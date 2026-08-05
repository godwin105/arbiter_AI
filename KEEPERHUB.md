# Arbiter × KeeperHub

**Submission for the KeeperHub Agents Onchain Hackathon.**

KeeperHub makes execution *reliable* — nonce management, retries, gas, RPC
failover, a hardware-backed wallet. It does not make execution *correct*. A
transaction that grants a stranger unlimited spending rights over your tokens is
submitted just as dependably as one that does not.

Arbiter is the judgment that belongs in front of it.

```
agent intent  ->  Arbiter verdict  ->  KeeperHub execution  ->  onchain
                       |
                       +-- BLOCK: nothing is submitted
```

## The guard is structural, not advisory

An agent cannot skip the check by forgetting to call it. There is no path
through `GuardedAgent` that reaches KeeperHub without a verdict first:

```ts
const agent = new GuardedAgent({
  arbiterUrl: process.env.ARBITER_URL,
  keeperHubApiKey: process.env.KEEPERHUB_API_KEY,
  allowDecisions: ["allow"],   // WARN is not enough for an autonomous agent
});

const result = await agent.execute(intent);
// result.executed === false  =>  KeeperHub was never called
```

`allowDecisions` defaults to `["allow"]` alone. A `WARN` means "proceed only if
an operator accepts this risk", and an autonomous agent has no operator standing
by — so anything short of a clean verdict stops and asks.

## What it catches

Agents do not usually lose funds to a transfer. They lose them to an **approval**
— a signature granting a third party the standing right to move tokens later, at
a moment of their choosing. The transaction that empties the wallet is one the
victim never sees.

- Unlimited ERC-20 approvals (`approve` at or near uint256 max)
- `setApprovalForAll` — one signature, an entire NFT collection
- Approvals granted to a **wallet** rather than a protocol
- `permit` — off-chain approval that leaves no transaction to notice later
- Transfers to the zero address
- Calldata sent to an address with no code
- Unknown selectors, reported as *unknown* rather than assumed safe

### EIP-7702 delegated accounts

The obvious way to write the "is this spender a contract?" check is
`eth_getCode(spender) !== "0x"`. Since EIP-7702 that check is wrong, and wrong in
the direction that matters.

An EOA can now delegate to contract code, so `eth_getCode` returns a non-empty
result for an account that is still controlled by a private key. A naive
firewall sees code, concludes "contract", concludes "protocol", and waves the
approval through. Presenting a wallet as a contract is exactly how a drainer
would defeat that check.

Arbiter classifies three states — `eoa`, `delegated`, `contract` — by testing
for the `0xef0100` delegation prefix, and treats `delegated` as key-controlled:

```
[CRITICAL] Grants unlimited permission to spend this token
[HIGH]     Spending rights granted to a wallet, not a protocol
           0xd8dA…6045 looks like a contract but is an EOA with EIP-7702
           delegated code — it is still spendable by whoever holds its
           private key.
```

Because delegation is per-chain, the same address can be `delegated` on
Ethereum and `eoa` on Sepolia. The check reflects that.

## Running it

```bash
npm run dev                    # Arbiter, in another terminal
KEEPERHUB_API_KEY=kh_... npm run demo:keeperhub
```

Two intents, one agent:

| Intent | Verdict | KeeperHub |
|---|---|---|
| Approve unlimited WETH to an address from a prompt | **BLOCK** risk 100 | never called |
| Send 0.0001 Sepolia ETH | **ALLOW** risk 0 | executed onchain |

The refusal is the interesting half. KeeperHub would have submitted that
approval flawlessly — correct nonce, sensible gas, retried on failure, confirmed
onchain. Reliability is not safety.

### The executed transaction

```
0x53fb05fae243fcc0b0fb48b40770d4588fed8476ffab1d722bca9c9331799b9d
block 11420527 · Sepolia · status SUCCESS · gas 74781
```

[View on Etherscan](https://sepolia.etherscan.io/tx/0x53fb05fae243fcc0b0fb48b40770d4588fed8476ffab1d722bca9c9331799b9d)

Read the receipt and it does not look like a 0.0001 ETH transfer: `from` is an
address that is not the org wallet, `value` is 0, and it burns 74,781 gas rather
than 21,000. That is because KeeperHub executes writes as **gas-sponsored meta
transactions** — a relayer EOA submits a signed payload to a forwarder contract,
which verifies the org wallet's signature and performs the transfer as an inner
call. Their docs flag this: check the `sponsored` field rather than EOA-level
state.

Decoding the calldata confirms the intent survived intact:

```
[0] 0x8ad82a9f…30f9    org wallet (sender)
[1] 0x8ad82a9f…30f9    recipient
[2] 0x5af3107a4000     = 100000000000000 wei = 0.0001 ETH
[5..7]                 r, s, v signature
```

Worth stating because it is a verification trap: taking the API's
`transactionHash` at face value would mean asserting a plain transfer that is
not what the chain actually contains.

## Setup

1. Create an organization at [app.keeperhub.com](https://app.keeperhub.com) and
   generate an API key (`kh_…`). Put it in `.env` as `KEEPERHUB_API_KEY` — it is
   a secret and belongs in neither source control nor a chat window.
2. Fund the KeeperHub org wallet with Sepolia ETH. Executions are submitted from
   that wallet, not from an address you pass in.
3. Optionally set `ARBITER_PRIVATE_KEY` — a base64 Algorand key used to *pay*
   Arbiter over x402. Without it the judgment calls hit the paywall. This is
   distinct from `PAY_TO`, which only receives.

## Why Arbiter charges for this

Arbiter is a paid API: $0.002 per transaction verdict, settled in USDC over
[x402](https://x402.org) on Algorand. Payment is invisible to the agent — the
SDK answers the 402 automatically.

That matters here for a reason beyond revenue. A safety check that costs a
fraction of a cent per call, with a hard spend cap enforced client-side, is one
an agent can afford to run on **every** transaction rather than the ones it
guesses are risky. Guessing which transactions are risky is the failure.

```
Real settlement, Algorand TestNet:
  0.002000 USDC   payer -> payTo
  txid EZJZOFS2JDAC6GW3VC6OSDO7KRYH7YJLRJMA53AJJC5KBALS7SGQ
  round 65996270, fee 0 (facilitator-sponsored)
```

## Files

| Path | |
|---|---|
| `src/keeperhub/client.ts` | KeeperHub API client — transfer, contract-call, status polling, idempotency |
| `src/keeperhub/guarded-agent.ts` | The guard: judge, then execute or refuse |
| `src/engine/evm.ts` | EVM firewall — calldata decoding, approval and delegation analysis |
| `scripts/demo-keeperhub.ts` | The demo above |
| `scripts/demo-evm.ts` | The firewall against seven real drain patterns |

Supported chains follow KeeperHub's: Ethereum, Base, Sepolia, Base Sepolia,
Arbitrum, Polygon.
