"""Verdict rendering for model consumption.

Mirrors the TypeScript formatter so a verdict reads identically whether it
reached the model through CrewAI, LangChain, ElizaOS or MCP. The decision and
its reasons lead, because that text is what the model actually reasons over.
"""

from __future__ import annotations

import json
from typing import Any

_BANNER = {
    "allow": "ALLOW",
    "warn": "WARN",
    "block": "BLOCK",
    "escalate": "ESCALATE",
}

_GUIDANCE = {
    "allow": "No blocking issues found. Safe to proceed.",
    "warn": "Proceed only if the operator accepts the risks listed above.",
    "block": "Do not proceed. Acting on this would likely cause loss.",
    "escalate": (
        "Not enough evidence to decide. Do not treat this as approval — get a human to "
        "confirm, or use the judge_human tool."
    ),
}


def format_verdict(verdict: dict[str, Any]) -> str:
    decision = str(verdict.get("decision", "unknown"))
    lines: list[str] = [
        f"{_BANNER.get(decision, decision.upper())} — "
        f"risk {verdict.get('risk')}/100, confidence {verdict.get('confidence')}",
        "",
    ]

    findings = verdict.get("findings") or []
    if findings:
        for f in findings:
            lines.append(f"[{str(f.get('severity', '')).upper()}] {f.get('title', '')}")
            lines.append(f"  {f.get('detail', '')}")
            lines.append(f"  (source: {f.get('source', '')}, code: {f.get('code', '')})")
            lines.append("")
    else:
        lines.append("No findings.")
        lines.append("")

    lines.append(_GUIDANCE.get(decision, ""))

    meta = verdict.get("meta") or {}
    if meta.get("degraded"):
        lines.append(
            "NOTE: some checks could not be completed, so this verdict is partial. "
            "Confidence has been reduced accordingly."
        )

    lines.append("")
    lines.append(f"verdict {verdict.get('id')} · {meta.get('latencyMs')}ms")
    lines.append("")
    lines.append("Evidence:")
    lines.append("```json")
    lines.append(json.dumps(verdict.get("evidence"), indent=2))
    lines.append("```")

    return "\n".join(lines)
