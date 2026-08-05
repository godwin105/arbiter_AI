"""CrewAI tool definitions for Arbiter."""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from typing import Any, ClassVar, Type

from crewai.tools import BaseTool
from pydantic import BaseModel, Field

from .format import format_verdict

DEFAULT_PROXY = "http://127.0.0.1:4030"


class ArbiterError(RuntimeError):
    """Raised when the sidecar is unreachable or refuses the call."""


def _post(path: str, payload: dict[str, Any], timeout: float) -> dict[str, Any]:
    base = os.environ.get("ARBITER_PROXY_URL", DEFAULT_PROXY).rstrip("/")
    token = os.environ.get("ARBITER_PROXY_TOKEN")

    body = json.dumps({k: v for k, v in payload.items() if v is not None}).encode()
    request = urllib.request.Request(
        f"{base}{path}",
        data=body,
        headers={"content-type": "application/json"},
        method="POST",
    )
    if token:
        request.add_header("authorization", f"Bearer {token}")

    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.loads(response.read().decode())
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode(errors="replace")
        if exc.code == 429:
            raise ArbiterError(
                f"Arbiter budget exhausted. Raise ARBITER_MAX_SPEND_USD on the sidecar. {detail}"
            ) from exc
        if exc.code == 402:
            raise ArbiterError(
                "The sidecar could not pay. Check ARBITER_PRIVATE_KEY is set and that the "
                f"account holds USDC. {detail}"
            ) from exc
        raise ArbiterError(f"Arbiter returned HTTP {exc.code}: {detail}") from exc
    except urllib.error.URLError as exc:
        raise ArbiterError(
            f"Could not reach the Arbiter sidecar at {base}. Start it with `npx arbiter-proxy`. "
            f"({exc.reason})"
        ) from exc


def _run_tool(path: str, payload: dict[str, Any], timeout: float = 35.0) -> str:
    try:
        return format_verdict(_post(path, payload, timeout))
    except ArbiterError as exc:
        # Returned rather than raised: a readable failure lets the agent recover,
        # whereas an exception usually aborts the crew.
        return f"Arbiter call failed: {exc}"


# --- judge_transaction -----------------------------------------------------


class JudgeTransactionInput(BaseModel):
    transaction: str | list[str] = Field(
        ..., description="Base64 unsigned transaction, or a list of them for an atomic group."
    )
    signer: str | None = Field(
        None, description="The 58-character address about to sign, if known."
    )


class JudgeTransactionTool(BaseTool):
    name: str = "judge_transaction"
    description: str = (
        "Check whether an unsigned Algorand transaction is safe to sign, BEFORE signing it. "
        "Returns allow/warn/block with specific reasons. Always call this for a transaction "
        "you did not construct yourself. Catches account rekeys, close-remainder sweeps that "
        "empty the balance regardless of the stated amount, clawbacks, fee drains, and "
        "application delete/update calls. Costs $0.002."
    )
    args_schema: Type[BaseModel] = JudgeTransactionInput
    _path: ClassVar[str] = "/judge/transaction"

    def _run(self, transaction: str | list[str], signer: str | None = None) -> str:
        return _run_tool(self._path, {"transaction": transaction, "signer": signer})


# --- judge_counterparty ----------------------------------------------------


class JudgeCounterpartyInput(BaseModel):
    address: str = Field(..., description="Counterparty's 58-character Algorand address.")
    expectedAsset: str | None = Field(
        None,
        description="ASA id being paid (USDC mainnet is 31566704). Enables the opt-in check.",
    )
    amount: str | None = Field(None, description="Payment amount in whole units.")
    claimedIdentity: str | None = Field(
        None,
        description=(
            "NFD name the counterparty claims, e.g. 'acme-exports.algo'. The field that "
            "detects a swapped payment address."
        ),
    )


class JudgeCounterpartyTool(BaseTool):
    name: str = "judge_counterparty"
    description: str = (
        "Verify that an Algorand address really belongs to the party you intend to pay, and "
        "that the payment can actually arrive. Call before sending funds to any address taken "
        "from an invoice, email or message. Catches a genuine payee whose payment address has "
        "been substituted, and recipients not opted in to the asset — on Algorand that "
        "transfer is rejected and the payment silently never arrives. Costs $0.01."
    )
    args_schema: Type[BaseModel] = JudgeCounterpartyInput
    _path: ClassVar[str] = "/judge/counterparty"

    def _run(
        self,
        address: str,
        expectedAsset: str | None = None,
        amount: str | None = None,
        claimedIdentity: str | None = None,
    ) -> str:
        return _run_tool(
            self._path,
            {
                "address": address,
                "expectedAsset": expectedAsset,
                "amount": amount,
                "claimedIdentity": claimedIdentity,
            },
        )


# --- judge_human -----------------------------------------------------------


class JudgeHumanInput(BaseModel):
    question: str = Field(..., description="A question a person can answer in seconds.")
    attachments: list[str] | None = Field(
        None, description="Public HTTPS URLs of images or documents to review."
    )
    options: list[str] | None = Field(
        None,
        description="Allowed answers, e.g. ['yes','no','unclear']. Strongly preferred.",
    )
    quorum: int | None = Field(None, description="Reviewers required before returning. Default 3.")
    waitSeconds: int | None = Field(None, description="How long to wait inline. Default 60.")


class JudgeHumanTool(BaseTool):
    name: str = "judge_human"
    description: str = (
        "Ask vetted human reviewers a question you cannot answer yourself, returning a quorum "
        "verdict with each reviewer's rationale. Use for questions needing eyes or real-world "
        "knowledge: does this photo show what it claims, does this business exist, is this "
        "document legitimate. Also use when another Arbiter tool returns ESCALATE. Do NOT use "
        "for anything you can determine yourself — it is slow and costs $0.25."
    )
    args_schema: Type[BaseModel] = JudgeHumanInput
    _path: ClassVar[str] = "/judge/human"

    def _run(
        self,
        question: str,
        attachments: list[str] | None = None,
        options: list[str] | None = None,
        quorum: int | None = None,
        waitSeconds: int | None = None,
    ) -> str:
        wait = waitSeconds if waitSeconds is not None else 60
        return _run_tool(
            self._path,
            {
                "question": question,
                "attachments": attachments,
                "options": options,
                "quorum": quorum,
                "waitSeconds": waitSeconds,
            },
            # Sit past the server-side long-poll rather than aborting a question
            # that reviewers are still answering.
            timeout=wait + 15,
        )


def arbiter_tools() -> list[BaseTool]:
    """Every Arbiter tool, ready to hand to a CrewAI agent."""
    return [JudgeTransactionTool(), JudgeCounterpartyTool(), JudgeHumanTool()]
