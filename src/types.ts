/**
 * The Arbiter verdict contract.
 *
 * Every route — machine, data, or human judgment — returns the same envelope.
 * That uniformity is the point of the product: an agent integrates one response
 * shape and can then ask for any kind of judgment without new branching logic.
 */

/**
 * `allow` and `block` are actionable without a human. `warn` means "proceed only
 * if your operator accepts this risk", and `escalate` means the machine declined
 * to decide and the question should go to /v1/judge/human.
 */
export type Decision = "allow" | "warn" | "block" | "escalate";

/** Severity of an individual finding, used to roll up into a decision. */
export type Severity = "info" | "low" | "medium" | "high" | "critical";

export interface Finding {
  /** Stable machine-readable id, e.g. "asset.unverified_creator". */
  code: string;
  severity: Severity;
  /** One line an operator can read in an alert without further context. */
  title: string;
  /** What was actually observed, including the values that triggered it. */
  detail: string;
  /** Where the underlying data came from, so a verdict can be audited. */
  source: string;
}

export interface Verdict<T = unknown> {
  /** Verdict identifier; echoed in receipts and the mobile approval inbox. */
  id: string;
  decision: Decision;
  /**
   * 0–100, where 100 is maximum assessed risk. Exposed so callers can set their
   * own threshold rather than being bound to our decision mapping.
   */
  risk: number;
  /** 0–1. Low confidence with high risk is what produces `escalate`. */
  confidence: number;
  findings: Finding[];
  /** Route-specific evidence — the decoded transaction, the counterparty record. */
  evidence: T;
  /** ISO-8601. */
  issuedAt: string;
  /** How long this verdict may be cached/reused by the caller, in seconds. */
  ttlSeconds: number;
  meta: {
    route: string;
    network: string;
    engineVersion: string;
    /** Wall-clock time spent producing the verdict. */
    latencyMs: number;
    /** True when some upstream source was unavailable and the verdict is partial. */
    degraded: boolean;
  };
}

/** Severity ordering used for rollups and sorting. */
export const SEVERITY_RANK: Record<Severity, number> = {
  info: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

/**
 * Contribution of each severity to the 0–100 risk score.
 *
 * Deliberately superadditive at the top end: a single critical finding should
 * be able to carry a block on its own, while any number of `info` findings
 * should not.
 */
const SEVERITY_WEIGHT: Record<Severity, number> = {
  info: 0,
  low: 8,
  medium: 22,
  high: 45,
  critical: 100,
};

/**
 * Rolls findings into a 0–100 risk score.
 *
 * Uses diminishing accumulation rather than a plain sum so that a long tail of
 * medium findings cannot silently reach the same score as one critical finding.
 */
export function scoreFindings(findings: readonly Finding[]): number {
  if (findings.length === 0) return 0;

  const sorted = [...findings].sort(
    (a, b) => SEVERITY_WEIGHT[b.severity] - SEVERITY_WEIGHT[a.severity],
  );

  let risk = 0;
  for (const [index, finding] of sorted.entries()) {
    // Each successive finding contributes less; the dominant finding sets the floor.
    const decay = 1 / (index + 1);
    risk += SEVERITY_WEIGHT[finding.severity] * decay;
  }

  return Math.min(100, Math.round(risk));
}

/**
 * Maps a risk score and confidence onto a decision.
 *
 * The confidence gate exists so that a thin-evidence verdict never silently
 * reads as a clean bill of health: if we could not gather enough signal, the
 * caller is told to escalate rather than handed a misleading `allow`.
 */
export function decide(risk: number, confidence: number): Decision {
  // Bands are calibrated against the severity weights so they mean what the
  // severity names promise: one `medium` (22) warns, one `low` (8) does not,
  // one `critical` (100) blocks, and two `high` findings (68) block together.
  //
  // Risk is checked before confidence deliberately. Something we could not
  // verify must never soften a signal we did verify — "unsure about X" is not a
  // reason to downgrade a confirmed critical finding from block to escalate.
  if (risk >= 65) return "block";
  if (confidence < 0.4) return "escalate";
  if (risk >= 20) return "warn";
  return "allow";
}
