/**
 * Transaction firewall.
 *
 * Decodes an unsigned Algorand transaction (or atomic group) and reports what it
 * would actually do if signed. The rules below target the ways an autonomous
 * agent actually loses funds — authority transfer, balance close-out, clawback,
 * and app upgrade/delete — rather than generic heuristics.
 *
 * Design rule: the caller has already paid by the time this runs, so no upstream
 * failure may throw. A lookup that fails lowers confidence and marks the verdict
 * degraded; it never turns into a 500.
 */
import algosdk, { OnApplicationComplete, TransactionType } from "algosdk";

import { getAccount, getAsset, getCurrentRound, isFundedAccount } from "./algorand.js";
import type { Finding, Verdict } from "../types.js";
import { decide, scoreFindings } from "../types.js";
import { config } from "../config.js";

export const ENGINE_VERSION = "tx-1.0.0";

/** Algorand's minimum fee, in microAlgos. */
const MIN_FEE = 1_000;
/** Minimum balance required for an account to exist, in microAlgos. */
const MIN_BALANCE = 100_000;
/** Above this, a fee stops looking like congestion pricing and starts looking like an attack. */
const SUSPICIOUS_FEE = 100_000;
const EGREGIOUS_FEE = 1_000_000;
/** ~9 hours at ~2.9s/round. A window this wide lets a signed txn be held and replayed later. */
const LONG_VALIDITY_ROUNDS = 11_000;

export interface TransactionRequest {
  chain: "algorand";
  /** Base64 unsigned transaction, or an array of them forming an atomic group. */
  transaction: string | string[];
  /** The address about to sign. Enables detection of self-harming operations. */
  signer?: string | undefined;
}

interface DecodedSummary {
  index: number;
  type: string;
  sender: string;
  fee: string;
  receiver?: string;
  amount?: string;
  assetId?: string;
  appId?: string;
  onComplete?: string;
  rekeyTo?: string;
  closeRemainderTo?: string;
  assetCloseTo?: string;
  clawbackFrom?: string;
}

export interface TransactionEvidence {
  network: string;
  transactionCount: number;
  totalFeeMicroAlgos: string;
  decoded: DecodedSummary[];
  /** Populated only when a lookup succeeded; absent entries are why confidence drops. */
  assetsInspected: Array<{
    assetId: string;
    name?: string;
    creator: string;
    clawbackEnabled: boolean;
    freezeEnabled: boolean;
  }>;
}

const ON_COMPLETE_NAMES: Record<number, string> = {
  [OnApplicationComplete.NoOpOC]: "NoOp",
  [OnApplicationComplete.OptInOC]: "OptIn",
  [OnApplicationComplete.CloseOutOC]: "CloseOut",
  [OnApplicationComplete.ClearStateOC]: "ClearState",
  [OnApplicationComplete.UpdateApplicationOC]: "UpdateApplication",
  [OnApplicationComplete.DeleteApplicationOC]: "DeleteApplication",
};

function decodeOne(b64: string): algosdk.Transaction {
  const bytes = Buffer.from(b64, "base64");
  if (bytes.length === 0) throw new Error("empty transaction payload");
  return algosdk.decodeUnsignedTransaction(bytes);
}

function summarize(txn: algosdk.Transaction, index: number): DecodedSummary {
  const summary: DecodedSummary = {
    index,
    type: String(txn.type),
    sender: txn.sender.toString(),
    fee: txn.fee.toString(),
  };

  if (txn.rekeyTo) summary.rekeyTo = txn.rekeyTo.toString();

  if (txn.payment) {
    summary.receiver = txn.payment.receiver.toString();
    summary.amount = txn.payment.amount.toString();
    if (txn.payment.closeRemainderTo) {
      summary.closeRemainderTo = txn.payment.closeRemainderTo.toString();
    }
  }

  if (txn.assetTransfer) {
    summary.receiver = txn.assetTransfer.receiver.toString();
    summary.amount = txn.assetTransfer.amount.toString();
    summary.assetId = txn.assetTransfer.assetIndex.toString();
    if (txn.assetTransfer.closeRemainderTo) {
      summary.assetCloseTo = txn.assetTransfer.closeRemainderTo.toString();
    }
    if (txn.assetTransfer.assetSender) {
      summary.clawbackFrom = txn.assetTransfer.assetSender.toString();
    }
  }

  if (txn.applicationCall) {
    summary.appId = txn.applicationCall.appIndex.toString();
    summary.onComplete =
      ON_COMPLETE_NAMES[txn.applicationCall.onComplete] ?? String(txn.applicationCall.onComplete);
  }

  return summary;
}

/**
 * Rules that need only the decoded bytes. These are the highest-severity checks
 * and, importantly, they still run when every network lookup fails.
 */
