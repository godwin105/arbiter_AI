/**
 * Puts every route into the Bazaar catalog by paying for each one once.
 *
 * A route is only catalogued after it settles a payment, and the catalog then
 * freezes what it recorded: the advertised examples and the payment options are
 * captured at first registration and never re-read. Two consequences:
 *
 *   - A route that has never been paid for on this URL is invisible to any
 *     agent browsing for services.
 *   - A route first registered with wrong examples keeps advertising them, so
 *     after correcting an example the route must be registered afresh — which
 *     in practice means a new URL, since the record is keyed on method + URL.
 *
 * Run this after deploying to a new hostname.
 *
 *   ARBITER_URL=https://arbiter-x402.onrender.com npx tsx scripts/register-routes.ts
 *
 * Costs the sum of the route prices, paid from .payer.json. When payer and
 * payTo are both yours the money comes back; the facilitator sponsors the fees.
 */
import { readFileSync } from "node:fs";
import { ArbiterClient } from "@arbiterlabs/sdk";

import { loadEnv, requireArbiter } from "./env.js";

loadEnv();

const BASE_URL = process.env["ARBITER_URL"] ?? "http://localhost:4021";
await requireArbiter(BASE_URL);

const manifest = (await (
  await fetch(BASE_URL, { headers: { accept: "application/json" } })
).json()) as { network: string; payTo: string; asset: { id: string } };

const payer = JSON.parse(readFileSync("./.payer.json", "utf8")) as {
  address: string;
  privateKey: string;
};

const client = new ArbiterClient({
  baseUrl: BASE_URL,
  privateKey: payer.privateKey,
  maxPricePerCallUsd: 0.5,
  // Enough for one call to each route, and no more. A registration run that
  // silently loops would spend real money.
  maxTotalSpendUsd: 0.4,
});

console.log(`\nRegistering routes in the Bazaar catalog\n`);
console.log(`  endpoint: ${BASE_URL}`);
console.log(`  network:  ${manifest.network}${manifest.network === "mainnet" ? "  — REAL FUNDS" : ""}`);
console.log(`  payTo:    ${manifest.payTo}\n`);

/**
 * Each route is registered with the example it advertises, read from its own
 * 402 response. If an advertised example does not work, this run fails on it —
 * which is the point: it fails here rather than for a stranger's agent.
 */
async function advertisedExample(route: string): Promise<any> {
  const res = await fetch(`${BASE_URL}${route}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  const header = res.headers.get("payment-required");
  if (!header) throw new Error("no PAYMENT-REQUIRED header");
  const pr = JSON.parse(Buffer.from(header, "base64").toString());
  const body = pr?.extensions?.bazaar?.info?.input?.body;
  if (!body) throw new Error("catalog advertises no example body");
  return body;
}

let failures = 0;

const jobs: Array<[string, (body: any) => Promise<any>]> = [
  ["/v1/judge/transaction", (b) => client.judgeTransaction(b)],
  ["/v1/judge/counterparty", (b) => client.judgeCounterparty(b)],
  // waitSeconds 0 registers and pays for the route without blocking on a
  // reviewer actually answering.
  ["/v1/judge/human", (b) => client.judgeHuman({ ...b, waitSeconds: 0 })],
];

for (const [route, call] of jobs) {
  process.stdout.write(`  ${route.padEnd(24)}`);
  try {
    const body = await advertisedExample(route);
    const v = await call(body);
    console.log(`${v.decision.toUpperCase()} (risk ${v.risk}/100)`);
  } catch (err) {
    failures++;
    console.log(`FAILED — ${(err as Error).message}`);
  }
}

console.log(`\n  spent $${client.spentUsd.toFixed(6)}`);

if (failures > 0) {
  console.error(`\n  ${failures} route(s) failed. They are not catalogued.\n`);
  process.exit(1);
}

console.log(
  "\n  All routes registered. The catalog records what they advertise now,\n" +
    "  so verify it before assuming it is right:\n" +
    "    curl -s 'https://facilitator.goplausible.xyz/discovery/resources?limit=500'\n",
);
