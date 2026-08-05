/**
 * Counterparty verification.
 *
 * Answers the question a payout agent has to get right before it moves money:
 * does this address really belong to the party we think we are paying, and will
 * the payment actually arrive.
 *
 * The two checks that carry the most weight are identity mismatch (the invoice
 * is genuine but the address was swapped) and missing asset opt-in (an Algorand
 * ASA transfer to an account that has not opted in simply fails). Both are
 * silent, expensive failures that a model reading an invoice cannot detect.
 */
import { getAccount, isFundedAccount } from "./algorand.js";
import { resolveIdentity } from "./identity.js";
import type { Finding, Verdict } from "../types.js";
import { decide, scoreFindings } from "../types.js";
import { config } from "../config.js";

export const ENGINE_VERSION = "cp-1.0.0";

/** Algorand's base minimum balance, in microAlgos. */
const MIN_BALANCE = 100_000;

export interface CounterpartyRequest {
  address: string;
  /** ASA id the payment will be sent in. Enables the opt-in check. */
  expectedAsset?: string | undefined;
  /** Payment amount in whole units, for size-anomaly checks. */
  amount?: string | undefined;
  /** NFD or domain the counterparty claims. Enables identity verification. */
  claimedIdentity?: string | undefined;
}

export interface CounterpartyEvidence {
  address: string;
  exists: boolean;
  balanceMicroAlgos: string | null;
  assetsOptedIn: number | null;
  optedIntoExpectedAsset: boolean | null;
  expectedAssetFrozen: boolean | null;
  rekeyedTo: string | null;
  identity: {
    claimed: string;
    status: string;
    matchedField?: string;
    knownAddresses?: string[];
  } | null;
}

