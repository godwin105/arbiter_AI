/**
 * Posts a real, paid human-judgment question to a running Arbiter.
 *
 * Used to put work in front of the reviewer app. Returns immediately with a
 * pending verdict rather than long-polling, because the point here is to create
 * the task, not to wait for it.
 *
 *   npx tsx scripts/ask-human.ts "Does this photo show a package at a door?"
 */
import { readFileSync } from "node:fs";
import { ArbiterClient } from "@arbiter/sdk";

import { loadEnv, requireArbiter } from "./env.js";

loadEnv();

const BASE_URL = process.env["ARBITER_URL"] ?? "http://localhost:4021";
await requireArbiter(BASE_URL);

const payer = JSON.parse(readFileSync("./.payer.json", "utf8")) as {
  address: string;
  privateKey: string;
};

const question =
  process.argv[2] ?? "Does this photo show a package left at a front door?";
const attachments = process.argv.slice(3);

const client = new ArbiterClient({
  baseUrl: BASE_URL,
  privateKey: payer.privateKey,
  maxPricePerCallUsd: 0.5,
  maxTotalSpendUsd: 5,
});

console.log(`\n  asking: "${question}"`);
if (attachments.length) console.log(`  with ${attachments.length} attachment(s)`);
console.log(`  paying from ${payer.address}\n`);

const verdict = await client.judgeHuman({
  question,
  ...(attachments.length ? { attachments } : {}),
  options: ["yes", "no", "unclear"],
  quorum: 1,
  // Do not block: the reviewer app is where this gets answered.
  waitSeconds: 0,
});

console.log(`  ${verdict.decision.toUpperCase()} — ${verdict.evidence.status}`);
console.log(`  taskId:  ${verdict.evidence.taskId}`);
console.log(`  payout:  $${verdict.evidence.payoutPerReviewerUsdc} per reviewer`);
console.log(`  collect: ${verdict.evidence.retrieveUrl}`);
console.log(`\n  paid $${client.spentUsd.toFixed(6)} — the question is now in the reviewer queue.\n`);
