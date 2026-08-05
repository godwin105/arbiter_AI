# Arbiter — reviewer app

The supply side of the human judgment marketplace. Agents pay for judgments they
cannot make alone; this is where a person actually answers them.

**Live at [arbiter-x402.fly.dev/work](https://arbiter-x402.fly.dev/work/)** — served
by the Arbiter server itself, so reaching a reviewer is sending a link.

React 19 + Vite. No router, no UI framework, no state library.

## Running it

```bash
npm --prefix web install
npm --prefix web run dev
```

Set the server field on the sign-in screen to point at a remote Arbiter, or
leave it blank to use the origin the page came from. In production that blank
default is the whole point: same-origin means the API calls are not
cross-origin at all.

To build what the server serves:

```bash
npm --prefix web run build     # -> web/dist, served at /work
```

## Why web and not React Native

An earlier version was an Expo app (still in `app/`). Web won on the thing that
actually matters for a marketplace: **distribution is a URL.** Recruiting a
reviewer is sending a link, not "install Expo Go, scan this QR code". There are
also no app store accounts in play, so the native path had no route to the
stores.

Being served from the Arbiter origin removes CORS from the picture entirely, and
the bundle is less than half the size — 201KB against 472KB for the React Native
web build, 63KB gzipped.

What was given up is push notifications, particularly on iOS. That matters for a
marketplace — a reviewer who does not know work arrived means the agent's
long-poll times out — and Web Push is the eventual answer. It is not blocking
anything today.

## The flow

1. **Sign in** — display name and an Algorand payout address, validated locally
   before it is sent, because a typo here becomes an address that silently never
   receives anything.
2. **Queue** — open questions with payout, deadline, attachment count and how
   many reviewers have answered. Refreshes every 15s, because an agent is
   blocked waiting on the other end.
3. **Answer** — fixed options or free text, plus what you actually saw. Time
   spent is reported to the server, which flags implausibly fast answers as a
   quality signal.
4. **Earnings** — USDC owed and settled, review count, and agreement rate once
   there are enough reviews for it to mean anything.

## Verified end to end

Against the live deployment, not a mock:

```
agent    -> POST /v1/judge/human, paid $0.25 over x402     task hmt_ac2660d7…
app      -> appears in queue: $0.150000 USDC, 58m left, 1 attachment
reviewer -> answers "yes" in 31s with a written rationale
agent    -> GET /v1/judge/human/hmt_ac2660d7…  (free — already paid)
            ALLOW · answer "yes" · agreement 1/1 · confidence 0.91
app      -> Earnings: $0.150000 awaiting settlement, 1 review
```

## Notes

**Semantic HTML.** Real `form`, `label`, `button` and `img alt` elements, so the
accessibility tree is meaningful — the React Native web build rendered
everything as anonymous `div`s.

**`erasableSyntaxOnly` is on** in the Vite template's tsconfig, which forbids
constructor parameter properties. `ApiError` declares its `status` field
explicitly rather than relaxing the setting.

**Assets are relative** (`base: "./"` in `vite.config.ts`) because the app is
served under `/work`, not at the domain root. Absolute asset paths would 404.

**Navigation is a state machine.** Four screens, one linear flow — a router
would add a dependency without removing any complexity.

## Not yet built

Payouts are recorded but **not settled on-chain** — `Settled` reads $0.00 for
everyone, and there is real USDC owed. The ledger is correct; what is missing is
the job that actually pays reviewers on Algorand.
