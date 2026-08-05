# @arbiter/proxy

A local sidecar that pays for Arbiter calls, so agents in any language can use it.

```bash
ARBITER_URL=https://arbiter-hs23.onrender.com \
ARBITER_PRIVATE_KEY=base64-64-byte-algorand-key \
ARBITER_MAX_SPEND_USD=10 \
npx @arbiter/proxy
```

Then call it over loopback, unpriced:

```bash
curl -X POST http://127.0.0.1:4030/judge/counterparty \
  -H 'content-type: application/json' \
  -d '{"address":"...","expectedAsset":"31566704"}'
```

## Why this exists

Paying x402 on Algorand needs an AVM scheme client, and that exists only in
TypeScript today. The published Python packages do not provide one — `x402`
ships no AVM client, and `x402-avm` ships none either despite the name. A Python
agent therefore cannot construct an Algorand x402 payment at all.

It is also the better arrangement where a native client *does* exist: one
process holds the funded key and enforces one budget, instead of every agent
process carrying a copy of both.

## Endpoints

`POST /judge/transaction` · `POST /judge/counterparty` · `POST /judge/human` ·
`GET /budget` · `GET /health`

## Security

Binds to `127.0.0.1` only — it is a paying oracle and must not be reachable from
the network. Set `ARBITER_PROXY_TOKEN` if other local processes should not be
able to spend. A budget error returns `429`, so callers back off rather than
retry into the cap.

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
