/**
 * The full loop with real value moving.
 *
 * An agent asks Arbiter whether a transaction is safe to sign. It gets a 402,
 * constructs an Algorand USDC payment, the GoPlausible facilitator settles it,
 * and the verdict comes back. Then the USDC balance is re-read from the chain,
 * because settling a payment and *receiving* one are different claims and only
 * the second is worth anything.
 *
 * Network, asset and payTo are read from the server's own manifest rather than
 * hardcoded. A demo that names a different network than the server is running
 * on is worse than no demo: it reports success against the wrong chain.
 *
 * Requires a running server and a funded payer:
 *   npm run dev
 *   npx tsx scripts/demo-live-payment.ts
 */
import { readFileSync } from "node:fs";
import algosdk from "algosdk";
import { ArbiterClient } from "@arbiterlabs/sdk";

import { loadEnv, requireArbiter } from "./env.js";

loadEnv();

const BASE_URL = process.env["ARBITER_URL"] ?? "http://localhost:4021";

await requireArbiter(BASE_URL);

// --- Take the network from the server, not from a constant ------------------

type Manifest = {
  network: string;
  payTo: string;
  asset: { id: string; symbol: string };
};

const manifestRes = await fetch(BASE_URL, { headers: { accept: "application/json" } });
if (!manifestRes.ok) {
  console.error(`\n  ${BASE_URL} did not return a manifest (${manifestRes.status}).\n`);
  process.exit(1);
}
const manifest = (await manifestRes.json()) as Manifest;

const NET = manifest.network === "mainnet" ? "mainnet" : "testnet";
const ALGOD = `https://${NET}-api.algonode.cloud`;
const INDEXER = `https://${NET}-idx.algonode.cloud`;
const USDC = Number(manifest.asset.id);
const PAY_TO = manifest.payTo;

// A stale PAY_TO in .env would have this script watch an account the server
// never credits, then report "no USDC arrived" against a payment that worked.
const localPayTo = process.env["PAY_TO"];
if (localPayTo && localPayTo !== PAY_TO) {
  console.warn(
    `\n  note: local PAY_TO (${localPayTo.slice(0, 10)}...) differs from the server's\n` +
      `  (${PAY_TO.slice(0, 10)}...). Following the server, which is what actually gets paid.`,
  );
}

const payer = JSON.parse(readFileSync("./.payer.json", "utf8")) as {
  address: string;
  privateKey: string;
};

async function usdcBalance(address: string): Promise<number> {
  const res = await fetch(`${ALGOD}/v2/accounts/${address}`);
  const body = (await res.json()) as { assets?: Array<{ "asset-id": number; amount: number }> };
  const holding = body.assets?.find((a) => a["asset-id"] === USDC);
  return holding ? holding.amount / 1e6 : 0;
}

const LABEL = NET === "mainnet" ? "MainNet" : "TestNet";
console.log(`\nArbiter — live payment on Algorand ${LABEL}\n`);
console.log("=".repeat(78));
console.log(`\n  endpoint: ${BASE_URL}`);
console.log(`  network:  ${LABEL}${NET === "mainnet" ? "  — REAL FUNDS" : ""}`);
console.log(`  asset:    ${USDC} (${manifest.asset.symbol})`);
console.log(`  payer:    ${payer.address}`);
console.log(`  payTo:    ${PAY_TO}\n`);

const before = { payer: await usdcBalance(payer.address), payTo: await usdcBalance(PAY_TO) };
console.log(`  USDC before  payer ${before.payer.toFixed(6)}  ->  payTo ${before.payTo.toFixed(6)}`);

if (before.payer === 0) {
  console.error(`\n  The payer holds no USDC. Fund ${payer.address} and run this again.\n`);
  process.exit(1);
}

const algod = new algosdk.Algodv2("", ALGOD, "");

// Everything at or below this round already existed. Anything the settlement
// produces lands above it, which is how the lookup below avoids mistaking
// earlier history for the payment it just made.
const baselineRound = Number((await algod.status().do()).lastRound);

