# @arbiter/eliza

ElizaOS plugin giving an agent judgment before it signs or pays.

```bash
npm install @arbiter/eliza
```

```ts
import { arbiterPlugin } from "@arbiter/eliza";

export const character = {
  name: "Treasurer",
  plugins: [arbiterPlugin],
  settings: {
    secrets: { ARBITER_PRIVATE_KEY: process.env.ALGO_KEY },
    ARBITER_URL: "https://arbiter-hs23.onrender.com",
  },
};
```

## Actions

| Action | Does |
|---|---|
| `ARBITER_JUDGE_TRANSACTION` | Check a transaction before signing |
| `ARBITER_JUDGE_COUNTERPARTY` | Verify a payee before sending funds |
| `ARBITER_JUDGE_HUMAN` | Ask people something the model cannot settle |

Each writes `arbiterDecision` and `arbiterRisk` into state, so later steps can
branch on the result without re-parsing text.

Settings are read through the runtime rather than `process.env` directly,
because Eliza commonly runs several characters in one process with separate
configuration.

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
