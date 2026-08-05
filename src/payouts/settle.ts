/**
 * Reviewer payout settlement.
 *
 * Pays each reviewer the USDC they are owed, on Algorand.
 *
 * Two decisions shape everything here:
 *
 * 1. **Claim before broadcasting.** Payouts are moved to `settling` and given an
 *    attempt id *before* any transaction is sent. A crash mid-flight therefore
 *    leaves money unpaid rather than paid twice. Unpaid is recoverable by a
 *    person looking at the stuck rows; paid twice is not.
 *
 * 2. **Check the payee before paying.** Every payout address goes through
 *    Arbiter's own counterparty engine first. That is not decoration: a USDC
 *    transfer to an account that has not opted in is rejected by the protocol,
 *    so paying blind would burn fees and leave the reviewer unpaid with no
 *    explanation. This is the exact failure /v1/judge/counterparty exists to
 *    catch, and it applies to us as much as to anyone.
 */
import algosdk from "algosdk";

import { config } from "../config.js";
import { judgeCounterparty } from "../engine/counterparty.js";
import { type PayoutEntry, store } from "../marketplace/store.js";

/** Below this, the transfer fee is a meaningful fraction of the payment. */
const MIN_PAYOUT_USDC = 0.01;

export interface SettlementResult {
  workerId: string;
  payoutAddress: string;
  amountUsdc: number;
  payoutCount: number;
  status: "settled" | "skipped" | "failed";
  txId?: string;
  confirmedRound?: number;
  reason?: string;
}

export interface SettlementSummary {
  attempted: number;
  settled: number;
  skipped: number;
  failed: number;
  totalPaidUsdc: number;
  results: SettlementResult[];
}

/** Loads the payout account from configuration. Mnemonic or base64 key. */
export function loadPayoutAccount(): algosdk.Account | null {
  const mnemonic = process.env["ARBITER_PAYOUT_MNEMONIC"];
  const privateKey = process.env["ARBITER_PAYOUT_PRIVATE_KEY"];

  try {
    if (mnemonic) return algosdk.mnemonicToSecretKey(mnemonic.trim());
    if (privateKey) {
      const sk = new Uint8Array(Buffer.from(privateKey, "base64"));
      const addr = algosdk.encodeAddress(sk.slice(32));
      return { addr: algosdk.decodeAddress(addr), sk } as algosdk.Account;
    }
  } catch (err) {
    throw new Error(
      `Payout account could not be loaded: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return null;
}

function algod(): algosdk.Algodv2 {
  return new algosdk.Algodv2("", config.algodUrl, "");
}

/** USDC held by the payout account, in whole units. */
export async function payoutBalance(address: string): Promise<{ usdc: number; algo: number }> {
  const info = await algod().accountInformation(address).do();
  const holding = info.assets?.find((a) => Number(a.assetId) === config.usdcAssetId);
  return {
    usdc: holding ? Number(holding.amount) / 1e6 : 0,
    algo: Number(info.amount) / 1e6,
  };
}

/**
 * Settles everything currently owed.
 *
 * @param dryRun when true, runs every check and reports what would happen
 *               without claiming payouts or broadcasting anything.
 */
export async function settlePayouts(options: { dryRun?: boolean } = {}): Promise<SettlementSummary> {
  const dryRun = options.dryRun ?? false;
  const account = loadPayoutAccount();

  if (!account) {
    throw new Error(
      "No payout account configured. Set ARBITER_PAYOUT_MNEMONIC (25 words) or " +
        "ARBITER_PAYOUT_PRIVATE_KEY (base64) in .env. This account holds working " +
        "capital only — keep it separate from PAY_TO, which accumulates revenue.",
    );
  }

  const from = account.addr.toString();
  const owed = store.workersOwed();

  const summary: SettlementSummary = {
    attempted: owed.length,
    settled: 0,
    skipped: 0,
    failed: 0,
    totalPaidUsdc: 0,
    results: [],
  };

  if (owed.length === 0) return summary;

  const balance = await payoutBalance(from);
  let remaining = balance.usdc;

  const client = algod();

  for (const worker of owed) {
    const amount = Number(worker.amountUsdc.toFixed(6));

    const record = (result: Omit<SettlementResult, "workerId" | "payoutAddress" | "amountUsdc" | "payoutCount">) => {
      summary.results.push({
        workerId: worker.workerId,
        payoutAddress: worker.payoutAddress,
        amountUsdc: amount,
        payoutCount: worker.count,
        ...result,
      });
      summary[result.status === "settled" ? "settled" : result.status === "skipped" ? "skipped" : "failed"] += 1;
    };

    if (amount < MIN_PAYOUT_USDC) {
      record({
        status: "skipped",
        reason: `Owed ${amount.toFixed(6)} USDC, below the ${MIN_PAYOUT_USDC} minimum. Accrues until it clears.`,
      });
      continue;
    }

    if (amount > remaining) {
      record({
        status: "skipped",
        reason: `Payout account holds ${remaining.toFixed(6)} USDC, short of ${amount.toFixed(6)}. Top it up.`,
      });
      continue;
    }

    // --- Check the payee before spending anything -------------------------

    const verdict = await judgeCounterparty({
      address: worker.payoutAddress,
      expectedAsset: config.usdcAsset,
      amount: String(amount),
    });

    if (verdict.decision === "block") {
      const worst = verdict.findings[0];
      record({
        status: "skipped",
        reason: `Arbiter blocked this payee: ${worst?.title ?? "unknown"}. ${worst?.detail ?? ""}`.trim(),
      });
      continue;
    }

    if (dryRun) {
      record({ status: "settled", reason: "dry run — nothing was claimed or sent" });
      summary.totalPaidUsdc += amount;
      remaining -= amount;
      continue;
    }

    // --- Claim, then pay ---------------------------------------------------

    const attemptId = `pay_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const claimed: PayoutEntry[] = store.claimForSettlement(worker.workerId, attemptId);

    if (claimed.length === 0) {
      record({ status: "skipped", reason: "Nothing left to claim — already settled by another run." });
      continue;
    }

    try {
      const params = await client.getTransactionParams().do();

      const txn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
        sender: from,
        receiver: worker.payoutAddress,
        amount: Math.round(amount * 1e6),
        assetIndex: config.usdcAssetId,
        suggestedParams: params,
        // The attempt id is written on-chain so a settlement that is interrupted
        // after broadcasting can be reconciled against the ledger rather than
        // guessed at.
        note: new TextEncoder().encode(`arbiter:payout:${attemptId}`),
      });

      const signed = txn.signTxn(account.sk);
      const { txid } = await client.sendRawTransaction(signed).do();
      const confirmed = await algosdk.waitForConfirmation(client, txid, 10);

      store.completeAttempt(attemptId, { status: "settled", txId: txid });
      summary.totalPaidUsdc += amount;
      remaining -= amount;

      record({
        status: "settled",
        txId: txid,
        confirmedRound: Number(confirmed.confirmedRound),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // The transfer did not confirm. Marking failed rather than releasing the
      // claim keeps it out of the next run until a person has looked at why.
      store.completeAttempt(attemptId, { status: "failed", error: message });
      record({ status: "failed", reason: message });
    }
  }

  await store.flush();
  return summary;
}