export async function judgeCounterparty(
  req: CounterpartyRequest,
): Promise<Verdict<CounterpartyEvidence>> {
  const started = Date.now();
  const findings: Finding[] = [];
  let degraded = false;

  const [accountLookup, identity] = await Promise.all([
    getAccount(req.address),
    req.claimedIdentity ? resolveIdentity(req.claimedIdentity, req.address) : Promise.resolve(null),
  ]);

  const account = accountLookup.data;
  if (!accountLookup.ok) degraded = true;

  const funded = isFundedAccount(account);

  const evidence: CounterpartyEvidence = {
    address: req.address,
    exists: funded,
    balanceMicroAlgos: account ? String(account.amount) : null,
    assetsOptedIn: account ? account["total-assets-opted-in"] : null,
    optedIntoExpectedAsset: null,
    expectedAssetFrozen: null,
    rekeyedTo: account?.["auth-addr"] ?? null,
    identity: null,
  };

  // --- Identity -----------------------------------------------------------

  if (identity) {
    evidence.identity = {
      claimed: identity.name,
      status: identity.status,
      ...(identity.status === "match" ? { matchedField: identity.matchedField } : {}),
      ...("candidates" in identity ? { knownAddresses: identity.candidates } : {}),
    };

    switch (identity.status) {
      case "mismatch":
        findings.push({
          code: "identity.address_mismatch",
          severity: "critical",
          title: "Payment address does not belong to the claimed identity",
          detail:
            `${identity.name} resolves to ${identity.candidates.join(", ") || "no addresses"}, ` +
            `but the payment is directed at ${req.address}. This is the signature of an ` +
            `invoice with a substituted payment address.`,
          source: "nfd:registry",
        });
        break;

      case "expired":
        findings.push({
          code: "identity.expired",
          severity: "medium",
          title: "Claimed identity has expired",
          detail:
            `${identity.name} is expired and may have been re-registered by someone else, ` +
            `so it no longer proves who controls it.`,
          source: "nfd:registry",
        });
        break;

      case "not_found":
        findings.push({
          code: "identity.unregistered",
          severity: "medium",
          title: "Claimed identity is not registered",
          detail:
            `${identity.name} does not exist. The counterparty asserted an identity that ` +
            `cannot be verified against any registry entry.`,
          source: "nfd:registry",
        });
        break;

      case "unavailable":
        degraded = true;
        break;

      case "match":
        // Verified: no finding. The absence is the signal.
        break;
    }
  }

  // --- Account existence and reachability ---------------------------------

  if (!accountLookup.ok) {
    // The chain is the primary source here. Without it we know nothing about
    // this counterparty, and saying nothing must never read as saying "fine".
    findings.push({
      code: "counterparty.unverifiable",
      severity: "high",
      title: "Counterparty could not be checked on-chain",
      detail:
        `The ledger lookup for ${req.address} failed (${accountLookup.error ?? "unknown error"}), ` +
        `so opt-in status, rekey state and balance are all unknown. This verdict carries no ` +
        `assurance about the address.`,
      source: "algod:accounts",
    });
  } else if (!funded) {
    findings.push({
      code: "counterparty.account_not_found",
      severity: "high",
      title: "Counterparty account does not exist on-chain",
      detail:
        `${req.address} has never been funded on ${config.network}. A payment below the ` +
        `${MIN_BALANCE} microAlgo minimum balance will be rejected, and a mistyped address is ` +
        `indistinguishable from an unused one.`,
      source: "algod:accounts",
    });
  }

  if (account && funded) {
    if (account["auth-addr"]) {
      findings.push({
        code: "counterparty.rekeyed",
        severity: "high",
        title: "Counterparty account is controlled by a different address",
        detail:
          `${req.address} has been rekeyed to ${account["auth-addr"]}. Funds sent here are ` +
          `spendable by that address, not by the account's original owner.`,
        source: "algod:accounts",
      });
    }

    if (account.amount < MIN_BALANCE) {
      findings.push({
        code: "counterparty.below_min_balance",
        severity: "medium",
        title: "Counterparty balance is below the minimum",
        detail:
          `Balance is ${account.amount} microAlgos, under the ${MIN_BALANCE} minimum. The ` +
          `account may be unable to transact, including to accept an asset opt-in.`,
        source: "algod:accounts",
      });
    }

    // --- Relationship history ----------------------------------------------

    const optedIn = account["total-assets-opted-in"];
    const apps = account["total-apps-opted-in"];
    if (optedIn === 0 && apps === 0 && account.amount < 1_000_000) {
      findings.push({
        code: "counterparty.no_activity",
        severity: "medium",
        title: "Counterparty account has no meaningful history",
        detail:
          `${req.address} holds no assets, has joined no applications, and carries a thin ` +
          `balance. Freshly created accounts are the norm for payment redirection fraud.`,
        source: "algod:accounts",
      });
    }
  }

  // --- Asset opt-in --------------------------------------------------------
  // Runs whenever the ledger answered, funded or not: an account that does not
  // exist has definitionally not opted in, and the transfer will be rejected.

  if (accountLookup.ok && req.expectedAsset) {
    const assetId = Number(req.expectedAsset);
    const holding = account?.assets?.find((a) => a["asset-id"] === assetId);

    evidence.optedIntoExpectedAsset = Boolean(holding);
    evidence.expectedAssetFrozen = holding ? holding["is-frozen"] : null;

    if (!holding) {
      findings.push({
        code: "counterparty.not_opted_in",
        severity: "critical",
        title: "Counterparty has not opted in to the asset being sent",
        detail:
          `${req.address} is not opted in to asset ${req.expectedAsset}. On Algorand this ` +
          `transfer is rejected outright — the payment cannot arrive until the recipient ` +
          `opts in first.`,
        source: "algod:accounts",
      });
    } else if (holding["is-frozen"]) {
      findings.push({
        code: "counterparty.asset_frozen",
        severity: "high",
        title: "Counterparty's holding of this asset is frozen",
        detail:
          `Asset ${req.expectedAsset} is frozen for ${req.address}. The payment would arrive ` +
          `but the recipient would be unable to move or use it.`,
        source: "algod:accounts",
      });
    }
  }

  // --- Amount sanity -------------------------------------------------------

  if (req.amount && account) {
    const amount = Number(req.amount);
    if (Number.isFinite(amount) && amount > 0) {
      const balanceAlgo = account.amount / 1_000_000;
      // A payment that dwarfs everything the account has ever held is not proof
      // of fraud, but it is the point at which a typo stops being recoverable.
      if (balanceAlgo > 0 && amount > balanceAlgo * 1_000) {
        findings.push({
          code: "counterparty.amount_anomaly",
          severity: "low",
          title: "Payment is far larger than anything this account has held",
          detail:
            `Sending ${req.amount} to an account holding ~${balanceAlgo.toFixed(4)} ALGO. ` +
            `Worth confirming the amount and the destination separately.`,
          source: "arbiter:heuristic",
        });
      }
    }
  }

  let confidence = 1;
  if (degraded) confidence -= 0.3;
  // Not asking for identity verification is the caller's choice, but it removes
  // the only check that catches a swapped payment address.
  if (!req.claimedIdentity) confidence -= 0.15;
  if (!req.expectedAsset) confidence -= 0.1;

  if (!accountLookup.ok) {
    // The ledger is the primary source. If it was unreachable, the verdict is
    // held below the escalation floor no matter what else succeeded, so it can
    // never be mistaken for a clean result.
    confidence = Math.min(confidence, 0.35);
  }

  confidence = Math.max(0.1, Number(confidence.toFixed(2)));

  const risk = scoreFindings(findings);

  return {
    id: `vrd_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`,
    decision: decide(risk, confidence),
    risk,
    confidence,
    findings: findings.sort((a, b) => scoreFindings([b]) - scoreFindings([a])),
    evidence,
    issuedAt: new Date().toISOString(),
    // Counterparty state changes slowly; an opt-in or rekey is durable enough
    // that a caller can safely reuse this across a batch run.
    ttlSeconds: 900,
    meta: {
      route: "/v1/judge/counterparty",
      network: config.network,
      engineVersion: ENGINE_VERSION,
      latencyMs: Date.now() - started,
      degraded,
    },
  };
}
