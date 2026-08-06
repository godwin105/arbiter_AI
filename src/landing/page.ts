/**
 * The landing page.
 *
 * Served at `/` to browsers; agents and the Bazaar catalog get the JSON manifest
 * from the same URL via content negotiation.
 *
 * Prices, network and base URL come from config rather than the markup — a
 * landing page quoting a stale price is worse than no landing page — and the
 * verdicts are computed by the real engines on request rather than pasted in.
 */
import { PRICING, config } from "../config.js";
import type { Finding } from "../types.js";
import { type LiveExample, liveExamples } from "./examples.js";
import { esc, page } from "./shell.js";

/** Cells in the risk meter. Coarse on purpose: risk is an estimate, not a gauge. */
const METER_CELLS = 20;

function renderMeter(decision: string, risk: number): string {
  const cells = Array.from({ length: METER_CELLS }, () => "<i></i>").join("");
  return `<div class="meter ${esc(decision)}" data-risk="${risk}" role="img"
    aria-label="Risk ${risk} out of 100">${cells}</div>`;
}

function renderFinding(f: Finding): string {
  return `<div class="finding">
    <div class="sev ${esc(f.severity)}">${esc(f.severity)}</div>
    <div class="t">${esc(f.title)}</div>
    <div class="d">${esc(f.detail)}</div>
  </div>`;
}

function renderExample(e: LiveExample, index: number): string {
  const findings = e.findings.length
    ? e.findings.map(renderFinding).join("")
    : `<p class="quiet">No findings. Nothing here needs a human's attention.</p>`;

  return `<article class="verdict" data-reveal>
    <div class="verdict-head">
      <div>
        <h3>${esc(e.title)}</h3>
        <p>${esc(e.setup)}</p>
      </div>
    </div>
    <div class="verdict-body">
      <div class="verdict-req">
        <div class="term">
          <div class="term-bar">
            <span class="dots" aria-hidden="true"><i></i><i></i><i></i></span>
            <span class="name">request ${index + 1}</span>
            <button class="copy" type="button">copy</button>
          </div>
          <pre>${esc(e.request)}</pre>
        </div>
      </div>
      <div>
        <span class="badge ${esc(e.decision)}">${esc(e.decision.toUpperCase())}</span>
        ${renderMeter(e.decision, e.risk)}
        <div class="metrics">
          <span>risk <b>${e.risk}</b>/100</span>
          <span>confidence <b>${e.confidence}</b></span>
          <span><b>${e.latencyMs}</b>ms</span>
          ${e.degraded ? "<span>degraded</span>" : ""}
        </div>
        ${findings}
      </div>
    </div>
  </article>`;
}

