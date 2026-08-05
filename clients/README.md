# Arbiter clients

Five packages, one job: let an agent ask for judgment before it acts, and pay
for it without the integrator writing payment code.

| Package | For | Pays directly |
|---|---|---|
| [`@arbiter/sdk`](./sdk) | TypeScript agents | yes |
| [`@arbiter/mcp`](./mcp) | Any MCP host — Claude Code, Claude Desktop, OpenClaw | yes |
| [`@arbiter/langchain`](./langchain) | LangChain.js | yes |
| [`@arbiter/eliza`](./eliza) | ElizaOS | yes |
| [`@arbiter/proxy`](./proxy) | Non-TypeScript agents | yes, on their behalf |
| [`arbiter-crewai`](./crewai) | CrewAI (Python) | via the proxy |

All of them render a verdict through the same formatter, so a `BLOCK` reads
identically whether it reached the model through MCP, LangChain or CrewAI.

## Why Python goes through a sidecar

Paying x402 on Algorand requires an AVM scheme client, and today that exists
only in TypeScript. The published Python packages do not provide one:

- `x402` **2.18.0** — no AVM client; only `x402.http.paywall.avm_paywall_template`,
  which is server-side paywall HTML.
- `x402-avm` **2.0.2** — despite the name, also ships no AVM scheme client and
  no `algosdk` dependency. It installs *into the `x402` namespace*, overwriting
  the base package rather than extending it, and trails the TypeScript SDK by a
  major version.

So a Python agent cannot construct an Algorand x402 payment at all. Rather than
ship a CrewAI tool that pretends to pay, `@arbiter/proxy` holds the key, pays,
and re-exposes the judgments unpriced on loopback.

This is the better arrangement even where a native client does exist: one
process holds the funded key and enforces one budget, instead of every agent
process carrying a copy of both.

```bash
ARBITER_URL=https://arbiter.example.com \
ARBITER_PRIVATE_KEY=... \
ARBITER_MAX_SPEND_USD=10 \
npx arbiter-proxy
```

It binds to `127.0.0.1` only — it is a paying oracle, and must not be reachable
from the network. Set `ARBITER_PROXY_TOKEN` if other local processes should not
be able to spend.

## Spend limits are part of the client

An agent in a retry loop against a paid endpoint is a wallet-draining bug, so
the cap lives in the SDK rather than in advice to integrators:

```ts
const client = new ArbiterClient({
  baseUrl: "https://arbiter.example.com",
  privateKey: process.env.ALGO_KEY,
  maxPricePerCallUsd: 0.50,   // reject any single call above this
  maxTotalSpendUsd: 10,       // lifetime cap for this client
});
```

Both limits are enforced in the payment selector, *before* a payment is signed.
Spend is counted at selection rather than at settlement, so a payment that is
created and then fails still consumes budget — that over-counts in the failure
case, which is the safe direction for a cap.

All tools in a tool set share one client, because a budget that resets per tool
is not a budget.

## MCP

```jsonc
// claude_desktop_config.json / .mcp.json
{
  "mcpServers": {
    "arbiter": {
      "command": "npx",
      "args": ["-y", "@arbiter/mcp"],
      "env": {
        "ARBITER_URL": "https://arbiter.example.com",
        "ARBITER_PRIVATE_KEY": "base64-64-byte-key",
        "ARBITER_MAX_SPEND_USD": "10"
      }
    }
  }
}
```

Exposes `judge_transaction`, `judge_counterparty`, `judge_human`,
`retrieve_human_verdict` and `arbiter_budget`.

## LangChain

```ts
import { createArbiterTools } from "@arbiter/langchain";

const { tools } = createArbiterTools({
  baseUrl: process.env.ARBITER_URL!,
  privateKey: process.env.ALGO_KEY!,
});

const agent = createReactAgent({ llm, tools });
```

## ElizaOS

```ts
import { arbiterPlugin } from "@arbiter/eliza";

export const character = {
  name: "Treasurer",
  plugins: [arbiterPlugin],
  settings: {
    secrets: { ARBITER_PRIVATE_KEY: process.env.ALGO_KEY },
    ARBITER_URL: "https://arbiter.example.com",
  },
};
```

Actions: `ARBITER_JUDGE_TRANSACTION`, `ARBITER_JUDGE_COUNTERPARTY`,
`ARBITER_JUDGE_HUMAN`. Each writes `arbiterDecision` and `arbiterRisk` into
state so later steps can branch without re-parsing the text.

## CrewAI

```python
from arbiter_crewai import arbiter_tools

agent = Agent(
    role="Payments operator",
    goal="Pay suppliers without losing funds",
    tools=arbiter_tools(),
)
```

Requires `npx arbiter-proxy` running locally. See above for why.

## A note on tool descriptions

The descriptions in these packages are written as instructions about *when to
reach for judgment*, not as API documentation. A tool the model never thinks to
call is worth nothing, and one it calls constantly wastes the operator's money —
so `judge_human` says plainly that it is slow, costs $0.25, and should not be
used for anything the model can determine itself.
