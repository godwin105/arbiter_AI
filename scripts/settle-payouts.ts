/**
 * Pays reviewers what they are owed.
 *
 *   npx tsx scripts/settle-payouts.ts --dry-run   # check everything, send nothing
 *   npx tsx scripts/settle-payouts.ts             # actually pay
 *
 * Requires ARBITER_PAYOUT_MNEMONIC (or ARBITER_PAYOUT_PRIVATE_KEY) in .env, on
 * an account holding USDC and a little ALGO for fees.
 */
import { loadEnv } from "./env.js";

loadEnv();

const { config } = await import("../src/config.js");
const { FilePersistence, NullPersistence } = await import("../src/marketplace/persistence.js");
const { store } = await import("../src/marketplace/store.js");
const { loadPayoutAccount, payoutBalance, settlePayouts } = await import("../src/payouts/settle.js");

const dryRun = process.argv.includes("--dry-run");

// The ledger lives with the server, so settlement has to read the same state.
await store.init(
  config.env.STATE_FILE === "off"
    ? new NullPersistence()
    : new FilePersistence(config.env.STATE_FILE),
);

console.log(`\nArbiter payout settlement${dryRun ? " — DRY RUN" : ""}\n`);
console.log("=".repeat(78));

const account = loadPayoutAccount();
if (!account) {
  console.error(
    "\n  No payout account configured.\n\n" +
      "  Set ARBITER_PAYOUT_MNEMONIC (25 words) or ARBITER_PAYOUT_PRIVATE_KEY\n" +
      "  (base64) in .env. Use an account that holds working capital only —\n" +
      "  keep it separate from PAY_TO, which accumulates revenue.\n",
  );
  process.exit(1);
}

const from = account.addr.toString();
const balance = await payoutBalance(from);

console.log(`\n  network : ${config.network}`);
console.log(`  paying from: ${from}`);
console.log(`  balance : ${balance.usdc.toFixed(6)} USDC, ${balance.algo.toFixed(6)} ALGO\n`);

const owed = store.workersOwed();
const stuck = store.stuckPayouts();

if (stuck.length > 0) {
  console.log(`  ${stuck.length} payout(s) stuck in "settling" from an interrupted run:`);
  for (const p of stuck) {
    console.log(`    ${p.id}  ${p.amountUsdc} USDC  attempt ${p.attemptId}`);
  }
  console.log(
    `  Reconcile against the ledger before re-running — search the payout\n` +
      `  account's transactions for the note "arbiter:payout:<attemptId>".\n`,
  );
}

if (owed.length === 0) {
  console.log("  Nothing owed.\n");
  process.exit(0);
}

console.log(`  ${owed.length} reviewer(s) owed:\n`);
for (const w of owed) {
  console.log(
    `    ${w.payoutAddress.slice(0, 12)}…  ${w.amountUsdc.toFixed(6)} USDC  (${w.count} payout${w.count === 1 ? "" : "s"})`,
  );
}

console.log(`\n${"-".repeat(78)}\n`);

const summary = await settlePayouts({ dryRun });

for (const r of summary.results) {
  const icon = r.status === "settled" ? "[PAID]" : r.status === "skipped" ? "[SKIP]" : "[FAIL]";
  console.log(`${icon}  ${r.amountUsdc.toFixed(6)} USDC -> ${r.payoutAddress.slice(0, 16)}…`);
  if (r.txId) {
    console.log(`        txid  ${r.txId}`);
    console.log(`        round ${r.confirmedRound}`);
    const net = config.isMainnet ? "mainnet" : "testnet";
    console.log(`        https://lora.algokit.io/${net}/transaction/${r.txId}`);
  }
  if (r.reason) console.log(`        ${r.reason}`);
  console.log("");
}

console.log("=".repeat(78));
console.log(
  `\n  ${summary.settled} settled, ${summary.skipped} skipped, ${summary.failed} failed — ` +
    `${summary.totalPaidUsdc.toFixed(6)} USDC${dryRun ? " (dry run, nothing sent)" : ""}.\n`,
);

process.exit(summary.failed > 0 ? 1 : 0);