// Something worth asking about: a rekey attack disguised as a harmless 0-ALGO
// payment. This is the transaction the agent is deciding whether to sign.
const victim = algosdk.generateAccount();
const attacker = algosdk.generateAccount();
const params = await algod.getTransactionParams().do();

const suspicious = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
  sender: victim.addr,
  receiver: victim.addr,
  amount: 0,
  rekeyTo: attacker.addr,
  suggestedParams: params,
});

const client = new ArbiterClient({
  baseUrl: BASE_URL,
  privateKey: payer.privateKey,
  maxPricePerCallUsd: 0.05,
  maxTotalSpendUsd: 1,
});

console.log("\n  calling POST /v1/judge/transaction ...\n");

const started = Date.now();
const verdict = await client.judgeTransaction({
  transaction: Buffer.from(suspicious.toByte()).toString("base64"),
  signer: victim.addr.toString(),
});
const elapsed = Date.now() - started;

console.log(`  ${verdict.decision.toUpperCase()} — risk ${verdict.risk}/100, confidence ${verdict.confidence}`);
for (const f of verdict.findings) {
  console.log(`    [${f.severity.toUpperCase()}] ${f.title}`);
}
console.log(`\n  verdict ${verdict.id} in ${elapsed}ms (engine ${verdict.meta.latencyMs}ms)`);
console.log(`  client reports spent: $${client.spentUsd.toFixed(6)}`);

// Settlement is asynchronous relative to the response, so give the chain a
// moment before claiming anything about balances.
console.log("\n  waiting for settlement to land on-chain...");
let after = { payer: before.payer, payTo: before.payTo };
for (let i = 0; i < 12; i++) {
  await new Promise((r) => setTimeout(r, 2_500));
  after = { payer: await usdcBalance(payer.address), payTo: await usdcBalance(PAY_TO) };
  if (after.payTo !== before.payTo) break;
}

console.log(`\n  USDC after   payer ${after.payer.toFixed(6)}  ->  payTo ${after.payTo.toFixed(6)}`);

const received = after.payTo - before.payTo;
const spent = before.payer - after.payer;

console.log(`\n  payer spent:    ${spent.toFixed(6)} USDC`);
console.log(`  payTo received: ${received.toFixed(6)} USDC`);

// --- Find the settlement transaction on-chain ------------------------------

try {
  // Two filters matter. `min-round` excludes history that predates this run,
  // and the receiver check excludes transfers payTo *sent* — without it the
  // most recent outgoing transfer gets reported as the incoming settlement.
  const res = await fetch(
    `${INDEXER}/v2/accounts/${PAY_TO}/transactions` +
      `?limit=10&asset-id=${USDC}&min-round=${baselineRound}`,
  );
  const body = (await res.json()) as { transactions?: any[] };
  const transfer = body.transactions?.find((t) => {
    const x = t["asset-transfer-transaction"];
    return x && x.amount > 0 && x.receiver === PAY_TO;
  });
  if (transfer) {
    console.log(`\n  settlement txid: ${transfer.id}`);
    console.log(`  from:            ${transfer.sender}`);
    console.log(`  amount:          ${(transfer["asset-transfer-transaction"].amount / 1e6).toFixed(6)} USDC`);
    console.log(`  confirmed round: ${transfer["confirmed-round"]}`);
    console.log(`  explorer:        https://lora.algokit.io/${NET}/transaction/${transfer.id}`);
  } else {
    console.log(`\n  (no incoming transfer above round ${baselineRound} yet — the indexer lags)`);
  }
} catch {
  console.log("\n  (indexer lookup unavailable)");
}

console.log(`\n${"=".repeat(78)}`);
if (received > 0) {
  console.log(`\n  Real payment settled. USDC moved from payer to payTo on Algorand ${LABEL}.\n`);
  process.exit(0);
}
console.log("\n  No USDC arrived at payTo. The call returned a verdict but settlement did not land.\n");
process.exit(1);
