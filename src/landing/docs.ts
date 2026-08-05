/**
 * Developer documentation, served at /docs.
 *
 * Written for someone deciding whether to integrate, so it leads with the
 * payment model — the thing most likely to stop them — rather than an endpoint
 * table they can read anywhere.
 */
import { PRICING, config } from "../config.js";
import { esc, page } from "./shell.js";

export function renderDocs(): string {
  const net = config.isMainnet ? "mainnet" : "testnet";
  const usdcId = config.usdcAsset;
  const base = config.publicUrl;

  const body = `
<div class="wrap">

<header style="padding-bottom:32px">
  <h1 style="font-size:clamp(30px,4.5vw,42px)">Documentation</h1>
  <p class="lede">
    Three endpoints, one response shape, paid per call. Nothing to sign up for — payment is
    the authentication.
  </p>
</header>

<section>
  <h2>How paying works</h2>
  <p class="sub">
    Arbiter uses <a href="https://x402.org">x402</a>: an unpaid request is answered with
    <code>402 Payment Required</code> and the terms; the client pays and retries. There are
    no API keys and no accounts.
  </p>
<pre><span class="dim"># 1. Ask without paying</span>
POST ${esc(base)}/v1/judge/transaction
<span class="dim">→ 402 Payment Required</span>
<span class="dim">→ PAYMENT-REQUIRED: &lt;base64 terms: amount, asset, payTo, network&gt;</span>

<span class="dim"># 2. Client signs a USDC payment and retries with proof</span>
POST ${esc(base)}/v1/judge/transaction
     X-PAYMENT: &lt;signed payload&gt;
<span class="dim">→ 200 OK, verdict body</span></pre>
  <p class="sub" style="margin-top:18px">
    The SDK does both steps. You call one method and never see the 402.
  </p>

  <table>
    <tr><th>Setting</th><th>Value</th></tr>
    <tr><td>Network</td><td><code>Algorand ${esc(net)}</code></td></tr>
    <tr><td>Asset</td><td><code>USDC · ASA ${esc(usdcId)}</code></td></tr>
    <tr><td>Facilitator</td><td><code>${esc(config.facilitatorUrl)}</code></td></tr>
    <tr><td>Pays to</td><td><code>${esc(config.payTo)}</code></td></tr>
  </table>
  <p class="sub">
    Your paying account needs USDC <strong>and must be opted in to ASA ${esc(usdcId)}</strong>.
    On Algorand a transfer to an account that has not opted in is rejected outright, so an
    un-opted-in payer simply cannot pay. Fees are sponsored by the facilitator, so the payer
    does not need ALGO.
  </p>
</section>

<section>
  <h2>Endpoints</h2>
  <table>
    <tr><th>Route</th><th>Price</th><th>Answers</th></tr>
    <tr>
      <td><code>POST /v1/judge/transaction</code></td>
      <td><code>${esc(PRICING.transaction)}</code></td>
      <td>Is this transaction safe to sign?</td>
    </tr>
    <tr>
      <td><code>POST /v1/judge/counterparty</code></td>
      <td><code>${esc(PRICING.counterparty)}</code></td>
      <td>Is this address who I think it is, and can it receive?</td>
    </tr>
    <tr>
      <td><code>POST /v1/judge/human</code></td>
      <td><code>${esc(PRICING.human)}</code></td>
      <td>What would a person say about this?</td>
    </tr>
    <tr>
      <td><code>GET /v1/judge/human/:taskId</code></td>
      <td><code>free</code></td>
      <td>Collect a human verdict you already paid for</td>
    </tr>
  </table>

  <h3 style="margin-top:28px">Transaction — Algorand</h3>
<pre>{
  <span class="k">"chain"</span>: <span class="k">"algorand"</span>,
  <span class="k">"transaction"</span>: <span class="k">"&lt;base64 unsigned txn&gt;"</span>,   <span class="dim">// or an array for an atomic group</span>
  <span class="k">"signer"</span>: <span class="k">"&lt;58-char address&gt;"</span>          <span class="dim">// optional; enables self-harm detection</span>
}</pre>

  <h3 style="margin-top:22px">Transaction — EVM</h3>
<pre>{
  <span class="k">"chain"</span>: <span class="k">"evm"</span>,
  <span class="k">"chainId"</span>: 1,                          <span class="dim">// 1, 8453, 42161, 137, 11155111, 84532</span>
  <span class="k">"transaction"</span>: {
    <span class="k">"to"</span>: <span class="k">"0x…"</span>,
    <span class="k">"data"</span>: <span class="k">"0x…"</span>,                      <span class="dim">// omit for a plain value transfer</span>
    <span class="k">"value"</span>: <span class="k">"0"</span>
  }
}</pre>

  <h3 style="margin-top:22px">Counterparty</h3>
<pre>{
  <span class="k">"address"</span>: <span class="k">"&lt;58-char address&gt;"</span>,
  <span class="k">"expectedAsset"</span>: <span class="k">"${esc(usdcId)}"</span>,          <span class="dim">// enables the opt-in check</span>
  <span class="k">"amount"</span>: <span class="k">"250.00"</span>,
  <span class="k">"claimedIdentity"</span>: <span class="k">"acme.algo"</span>          <span class="dim">// detects a swapped payment address</span>
}</pre>

  <h3 style="margin-top:22px">Human</h3>
<pre>{
  <span class="k">"question"</span>: <span class="k">"Does this photo show a package at a front door?"</span>,
  <span class="k">"attachments"</span>: [<span class="k">"https://…"</span>],
  <span class="k">"options"</span>: [<span class="k">"yes"</span>, <span class="k">"no"</span>, <span class="k">"unclear"</span>],      <span class="dim">// omit for free text</span>
  <span class="k">"quorum"</span>: 3,
  <span class="k">"waitSeconds"</span>: 60                        <span class="dim">// long-poll; 0 returns immediately</span>
}</pre>
  <p class="sub" style="margin-top:14px">
    If reviewers do not finish inside <code>waitSeconds</code> you get a pending verdict and a
    <code>taskId</code>. Collect it later from the free retrieval endpoint — timing out never
    costs a second payment.
  </p>
</section>

<section>
  <h2>The verdict</h2>
  <p class="sub">Every route returns this. Integrate the shape once.</p>
<pre>{
  <span class="k">"decision"</span>: <span class="k">"block"</span>,        <span class="dim">// allow | warn | block | escalate</span>
  <span class="k">"risk"</span>: 100,                <span class="dim">// 0–100</span>
  <span class="k">"confidence"</span>: 1,            <span class="dim">// 0–1</span>
  <span class="k">"findings"</span>: [{
    <span class="k">"code"</span>: <span class="k">"txn.rekey_to_third_party"</span>,
    <span class="k">"severity"</span>: <span class="k">"critical"</span>,   <span class="dim">// info | low | medium | high | critical</span>
    <span class="k">"title"</span>: <span class="k">"…"</span>,
    <span class="k">"detail"</span>: <span class="k">"…"</span>,
    <span class="k">"source"</span>: <span class="k">"arbiter:decoder"</span>
  }],
  <span class="k">"evidence"</span>: { <span class="dim">/* route-specific: the decoded txn, the account record */</span> },
  <span class="k">"ttlSeconds"</span>: 60,
  <span class="k">"meta"</span>: { <span class="k">"latencyMs"</span>: 359, <span class="k">"degraded"</span>: <span class="dim">false</span> }
}</pre>

  <table style="margin-top:20px">
    <tr><th>Decision</th><th>What to do</th></tr>
    <tr><td><code>allow</code></td><td>Nothing blocking was found. Proceed.</td></tr>
    <tr><td><code>warn</code></td><td>Proceed only if your operator accepts the listed risks.</td></tr>
    <tr><td><code>block</code></td><td>Do not proceed. Acting on this would likely cause loss.</td></tr>
    <tr><td><code>escalate</code></td><td>Not enough evidence to decide. <strong>Not an approval.</strong> Ask a human.</td></tr>
  </table>

  <p class="sub">
    Two behaviours worth relying on. <code>confidence</code> below 0.4 returns
    <code>escalate</code> rather than <code>allow</code>, so a thin-evidence verdict can never
    be mistaken for a clean bill of health. And <code>meta.degraded</code> is true when an
    upstream was unreachable — the verdict is still useful, because the decode rules that
    catch the critical severities do not depend on the network, but it is partial.
  </p>
</section>

<section>
  <h2>Clients</h2>
  <table>
    <tr><th>Package</th><th>For</th></tr>
    <tr><td><code>@arbiterlabs/sdk</code></td><td>TypeScript. Pays x402 automatically.</td></tr>
    <tr><td><code>@arbiterlabs/mcp</code></td><td>Any MCP host.</td></tr>
    <tr><td><code>@arbiterlabs/langchain</code></td><td>LangChain.js tools.</td></tr>
    <tr><td><code>@arbiterlabs/eliza</code></td><td>ElizaOS plugin.</td></tr>
    <tr><td><code>@arbiterlabs/proxy</code></td><td>Local paying sidecar for non-TypeScript agents.</td></tr>
    <tr><td><code>arbiter-crewai</code></td><td>CrewAI, via the sidecar.</td></tr>
  </table>

  <h3 style="margin-top:24px">Spend limits are part of the client</h3>
  <p class="sub">
    An agent stuck in a retry loop against a paid endpoint is a wallet-draining bug, so the
    cap is enforced in the payment selector — before anything is signed — rather than left to
    the integrator to remember.
  </p>
<pre>const arbiter = new ArbiterClient({
  baseUrl: <span class="k">"${esc(base)}"</span>,
  privateKey: process.env.ALGO_KEY,
  maxPricePerCallUsd: 0.05,   <span class="dim">// refuse any single call above this</span>
  maxTotalSpendUsd: 10,       <span class="dim">// lifetime cap for this client</span>
});</pre>

  <h3 style="margin-top:24px">Python and other languages</h3>
  <p class="sub">
    Paying x402 on Algorand requires an AVM scheme client, which today exists only in
    TypeScript — the published Python packages ship none. Run the sidecar instead; it holds
    the key, pays, and re-exposes the judgments unpriced on loopback.
  </p>
<pre>ARBITER_URL=${esc(base)} \\
ARBITER_PRIVATE_KEY=… \\
npx arbiter-proxy</pre>
</section>

<section>
  <h2>Errors</h2>
  <table>
    <tr><th>Status</th><th>Meaning</th></tr>
    <tr><td><code>402</code></td><td>No payment attached, or the payment was not accepted. Usually the payer holds no USDC or is not opted in.</td></tr>
    <tr><td><code>400</code></td><td>Request body did not match the schema. The response lists the offending fields — you have already been charged, so it names what to fix rather than telling you to retry.</td></tr>
    <tr><td><code>404</code></td><td>Unknown route, or a human <code>taskId</code> that does not exist.</td></tr>
    <tr><td><code>409</code></td><td>Reviewer submission rejected — already answered, or the task closed.</td></tr>
    <tr><td><code>500</code></td><td>The verdict could not be produced. This call should not have been charged.</td></tr>
  </table>
</section>

<section>
  <h2>Reviewer API</h2>
  <p class="sub">
    Unpriced. Reviewers are the supply side and get paid, so charging them to see the queue
    would be backwards. Most people should just use <a href="/work/">the app</a>.
  </p>
  <table>
    <tr><th>Route</th><th>Does</th></tr>
    <tr><td><code>POST /v1/work/register</code></td><td>Register; returns a bearer token, shown once.</td></tr>
    <tr><td><code>GET /v1/work/queue</code></td><td>Open questions you have not answered.</td></tr>
    <tr><td><code>POST /v1/work/:taskId/submit</code></td><td>Answer, with a rationale.</td></tr>
    <tr><td><code>GET /v1/work/earnings</code></td><td>USDC owed and settled.</td></tr>
  </table>
</section>

</div>`;

  return page({
    title: "Arbiter — developer documentation",
    description:
      "Endpoints, the verdict contract, x402 payment flow, clients and error codes for " +
      "Arbiter — judgment for autonomous agents.",
    active: "docs",
    body,
  });
}
