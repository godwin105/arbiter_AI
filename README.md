# Arbiter

**The judgment layer for autonomous agents.**

An AI agent about to act on the world often needs a judgment it cannot make by
itself: *is this transaction safe to sign, is this counterparty real, is this
photo actually what it claims to be.* Arbiter sells those judgments one call at
a time, paid over [x402](https://x402.org) in USDC on Algorand.

Three routes, one response contract:

| Route | Judgment | Price |
|---|---|---|
| `POST /v1/judge/transaction` | Machine — decode and risk-score an unsigned transaction before signing | $0.002 |
| `POST /v1/judge/counterparty` | Data — is this payment counterparty who they claim to be | $0.01 |
| `POST /v1/judge/human` | Human — questions a model cannot settle alone, answered by vetted reviewers | $0.25 |

Every route returns the same verdict envelope, so an agent integrates one shape
and can then ask for any kind of judgment without new branching logic:

```jsonc
{
  "decision": "block",        // allow | warn | block | escalate
  "risk": 100,                // 0-100
  "confidence": 1,            // 0-1; low confidence forces "escalate"
  "findings": [ /* itemised, each with severity, detail and source */ ],
  "evidence": { /* the decoded transaction, the counterparty record */ },
  "meta": { "degraded": false, "latencyMs": 378 }
}
```

> **New here, or explaining this to someone non-technical?**
> [What Arbiter actually does](./WHAT-IT-DOES.md) — no code, no jargon.

## Live

**https://arbiter-hs23.onrender.com** — API, and the reviewer app at
[`/work`](https://arbiter-hs23.onrender.com/work/).

Preflight: 18 passed, 0 blocking failures. Running on Render's free plan, which
has no persistent disk and spins down after 15 minutes idle — see
[DEPLOY.md](./DEPLOY.md) for what that costs and the upgrade needed before the
October leaderboard window.

## Status

| Component | State |
|---|---|
| x402 payment core (Algorand, USDC, GoPlausible facilitator) | Working, verified end-to-end |
| Bazaar discovery + `x402-global-challenge` tag | Working, verified in the 402 response |
| `/v1/judge/transaction` Algorand firewall | Working, 5/5 attack cases pass |
| `/v1/judge/transaction` EVM firewall | Working, 7/7 drain patterns pass, EIP-7702 aware |
| `/v1/judge/counterparty` engine | Working, 5/5 cases pass against live mainnet + NFD |
| `/v1/judge/human` marketplace | Working, consensus + reviewer reliability + payout ledger |
| On-chain payout settlement | Working — real USDC paid to a reviewer on-chain |
| SDK, MCP server, LangChain, ElizaOS, paying proxy | Built, typechecked, runtime-verified |
| CrewAI tools (Python) | Built; runs through the paying proxy — see below |
| KeeperHub integration | Working, real Sepolia transaction executed |
| Reviewer app (React) | Live at `/work`, verified end-to-end with a paid question |

## The transaction firewall

Autonomous agents lose funds in a small number of specific ways. The firewall
decodes the actual transaction bytes and reports what signing would really do:

- **Rekey** — `rekeyTo` permanently transfers signing authority over the account
- **Close-remainder** — sweeps the entire ALGO balance regardless of the stated amount
- **Asset close-out** — sweeps the entire ASA holding regardless of the stated amount
- **Clawback** — moves assets out of a third party's account
- **Fee drain** — the balance leaves via an oversized fee rather than a visible transfer
- **App delete / update** — destroys or silently replaces contract logic
- Asset-level risk: creator-held clawback and freeze authority, non-existent assets
- Account-level risk: signer already rekeyed, unfunded recipient, expired validity window

Run it against real, freshly-encoded transactions:

```bash
npm run demo:attacks
```

```
[BLOCK]  Rekey attack              risk=100/100  confidence=1  1365ms
[BLOCK]  Close-remainder drain     risk=100/100  confidence=1   378ms
[BLOCK]  Asset close-out drain     risk=100/100  confidence=1  1432ms
[BLOCK]  Fee drain                 risk=100/100  confidence=1   379ms
[ALLOW]  Benign payment            risk=0/100    confidence=1   398ms
```

The benign case returning zero findings matters as much as the blocks — a
firewall that cries wolf gets switched off.

## Counterparty verification

Catches the two silent, expensive failures a payout agent cannot see by reading
an invoice:

- **Swapped payment address** — the invoice is genuine and the payee is real, but
  the address belongs to someone else. Resolved against the NFD registry and
  compared to every address the identity legitimately controls.
- **Missing asset opt-in** — on Algorand an ASA transfer to an account that has
  not opted in is rejected outright. The payment simply never arrives.

Plus rekeyed recipients, frozen holdings, below-minimum balances, unregistered or
expired identities, and never-funded addresses.

```bash
npm run demo:counterparty     # live NFD registry + Algorand mainnet, read-only
```

The two cases worth reading are adjacent and opposite: an identity that
**verifies** but whose address cannot receive the asset, and an identity that
**fails** on an address that could. Both block, for entirely different reasons.

## Human judgment

Questions a model cannot settle alone go to vetted reviewers. The paid call
long-polls for a bounded window; if reviewers answer in time the verdict returns
inline, otherwise the caller gets a pending verdict and a **free** retrieval URL.
Timing out never costs a second payment.

```bash
npm run demo:human
```

- Majority vote across a configurable quorum, with the agreement ratio exposed
- Confidence is agreement discounted by how proven the panel is, so a unanimous
  answer from unproven reviewers is not treated as certainty
- Reviewers are paid for participating, not for agreeing — paying for agreement
  incentivises guessing the majority rather than reporting what you saw
- Implausibly fast answers are flagged as a quality signal
- Per-reviewer reliability accrues from consensus agreement over time

Worker API (`/v1/work/*`) is unpriced: reviewers are the supply side.

### Paying reviewers

```bash
npm run settle -- --dry-run    # check everything, send nothing
npm run settle                 # pay
```

Two rules govern this, and both cost something to follow:

**Claim before broadcasting.** Payouts move to `settling` with an attempt id
*before* any transaction is sent, and that attempt id is written into the
transaction's note field. A process that dies mid-flight therefore leaves money
unpaid rather than paid twice — unpaid is recoverable by a person reading the
stuck rows against the ledger, paid twice is not.

**Check the payee before paying.** Every payout address goes through Arbiter's
own `/v1/judge/counterparty` engine first. Not decoration: a USDC transfer to an
account that has not opted in is rejected by the protocol, so paying blind burns
a fee and leaves the reviewer unpaid with no explanation. Blocked payouts stay
pending and are retried once the reviewer opts in.

```
[PAID]  0.150000 USDC -> GBRO5EM4JM57PDPS…
        txid  SIEXIGX6KQKA4D4PTOUL7R6M5BDP4BIUEW2TTOIFZHBU233LSKWQ
        note  arbiter:payout:pay_msft8csu_rfq0ch

[SKIP]  0.150000 USDC -> OEQWDYGTEXMDWSH2…
        Arbiter blocked this payee: Counterparty has not opted in to the asset
```

The payout account is configured separately from `PAY_TO` on purpose. `PAY_TO`
accumulates revenue and its key never needs to be on a server; the payout
account holds working capital only, so a compromised host cannot drain earnings.

### Design rule: the caller has already paid

By the time an engine runs, the agent has been charged. So no upstream failure
may throw. Every algod lookup has a hard timeout and returns a result that says
whether data was actually obtained; a failed lookup lowers `confidence` and sets
`meta.degraded`, and the static decode rules — which catch the critical
severities — still run. A degraded verdict is still a useful verdict.

Separately, `confidence < 0.4` returns `escalate` rather than `allow`, so a
thin-evidence verdict can never be mistaken for a clean bill of health.

## Getting it into agents

Volume on a usage-ranked leaderboard comes from other people's agents calling
you, so the clients are the product surface, not an afterthought. Full detail in
[clients/README.md](./clients/README.md).

| Package | For |
|---|---|
| `@arbiterlabs/sdk` | TypeScript agents; pays x402 automatically |
| `@arbiterlabs/mcp` | Any MCP host — Claude Code, Claude Desktop, OpenClaw |
| `@arbiterlabs/langchain` | LangChain.js tools |
| `@arbiterlabs/eliza` | ElizaOS plugin |
| `@arbiterlabs/proxy` | Local paying sidecar for non-TypeScript agents |
| `arbiter-crewai` | CrewAI (Python), via the sidecar |

Spend limits live in the client rather than in advice to integrators, because an
agent in a retry loop against a paid endpoint is a wallet-draining bug:

```ts
const client = new ArbiterClient({
  baseUrl: process.env.ARBITER_URL,
  privateKey: process.env.ALGO_KEY,
  maxPricePerCallUsd: 0.5,
  maxTotalSpendUsd: 10,
});
```

Both caps are enforced in the payment selector, before anything is signed.

### Why Python needs a sidecar

Paying x402 on Algorand requires an AVM scheme client, and that exists only in
TypeScript today. `x402` 2.18 ships no AVM client, and `x402-avm` 2.0.2 — despite
the name — ships none either, has no `algosdk` dependency, and installs *into
the `x402` namespace*, overwriting the base package. So a Python agent cannot
construct an Algorand x402 payment at all.

`@arbiterlabs/proxy` therefore holds the key, pays, and re-exposes the judgments
unpriced on loopback. That is also the better arrangement in general: one
process holds the funded key and enforces one budget, instead of every agent
process carrying a copy of both.

## Setup

```bash
npm install
cp .env.example .env    # then set PAY_TO
npm run dev
```

`PAY_TO` must be a real Algorand address **opted in to the USDC ASA** for the
network you are running (testnet `10458941`, mainnet `31566704`), or settlement
fails.

Verify the payment gate:

```bash
curl -i -X POST http://localhost:4021/v1/judge/transaction \
  -H 'content-type: application/json' \
  -d '{"chain":"algorand","transaction":"abc"}'
```

Expect `HTTP 402` with a base64 `PAYMENT-REQUIRED` header carrying the price,
asset, `payTo`, `feePayer` and the Bazaar discovery schema.

## A note on the facilitator network identifier

The GoPlausible facilitator advertises Algorand using the **full padded base64
genesis hash** as the CAIP-2 reference:

```
algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI=
```

while `@x402/avm`'s `ALGORAND_TESTNET_CAIP2` uses the CAIP-2-legal 32-character
truncation:

```
algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDe
```

Both normalize to the same network inside the AVM scheme, but the resource
server validates route configuration against the facilitator's advertised
strings by exact equality — so using the SDK constant fails startup with
`missing_facilitator`. `src/facilitator.ts` resolves the identifier from
`/supported` at boot and matches by normalization, which works with either form
and will keep working if the padding is fixed upstream. It also picks up the
advertised `feePayer`, so callers can pay in USDC without holding ALGO for gas.

## Competition configuration

Built for the [Algorand Global x402 Challenge](https://algorand.co/global-x402-challenge)
as a **Composite Entry**: all three routes share one `payTo`, so their volume
rolls up into a single merchant entry while each route stays individually
discoverable in the Bazaar.

Requirements wired in and verified in the live 402 response:

- [x] Paid endpoint returning HTTP 402 without payment
- [x] GoPlausible facilitator (not an alternative facilitator)
- [x] Bazaar discovery extension with per-route input/output schemas
- [x] `x402-global-challenge` tag on every route
- [x] Single consistent `payTo` across all routes
- [ ] Deployed to public HTTPS on MainNet
- [ ] One real MainNet payment settled, USDC confirmed received
- [ ] Endpoint visible on the leaderboard with the challenge filter

`assertChallengeReady()` fails startup if a mainnet deployment is still pointing
at localhost or plain HTTP.
