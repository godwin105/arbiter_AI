/**
 * Builds real Algorand transactions that encode the actual ways agents lose
 * funds, then runs each through the firewall and prints the verdict.
 *
 * These are genuine encoded transactions, not fixtures — the engine sees exactly
 * what it would see in production.
 *
 *   npm run demo:attacks
 */
import algosdk from "algosdk";

// config is validated at import time, so the environment must be set up first.
const throwaway = algosdk.generateAccount();
process.env["PAY_TO"] ??= throwaway.addr.toString();
process.env["ARBITER_NETWORK"] ??= "testnet";

const { judgeTransaction } = await import("../src/engine/transaction.js");

const TESTNET_GENESIS_HASH = "SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI=";

const victim = algosdk.generateAccount();
const attacker = algosdk.generateAccount();
const friend = algosdk.generateAccount();

const VICTIM = victim.addr;
const ATTACKER = attacker.addr;
const FRIEND = friend.addr;

// Anchor validity windows to the live chain so the demo exercises the real rules
// rather than tripping the expiry check on every case.
const currentRound = await (async () => {
  try {
    const res = await fetch("https://testnet-api.algonode.cloud/v2/status");
    const body = (await res.json()) as { "last-round": number };
    return body["last-round"];
  } catch {
    return 1_000_000;
  }
})();

function params(overrides: Partial<algosdk.SuggestedParams> = {}): algosdk.SuggestedParams {
  return {
    minFee: 1_000,
    fee: 1_000,
    firstValid: currentRound,
    lastValid: currentRound + 1_000,
    genesisID: "testnet-v1.0",
    genesisHash: Uint8Array.from(Buffer.from(TESTNET_GENESIS_HASH, "base64")),
    flatFee: true,
    ...overrides,
  };
}

const b64 = (txn: algosdk.Transaction) => Buffer.from(txn.toByte()).toString("base64");

interface Case {
  name: string;
  why: string;
  txn: string;
}

const cases: Case[] = [
  {
    name: "Rekey attack",
    why: "Looks like a harmless 0-ALGO payment, but hands over the account forever.",
    txn: b64(
      algosdk.makePaymentTxnWithSuggestedParamsFromObject({
        sender: VICTIM,
        receiver: VICTIM,
        amount: 0,
        rekeyTo: ATTACKER,
        suggestedParams: params(),
      }),
    ),
  },
  {
    name: "Close-remainder drain",
    why: "States a 1 ALGO transfer while sweeping the entire remaining balance.",
    txn: b64(
      algosdk.makePaymentTxnWithSuggestedParamsFromObject({
        sender: VICTIM,
        receiver: FRIEND,
        amount: 1_000_000,
        closeRemainderTo: ATTACKER,
        suggestedParams: params(),
      }),
    ),
  },
  {
    name: "Asset close-out drain",
    why: "Sends 1 unit of an ASA but moves the whole holding to the attacker.",
    txn: b64(
      algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
        sender: VICTIM,
        receiver: FRIEND,
        amount: 1,
        assetIndex: 10458941,
        closeRemainderTo: ATTACKER,
        suggestedParams: params(),
      }),
    ),
  },
  {
    name: "Fee drain",
    why: "Tiny transfer, 5 ALGO fee. The loss is in the fee, not the amount.",
    txn: b64(
      algosdk.makePaymentTxnWithSuggestedParamsFromObject({
        sender: VICTIM,
        receiver: FRIEND,
        amount: 1_000,
        suggestedParams: params({ fee: 5_000_000 }),
      }),
    ),
  },
  {
    name: "Benign payment",
    why: "An ordinary 1 ALGO transfer. Must NOT be blocked, or the product is useless.",
    txn: b64(
      algosdk.makePaymentTxnWithSuggestedParamsFromObject({
        sender: VICTIM,
        receiver: FRIEND,
        amount: 1_000_000,
        suggestedParams: params(),
      }),
    ),
  },
];

const ICON: Record<string, string> = {
  allow: "[ALLOW]",
  warn: "[WARN ]",
  block: "[BLOCK]",
  escalate: "[ESCL ]",
};

console.log("\nArbiter transaction firewall — live decode of real transactions\n");
console.log(`signer under test: ${VICTIM.toString()}`);
console.log(`attacker address:  ${ATTACKER.toString()}\n`);
console.log("=".repeat(78));

let failures = 0;

for (const c of cases) {
  const verdict = await judgeTransaction({
    chain: "algorand",
    transaction: c.txn,
    signer: VICTIM.toString(),
  });

  console.log(`\n${ICON[verdict.decision]}  ${c.name}`);
  console.log(`         ${c.why}`);
  console.log(
    `         risk=${verdict.risk}/100  confidence=${verdict.confidence}  ` +
      `${verdict.meta.latencyMs}ms${verdict.meta.degraded ? "  (degraded)" : ""}`,
  );

  for (const f of verdict.findings) {
    console.log(`           - [${f.severity.toUpperCase()}] ${f.title}`);
    console.log(`             ${f.detail.replace(/\s+/g, " ").slice(0, 150)}`);
  }
  if (verdict.findings.length === 0) console.log("           (no findings)");

  const shouldBlock = c.name !== "Benign payment";
  const didBlock = verdict.decision === "block";
  if (shouldBlock !== didBlock) {
    console.log(`         !! EXPECTED ${shouldBlock ? "block" : "not-block"}, GOT ${verdict.decision}`);
    failures += 1;
  }
}

console.log(`\n${"=".repeat(78)}`);
console.log(failures === 0 ? "\nAll cases behaved as expected.\n" : `\n${failures} case(s) misbehaved.\n`);
process.exit(failures === 0 ? 0 : 1);
