# arbiter-crewai

CrewAI tools for [Arbiter](../../README.md) — judgment before an agent signs or pays.

```python
from crewai import Agent
from arbiter_crewai import arbiter_tools

operator = Agent(
    role="Payments operator",
    goal="Pay suppliers without losing funds to fraud or failed transfers",
    tools=arbiter_tools(),
)
```

Tools: `judge_transaction`, `judge_counterparty`, `judge_human`.

## Requires the paying sidecar

These tools call `@arbiter/proxy` on loopback rather than paying x402 directly.
That is a constraint of the ecosystem, not a shortcut:

- `x402` **2.18.0** ships no Algorand (AVM) scheme client — only
  `x402.http.paywall.avm_paywall_template`, which is server-side paywall HTML.
- `x402-avm` **2.0.2**, despite the name, also ships no AVM scheme client and
  declares no `algosdk` dependency. It installs *into the `x402` namespace*,
  overwriting the base package rather than extending it.

So a Python process cannot construct an Algorand x402 payment today. Start the
sidecar next to your crew:

```bash
ARBITER_URL=https://arbiter.example.com \
ARBITER_PRIVATE_KEY=base64-64-byte-key \
ARBITER_MAX_SPEND_USD=10 \
npx arbiter-proxy
```

The sidecar binds to `127.0.0.1` only and enforces one spend budget for every
local agent. Set `ARBITER_PROXY_TOKEN` (and the matching env var here) if other
local processes should not be able to spend.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `ARBITER_PROXY_URL` | `http://127.0.0.1:4030` | Where the sidecar is listening |
| `ARBITER_PROXY_TOKEN` | unset | Bearer token, if the sidecar requires one |

Tool errors are returned as readable text rather than raised, so a failed
judgment lets the agent recover instead of aborting the crew.

## Python support

Requires Python 3.10–3.13. CrewAI itself declares `<3.14`, so Python 3.14 is not
usable yet.