function staticRules(txn: algosdk.Transaction, index: number, signer?: string): Finding[] {
  const findings: Finding[] = [];
  const at = (s: string) => (index >= 0 ? `txn[${index}] ${s}` : s);
  const sender = txn.sender.toString();

  if (txn.rekeyTo) {
    const target = txn.rekeyTo.toString();
    if (target !== sender) {
      findings.push({
        code: "txn.rekey_to_third_party",
        severity: "critical",
        title: "Transaction rekeys the signing account to another address",
        detail: at(
          `rekeyTo is set to ${target}. Signing permanently transfers control of ${sender} ` +
            `to that address; every future transaction would be authorised by it, not by you.`,
        ),
        source: "arbiter:decoder",
      });
    }
  }

  if (txn.payment?.closeRemainderTo) {
    findings.push({
      code: "txn.close_remainder_to",
      severity: "critical",
      title: "Transaction closes the account and sweeps the remaining balance",
      detail: at(
        `closeRemainderTo is set to ${txn.payment.closeRemainderTo.toString()}. This sends the ` +
          `entire remaining ALGO balance there and closes the account, regardless of the ` +
          `${txn.payment.amount.toString()} microAlgo amount shown.`,
      ),
      source: "arbiter:decoder",
    });
  }

  if (txn.assetTransfer?.closeRemainderTo) {
    findings.push({
      code: "txn.asset_close_to",
      severity: "critical",
      title: "Transaction sweeps the entire asset balance",
      detail: at(
        `assetCloseTo is set to ${txn.assetTransfer.closeRemainderTo.toString()} for asset ` +
          `${txn.assetTransfer.assetIndex.toString()}. The full holding is transferred there, ` +
          `not the stated amount of ${txn.assetTransfer.amount.toString()}.`,
      ),
      source: "arbiter:decoder",
    });
  }

  if (txn.assetTransfer?.assetSender) {
    const victim = txn.assetTransfer.assetSender.toString();
    findings.push({
      code: "txn.clawback_revoke",
      severity: signer && victim === signer ? "critical" : "high",
      title: "Transaction is a clawback that moves assets out of a third-party account",
      detail: at(
        `Assets are being revoked from ${victim} rather than sent from the sender. ` +
          (signer && victim === signer
            ? "The account being drained is the signer."
            : "This only succeeds if the sender is the asset's clawback address."),
      ),
      source: "arbiter:decoder",
    });
  }

  if (txn.applicationCall) {
    const oc = txn.applicationCall.onComplete;
    if (oc === OnApplicationComplete.DeleteApplicationOC) {
      findings.push({
        code: "txn.app_delete",
        severity: "high",
        title: "Transaction deletes an application",
        detail: at(
          `onComplete is DeleteApplication for app ${txn.applicationCall.appIndex.toString()}. ` +
            `Any funds or state held by the application may become unrecoverable.`,
        ),
        source: "arbiter:decoder",
      });
    }
    if (oc === OnApplicationComplete.UpdateApplicationOC) {
      findings.push({
        code: "txn.app_update",
        severity: "high",
        title: "Transaction replaces an application's program",
        detail: at(
          `onComplete is UpdateApplication for app ${txn.applicationCall.appIndex.toString()}. ` +
            `The contract logic you evaluated is being swapped for different code.`,
        ),
        source: "arbiter:decoder",
      });
    }
    if (oc === OnApplicationComplete.CloseOutOC || oc === OnApplicationComplete.ClearStateOC) {
      findings.push({
        code: "txn.app_state_exit",
        severity: "low",
        title: "Transaction exits application state",
        detail: at(
          `onComplete is ${ON_COMPLETE_NAMES[oc]} for app ` +
            `${txn.applicationCall.appIndex.toString()}; local state will be discarded.`,
        ),
        source: "arbiter:decoder",
      });
    }
  }

  if (txn.keyreg && txn.keyreg.nonParticipation) {
    findings.push({
      code: "txn.keyreg_nonparticipation",
      severity: "medium",
      title: "Transaction marks the account as permanently non-participating",
      detail: at("This is irreversible and permanently forfeits consensus rewards."),
      source: "arbiter:decoder",
    });
  }

  const fee = Number(txn.fee);
  if (fee >= EGREGIOUS_FEE) {
    // A large fee is legitimate on application calls, where a single transaction
    // covers the pooled fees of its inner transactions. It is an attack when it
    // exceeds the value actually being moved — the loss is then the fee itself.
    const transferred = txn.payment ? Number(txn.payment.amount) : null;
    const costsMoreThanItSends = transferred !== null && fee > transferred;

    findings.push({
      code: "txn.excessive_fee",
      severity: costsMoreThanItSends ? "critical" : "high",
      title: costsMoreThanItSends
        ? "Transaction fee exceeds the amount being sent"
        : "Transaction fee is extreme",
      detail: at(
        `Fee is ${fee} microAlgos, ${Math.round(fee / MIN_FEE)}x the ${MIN_FEE} minimum` +
          (costsMoreThanItSends
            ? `, while moving only ${transferred} microAlgos. The fee is the payload: the ` +
              `balance leaves via the fee rather than via a visible transfer.`
            : `. Verify this covers pooled inner-transaction fees and is not a drain.`),
      ),
      source: "arbiter:decoder",
    });
  } else if (fee >= SUSPICIOUS_FEE) {
    findings.push({
      code: "txn.elevated_fee",
      severity: "medium",
      title: "Transaction fee is unusually high",
      detail: at(`Fee is ${fee} microAlgos against a ${MIN_FEE} minimum.`),
      source: "arbiter:decoder",
    });
  }

  const window = Number(txn.lastValid - txn.firstValid);
  if (window > LONG_VALIDITY_ROUNDS) {
    findings.push({
      code: "txn.long_validity_window",
      severity: "low",
      title: "Transaction stays valid for an unusually long time",
      detail: at(
        `Valid for ${window} rounds (~${Math.round((window * 2.9) / 3600)}h). A signed copy can ` +
          `be withheld and submitted later, when conditions differ from now.`,
      ),
      source: "arbiter:decoder",
    });
  }

  return findings;
}

