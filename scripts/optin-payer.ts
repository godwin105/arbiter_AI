/**
 * Opts the disposable testnet payer account in to USDC.
 *
 * An opt-in is a zero-amount transfer of the asset from an account to itself;
 * that single transaction is what creates the account's slot for the asset and
 * raises its minimum balance by 0.1 ALGO.
 *
 * The transaction is run through Arbiter's own firewall before signing, which
 * is the behaviour the product exists to encourage: never sign something you
 * have not decoded.
 *
 *   npx tsx scripts/optin-payer.ts
 */
import { readFileSync } from "node:fs";
import algosdk from "algosdk";

const ALGOD = "https://testnet-api.algonode.cloud";
const USDC_TESTNET = 10458941;

const payer = JSON.parse(readFileSync("./.payer.json", "utf8")) as {
  address: string;
  privateKey: string;
};

process.env["PAY_TO"] ??= payer.address;
process.env["ARBITER_NETWORK"] ??= "testnet";
const { judgeTransaction } = await import("../src/engine/transaction.js");

const algod = new algosdk.Algodv2("", ALGOD, "");
const params = await algod.getTransactionParams().do();

// Zero-amount self-transfer: sender and receiver are the same account.
const optIn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
  sender: payer.address,
  receiver: payer.address,
  amount: 0,
  assetIndex: USDC_TESTNET,
  suggestedParams: params,
});

const encoded = Buffer.from(optIn.toByte()).toString("base64");

console.log("\nOpting payer in to USDC\n");
console.log(`  account: ${payer.address}`);
console.log(`  asset:   ${USDC_TESTNET} (testnet USDC)\n`);

// --- Check it before signing it --------------------------------------------

const verdict = await judgeTransaction({
  chain: "algorand",
  transaction: encoded,
  signer: payer.address,
});

console.log(`  firewall: ${verdict.decision.toUpperCase()} (risk ${verdict.risk}/100)`);
for (const f of verdict.findings) {
  console.log(`    - [${f.severity.toUpperCase()}] ${f.title}`);
}
if (verdict.findings.length === 0) console.log("    (no findings)");

if (verdict.decision === "block") {
  console.error("\n  Firewall blocked this transaction. Not signing.\n");
  process.exit(1);
}

// --- Sign and submit --------------------------------------------------------

const sk = new Uint8Array(Buffer.from(payer.privateKey, "base64"));
const signed = optIn.signTxn(sk);

const { txid } = await algod.sendRawTransaction(signed).do();
console.log(`\n  submitted: ${txid}`);

const confirmed = await algosdk.waitForConfirmation(algod, txid, 8);
console.log(`  confirmed in round ${confirmed.confirmedRound}`);
console.log(`  explorer: https://lora.algokit.io/testnet/transaction/${txid}\n`);

const account = await algod.accountInformation(payer.address).do();
const holding = account.assets?.find((a) => Number(a.assetId) === USDC_TESTNET);
console.log(`  assets opted in: ${account.totalAssetsOptedIn}`);
console.log(`  USDC slot:       ${holding ? "present" : "MISSING"}`);
console.log(`  min balance:     ${(Number(account.minBalance) / 1e6).toFixed(6)} ALGO\n`);
