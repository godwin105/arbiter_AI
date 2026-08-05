# @arbiterlabs/mcp

Judgment tools for any MCP-capable agent — Claude Code, Claude Desktop, OpenClaw,
or your own host.

Lets a model check whether an action is safe *before* taking it, rather than
finding out afterwards.

## Setup

```jsonc
// claude_desktop_config.json, or .mcp.json
{
  "mcpServers": {
    "arbiter": {
      "command": "npx",
      "args": ["-y", "@arbiterlabs/mcp"],
      "env": {
        "ARBITER_URL": "https://arbiter-hs23.onrender.com",
        "ARBITER_PRIVATE_KEY": "base64-64-byte-algorand-key",
        "ARBITER_MAX_SPEND_USD": "10"
      }
    }
  }
}
```

## Tools

| Tool | Does | Cost |
|---|---|---|
| `judge_transaction` | Is this transaction safe to sign? | $0.002 |
| `judge_counterparty` | Is this address who I think it is, and can it receive? | $0.01 |
| `judge_human` | What would a person say about this? | $0.25 |
| `retrieve_human_verdict` | Collect a human answer already paid for | free |
| `arbiter_budget` | How much has been spent this session | free |

Verdicts come back as readable text with the decision first and every finding
explained, because that text is what the model reasons over.

## Configuration

| Variable | Default | |
|---|---|---|
| `ARBITER_URL` | `http://localhost:4021` | Deployment to call |
| `ARBITER_PRIVATE_KEY` | — | Base64 Algorand key used to pay |
| `ARBITER_MAX_SPEND_USD` | `25` | Lifetime cap for this process |
| `ARBITER_MAX_PRICE_PER_CALL` | `1.00` | Per-call cap |

## Paying

Calls are settled per request in USDC on Algorand over [x402](https://x402.org).
There is no API key and no account — payment is the authentication.

Your payer account needs USDC **and must be opted in to the USDC asset**. On
Algorand a transfer to an account that has not opted in is rejected outright, so
an un-opted-in payer cannot pay at all. Fees are sponsored by the facilitator,
so the payer does not need ALGO.

| Route | Price |
|---|---|
| Transaction verdict | $0.002 |
| Counterparty verdict | $0.01 |
| Human judgment | $0.25 |

Full documentation: https://arbiter-hs23.onrender.com/docs

## Licence

MIT
