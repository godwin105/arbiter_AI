# Deploying Arbiter

The goal is a public HTTPS endpoint on Algorand MainNet, routing through the
GoPlausible facilitator, listed in the Bazaar, that has settled at least one
real payment. Everything below works toward that.

Run the validator at any point to see exactly where you stand:

```bash
npm run preflight -- https://your-deployment.example.com
```

It checks every blocking requirement and exits non-zero if the entry would not
score. Run it against localhost first, then against the deployed URL.

## 1. Prerequisites

You need **one Algorand address** that stays fixed for the entire competition —
the leaderboard rolls up volume by `payTo`, and changing it splits your entry in
two.

- Use a **fresh, dedicated account**, not your main wallet. It is published in
  every 402 response and on a public leaderboard.
- It **must be opted in to USDC**, or every settlement fails: ASA `10458941` on
  TestNet, `31566704` on MainNet. Opting in is a zero-amount self-transfer of
  the asset; Pera and Defly both do it in a couple of taps.
- It needs a small ALGO balance to exist at all (0.1 ALGO minimum balance, plus
  0.1 per asset opted into).

`preflight` verifies both of these on-chain. They are the two failures that
otherwise show up only as payments that silently never arrive.

## 2. Run locally

```bash
cp .env.example .env      # set PAY_TO
npm install
npm run dev
npm run preflight         # against http://localhost:4021
```

## 3. Build the container

```bash
docker build -t arbiter:local .
docker run --rm -p 4021:4021 \
  -e PAY_TO=YOUR_ADDRESS \
  -e ARBITER_NETWORK=testnet \
  -e PUBLIC_URL=http://localhost:4021 \
  -v arbiter_data:/data \
  --init \
  arbiter:local
```

The `-v arbiter_data:/data` is not optional in any long-lived deployment. That
volume holds unresolved reviewer questions that callers have already paid for,
and the ledger of USDC owed to reviewers. Without it, a redeploy destroys both.

## 4. Deploy to Render

Render builds from this repo's `Dockerfile` using `render.yaml`.

1. Push this repo to GitHub.
2. Render Dashboard → **New** → **Blueprint**, point it at the repo.
3. It prompts for `PAY_TO` and `PUBLIC_URL` (marked `sync: false` so they are
   never committed). `PUBLIC_URL` is `https://<service>.onrender.com`.
4. Deploy, then verify:

```bash
npm run preflight -- https://<service>.onrender.com
```

### The free plan splits this product in two

Free Render web services **cannot attach a persistent disk** and **spin down
after 15 minutes** without traffic. That does not affect Arbiter uniformly:

| Route | Free plan |
|---|---|
| `/v1/judge/transaction` | Fine. Stateless — decodes and scores, holds nothing. |
| `/v1/judge/counterparty` | Fine. Stateless — reads the chain, holds nothing. |
| `/v1/judge/human` | **Degraded.** Reviewer registrations, open questions and the USDC payout ledger live in memory and vanish on every spin-down. Reviewer tokens stop working; owed payouts disappear. |

`render.yaml` therefore sets `STATE_FILE=off` rather than pointing at a path
that cannot persist. Losing state loudly beats a service that believes it saved
something it did not.

The free Postgres alternative is worse here: 1GB, and it **expires 30 days after
creation**. That is not where a payout ledger goes.

### Upgrading before the leaderboard window

Two changes in `render.yaml`, both marked in the file:

```yaml
plan: starter          # was: free
disk:
  name: arbiter-data
  mountPath: /data
  sizeGB: 1
```

and set `STATE_FILE=/data/marketplace.json`.

Do this before October. Cold starts cost settled volume during a window whose
timing is not announced, and by then the payout ledger holds real money.

## 4b. Deploy to Fly.io (alternative)

`fly.toml` and `scripts/deploy-fly.sh` are kept and working. Fly gives explicit
region control and a persistent volume on any paid plan, but has no free tier:

```bash
fly launch --no-deploy --copy-config
fly volumes create arbiter_data --size 1 --region iad
fly secrets set PAY_TO=YOUR_ADDRESS PUBLIC_URL=https://your-app.fly.dev
fly deploy
```

Whichever host: public HTTPS, a persistent volume mounted at `STATE_FILE`,
`SIGTERM` with at least 30s of grace, and no scale-to-zero.

## 5. Promote to MainNet

TestNet activity does **not** count toward the leaderboard. Promotion is one
environment variable — everything network-specific derives from it:

Set `ARBITER_NETWORK=mainnet` in your host's environment settings (Render:
service → Environment; Fly: `fly secrets set`), redeploy, then:

```bash
npm run preflight -- https://your-deployment.example.com
```

`assertChallengeReady()` refuses to boot a mainnet deployment that is still
pointing at localhost or plain HTTP, so a half-finished promotion fails loudly
instead of quietly serving an entry that cannot score.

