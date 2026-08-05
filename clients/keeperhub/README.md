# @arbiterlabs/keeperhub

An agent that cannot execute what it has not checked.

[KeeperHub](https://keeperhub.com) makes execution reliable — nonces, retries,
gas, RPC failover. It does not make execution *correct*: a transaction granting
a stranger unlimited spending rights is submitted just as dependably as a
legitimate transfer. This puts judgment in front of it.

```bash
npm install @arbiterlabs/keeperhub
```

```ts
import { GuardedAgent } from "@arbiterlabs/keeperhub";

const agent = new GuardedAgent({
  arbiterUrl: "https://arbiter-hs23.onrender.com",
  arbiterPrivateKey: process.env.ALGO_KEY,
  keeperHubApiKey: process.env.KEEPERHUB_API_KEY,
  allowDecisions: ["allow"],
});

const result = await agent.execute({
  kind: "erc20-approve",
  chainId: 1,
  token: USDC,
  spender,
  amount: MAX_UINT256,
  description: "Approve USDC",
});

result.executed;        // false — KeeperHub was never called
result.refusedBecause;  // "Arbiter returned BLOCK (risk 100/100): ..."
```

## The guard is structural

There is no path through `GuardedAgent` that reaches KeeperHub without a verdict
first, so an agent cannot skip the check by forgetting to call it.

`allowDecisions` defaults to `["allow"]` alone. A `warn` means "proceed only if
an operator accepts this risk", and an autonomous agent has no operator standing
by — so anything short of a clean verdict stops.

## What it catches

Unlimited ERC-20 approvals, `setApprovalForAll`, `permit` signatures, transfers
to the zero address, and approvals granted to **EIP-7702 delegated accounts** —
wallets that return contract code from `eth_getCode` and remain spendable by
whoever holds the private key. A naive contract check waves those straight
through.

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
