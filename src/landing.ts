/**
 * The landing page.
 *
 * Served at `/` to browsers, while agents and the Bazaar catalog continue to get
 * the JSON manifest from the same URL via content negotiation. One canonical
 * address, two audiences.
 *
 * Prices, network and payTo are read from config rather than written into the
 * markup, because a landing page that quotes a stale price is worse than no
 * landing page.
 */
import { PRICING, config } from "./config.js";

const ESCAPE: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
};

const esc = (value: string): string => value.replace(/[&<>"]/g, (c) => ESCAPE[c] ?? c);

export function renderLanding(): string {
  const net = config.isMainnet ? "MainNet" : "TestNet";
  const usdcLabel = config.isMainnet ? "USDC" : "test USDC";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Arbiter — judgment for autonomous agents</title>
<meta name="description" content="A paid API that tells an AI agent whether an action is safe before it takes it. Transaction firewall, counterparty verification, and human judgment — settled per call in USDC on Algorand.">
<link rel="icon" href="/icon.png">
<meta property="og:title" content="Arbiter — judgment for autonomous agents">
<meta property="og:description" content="Agents act on the world. Arbiter decides whether they should, one call at a time.">
<meta property="og:type" content="website">
<style>
  :root {
    --bg:#0d1117; --surface:#161b22; --border:#2d3a48;
    --text:#e6edf3; --muted:#8b98a5; --faint:#6a7683;
    --accent:#56d3a0; --accent-ink:#04231a;
    --danger:#f85149; --warn:#d29922;
    color-scheme: dark;
  }
  *{box-sizing:border-box}
  body{
    margin:0; background:var(--bg); color:var(--text);
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",sans-serif;
    -webkit-font-smoothing:antialiased; line-height:1.6;
  }
  .wrap{max-width:860px;margin:0 auto;padding:0 24px}
  a{color:var(--accent)}
  code,pre{font-family:ui-monospace,SFMono-Regular,"SF Mono",Menlo,monospace}

  header{padding:80px 0 56px}
  .brandline{display:flex;align-items:center;gap:12px;margin-bottom:28px}
  .brandline img{width:36px;height:36px;border-radius:8px}
  .brandline span{font-weight:700;font-size:19px;letter-spacing:-.2px}
  h1{font-size:clamp(34px,6vw,54px);line-height:1.1;letter-spacing:-1.5px;margin:0 0 20px;font-weight:700}
  .lede{font-size:clamp(17px,2.4vw,21px);color:var(--muted);max-width:62ch;margin:0}
  .lede strong{color:var(--text);font-weight:600}

  .cta{display:flex;flex-wrap:wrap;gap:12px;margin-top:36px}
  .btn{
    display:inline-block;padding:14px 22px;border-radius:12px;text-decoration:none;
    font-weight:700;font-size:15px;border:1px solid transparent;
  }
  .btn-primary{background:var(--accent);color:var(--accent-ink)}
  .btn-ghost{border-color:var(--border);color:var(--text)}
  .btn:hover{opacity:.9}

  section{padding:52px 0;border-top:1px solid var(--border)}
  h2{font-size:26px;letter-spacing:-.5px;margin:0 0 10px;font-weight:700}
  .sub{color:var(--muted);margin:0 0 28px;max-width:62ch}

  .grid{display:grid;gap:14px;grid-template-columns:repeat(auto-fit,minmax(240px,1fr))}
  .card{background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:22px}
  .card h3{margin:0 0 6px;font-size:16px;font-weight:700}
  .price{color:var(--accent);font-weight:700;font-size:14px;margin-bottom:10px}
  .card p{margin:0;color:var(--muted);font-size:14.5px}

  pre{
    background:var(--surface);border:1px solid var(--border);border-radius:14px;
    padding:20px;overflow-x:auto;font-size:13.5px;line-height:1.7;margin:0;
  }
  .block{color:var(--danger);font-weight:700}
  .allow{color:var(--accent);font-weight:700}
  .warnc{color:var(--warn);font-weight:700}
  .dim{color:var(--faint)}
  .cap{color:var(--faint);font-size:13.5px;margin:14px 0 0}

  ul.plain{margin:0;padding-left:20px;color:var(--muted)}
  ul.plain li{margin-bottom:9px}
  ul.plain strong{color:var(--text)}

  .facts{display:flex;flex-wrap:wrap;gap:10px;margin-top:8px}
  .fact{
    background:var(--surface);border:1px solid var(--border);border-radius:999px;
    padding:7px 14px;font-size:12.5px;color:var(--muted);
  }
  .fact b{color:var(--text);font-weight:600}

  footer{padding:44px 0 72px;border-top:1px solid var(--border);color:var(--faint);font-size:13.5px}
  footer a{color:var(--muted)}
</style>
</head>
<body>

<div class="wrap">

<header>
  <div class="brandline">
    <img src="/icon.png" alt="">
    <span>Arbiter</span>
  </div>
  <h1>Agents act on the world.<br>Arbiter decides whether they should.</h1>
  <p class="lede">
    An AI agent about to sign a transaction cannot tell a legitimate one from a transaction
    that quietly hands away its wallet. <strong>Arbiter reads it and answers</strong> — allow,
    warn, or block, with reasons — for a fifth of a cent.
  </p>
  <div class="cta">
    <a class="btn btn-primary" href="/work/">Review work, earn ${esc(usdcLabel)}</a>
    <a class="btn btn-ghost" href="https://github.com/godwin105/arbiter_AI">Read the code</a>
  </div>
  <div class="facts">
    <span class="fact">Network <b>Algorand ${esc(net)}</b></span>
    <span class="fact">Paid per call over <b>x402</b></span>
    <span class="fact">Settles in <b>${esc(usdcLabel)}</b></span>
  </div>
</header>

<section>
  <h2>This transaction looks like nothing</h2>
  <p class="sub">
    A zero-amount payment from an account to itself. Most wallets show it as harmless. It
    permanently transfers control of the account to someone else.
  </p>
<pre><span class="dim">$ curl -X POST /v1/judge/transaction -d '{"transaction":"gqNhbXTNA+ijZm..."}'</span>

<span class="block">BLOCK</span> — risk 100/100, confidence 1

  <span class="block">[CRITICAL]</span> Transaction rekeys the signing account to another address
    rekeyTo is set to 6V2RCHBAFZK5BXZ7SK7N3IMHMLBLPVMOHKVMQ76P34O2K6RXPZ55RO7UNE.
    Signing permanently transfers control of this account to that address;
    every future transaction would be authorised by it, not by you.

<span class="dim">verdict vrd_4b0ea38eb710 · 359ms · paid $0.002000</span></pre>
  <p class="cap">
    Real output. The firewall also catches balance sweeps disguised as small transfers,
    clawbacks, fee drains, and — on EVM chains — unlimited approvals granted to wallets
    pretending to be contracts.
  </p>
</section>

<section>
  <h2>Three kinds of judgment</h2>
  <p class="sub">One response shape for all of them, so an agent integrates once.</p>
  <div class="grid">
    <div class="card">
      <h3>Transaction</h3>
      <div class="price">${esc(PRICING.transaction)} per call</div>
      <p>Decode what a transaction really does before signing. Rekeys, balance sweeps,
         clawbacks, fee drains, unlimited token approvals.</p>
    </div>
    <div class="card">
      <h3>Counterparty</h3>
      <div class="price">${esc(PRICING.counterparty)} per call</div>
      <p>Does this address belong to the party you think you are paying, and can the
         payment even arrive? Catches swapped invoice addresses and missing asset opt-ins.</p>
    </div>
    <div class="card">
      <h3>Human</h3>
      <div class="price">${esc(PRICING.human)} per call</div>
      <p>Questions a model cannot settle alone — does this photo show what it claims, is
         this document genuine — answered by a quorum of people.</p>
    </div>
  </div>
</section>

<section>
  <h2>Two lines to integrate</h2>
  <p class="sub">Payment is invisible. The SDK answers the 402 and signs, inside a spend cap you set.</p>
<pre>import { ArbiterClient } from "@arbiter/sdk";

const arbiter = new ArbiterClient({
  baseUrl: "${esc(config.publicUrl)}",
  privateKey: process.env.ALGO_KEY,
  maxTotalSpendUsd: 10,          <span class="dim">// enforced before anything is signed</span>
});

const verdict = await arbiter.judgeTransaction({ transaction, signer });
if (verdict.decision !== "allow") return;   <span class="dim">// do not sign</span></pre>
  <p class="cap">
    Also available as an <strong>MCP server</strong>, and as tools for LangChain, ElizaOS
    and CrewAI. An agent in a retry loop against a paid endpoint is a wallet-draining bug,
    so the spend cap lives in the client rather than in advice.
  </p>
</section>

<section>
  <h2>Get paid to answer questions</h2>
  <p class="sub">
    When an agent cannot decide something itself, it pays a person who can. That person
    could be you.
  </p>
  <ul class="plain">
    <li><strong>No install.</strong> It runs in your browser. No app store, no account with us.</li>
    <li><strong>Paid in ${esc(usdcLabel)}</strong>, straight to your Algorand address.</li>
    <li><strong>Paid for answering, not for agreeing.</strong> Rewarding agreement would just
        teach reviewers to guess the majority instead of reporting what they saw.</li>
  </ul>
  <div class="cta">
    <a class="btn btn-primary" href="/work/">Start reviewing</a>
  </div>
</section>

<footer>
  <p>
    Arbiter · paid per call over <a href="https://x402.org">x402</a> on Algorand ${esc(net)} ·
    <a href="/.well-known/x402">service manifest</a> ·
    <a href="https://github.com/godwin105/arbiter_AI">source</a>
  </p>
  <p>
    Agents and catalogs requesting <code>application/json</code> at this address get the
    manifest instead of this page.
  </p>
</footer>

</div>
</body>
</html>`;
}
