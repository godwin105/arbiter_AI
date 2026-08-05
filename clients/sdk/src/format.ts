/**
 * Verdict rendering for model consumption.
 *
 * The text returned by an MCP tool is what the calling model actually reasons
 * over, so the decision and its reasons lead. Raw JSON is appended for agents
 * that want to branch on fields, but it is not what carries the meaning.
 */
import type { Verdict } from "./types.js";

const BANNER: Record<string, string> = {
  allow: "ALLOW",
  warn: "WARN",
  block: "BLOCK",
  escalate: "ESCALATE",
};

const GUIDANCE: Record<string, string> = {
  allow: "No blocking issues found. Safe to proceed.",
  warn: "Proceed only if the operator accepts the risks listed above.",
  block: "Do not proceed. Acting on this would likely cause loss.",
  escalate:
    "Not enough evidence to decide. Do not treat this as approval — get a human to confirm, " +
    "or call judge_human.",
};

export function formatVerdict(verdict: Verdict, pricePaidUsd?: number): string {
  const lines: string[] = [];

  lines.push(
    `${BANNER[verdict.decision] ?? verdict.decision.toUpperCase()} — ` +
      `risk ${verdict.risk}/100, confidence ${verdict.confidence}`,
  );
  lines.push("");

  if (verdict.findings.length > 0) {
    for (const f of verdict.findings) {
      lines.push(`[${f.severity.toUpperCase()}] ${f.title}`);
      lines.push(`  ${f.detail}`);
      lines.push(`  (source: ${f.source}, code: ${f.code})`);
      lines.push("");
    }
  } else {
    lines.push("No findings.");
    lines.push("");
  }

  lines.push(GUIDANCE[verdict.decision] ?? "");

  if (verdict.meta.degraded) {
    lines.push(
      "NOTE: some checks could not be completed, so this verdict is partial. Confidence has " +
        "been reduced accordingly.",
    );
  }

  lines.push("");
  const cost = pricePaidUsd !== undefined ? `, paid $${pricePaidUsd.toFixed(6)}` : "";
  lines.push(`verdict ${verdict.id} · ${verdict.meta.latencyMs}ms${cost}`);
  lines.push("");
  lines.push("Evidence:");
  lines.push("```json");
  lines.push(JSON.stringify(verdict.evidence, null, 2));
  lines.push("```");

  return lines.join("\n");
}

export function formatError(err: unknown): string {
  if (err instanceof Error) {
    return `Arbiter call failed: ${err.message}`;
  }
  return `Arbiter call failed: ${String(err)}`;
}
