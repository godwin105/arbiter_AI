/**
 * Proves the SDK's spend guards actually fire.
 *
 * The budget check runs inside the payment selector, which the x402 client
 * invokes after receiving a 402 and *before* constructing or signing anything.
 * That is what makes this verifiable without funded accounts: a client whose cap
 * is below the route price must fail with a budget error, not a signing or
 * funding error.
 *
 * Requires a running Arbiter server:
 *   PAY_TO=... npm run dev
 *   npm run demo:budget
 */
import algosdk from "algosdk";
import { ArbiterBudgetError, ArbiterClient, ArbiterError } from "@arbiter/sdk";

const BASE_URL = process.env["ARBITER_URL"] ?? "http://localhost:4021";

// A real, well-formed key so the payment path is genuinely exercised. It holds
// no funds, which is fine: the guard must reject before funds ever matter.
const account = algosdk.generateAccount();
const privateKey = Buffer.from(account.sk).toString("base64");

console.log("\nArbiter SDK — spend guard\n");
console.log("=".repeat(78));
console.log(`\ntarget: ${BASE_URL}`);
console.log(`payer:  ${account.addr.toString()} (unfunded, deliberately)\n`);

const TXN = "invalid-but-irrelevant-the-guard-runs-first";

interface Case {
  name: string;
  why: string;
  client: ArbiterClient;
  expect: "budget" | "other";
}

const cases: Case[] = [
  {
    name: "Per-call cap below route price",
    why: "Route costs $0.002; cap is $0.001. Must refuse before signing.",
    client: new ArbiterClient({ baseUrl: BASE_URL, privateKey, maxPricePerCallUsd: 0.001 }),
    expect: "budget",
  },
  {
    name: "Lifetime cap already exhausted",
    why: "Total budget is $0.0001, less than one call. Must refuse.",
    client: new ArbiterClient({ baseUrl: BASE_URL, privateKey, maxTotalSpendUsd: 0.0001 }),
    expect: "budget",
  },
  {
    name: "Caps generous enough to proceed",
    why: "Guard must NOT fire — failure should come from the unfunded wallet instead.",
    client: new ArbiterClient({
      baseUrl: BASE_URL,
      privateKey,
      maxPricePerCallUsd: 1,
      maxTotalSpendUsd: 25,
    }),
    expect: "other",
  },
];

let failures = 0;

for (const c of cases) {
  let outcome: "budget" | "other" | "no-error" = "no-error";
  let detail = "";

  try {
    await c.client.judgeTransaction({ transaction: TXN });
    detail = "call unexpectedly succeeded";
  } catch (err) {
    if (err instanceof ArbiterBudgetError) {
      outcome = "budget";
      detail = err.message;
    } else {
      outcome = "other";
      detail = err instanceof ArbiterError ? `${err.name}: ${err.message}` : String(err);
    }
  }

  const ok = outcome === c.expect;
  if (!ok) failures += 1;

  console.log(`${ok ? "[PASS]" : "[FAIL]"}  ${c.name}`);
  console.log(`        ${c.why}`);
  console.log(`        outcome: ${outcome} (expected ${c.expect})`);
  console.log(`        ${detail.replace(/\s+/g, " ").slice(0, 150)}`);
  console.log(`        spent so far: $${c.client.spentUsd.toFixed(6)}`);
  console.log("");
}

console.log("=".repeat(78));
console.log(
  failures === 0
    ? "\nSpend guards behaved as expected.\n"
    : `\n${failures} case(s) misbehaved.\n`,
);
process.exit(failures === 0 ? 0 : 1);
