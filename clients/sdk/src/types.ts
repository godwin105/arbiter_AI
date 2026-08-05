/**
 * Public verdict contract.
 *
 * Mirrors the server's response shape. Defined here rather than imported from
 * the server so that installing the SDK does not drag in the service.
 */

export type Decision = "allow" | "warn" | "block" | "escalate";

export type Severity = "info" | "low" | "medium" | "high" | "critical";

export interface Finding {
  code: string;
  severity: Severity;
  title: string;
  detail: string;
  source: string;
}

export interface Verdict<T = unknown> {
  id: string;
  decision: Decision;
  /** 0–100, where 100 is maximum assessed risk. */
  risk: number;
  /** 0–1. Low confidence with high risk is what produces `escalate`. */
  confidence: number;
  findings: Finding[];
  evidence: T;
  issuedAt: string;
  ttlSeconds: number;
  meta: {
    route: string;
    network: string;
    engineVersion: string;
    latencyMs: number;
    /** True when an upstream source was unavailable and the verdict is partial. */
    degraded: boolean;
  };
}

// --- Route inputs ---------------------------------------------------------

export interface AlgorandTransactionInput {
  chain?: "algorand";
  /** Base64 unsigned transaction, or an array forming an atomic group. */
  transaction: string | string[];
  /** Address about to sign; enables detection of self-harming operations. */
  signer?: string;
}

export interface EvmTransactionInput {
  chain: "evm";
  /** 1 Ethereum, 8453 Base, 11155111 Sepolia, 84532 Base Sepolia, ... */
  chainId: number;
  /** The unsigned transaction request, as a wallet would be asked to sign it. */
  transaction: {
    to: string;
    /** Hex calldata. Omit or "0x" for a plain value transfer. */
    data?: string;
    /** Wei, decimal or hex. */
    value?: string;
    from?: string;
  };
}

export type TransactionInput = AlgorandTransactionInput | EvmTransactionInput;

export interface CounterpartyInput {
  address: string;
  /** ASA id the payment will be sent in. Enables the opt-in check. */
  expectedAsset?: string;
  amount?: string;
  /** NFD the counterparty claims. Enables identity verification. */
  claimedIdentity?: string;
}

export interface HumanInput {
  question: string;
  attachments?: string[];
  options?: string[];
  quorum?: number;
  /** Seconds to hold the request open waiting for reviewers. */
  waitSeconds?: number;
}

// --- Route evidence -------------------------------------------------------

export interface TransactionEvidence {
  network: string;
  transactionCount: number;
  totalFeeMicroAlgos: string;
  decoded: Array<Record<string, unknown>>;
  assetsInspected: Array<{
    assetId: string;
    name?: string;
    creator: string;
    clawbackEnabled: boolean;
    freezeEnabled: boolean;
  }>;
}

/** An account's kind. `delegated` is an EOA with EIP-7702 code — still key-controlled. */
export type AccountKind = "eoa" | "delegated" | "contract";

export interface EvmEvidence {
  chainId: number;
  chainName: string;
  to: string;
  valueWei: string;
  decoded: {
    selector: string;
    function: string | null;
    signature: string | null;
    args: Record<string, string>;
  } | null;
  targetKind: AccountKind | null;
  spenderKind: AccountKind | null;
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

export interface HumanEvidence {
  taskId: string;
  status: "open" | "resolved" | "expired";
  question: string;
  answer: string | null;
  agreement: string | null;
  tally: Record<string, number> | null;
  reviewers: Array<{ rationale: string; answer: string; responseMs: number }>;
  responsesReceived: number;
  quorum: number;
  /** Free endpoint for collecting the result later; the call is already paid. */
  retrieveUrl: string;
  payoutPerReviewerUsdc: string;
}
