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

function renderFinding(f: Finding): string {
  return `<div class="finding">
    <div class="sev ${esc(f.severity)}">${esc(f.severity)}</div>
    <div class="t">${esc(f.title)}</div>
    <div class="d">${esc(f.detail)}</div>
  </div>`;
}

function renderExample(e: LiveExample): string {
  const findings = e.findings.length
    ? e.findings.map(renderFinding).join("")
    : `<p class="quiet">No findings. Nothing here needs a human's attention.</p>`;

  return `<article class="verdict">
    <div class="verdict-head">
      <h3>${esc(e.title)}</h3>
      <p>${esc(e.setup)}</p>
    </div>
    <div class="verdict-body">
      <div class="verdict-req">
        <pre>${esc(e.request)}</pre>
      </div>
      <div>
        <span class="badge ${esc(e.decision)}">${esc(e.decision.toUpperCase())}</span>
        <div class="metrics">
          risk ${e.risk}/100 · confidence ${e.confidence} · ${e.latencyMs}ms${
            e.degraded ? " · degraded" : ""
          }
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
  <h1>Agents act on the world.<br>Arbiter decides whether they should.</h1>
  <p class="lede">
    An AI agent about to sign a transaction cannot tell a legitimate one from a transaction
    that quietly hands away its wallet. <strong>Arbiter reads it and answers</strong> —
    allow, warn, or block, with reasons — for a fifth of a cent.
  </p>
  <div class="cta">
    <a class="btn btn-primary" href="/work/">Review work, earn ${esc(usdc)}</a>
    <a class="btn btn-ghost" href="/docs">Developer docs</a>
  </div>
  <div class="facts">
    <span class="fact">Network <b>Algorand ${esc(net)}</b></span>
    <span class="fact">Paid per call over <b>x402</b></span>
    <span class="fact">Settles in <b>${esc(usdc)}</b></span>
  </div>
</header>

<section>
  <h2>Judged live, on this page load</h2>
  <p class="sub">
    These are not screenshots. The transactions below were built and run through the same
    engines that serve paying callers when you opened this page — the timings and findings
    are what the service actually decided.
  </p>
  ${
    computedAt
      ? `<p class="livetag"><span class="livedot"></span>computed ${esc(computedAt)}</p>`
      : `<p class="livetag">Examples unavailable — an upstream data source is unreachable.</p>`
  }
  ${examples.map(renderExample).join("")}
</section>

<section>
  <h2>Three kinds of judgment</h2>
  <p class="sub">One response shape for all of them, so an agent integrates once.</p>
  <div class="grid">
    <div class="card">
      <h3>Transaction</h3>
      <div class="price">${esc(PRICING.transaction)} per call</div>
      <p>What a transaction really does, before signing. Rekeys, balance sweeps, clawbacks,
         fee drains, unlimited token approvals, EIP-7702 delegated accounts.</p>
    </div>
    <div class="card">
      <h3>Counterparty</h3>
      <div class="price">${esc(PRICING.counterparty)} per call</div>
      <p>Does this address belong to the party you mean to pay, and can the payment even
         arrive? Catches swapped invoice addresses and missing asset opt-ins.</p>
    </div>
    <div class="card">
      <h3>Human</h3>
      <div class="price">${esc(PRICING.human)} per call</div>
      <p>Questions a model cannot settle alone — does this photo show what it claims, is this
         document genuine — answered by a quorum of people.</p>
    </div>
  </div>
</section>

<section>
  <h2>Two lines to integrate</h2>
  <p class="sub">Payment is invisible. The SDK answers the 402 and signs, inside a cap you set.</p>
<pre>import { ArbiterClient } from <span class="k">"@arbiter/sdk"</span>;

const arbiter = new ArbiterClient({
  baseUrl: <span class="k">"${esc(config.publicUrl)}"</span>,
  privateKey: process.env.ALGO_KEY,
  maxTotalSpendUsd: 10,          <span class="dim">// enforced before anything is signed</span>
});

const verdict = await arbiter.judgeTransaction({ transaction, signer });
<span class="dim">if</span> (verdict.decision !== <span class="k">"allow"</span>) <span class="dim">return</span>;   <span class="dim">// do not sign</span></pre>
  <p class="sub" style="margin-top:18px">
    Also an <strong>MCP server</strong>, and tools for LangChain, ElizaOS and CrewAI.
    <a href="/docs">Full documentation →</a>
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
    <li><strong>Paid in ${esc(usdc)}</strong>, straight to your Algorand address.</li>
    <li><strong>Paid for answering, not for agreeing.</strong> Rewarding agreement would only
        teach reviewers to guess the majority instead of reporting what they saw.</li>
  </ul>
  <div class="cta">
    <a class="btn btn-primary" href="/work/">Start reviewing</a>
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
    body,
  });
}
