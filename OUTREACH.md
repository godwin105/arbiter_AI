# Outreach: the other x402 merchants

Fifty merchants settle USDC on Algorand mainnet through the same facilitator
Arbiter does. Most of them are agents that sign transactions or move money for
someone else, which is the exact problem Arbiter exists for. They already speak
x402, so integration is a base URL rather than a sales cycle.

Every name, volume and description below was read from the live catalog:

```bash
curl -s 'https://facilitator.goplausible.xyz/data/leaderboards?cat=merchants&network=algorand-mainnet&asset=USDC&range=all&limit=60'
curl -s 'https://facilitator.goplausible.xyz/discovery/resources?limit=500'
```

Re-run both before sending anything — volumes move, and quoting a stale number
at someone about their own product is a bad first impression.

---

## The strongest opener is not a pitch

Arbiter's counterparty engine scores addresses and assets. Several merchants
here sell exactly the evidence that would make those verdicts better:

| Merchant | Sells | What Arbiter would do with it |
|---|---|---|
| `api.x402node.dev` | ERC-20 honeypot / transfer-restriction detection | Evidence for the EVM firewall, which has no honeypot check today |
| AgentHub | Algorand wallet risk scoring, ASA metadata (16 routes) | Counterparty evidence and asset sanity |
| Algorand & ASA Tracker | ASA activity metrics | Account-age and volume anomaly signals |
| Amarok / CANIX402 (CompX) | DeFi position and scan data | Context on what a counterparty actually holds |

Opening with *"I want to pay for your data"* is a different conversation from
*"please use my service."* It is also true: these are real gaps in Arbiter's
evidence, and buying them over x402 costs cents per call and takes an afternoon.
Integrate first, mention the firewall second.

Do not promise an integration you do not intend to build. Anyone in this group
can check whether their endpoint ever got called.

---

## Tiers

### Tier 1 — they move money on someone's behalf

The firewall is directly relevant; a bad counterparty or a malformed transaction
is their incident, not a hypothetical.

| Merchant | Domain | Volume | Angle |
|---|---|---|---|
| IoMarkets Topup | `iomarkets.app` | $15.31 | Real-world checkout and international payments for an agent's principal. Paying the wrong address is unrecoverable and it is their support ticket. Counterparty verification at $0.01 is cheap insurance. |
| TENDRIL | `tendrilhq.com` | $229.70 | Balances keyed to a sending address. Anything address-keyed benefits from address verification. |
| AgentMesh | `www.agent-mesh.app` | $194.01 | Workflow platform that settles platform-billed work. A guard between "agent decided" and "platform executed" is a product feature they can charge for. |
| Micropay | `api.micropay.website` | $23.03 | Payments infrastructure. Same argument as IoMarkets. |
| HelixBox | `helixbox-manager.onrender.com` | $23.25 + $12.75 | Sells agent session access. Their users' agents act autonomously. |

### Tier 2 — distribution multipliers

Getting listed reaches more agents than any individual integration.

| Merchant | Domain | Why |
|---|---|---|
| Agent402.Tools | `agent402.tools` | **294 routes.** This is a tool directory, not a single service. One listing here is worth more than ten direct integrations. Lead with this one. |
| AgentHub | `agenthub-production-8c75.up.railway.app` | 16 routes, already in wallet-risk territory. Partner or be listed. |
| CANIX402 / Amarok | `*.compx.io` | Two entries, same organisation — one conversation covers both. |

### Tier 3 — adjacent security, complementary not competing

Be straight about the overlap. These people will read your docs properly, and
pretending there is no overlap reads as either dishonest or uninformed.

| Merchant | Overlap | Honest framing |
|---|---|---|
| `api.x402node.dev` | Token honeypot detection | They answer "is this token a trap". Arbiter answers "is this transaction a trap". Different layer, same customer. |
| AgentHub | Wallet risk scoring | Genuine overlap on counterparty. Propose interop, or buy their score as an input rather than duplicating it. |
| Second Opinion | Adversarial second opinion | Closest competitor in concept. Worth reading before writing to anyone, if only to sharpen your own positioning. |
| PRISM | Code review and security auditing | Security-minded audience, no product overlap. Good for a cross-mention. |

### Tier 4 — weak fit

Syra, Losbeto, Scrape402, Algate, One Step Chess, x402 Echo. Data and utility
services whose agents mostly do not sign value-bearing transactions. Skip unless
they approach you.

---

## The message

Short, specific, no urgency games. These are engineers shipping side projects,
not procurement departments.

### Cold, direct (DM or contact form)

