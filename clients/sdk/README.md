# @arbiter/sdk

Ask whether an action is safe before your agent takes it.

An AI agent about to sign a transaction cannot tell a legitimate one from a
transaction that quietly hands away its wallet. This client asks
[Arbiter](https://arbiter-hs23.onrender.com) and gets back allow, warn, block or escalate — with reasons —
in a few hundred milliseconds.

```bash
npm install @arbiter/sdk
```

```ts
import { ArbiterClient } from "@arbiter/sdk";

const arbiter = new ArbiterClient({
  baseUrl: "https://arbiter-hs23.onrender.com",
  privateKey: process.env.ALGO_KEY,   // base64 64-byte Algorand key
  maxTotalSpendUsd: 10,
});

const verdict = await arbiter.judgeTransaction({ transaction, signer });

if (verdict.decision !== "allow") {
  console.warn(verdict.findings.map((f) => f.title));
  return;                              // do not sign
}
```

Algorand and EVM chains share one method:

```ts
await arbiter.judgeTransaction({
  chain: "evm",
  chainId: 1,
  transaction: { to: token, data: approveCalldata },
});
```

## Spend limits are part of the client

An agent stuck in a retry loop against a paid endpoint is a wallet-draining bug,
so the caps are enforced in the payment selector — before anything is signed —
rather than left to you to remember.

```ts
new ArbiterClient({
  maxPricePerCallUsd: 0.05,   // refuse any single call above this
  maxTotalSpendUsd: 10,       // lifetime cap for this client
});
```

Exceeding either throws `ArbiterBudgetError`, catchable distinctly from a
network or payment failure.

## The verdict

Every route returns the same shape, so you integrate once.

```ts
{
  decision: "block",     // allow | warn | block | escalate
  risk: 100,             // 0-100
  confidence: 1,         // 0-1
  findings: [{ code, severity, title, detail, source }],
  evidence: { /* the decoded transaction, the account record */ },
  meta: { latencyMs: 359, degraded: false },
}
```

`escalate` means not enough evidence was gathered to decide. **It is not
approval** — treat it as "ask a human". `meta.degraded: true` means an upstream
was unreachable and the verdict is partial; the decode rules that catch critical
severities still ran.

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
