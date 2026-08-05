/**
 * Drives the human judgment marketplace end to end: an agent asks a question,
 * reviewers pull it from the queue and answer, consensus resolves, and payouts
 * are recorded against each reviewer's address.
 *
 *   npm run demo:human
 */
import algosdk from "algosdk";

const throwaway = algosdk.generateAccount();
process.env["PAY_TO"] ??= throwaway.addr.toString();
process.env["ARBITER_NETWORK"] ??= "testnet";

const { judgeHuman } = await import("../src/engine/human.js");
const { store } = await import("../src/marketplace/store.js");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const reviewers = ["Ada", "Bem", "Chidi", "Dami"].map((name) =>
  store.registerWorker(name, algosdk.generateAccount().addr.toString()),
);

console.log("\nArbiter human judgment marketplace\n");
console.log("=".repeat(78));
console.log(`\nRegistered ${reviewers.length} reviewers:`);
for (const r of reviewers) {
  console.log(`  ${r.displayName.padEnd(6)} ${r.id}  -> ${r.payoutAddress.slice(0, 12)}...`);
}

interface Scenario {
  name: string;
  question: string;
  options: string[];
  quorum: number;
  /** [reviewerIndex, answer, rationale, responseMs] */
  answers: Array<[number, string, string, number]>;
}

const scenarios: Scenario[] = [
  {
    name: "Unanimous — clear evidence",
    question: "Does this photo show a package left at a front door?",
    options: ["yes", "no", "unclear"],
    quorum: 3,
    answers: [
      [0, "yes", "Package visible on the doormat, label facing up.", 6_200],
      [1, "yes", "Brown box against the door, clearly delivered.", 8_100],
      [2, "yes", "Parcel on the step, no one holding it.", 5_400],
    ],
  },
  {
    name: "Split — genuinely ambiguous",
    question: "Is the business name on this receipt 'Adeyemi Trading Ltd'?",
    options: ["yes", "no", "unclear"],
    quorum: 3,
    answers: [
      [0, "yes", "Header reads Adeyemi Trading Ltd, slightly blurred.", 11_000],
      [1, "unclear", "Text is cut off at the top; cannot confirm 'Ltd'.", 14_500],
      [3, "yes", "Matches, though the print is faint.", 9_800],
    ],
  },
  {
    name: "Rushed answers — quality signal",
    question: "Does this invoice total match the line items shown?",
    options: ["yes", "no"],
    quorum: 3,
    answers: [
      [0, "yes", "Totals add up.", 420],
      [1, "yes", "Looks right.", 610],
      [2, "yes", "Checked the sum, matches.", 12_400],
    ],
  },
];

const ICON: Record<string, string> = {
  allow: "[ALLOW]",
  warn: "[WARN ]",
  block: "[BLOCK]",
  escalate: "[ESCL ]",
};

for (const s of scenarios) {
  console.log(`\n${"=".repeat(78)}`);
  console.log(`\nAgent asks: "${s.question}"`);
  console.log(`Quorum: ${s.quorum}\n`);

  // The paid call long-polls while reviewers work.
  const pending = judgeHuman({
    question: s.question,
    options: s.options,
    quorum: s.quorum,
    waitSeconds: 20,
  });

  await sleep(50);

  // Reviewers pull from the queue and answer.
  for (const [idx, answer, rationale, ms] of s.answers) {
    const reviewer = reviewers[idx]!;
    const queue = store.queueFor(reviewer.id);
    const task = queue.find((t) => t.question === s.question);
    if (!task) {
      console.log(`  ${reviewer.displayName}: nothing in queue`);
      continue;
    }
    const result = store.submitResponse(task.id, reviewer, answer, rationale, ms);
    console.log(
      `  ${reviewer.displayName.padEnd(6)} answered "${answer}" in ${(ms / 1000).toFixed(1)}s` +
        (result.ok ? "" : `  (rejected: ${result.reason})`),
    );
  }

  const v = await pending;

  console.log(`\n${ICON[v.decision]}  answer="${v.evidence.answer}"  agreement=${v.evidence.agreement}`);
  console.log(`         risk=${v.risk}/100  confidence=${v.confidence}  ${v.meta.latencyMs}ms`);
  console.log(`         tally: ${JSON.stringify(v.evidence.tally)}`);
  console.log(`         payout per reviewer: ${v.evidence.payoutPerReviewerUsdc} USDC`);

  for (const f of v.findings) {
    console.log(`           - [${f.severity.toUpperCase()}] ${f.title}`);
    console.log(`             ${f.detail.replace(/\s+/g, " ").slice(0, 140)}`);
  }
  if (v.findings.length === 0) console.log("           (no findings — unanimous, proven panel)");
}

// --- Payout ledger ---------------------------------------------------------

console.log(`\n${"=".repeat(78)}`);
console.log("\nReviewer ledger\n");
console.log("  name    tasks  reliability   pending USDC   address");
for (const r of reviewers) {
  const worker = store.workerByToken(r.token)!;
  const e = store.earningsFor(worker.id);
  console.log(
    `  ${worker.displayName.padEnd(6)}  ${String(worker.tasksCompleted).padStart(4)}` +
      `  ${store.reliability(worker).toFixed(2).padStart(10)}` +
      `  ${e.pendingUsdc.padStart(13)}   ${worker.payoutAddress.slice(0, 16)}...`,
  );
}

const pending = store.pendingPayouts();
const total = pending.reduce((sum, p) => sum + Number(p.amountUsdc), 0);
console.log(`\n  ${pending.length} payouts pending on-chain settlement, ${total.toFixed(6)} USDC total.`);
console.log("  (Settlement requires a funded payout wallet — not yet configured.)\n");