/**
 * Rules that need network state. Each lookup is independent so that one failure
 * costs a single check rather than the whole network-informed pass.
 */
async function networkRules(
  txns: algosdk.Transaction[],
  signer: string | undefined,
  evidence: TransactionEvidence,
): Promise<{ findings: Finding[]; degraded: boolean }> {
  const findings: Finding[] = [];
  let degraded = false;

  const assetIds = new Set<string>();
  for (const txn of txns) {
    if (txn.assetTransfer) assetIds.add(txn.assetTransfer.assetIndex.toString());
  }

  // Tracked with the ALGO being sent, because whether an unfunded recipient is a
  // problem depends entirely on whether the payment clears the minimum balance.
  const receivers = new Map<string, { algoAmount: bigint; needsOptIn: boolean }>();
  for (const txn of txns) {
    if (txn.payment) {
      const addr = txn.payment.receiver.toString();
      const prev = receivers.get(addr);
      receivers.set(addr, {
        algoAmount: (prev?.algoAmount ?? 0n) + txn.payment.amount,
        needsOptIn: prev?.needsOptIn ?? false,
      });
    }
    if (txn.assetTransfer) {
      const addr = txn.assetTransfer.receiver.toString();
      const prev = receivers.get(addr);
      receivers.set(addr, { algoAmount: prev?.algoAmount ?? 0n, needsOptIn: true });
    }
  }

  const [assetLookups, receiverLookups, roundLookup, signerLookup] = await Promise.all([
    Promise.all([...assetIds].map(async (id) => ({ id, res: await getAsset(BigInt(id)) }))),
    Promise.all(
      [...receivers].map(async ([addr, info]) => ({ addr, info, res: await getAccount(addr) })),
    ),
    getCurrentRound(),
    signer ? getAccount(signer) : Promise.resolve(null),
  ]);

  for (const { id, res } of assetLookups) {
    if (!res.ok) {
      degraded = true;
      continue;
    }
    if (!res.data) {
      findings.push({
        code: "asset.nonexistent",
        severity: "high",
        title: "Asset does not exist on this network",
        detail: `Asset ${id} was not found on ${config.network}. The transaction cannot succeed as written.`,
        source: "algod:assets",
      });
      continue;
    }

    const p = res.data.params;
    evidence.assetsInspected.push({
      assetId: id,
      ...(p.name !== undefined ? { name: p.name } : {}),
      creator: p.creator,
      clawbackEnabled: Boolean(p.clawback),
      freezeEnabled: Boolean(p.freeze),
    });

    if (p.clawback) {
      findings.push({
        code: "asset.clawback_enabled",
        severity: "medium",
        title: "Asset creator can seize this asset after you receive it",
        detail:
          `Asset ${id}${p.name ? ` (${p.name})` : ""} has clawback address ${p.clawback}, ` +
          `which can transfer the asset out of any holder's account without their signature.`,
        source: "algod:assets",
      });
    }
    if (p.freeze) {
      findings.push({
        code: "asset.freeze_enabled",
        severity: "low",
        title: "Asset can be frozen by its creator",
        detail:
          `Asset ${id} has freeze address ${p.freeze}, which can block you from transferring it.`,
        source: "algod:assets",
      });
    }
  }

  for (const { addr, info, res } of receiverLookups) {
    if (!res.ok) {
      degraded = true;
      continue;
    }
    // algod returns a zero-balance record for any valid address rather than a
    // 404, so emptiness — not absence — is what identifies an unused account.
    if (isFundedAccount(res.data)) continue;

    if (info.needsOptIn) {
      findings.push({
        code: "counterparty.asset_to_unfunded",
        severity: "high",
        title: "Asset is being sent to an account that cannot receive it",
        detail:
          `${addr} has never been funded, so it cannot have opted in to the asset. Algorand ` +
          `rejects this transfer outright.`,
        source: "algod:accounts",
      });
    } else if (info.algoAmount < BigInt(MIN_BALANCE)) {
      findings.push({
        code: "counterparty.below_min_balance",
        severity: "high",
        title: "Payment is too small to create the recipient account",
        detail:
          `${addr} has never been funded, and ${info.algoAmount} microAlgos is under the ` +
          `${MIN_BALANCE} minimum balance required to open an account. This transfer fails.`,
        source: "algod:accounts",
      });
    } else {
      // Funding a genuinely new account is routine, so this is a typo check
      // rather than a warning about the transaction failing.
      findings.push({
        code: "counterparty.new_account",
        severity: "low",
        title: "Recipient account is new",
        detail:
          `${addr} has never been funded. The payment will succeed and open the account, but a ` +
          `mistyped address looks exactly like this.`,
        source: "algod:accounts",
      });
    }
  }

  if (signerLookup && signerLookup.ok && signerLookup.data?.["auth-addr"]) {
    findings.push({
      code: "signer.already_rekeyed",
      severity: "high",
      title: "Signing account has already been rekeyed",
      detail:
        `${signer} is controlled by ${signerLookup.data["auth-addr"]}. If that was not intentional, ` +
        `the account is already compromised and any signature produced now may not be yours.`,
      source: "algod:accounts",
    });
  } else if (signerLookup && !signerLookup.ok) {
    degraded = true;
  }

  if (roundLookup.ok && roundLookup.data !== null) {
    const current = roundLookup.data;
    for (const [i, txn] of txns.entries()) {
      if (Number(txn.lastValid) < current) {
        findings.push({
          code: "txn.expired",
          severity: "medium",
          title: "Transaction has already expired",
          detail: `txn[${i}] lastValid ${txn.lastValid} is behind the current round ${current}.`,
          source: "algod:status",
        });
      }
    }
  } else {
    degraded = true;
  }

  return { findings, degraded };
}

