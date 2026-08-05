/**
 * Minimal algod REST access.
 *
 * Deliberately uses fetch against the REST API rather than the algosdk client:
 * every lookup here sits in the hot path of a paid request, so a hard per-call
 * timeout matters more than SDK ergonomics. Callers have already been charged by
 * the time we get here, so no upstream failure may throw — each function returns
 * a result that says whether the data was actually obtained.
 */
import { config } from "../config.js";

// Generous enough to survive a slow public indexer under load. A paid caller is
// better served by a correct answer at 5s than a degraded one at 2.5s.
const DEFAULT_TIMEOUT_MS = 5_000;

export interface Lookup<T> {
  ok: boolean;
  data: T | null;
  /** Present when ok is false; used to explain a degraded verdict. */
  error?: string;
}

export interface AccountInfo {
  address: string;
  /** microAlgos */
  amount: number;
  "min-balance": number;
  "total-assets-opted-in": number;
  "total-apps-opted-in": number;
  "total-created-assets": number;
  /** Round the account was first seen; absent on some archival configs. */
  "created-at-round"?: number;
  assets?: Array<{ "asset-id": number; amount: number; "is-frozen": boolean }>;
  /** Set when the account has handed signing authority to another address. */
  "auth-addr"?: string;
}

export interface AssetInfo {
  index: number;
  params: {
    name?: string;
    "unit-name"?: string;
    creator: string;
    total: number;
    decimals: number;
    "default-frozen"?: boolean;
    url?: string;
    /** Presence of these means the creator retains power over holders' balances. */
    manager?: string;
    reserve?: string;
    freeze?: string;
    clawback?: string;
  };
}

async function algodGet<T>(path: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<Lookup<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${config.algodUrl}${path}`, {
      signal: controller.signal,
      headers: { accept: "application/json" },
    });

    if (res.status === 404) {
      // A 404 is a real answer, not a failure: the account or asset does not exist.
      return { ok: true, data: null };
    }
    if (!res.ok) {
      return { ok: false, data: null, error: `algod ${res.status}` };
    }

    return { ok: true, data: (await res.json()) as T };
  } catch (err) {
    const reason = err instanceof Error && err.name === "AbortError" ? "timeout" : String(err);
    return { ok: false, data: null, error: `algod unreachable (${reason})` };
  } finally {
    clearTimeout(timer);
  }
}

export function getAccount(address: string): Promise<Lookup<AccountInfo>> {
  return algodGet<AccountInfo>(`/v2/accounts/${address}`);
}

export function getAsset(assetId: bigint | number): Promise<Lookup<AssetInfo>> {
  return algodGet<AssetInfo>(`/v2/assets/${assetId.toString()}`);
}

/**
 * Whether an account has ever actually been funded.
 *
 * algod answers for *any* syntactically valid address, returning a zero-balance
 * record rather than 404, so a null result is not how a non-existent account
 * shows up. An account that holds nothing, has opted in to nothing and has
 * joined no applications has never been used.
 */
export function isFundedAccount(info: AccountInfo | null): boolean {
  if (!info) return false;
  return (
    info.amount > 0 ||
    info["total-assets-opted-in"] > 0 ||
    info["total-apps-opted-in"] > 0 ||
    info["total-created-assets"] > 0
  );
}

/** Current consensus round, used to age accounts and bound validity windows. */
export async function getCurrentRound(): Promise<Lookup<number>> {
  const res = await algodGet<{ "last-round": number }>("/v2/status");
  return res.data ? { ok: res.ok, data: res.data["last-round"] } : { ...res, data: null };
}
