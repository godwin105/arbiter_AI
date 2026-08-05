/**
 * Human judgment.
 *
 * Wraps the marketplace in the same verdict contract as the machine engines, so
 * an agent that already handles /v1/judge/transaction can ask a human a question
 * without new response handling.
 *
 * The paid call long-polls for a bounded window. If reviewers answer in time the
 * verdict comes back inline; if not, the caller gets a pending verdict and a free
 * retrieval URL — they are never charged twice for the same question.
 */
import { PRICING, config } from "../config.js";
import type { Finding, Verdict } from "../types.js";
import { decide, scoreFindings } from "../types.js";
import { type HumanTask, store } from "../marketplace/store.js";

export const ENGINE_VERSION = "hm-1.0.0";

/** Portion of the call price paid out to reviewers, split across the quorum. */
const REVIEWER_SHARE = 0.6;
/** Below this, a panel is judged to have genuinely disagreed. */
const CONSENSUS_FLOOR = 0.6;
/** An answer faster than this suggests the reviewer did not look. */
const RUSHED_MS = 1_500;

export const DEFAULT_QUORUM = 3;
export const MAX_WAIT_SECONDS = 120;
export const TASK_TTL_SECONDS = 3_600;

export interface HumanRequest {
  question: string;
  attachments?: string[] | undefined;
  options?: string[] | undefined;
  quorum?: number | undefined;
  /** Seconds to hold the request open waiting for reviewers. */
  waitSeconds?: number | undefined;
}

export interface HumanEvidence {
  taskId: string;
  status: HumanTask["status"];
  question: string;
  answer: string | null;
  agreement: string | null;
  tally: Record<string, number> | null;
  reviewers: Array<{ rationale: string; answer: string; responseMs: number }>;
  responsesReceived: number;
  quorum: number;
  /** Free endpoint for retrieving the result later; the call is already paid. */
  retrieveUrl: string;
  payoutPerReviewerUsdc: string;
}

function priceToNumber(price: string): number {
  return Number(price.replace(/[^0-9.]/g, ""));
}

/** Builds the verdict for a task in whatever state it has reached. */
export function verdictForTask(task: HumanTask, startedAt: number): Verdict<HumanEvidence> {
  const findings: Finding[] = [];

  const evidence: HumanEvidence = {
    taskId: task.id,
    status: task.status,
    question: task.question,
    answer: task.resolution?.answer ?? null,
    agreement: task.resolution
      ? `${Math.round(task.resolution.agreement * task.responses.length)}/${task.responses.length}`
      : null,
    tally: task.resolution?.tally ?? null,
    reviewers: task.responses.map((r) => ({
      rationale: r.rationale,
      answer: r.answer,
      responseMs: r.responseMs,
    })),
    responsesReceived: task.responses.length,
    quorum: task.quorum,
    retrieveUrl: `${config.publicUrl}/v1/judge/human/${task.id}`,
    payoutPerReviewerUsdc: task.payoutPerReviewer,
  };

  let confidence: number;

  if (task.status === "resolved" && task.resolution) {
    const { agreement } = task.resolution;

    if (agreement < CONSENSUS_FLOOR) {
      findings.push({
        code: "human.no_consensus",
        severity: "high",
        title: "Reviewers did not agree",
        detail:
          `Only ${Math.round(agreement * 100)}% of reviewers chose "${task.resolution.answer}" ` +
          `(${JSON.stringify(task.resolution.tally)}). The question may be genuinely ambiguous ` +
          `or the evidence insufficient.`,
        source: "arbiter:consensus",
      });
    } else if (agreement < 1) {
      findings.push({
        code: "human.split_decision",
        severity: "low",
        title: "Reviewers were not unanimous",
        detail:
          `${Math.round(agreement * 100)}% chose "${task.resolution.answer}" ` +
          `(${JSON.stringify(task.resolution.tally)}).`,
        source: "arbiter:consensus",
      });
    }

    const rushed = task.responses.filter((r) => r.responseMs < RUSHED_MS);
    if (rushed.length > 0) {
      findings.push({
        code: "human.rushed_responses",
        severity: "medium",
        title: "Some reviewers answered implausibly quickly",
        detail:
          `${rushed.length} of ${task.responses.length} responses arrived in under ` +
          `${RUSHED_MS}ms, which is faster than the attachments could be examined.`,
        source: "arbiter:quality",
      });
    }

    // Confidence is agreement discounted by how proven the panel is, so a
    // unanimous answer from unproven reviewers is not treated as certainty.
    const panelReliability =
      task.responses.length > 0
        ? task.responses.reduce((sum, r) => sum + store.reliabilityOf(r.workerId), 0) /
          task.responses.length
        : 0.7;

    confidence = Number(Math.min(1, agreement * (0.7 + 0.3 * panelReliability)).toFixed(2));
  } else if (task.status === "expired") {
    findings.push({
      code: "human.expired_without_quorum",
      severity: "high",
      title: "Question expired before enough reviewers answered",
      detail:
        `${task.responses.length} of ${task.quorum} required responses arrived before the task ` +
        `expired. No judgment was reached.`,
      source: "arbiter:marketplace",
    });
    confidence = 0.1;
  } else {
    findings.push({
      code: "human.pending",
      severity: "medium",
      title: "Awaiting human reviewers",
      detail:
        `${task.responses.length} of ${task.quorum} responses received. Retrieve the result ` +
        `from ${evidence.retrieveUrl} — that endpoint is free, this question is already paid for.`,
      source: "arbiter:marketplace",
    });
    confidence = 0.2;
  }

  const risk = scoreFindings(findings);

  return {
    id: `vrd_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`,
    // A pending or expired task lands on `escalate` through the confidence gate
    // rather than through a special case.
    decision: decide(risk, confidence),
    risk,
    confidence,
    findings,
    evidence,
    issuedAt: new Date().toISOString(),
    ttlSeconds: task.status === "resolved" ? 86_400 : 60,
    meta: {
      route: "/v1/judge/human",
      network: config.network,
      engineVersion: ENGINE_VERSION,
      latencyMs: Date.now() - startedAt,
      degraded: false,
    },
  };
}

export async function judgeHuman(req: HumanRequest): Promise<Verdict<HumanEvidence>> {
  const started = Date.now();

  const quorum = Math.min(Math.max(req.quorum ?? DEFAULT_QUORUM, 1), 9);
  const waitSeconds = Math.min(Math.max(req.waitSeconds ?? 60, 0), MAX_WAIT_SECONDS);

  const payoutPerReviewer = (
    (priceToNumber(PRICING.human) * REVIEWER_SHARE) /
    quorum
  ).toFixed(6);

  const task = store.createTask({
    question: req.question,
    attachments: req.attachments ?? [],
    options: req.options ?? null,
    quorum,
    ttlSeconds: TASK_TTL_SECONDS,
    payoutPerReviewer,
  });

  const settled = await store.waitForResolution(task.id, waitSeconds * 1000);

  return verdictForTask(settled ?? task, started);
}