export async function judgeTransaction(req: TransactionRequest): Promise<Verdict<TransactionEvidence>> {
  const started = Date.now();
  const payloads = Array.isArray(req.transaction) ? req.transaction : [req.transaction];

  const txns: algosdk.Transaction[] = [];
  const decodeFindings: Finding[] = [];

  for (const [i, payload] of payloads.entries()) {
    try {
      txns.push(decodeOne(payload));
    } catch (err) {
      decodeFindings.push({
        code: "txn.undecodable",
        severity: "high",
        title: "Transaction could not be decoded",
        detail:
          `txn[${i}] is not a valid base64-encoded unsigned Algorand transaction: ` +
          `${err instanceof Error ? err.message : String(err)}. It cannot be verified, so it ` +
          `must not be signed.`,
        source: "arbiter:decoder",
      });
    }
  }

  const evidence: TransactionEvidence = {
    network: config.network,
    transactionCount: txns.length,
    totalFeeMicroAlgos: txns.reduce((sum, t) => sum + t.fee, 0n).toString(),
    decoded: txns.map((t, i) => summarize(t, i)),
    assetsInspected: [],
  };

  const findings: Finding[] = [...decodeFindings];
  for (const [i, txn] of txns.entries()) {
    findings.push(...staticRules(txn, payloads.length > 1 ? i : -1, req.signer));
  }

  let degraded = false;
  if (txns.length > 0) {
    const network = await networkRules(txns, req.signer, evidence);
    findings.push(...network.findings);
    degraded = network.degraded;
  }

  // Confidence reflects how much of the intended evidence we actually gathered.
  // Static rules alone are still trustworthy, so a degraded pass stays above the
  // escalation floor rather than collapsing to "ask a human".
  let confidence = 1;
  if (degraded) confidence -= 0.25;
  if (decodeFindings.length > 0) confidence -= 0.15;
  confidence = Math.max(0.45, Number(confidence.toFixed(2)));

  const risk = scoreFindings(findings);

  return {
    id: `vrd_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`,
    decision: decide(risk, confidence),
    risk,
    confidence,
    findings: findings.sort(
      (a, b) => scoreFindings([b]) - scoreFindings([a]),
    ),
    evidence,
    issuedAt: new Date().toISOString(),
    // Short: a verdict about a specific unsigned transaction stops being useful
    // once its validity window moves on.
    ttlSeconds: 60,
    meta: {
      route: "/v1/judge/transaction",
      network: config.network,
      engineVersion: ENGINE_VERSION,
      latencyMs: Date.now() - started,
      degraded,
    },
  };
}
