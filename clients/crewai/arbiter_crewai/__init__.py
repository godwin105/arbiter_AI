"""CrewAI tools for Arbiter — judgment before an agent signs or pays.

Payment note
------------
These tools talk to the Arbiter paying sidecar (``@arbiterlabs/proxy``) on
loopback rather than paying x402 directly. That is not a shortcut: as of
x402 ``2.18`` / ``x402-avm`` ``2.0.2`` the published Python packages ship no
Algorand (AVM) scheme client, so a Python process cannot construct an
Algorand x402 payment at all. The sidecar holds the key, pays, and enforces
one budget for every local agent.

Start it alongside your crew::

    ARBITER_URL=https://arbiter.example.com \\
    ARBITER_PRIVATE_KEY=... \\
    npx arbiter-proxy
"""

from .tools import (
    ArbiterError,
    JudgeCounterpartyTool,
    JudgeHumanTool,
    JudgeTransactionTool,
    arbiter_tools,
)

__all__ = [
    "ArbiterError",
    "JudgeCounterpartyTool",
    "JudgeHumanTool",
    "JudgeTransactionTool",
    "arbiter_tools",
]

__version__ = "0.1.0"
