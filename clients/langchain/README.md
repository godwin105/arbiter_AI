# @arbiter/langchain

LangChain tools that let an agent check an action before taking it.

```bash
npm install @arbiter/langchain @langchain/core
```

```ts
import { createArbiterTools } from "@arbiter/langchain";

const { tools } = createArbiterTools({
  baseUrl: "https://arbiter-hs23.onrender.com",
  privateKey: process.env.ALGO_KEY,
  maxTotalSpendUsd: 10,
});

const agent = createReactAgent({ llm, tools });
```

## Tools

`judge_transaction` · `judge_counterparty` · `judge_human` ·
`retrieve_human_verdict`

All of them share one client, so the spend cap applies across the whole agent —
a budget that resets per tool is not a budget.

Tool errors are returned as readable text rather than thrown, so a failed check
lets the agent recover instead of aborting the run.

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
