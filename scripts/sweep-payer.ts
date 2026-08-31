/**
 * Returns everything in the disposable payer account to your wallet.
 *
 * Three things have to happen, in this order:
 *
 *   1. The USDC moves. Sent as a close-out (assetCloseTo), which transfers the
 *      entire holding and removes the opt-in in one transaction.
 *   2. Removing the opt-in releases the 0.1 ALGO it was locking as minimum
 *      balance. Skipping this strands that ALGO permanently.
 *   3. The remaining ALGO moves as a close-remainder, which empties the account
 *      down to zero and closes it. Doing this before step 1 would fail: an
 *      account holding assets cannot be closed.
 *
 * After this runs the payer account is empty and closed. Its key in
 * .payer.json still works — the address can be funded and reused — but nothing
 * is left in it.
 *
 *   npx tsx scripts/sweep-payer.ts            # shows the plan, sends nothing
 *   npx tsx scripts/sweep-payer.ts --yes      # actually signs and submits
 */
import { readFileSync } from "node:fs";
import algosdk from "algosdk";

import { loadEnv } from "./env.js";

loadEnv();

const CONFIRMED = process.argv.includes("--yes");

const USDC = Number(process.env["USDC_ASSET"] ?? 31566704);
const IS_MAINNET = USDC === 31566704;
const NET = IS_MAINNET ? "mainnet" : "testnet";
const ALGOD = process.env["ALGOD_URL"] ?? `https://${NET}-api.algonode.cloud`;

/** Where the funds go. Your wallet, which is also the payTo address. */
const DESTINATION =
  process.env["SWEEP_TO"] ?? process.env["PAY_TO"] ?? "";

if (!algosdk.isValidAddress(DESTINATION)) {
  console.error(
    `\n  SWEEP_TO is not a valid Algorand address: "${DESTINATION}"\n\n` +
      `  Set it explicitly rather than trusting a default — this is the address\n` +
      `  that receives everything, and a typo sends funds somewhere unrecoverable.\n`,
  );
  process.exit(1);
}

const payer = JSON.parse(readFileSync("./.payer.json", "utf8")) as {
  address: string;
  privateKey: string;
};

if (payer.address === DESTINATION) {
  console.error("\n  Payer and destination are the same account. Nothing to do.\n");
  process.exit(1);
}

const algod = new algosdk.Algodv2("", ALGOD, "");
const sk = new Uint8Array(Buffer.from(payer.privateKey, "base64"));

const account = await algod.accountInformation(payer.address).do();
const algo = Number(account.amount);
const holding = account.assets?.find((a) => Number(a.assetId) === USDC);
const usdc = holding ? Number(holding.amount) : 0;

console.log(`\nSweeping the payer account  (${NET.toUpperCase()})\n`);
console.log("=".repeat(72));
console.log(`\n  from: ${payer.address}`);
console.log(`  to:   ${DESTINATION}\n`);
console.log(`  USDC: ${(usdc / 1e6).toFixed(6)}`);
console.log(`  ALGO: ${(algo / 1e6).toFixed(6)}  (min balance ${(Number(account.minBalance) / 1e6).toFixed(6)} locked)`);

if (algo === 0) {
  console.log("\n  Account is already empty.\n");
  process.exit(0);
}

// --- Show what will be signed, and check it -------------------------------

console.log(`\n  Plan:`);
if (holding) {
  console.log(`    1. Close out ASA ${USDC} to the destination`);
  console.log(`       moves ${(usdc / 1e6).toFixed(6)} USDC and frees 0.1 ALGO of minimum balance`);
}
console.log(`    ${holding ? 2 : 1}. Close the account, sending all remaining ALGO to the destination`);
console.log(`       the payer address ends at zero and is closed\n`);

process.env["PAY_TO"] ??= DESTINATION;
process.env["ARBITER_NETWORK"] ??= NET;
const { judgeTransaction } = await import("../src/engine/transaction.js");

if (!CONFIRMED) {
  console.log("=".repeat(72));
  console.log("\n  Nothing sent. Re-run with --yes to sign and submit.\n");
  process.exit(0);
}

// --- 1. Asset close-out ----------------------------------------------------

if (holding) {
  const params = await algod.getTransactionParams().do();
  const closeAsset = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
    sender: payer.address,
    receiver: DESTINATION,
    amount: 0, // the close-out carries the whole balance
    assetIndex: USDC,
    closeRemainderTo: DESTINATION,
    suggestedParams: params,
  });

  // Arbiter flags asset close-outs as dangerous, and it is right to: this is
  // the shape of a drain. Here it is intended, which is exactly why a verdict
  // is advice to a human and not an automatic veto.
  const verdict = await judgeTransaction({
    chain: "algorand",
    transaction: Buffer.from(closeAsset.toByte()).toString("base64"),
    signer: payer.address,
  });
  console.log(`  firewall on the asset close-out: ${verdict.decision.toUpperCase()} (risk ${verdict.risk}/100)`);
  for (const f of verdict.findings) console.log(`    - [${f.severity.toUpperCase()}] ${f.title}`);
  console.log("  proceeding: this drain is the intended operation\n");

  const { txid } = await algod.sendRawTransaction(closeAsset.signTxn(sk)).do();
  const done = await algosdk.waitForConfirmation(algod, txid, 8);
  console.log(`  USDC swept:    ${txid}`);
  console.log(`  confirmed in round ${done.confirmedRound}`);
  console.log(`  explorer: https://lora.algokit.io/${NET}/transaction/${txid}\n`);
}

// --- 2. Close the account --------------------------------------------------

// Re-read: the asset close-out changed both the balance and the minimum.
const after = await algod.accountInformation(payer.address).do();
const params2 = await algod.getTransactionParams().do();

const closeAccount = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
  sender: payer.address,
  receiver: DESTINATION,
  amount: 0, // close-remainder carries the rest, less the fee
  closeRemainderTo: DESTINATION,
  suggestedParams: params2,
});

const { txid: txid2 } = await algod.sendRawTransaction(closeAccount.signTxn(sk)).do();
const done2 = await algosdk.waitForConfirmation(algod, txid2, 8);

const sent = (Number(after.amount) - Number(params2.minFee ?? 1000)) / 1e6;
console.log(`  ALGO swept:    ${txid2}`);
console.log(`  confirmed in round ${done2.confirmedRound}`);
console.log(`  ~${sent.toFixed(6)} ALGO sent`);
console.log(`  explorer: https://lora.algokit.io/${NET}/transaction/${txid2}\n`);

// --- Verify against the chain rather than against the responses above ------

const final = await algod.accountInformation(payer.address).do().catch(() => null);
const dest = await algod.accountInformation(DESTINATION).do();
const destUsdc = dest.assets?.find((a) => Number(a.assetId) === USDC);

console.log("=".repeat(72));
console.log(`\n  payer now:  ALGO ${((Number(final?.amount) || 0) / 1e6).toFixed(6)}  (closed)`);
console.log(
  `  wallet now: ALGO ${(Number(dest.amount) / 1e6).toFixed(6)}  ` +
    `USDC ${destUsdc ? (Number(destUsdc.amount) / 1e6).toFixed(6) : "0"}\n`,
);