export async function renderLanding(): Promise<string> {
  const examples = await liveExamples();
  const net = config.isMainnet ? "MainNet" : "TestNet";
  const usdc = config.isMainnet ? "USDC" : "test USDC";
  const computedAt = examples[0]?.computedAt;

  const body = `
<div class="wrap">

<header>
  <p class="eyebrow"><b>&#9679; live</b> Algorand ${esc(net)} &middot; paid per call over x402</p>
  <h1>Agents act on the world.<br>Arbiter decides whether they should.</h1>
  <p class="lede">
    An AI agent about to sign a transaction cannot tell a legitimate one from a transaction
    that quietly hands away its wallet. <strong>Arbiter reads it and answers</strong> —
    allow, warn, or block, with reasons — for a fifth of a cent.
  </p>
  <div class="cta">
    <a class="btn btn-primary" href="/work/">Review work, earn ${esc(usdc)}</a>
    <a class="btn btn-ghost" href="/about">What is this?</a>
  </div>
  <div class="facts">
    <span class="fact">Network <b>Algorand ${esc(net)}</b></span>
    <span class="fact">Paid per call over <b>x402</b></span>
    <span class="fact">Settles in <b>${esc(usdc)}</b></span>
    <span class="fact">No account, <b>no API key</b></span>
  </div>

  <div class="term" style="margin-top:38px" data-reveal>
    <div class="term-bar">
      <span class="dots" aria-hidden="true"><i></i><i></i><i></i></span>
      <span class="name">the whole protocol</span>
      <button class="copy" type="button">copy</button>
    </div>
<pre><span class="dim">$</span> curl -X POST ${esc(config.publicUrl)}/v1/judge/transaction
<span class="dim">&larr; 402 Payment Required</span>   <span class="dim">terms: ${esc(PRICING.transaction)} USDC &rarr; ${esc(config.payTo.slice(0, 8))}&hellip;</span>

<span class="dim">$</span> curl -X POST &hellip; -H <span class="k">"X-PAYMENT: &lt;signed&gt;"</span>
<span class="dim">&larr; 200 OK</span>   { <span class="k">"decision"</span>: <span class="k">"block"</span>, <span class="k">"risk"</span>: 100 }<span class="cursor" aria-hidden="true"></span></pre>
  </div>
</header>

<section id="live" data-reveal>
  <p class="eyebrow"><b>01</b> judged on this page load</p>
  <h2>These are not screenshots</h2>
  <p class="sub">
    The transactions below were built and run through the same engines that serve paying
    callers when you opened this page — the timings and findings are what the service
    actually decided.
  </p>
  ${
    computedAt
      ? `<p class="livetag"><span class="livedot"></span>computed ${esc(computedAt)}</p>`
      : `<p class="livetag">Examples unavailable — an upstream data source is unreachable.</p>`
  }
  ${examples.map(renderExample).join("")}
</section>

<section id="judgments" data-reveal>
  <p class="eyebrow"><b>02</b> the catalogue</p>
  <h2>Three kinds of judgment</h2>
  <p class="sub">One response shape for all of them, so an agent integrates once.</p>
  <div class="grid">
    <div class="card">
      <div class="price">${esc(PRICING.transaction)} / call</div>
      <h3>Transaction</h3>
      <p>What a transaction really does, before signing. Rekeys, balance sweeps, clawbacks,
         fee drains, unlimited token approvals, EIP-7702 delegated accounts.</p>
      <div class="route">POST /v1/judge/transaction</div>
    </div>
    <div class="card">
      <div class="price">${esc(PRICING.counterparty)} / call</div>
      <h3>Counterparty</h3>
      <p>Does this address belong to the party you mean to pay, and can the payment even
         arrive? Catches swapped invoice addresses and missing asset opt-ins.</p>
      <div class="route">POST /v1/judge/counterparty</div>
    </div>
    <div class="card">
      <div class="price">${esc(PRICING.human)} / call</div>
      <h3>Human</h3>
      <p>Questions a model cannot settle alone — does this photo show what it claims, is this
         document genuine — answered by a quorum of people.</p>
      <div class="route">POST /v1/judge/human</div>
    </div>
  </div>
</section>

<section id="invoice" data-reveal>
  <p class="eyebrow"><b>03</b> built on it</p>
  <h2>Cross-border invoicing</h2>
  <p class="sub">
    A freelancer in Lagos billing a client in Berlin waits days and loses about 7% to get
    paid. Send a link instead — the client pays in digital dollars, it arrives in seconds,
    and the fee is a fraction of a cent.
  </p>
  <div class="steps">
    <div class="step">
      <div class="n">01</div>
      <h3>Raise it</h3>
      <p>Name, amount, address. The invoice is encoded into its own link.</p>
    </div>
    <div class="step">
      <div class="n">02</div>
      <h3>Send the link</h3>
      <p>Your client opens it anywhere. The payee is checked before they are asked to pay.</p>
    </div>
    <div class="step">
      <div class="n">03</div>
      <h3>Watch it land</h3>
      <p>Payment is read from the chain. The page updates itself when the money arrives.</p>
    </div>
  </div>
  <ul class="plain" style="margin-top:26px">
    <li><strong>The payee is checked before the client is asked to pay.</strong> The same
        engine behind <code>/v1/judge/counterparty</code> catches an address that cannot
        receive — a payment there does not bounce, it silently never arrives.</li>
    <li><strong>Nothing is stored.</strong> The invoice lives inside its own link, so the
        amount and your client's name never reach our servers or logs.</li>
    <li><strong>The receipt is the ledger.</strong> Payment is read from the chain, so it
        does not depend on us saying it was paid.</li>
  </ul>
  <div class="cta">
    <a class="btn btn-ghost" href="/invoice/">Create an invoice</a>
  </div>
</section>

<section id="integrate" data-reveal>
  <p class="eyebrow"><b>04</b> integration</p>
  <h2>Two lines to integrate</h2>
  <p class="sub">Payment is invisible. The SDK answers the 402 and signs, inside a cap you set.</p>
  <div class="term">
    <div class="term-bar">
      <span class="dots" aria-hidden="true"><i></i><i></i><i></i></span>
      <span class="name">agent.ts</span>
      <button class="copy" type="button">copy</button>
    </div>
<pre>import { ArbiterClient } from <span class="k">"@arbiterlabs/sdk"</span>;

const arbiter = new ArbiterClient({
  baseUrl: <span class="k">"${esc(config.publicUrl)}"</span>,
  privateKey: process.env.ALGO_KEY,
  maxTotalSpendUsd: 10,          <span class="dim">// enforced before anything is signed</span>
});

const verdict = await arbiter.judgeTransaction({ transaction, signer });
<span class="dim">if</span> (verdict.decision !== <span class="k">"allow"</span>) <span class="dim">return</span>;   <span class="dim">// do not sign</span></pre>
  </div>
  <p class="sub" style="margin-top:18px">
    Also an <strong>MCP server</strong>, and tools for LangChain, ElizaOS and CrewAI.
    <a href="/docs">Full documentation &rarr;</a>
  </p>
</section>

<section id="earn" data-reveal>
  <p class="eyebrow"><b>05</b> the supply side</p>
  <h2>Get paid to answer questions</h2>
  <p class="sub">
    When an agent cannot decide something itself, it pays a person who can. That person
    could be you.
  </p>
  <ul class="plain">
    <li><strong>No install.</strong> It runs in your browser. No app store, no account with us.</li>
    <li><strong>Paid in ${esc(usdc)}</strong>, straight to your Algorand address.</li>
    <li><strong>Paid for answering, not for agreeing.</strong> Rewarding agreement would only
        teach reviewers to guess the majority instead of reporting what they saw.</li>
  </ul>
  <div class="cta">
    <a class="btn btn-primary" href="/work/">Start reviewing</a>
    <a class="btn btn-ghost" href="/docs">Read the docs</a>
  </div>
</section>

</div>`;

  return page({
    title: "Arbiter — judgment for autonomous agents",
    description:
      "A paid API that tells an AI agent whether an action is safe before it takes it. " +
      "Transaction firewall, counterparty verification and human judgment, settled per call " +
      "in USDC on Algorand.",
    active: "home",
    path: "/",
    body,
  });
}