> Subject: paying for your honeypot check
>
> I run Arbiter, one of the x402 merchants on the Algorand mainnet leaderboard —
> a pre-flight safety check for agents about to sign a transaction. $0.002 a
> call, same facilitator as you.
>
> My EVM firewall has no honeypot detection and yours looks like the right
> answer. I would rather pay you per call than build a worse version.
>
> Two questions: is your endpoint stable enough to depend on, and would you want
> the reverse — a transaction-safety verdict your callers can buy inline? Your
> users are checking whether a token is a trap; mine are checking whether the
> transaction is. Same customer, different layer.
>
> Docs: https://arbiter-hs23.onrender.com/docs
>
> — Godwin

### To a directory (Agent402.Tools)

> Subject: listing a transaction-safety endpoint
>
> You have the broadest tool catalog on the Algorand x402 leaderboard. I would
> like Arbiter listed in it.
>
> It answers one question: is this transaction safe to sign? It decodes what the
> transaction actually does and returns allow / warn / block with itemised
> reasons — rekeys, close-remainder-to, unlimited ERC-20 approvals, EIP-7702
> delegation. $0.002 a call, x402 over the same facilitator, no signup.
>
> Live example anyone can run without paying: https://arbiter-hs23.onrender.com
> shows real verdicts computed on request.
>
> Happy to fit whatever listing format you use.
>
> — Godwin

### Community channel (challenge Discord / Telegram)

> Built Arbiter for the challenge: a paid pre-flight check for agents that sign
> transactions. Decodes the transaction and returns allow/warn/block with
> reasons — rekey, close-remainder, unlimited approvals, EIP-7702 delegation.
>
> If your agent signs anything, it is two lines:
>
> ```ts
> const verdict = await arbiter.judgeTransaction({ transaction, signer });
> if (verdict.decision !== "allow") return;   // don't sign
> ```
>
> Non-TypeScript agents can use the sidecar — `npx @arbiterlabs/proxy` — since
> no Python AVM client exists to pay x402 on Algorand.
>
> Free to look at, $0.002 to call: https://arbiter-hs23.onrender.com

---

## Integration, verbatim

Keep it this short. The moment it needs a paragraph of setup, people stop.

**TypeScript**

```ts
import { ArbiterClient } from "@arbiterlabs/sdk";

const arbiter = new ArbiterClient({
  baseUrl: "https://arbiter-hs23.onrender.com",
  privateKey: process.env.ALGO_KEY,   // base64 64-byte Algorand key
  maxTotalSpendUsd: 10,
});

const verdict = await arbiter.judgeTransaction({ transaction, signer });
if (verdict.decision !== "allow") return;   // do not sign
```

**Any other language** — a local sidecar holds the key and the budget:

```bash
ARBITER_URL=https://arbiter-hs23.onrender.com \
ARBITER_PRIVATE_KEY=base64-64-byte-algorand-key \
ARBITER_MAX_SPEND_USD=10 \
npx @arbiterlabs/proxy
```

```bash
curl -X POST http://127.0.0.1:4030/judge/transaction \
  -H 'content-type: application/json' \
  -d '{"chain":"algorand","transaction":"<base64>","signer":"<address>"}'
```

---

## Channels

There is no contact directory for these merchants. In rough order of yield:

1. **The challenge's own community channel.** Everyone here is in it, everyone
   is already building on x402, and a technical post gets read by all of them at
   once. Highest yield by a distance — start here.
2. **Their domain.** Most have a site with a contact form, a GitHub link, or an
   X account in the footer.
3. **GitHub.** Several are open source. An issue or discussion proposing interop
   is legitimate and public.
4. **Their own paid endpoint.** Call it, pay for it, then mention you did. It is
   a real signal that you engaged with their work rather than mass-mailing.

## Ground rules

- **Do not overstate traction.** Arbiter has earned $0.026 from one external
  agent. Anyone in this group can read your volume off the same leaderboard you
  read theirs off. Claiming momentum you do not have is both checkable and
  pointless — the pitch is that the service works and is cheap, not that it is
  popular.
- **No fake urgency, no invented deadlines.**
- **Send few, personalised.** Twelve real messages beat fifty templated ones,
  and this group talks to each other.
- **Lead with what you will pay for.** It is the only opener in this document
  that gives the other side something before asking for anything.

## Before sending

The URL in this document changes when the service is renamed. Run
`bash scripts/rename-public-url.sh <old> <new>` first — it rewrites this file
along with the READMEs — and re-read the docs link once to be sure it resolves.
