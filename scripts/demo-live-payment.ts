/**
 * The full loop with real value moving.
 *
 * An agent asks Arbiter whether a transaction is safe to sign. It gets a 402,
 * constructs an Algorand USDC payment, the GoPlausible facilitator settles it,
 * and the verdict comes back. Then the USDC balance is re-read from the chain,
 * because settling a payment and *receiving* one are different claims and only
 * the second is worth anything.
 *
 * Requires a running server and a funded payer:
 *   npm run dev
 *   npx tsx scripts/demo-live-payment.ts
 */
import { readFileSync } from "node:fs";
import algosdk from "algosdk";
import { ArbiterClient } from "@arbiter/sdk";

import { loadEnv, requireArbiter } from "./env.js";

loadEnv();

const ALGOD = "https://testnet-api.algonode.cloud";
const INDEXER = "https://testnet-idx.algonode.cloud";
const USDC = 10458941;

const BASE_URL = process.env["ARBITER_URL"] ?? "http://localhost:4021";
const PAY_TO = process.env["PAY_TO"]!;

await requireArbiter(BASE_URL);

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

console.log("\nArbiter — live payment on Algorand TestNet\n");
console.log("=".repeat(78));
console.log(`\n  endpoint: ${BASE_URL}`);
console.log(`  payer:    ${payer.address}`);
console.log(`  payTo:    ${PAY_TO}\n`);

const before = { payer: await usdcBalance(payer.address), payTo: await usdcBalance(PAY_TO) };
console.log(`  USDC before  payer ${before.payer.toFixed(6)}  ->  payTo ${before.payTo.toFixed(6)}`);

// Something worth asking about: a rekey attack disguised as a harmless 0-ALGO
// payment. This is the transaction the agent is deciding whether to sign.
const victim = algosdk.generateAccount();
const attacker = algosdk.generateAccount();
const algod = new algosdk.Algodv2("", ALGOD, "");
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
  const res = await fetch(
    `${INDEXER}/v2/accounts/${PAY_TO}/transactions?limit=3&asset-id=${USDC}`,
  );
  const body = (await res.json()) as { transactions?: any[] };
  const transfer = body.transactions?.find((t) => t["asset-transfer-transaction"]?.amount > 0);
  if (transfer) {
    console.log(`\n  settlement txid: ${transfer.id}`);
    console.log(`  confirmed round: ${transfer["confirmed-round"]}`);
    console.log(`  explorer:        https://lora.algokit.io/testnet/transaction/${transfer.id}`);
  }
} catch {
  console.log("\n  (indexer lookup unavailable)");
}

console.log(`\n${"=".repeat(78)}`);
if (received > 0) {
  console.log("\n  Real payment settled. USDC moved from payer to payTo on Algorand TestNet.\n");
  process.exit(0);
}
console.log("\n  No USDC arrived at payTo. The call returned a verdict but settlement did not land.\n");
process.exit(1);
