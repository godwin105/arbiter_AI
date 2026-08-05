/**
 * KeeperHub × Arbiter — execution with judgment in front of it.
 *
 * KeeperHub is the execution layer: it submits transactions reliably, handling
 * nonces, retries, gas and RPC failover. What it deliberately does not do is
 * decide whether a transaction *should* be submitted — a wallet-draining
 * approval executes just as dependably as a legitimate transfer.
 *
 * This runs two intents through the same agent. One is refused before it
 * reaches KeeperHub. The other is judged clean and executed for real on
 * Sepolia, producing a transaction hash.
 *
 *   KEEPERHUB_API_KEY=kh_... npm run demo:keeperhub
 */
import { loadEnv, requireArbiter } from "./env.js";

// Before anything reads process.env, or the API key looks absent rather than
// unloaded.
loadEnv();

const { GuardedAgent } = await import("../clients/keeperhub/src/guarded-agent.js");
const { KeeperHubError } = await import("../clients/keeperhub/src/client.js");
type Intent = import("../clients/keeperhub/src/guarded-agent.js").Intent;

const SEPOLIA = 11155111;
const ARBITER_URL = process.env["ARBITER_URL"] ?? "http://localhost:4021";

await requireArbiter(ARBITER_URL);

/** A key-controlled account — the shape a drainer's "spender" takes. */
const ATTACKER = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
/** Sepolia WETH, a real deployed token contract. */
const SEPOLIA_WETH = "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14";
/** Where the safe transfer goes. Override to send somewhere you control. */
const RECIPIENT = process.env["DEMO_RECIPIENT"] ?? ATTACKER;

const MAX_UINT256 = (1n << 256n) - 1n;

const agent = new GuardedAgent({
  arbiterUrl: ARBITER_URL,
  arbiterPrivateKey: process.env["ARBITER_PRIVATE_KEY"],
  keeperHubApiKey: process.env["KEEPERHUB_API_KEY"],
  // Only a clean verdict may execute. An autonomous agent has no operator
  // standing by to accept a WARN, so anything short of ALLOW stops.
  allowDecisions: ["allow"],
});

const intents: Intent[] = [
  {
    kind: "erc20-approve",
    chainId: SEPOLIA,
    token: SEPOLIA_WETH,
    spender: ATTACKER,
    amount: MAX_UINT256,
    description: "Approve unlimited WETH to an address that turned up in a prompt",
  },
  {
    kind: "native-transfer",
    chainId: SEPOLIA,
    to: RECIPIENT,
    amountEth: "0.0001",
    description: "Send 0.0001 Sepolia ETH",
  },
];

console.log("\nKeeperHub x Arbiter — judgment before execution\n");
console.log("=".repeat(78));
console.log(`\n  arbiter:  ${ARBITER_URL}`);
console.log(`  chain:    Sepolia (${SEPOLIA})\n`);

if (!agent.keeperHub.configured) {
  console.log("  keeperhub: NO API KEY — judgment will run, execution will be skipped.");
  console.log("             Set KEEPERHUB_API_KEY in .env to execute for real.\n");
} else {
  try {
    const chains = await agent.keeperHub.chains();
    const sepolia = chains.find((c) => c.chainId === SEPOLIA);
    console.log(
      `  keeperhub: reachable, ${chains.length} chains, Sepolia ` +
        `${sepolia?.isEnabled ? "enabled" : "NOT enabled"}\n`,
    );
  } catch (err) {
    if (err instanceof KeeperHubError) {
      console.error(`\n  KeeperHub unreachable: ${err.message}\n`);
      process.exit(1);
    }
    throw err;
  }
}

let executed = 0;
let refused = 0;

for (const intent of intents) {
  console.log("-".repeat(78));
  console.log(`\n  INTENT: ${intent.description}\n`);

  let result;
  try {
    result = await agent.execute(intent);
  } catch (err) {
    if (err instanceof KeeperHubError && err.status === 0) {
      // Verdict permitted execution, but no execution layer is configured.
      const verdict = await agent.judge(intent);
      console.log(`  Arbiter: ${verdict.decision.toUpperCase()} — risk ${verdict.risk}/100`);
      console.log(`\n  KeeperHub: SKIPPED (no API key configured)\n`);
      continue;
    }
    throw err;
  }
  const v = result.verdict;

  console.log(`  Arbiter: ${v.decision.toUpperCase()} — risk ${v.risk}/100, confidence ${v.confidence}`);
  console.log(
    `           decoded ${v.evidence.decoded?.function ?? "(plain transfer)"}` +
      `, target ${v.evidence.targetKind ?? "?"}` +
      (v.evidence.spenderKind ? `, spender ${v.evidence.spenderKind}` : ""),
  );
  for (const f of v.findings) {
    console.log(`             [${f.severity.toUpperCase()}] ${f.title}`);
  }

  if (!result.executed) {
    refused += 1;
    console.log(`\n  KeeperHub: NOT CALLED`);
    console.log(`  ${result.refusedBecause}\n`);
    continue;
  }

  executed += 1;
  const e = result.execution!;
  console.log(`\n  KeeperHub: executed`);
  console.log(`             executionId ${e.executionId}`);
  console.log(`             status      ${e.status}`);
  if (e.transactionHash) console.log(`             txHash      ${e.transactionHash}`);
  if (e.transactionLink) console.log(`             explorer    ${e.transactionLink}`);
  for (const r of e.receipts ?? []) {
    console.log(
      `             receipt     block ${r.blockNumber}, gas ${r.gasUsed}, ${r.receiptStatus}`,
    );
  }
  console.log("");
}

console.log("=".repeat(78));
console.log(`\n  ${refused} intent(s) refused before execution, ${executed} executed onchain.\n`);
console.log("  The refusal is the point: KeeperHub would have submitted that approval");
console.log("  perfectly reliably. Reliability is not safety.\n");