Confirm before moving on:

- `preflight` reports **mainnet**, not testnet
- USDC asset reads `31566704`
- The mainnet `payTo` is opted in to `31566704`

## 6. Settle one real payment

The endpoint must complete at least one genuine MainNet payment end to end.
Point a paying client at it:

```bash
ARBITER_URL=https://your-app.fly.dev \
ARBITER_PRIVATE_KEY=base64-64-byte-key \
npx arbiter-proxy

curl -X POST http://127.0.0.1:4030/judge/counterparty \
  -H 'content-type: application/json' \
  -d '{"address":"SOME_ADDRESS","expectedAsset":"31566704"}'
```

The paying account needs USDC and must be opted in to `31566704`. Then confirm
USDC actually arrived at `payTo` — settling and *receiving* are different
claims, and only the second one counts.

## 7. Competition checklist

| Requirement | How to confirm |
|---|---|
| Paid endpoint returning 402 | `preflight` — 402 gating |
| GoPlausible facilitator | `preflight` — facilitator check |
| Bazaar discovery extension | `preflight` — per route |
| `x402-global-challenge` tag | `preflight` — per route |
| Single consistent `payTo` | `preflight` — single payTo |
| Public HTTPS on MainNet | `preflight` — HTTPS + network |
| `payTo` opted in to USDC | `preflight` — on-chain check |
| One real MainNet payment settled | Confirm USDC balance increased |
| Visible in Bazaar and leaderboard | Check with the challenge filter on |

The last two are the only ones `preflight` cannot confirm for you.

## Configuration

| Variable | Default | Notes |
|---|---|---|
| `PAY_TO` | — | Required. Fixed for the whole competition. |
| `ARBITER_NETWORK` | `testnet` | `testnet` or `mainnet`. Derives CAIP-2, USDC ASA, algod. |
| `PUBLIC_URL` | `http://localhost:4021` | Must be the real HTTPS origin on mainnet. |
| `PORT` | `4021` | |
| `FACILITATOR_URL` | GoPlausible | Changing it forfeits leaderboard tracking. |
| `STATE_FILE` | `./data/marketplace.json` | Point at a mounted volume. `off` disables persistence — required on Render's free plan, which has no disk. |
| `SHUTDOWN_GRACE_SECONDS` | `25` | Keep below the platform's kill timeout. |
| `TRUST_PROXY` | `false` | Set `true` behind a load balancer. |

## Troubleshooting

**`RouteConfigurationError: Facilitator does not support scheme "exact"`**
The facilitator advertises Algorand using the full padded base64 genesis hash as
the CAIP-2 reference, while `@x402/avm`'s constants use the 32-character
truncation. `src/facilitator.ts` resolves the identifier from `/supported` at
boot to bridge that. If this appears, the facilitator is unreachable and the
code fell back to the SDK constant — check `FACILITATOR_URL`.

**Payments settle but no USDC arrives.** `payTo` is not opted in to the asset.
Run `preflight`.

**Endpoint missing from the leaderboard.** Check the challenge tag is present on
every route, the facilitator is GoPlausible, and you are on mainnet — `preflight`
covers all three.

**State lost after deploy.** `STATE_FILE` is not on a mounted volume.

## Verification status

The image builds and runs. Verified against a live container:

- Boots as non-root (`uid=100(arbiter)`), Docker healthcheck reports `healthy`
- `preflight` scores 16/16 structural checks against the container
- Writes state to the mounted volume as the non-root user
- Restores across containers: a worker registered before a restart still
  authenticates in a fresh container sharing the volume
- Graceful shutdown on real `SIGTERM` — `docker stop` logs
  `SIGTERM received, draining...` then `state flushed, exiting cleanly`, exit
  code 0, in under a second rather than hitting the kill timeout

### Image size

440MB. Around 99MB of that is `viem`, `ox` and `typescript`, pulled in
transitively by `@x402/extensions` (which also depends on
`@signinwithethereum/siwe`). They are Ethereum libraries that an Algorand-only
service never executes, but `@x402/extensions` is what provides the Bazaar
discovery extension, so removing them would mean vendoring the piece that most
needs to stay spec-compliant. Left as-is deliberately.

### A build trap worth knowing

An earlier revision ran `chown -R arbiter:arbiter /data /app`. That single layer
took **273 seconds** and inflated the image to 645MB, because a recursive chown
over a copied layer forces Docker to write a fresh copy of every file in
`node_modules`.

The fix was to stop giving the runtime user ownership of `/app` at all. The
service only reads its own code, so root-owned and world-readable is both faster
and stricter — a compromised process cannot rewrite its own code. Only `/data`,
the one path it writes to, is owned by `arbiter`. That layer now takes 1.1
seconds.
