/**
 * Live verdicts for the landing page.
 *
 * These are not pasted output. The transactions below are constructed here and
 * run through the same engines that serve paying callers, at request time. What
 * a visitor reads is what the service decided moments ago — including the real
 * latency and, when an upstream is slow, the real degraded flag.
 *
 * That matters more than it sounds: a screenshot proves the product worked once
 * on someone's laptop. A verdict computed on page load proves it works now.
 *
 * Results are cached briefly because each one costs real algod and RPC calls,
 * and a landing page should not put load on the same upstreams that paying
 * requests depend on.
 */
import algosdk from "algosdk";

import { config } from "../config.js";
import { judgeEvmTransaction } from "../engine/evm.js";
import { judgeTransaction } from "../engine/transaction.js";
import type { Finding, Verdict } from "../types.js";

const CACHE_MS = 60_000;

export interface LiveExample {
  id: string;
  title: string;
  /** Why this looks harmless to a human or a wallet. */
  setup: string;
  /** The call as a caller would make it. */
  request: string;
  decision: Verdict["decision"];
  risk: number;
  confidence: number;
  findings: Finding[];
  latencyMs: number;
  degraded: boolean;
  computedAt: string;
}

let cache: { at: number; examples: LiveExample[] } | null = null;

/** A rekey hidden inside a zero-amount self-payment. */
async function rekeyExample(): Promise<LiveExample> {
  const victim = algosdk.generateAccount();
  const attacker = algosdk.generateAccount();

  // Anchored to the live chain so the validity window is real and the verdict
  // is not polluted by an "expired" finding.
  let firstValid = 1;
  try {
    const status = await fetch(`${config.algodUrl}/v2/status`, {
      signal: AbortSignal.timeout(4_000),
    });
    firstValid = ((await status.json()) as { "last-round": number })["last-round"];
  } catch {
    /* the decoder rules that matter do not depend on this */
  }

  const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    sender: victim.addr,
    receiver: victim.addr,
    amount: 0,
    rekeyTo: attacker.addr,
    suggestedParams: {
      minFee: 1000,
      fee: 1000,
      firstValid,
      lastValid: firstValid + 1000,
      genesisID: config.isMainnet ? "mainnet-v1.0" : "testnet-v1.0",
      genesisHash: Uint8Array.from(
        Buffer.from(
          config.isMainnet
            ? "wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qzkkit8="
            : "SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI=",
          "base64",
        ),
      ),
      flatFee: true,
    },
  });

  const encoded = Buffer.from(txn.toByte()).toString("base64");
  const verdict = await judgeTransaction({
    chain: "algorand",
    transaction: encoded,
    signer: victim.addr.toString(),
  });

  return {
    id: "rekey",
    title: "A zero-amount payment that hands over the account",
    setup:
      "Sends 0 ALGO from an account to itself. Most wallets render this as harmless — " +
      "nothing moves. It permanently transfers signing authority to someone else.",
    request: `POST /v1/judge/transaction
{
  "chain": "algorand",
  "transaction": "${encoded.slice(0, 44)}…",
  "signer": "${victim.addr.toString().slice(0, 20)}…"
}`,
    decision: verdict.decision,
    risk: verdict.risk,
    confidence: verdict.confidence,
    findings: verdict.findings,
    latencyMs: verdict.meta.latencyMs,
    degraded: verdict.meta.degraded,
    computedAt: verdict.issuedAt,
  };
}

/** An unlimited ERC-20 approval granted to a key-controlled account. */
async function approvalExample(): Promise<LiveExample> {
  const USDC_ETH = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
  const spender = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
  const data = `0x095ea7b3${spender.slice(2).toLowerCase().padStart(64, "0")}${"f".repeat(64)}`;

  const verdict = await judgeEvmTransaction({ to: USDC_ETH, data, chainId: 1 });

  return {
    id: "approval",
    title: "An approval that never expires and has no limit",
    setup:
      "Grants permission to move an unlimited amount of USDC, forever. Nothing leaves the " +
      "wallet when this is signed — the transfer that empties it comes later, and separately.",
    request: `POST /v1/judge/transaction
{
  "chain": "evm",
  "chainId": 1,
  "transaction": { "to": "${USDC_ETH.slice(0, 12)}…", "data": "0x095ea7b3…" }
}`,
    decision: verdict.decision,
    risk: verdict.risk,
    confidence: verdict.confidence,
    findings: verdict.findings,
    latencyMs: verdict.meta.latencyMs,
    degraded: verdict.meta.degraded,
    computedAt: verdict.issuedAt,
  };
}

/** An ordinary payment. A firewall that flags this is a firewall people disable. */
async function benignExample(): Promise<LiveExample> {
  const sender = algosdk.generateAccount();
  const friend = algosdk.generateAccount();

  let firstValid = 1;
  try {
    const status = await fetch(`${config.algodUrl}/v2/status`, {
      signal: AbortSignal.timeout(4_000),
    });
    firstValid = ((await status.json()) as { "last-round": number })["last-round"];
  } catch {
    /* not material to this example */
  }

  const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    sender: sender.addr,
    receiver: friend.addr,
    amount: 1_000_000,
    suggestedParams: {
      minFee: 1000,
      fee: 1000,
      firstValid,
      lastValid: firstValid + 1000,
      genesisID: config.isMainnet ? "mainnet-v1.0" : "testnet-v1.0",
      genesisHash: Uint8Array.from(
        Buffer.from(
          config.isMainnet
            ? "wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qzkkit8="
            : "SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI=",
          "base64",
        ),
      ),
      flatFee: true,
    },
  });

  const verdict = await judgeTransaction({
    chain: "algorand",
    transaction: Buffer.from(txn.toByte()).toString("base64"),
    signer: sender.addr.toString(),
  });

  return {
    id: "benign",
    title: "An ordinary 1 ALGO payment",
    setup:
      "Nothing wrong with it. Included because a firewall that cries wolf gets switched off, " +
      "and the only way to show it does not is to show it staying quiet.",
    request: `POST /v1/judge/transaction
{ "chain": "algorand", "transaction": "…", "signer": "…" }`,
    decision: verdict.decision,
    risk: verdict.risk,
    confidence: verdict.confidence,
    findings: verdict.findings,
    latencyMs: verdict.meta.latencyMs,
    degraded: verdict.meta.degraded,
    computedAt: verdict.issuedAt,
  };
}

/**
 * Runs all examples, or serves the recent cache.
 *
 * Failures are swallowed to an empty list: a landing page must still render if
 * an upstream is down, and a blank example section is better than a 500 on the
 * front door.
 */
export async function liveExamples(): Promise<LiveExample[]> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.examples;

  try {
    const examples = await Promise.all([rekeyExample(), approvalExample(), benignExample()]);
    cache = { at: Date.now(), examples };
    return examples;
  } catch (err) {
    console.error("[arbiter] landing examples failed:", err);
    return cache?.examples ?? [];
  }
}
