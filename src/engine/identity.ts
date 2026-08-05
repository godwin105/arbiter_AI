/**
 * NFD identity resolution.
 *
 * This exists to catch the single most damaging failure in agent-driven
 * payments: the payee is real, the invoice is real, but the address has been
 * swapped. Resolving the claimed name and comparing it against the address the
 * agent is about to pay is what turns that from an undetectable loss into a
 * blocked transaction.
 */
import { config } from "../config.js";

const TIMEOUT_MS = 3_000;

export interface NfdRecord {
  name: string;
  state?: string;
  expired?: boolean;
  owner?: string;
  depositAccount?: string;
  nfdAccount?: string;
  properties?: { verified?: { caAlgo?: string } };
}

export type IdentityResult =
  | { status: "match"; name: string; matchedField: string; candidates: string[] }
  | { status: "mismatch"; name: string; candidates: string[] }
  | { status: "not_found"; name: string }
  | { status: "expired"; name: string; candidates: string[] }
  | { status: "unavailable"; name: string; reason: string };

/** NFD names are `something.algo`; accept a bare label and normalize it. */
function normalizeName(claimed: string): string {
  const trimmed = claimed.trim().toLowerCase();
  return trimmed.includes(".") ? trimmed : `${trimmed}.algo`;
}

/**
 * Every address the NFD legitimately points at.
 *
 * `depositAccount` is listed first deliberately: it is where the owner has
 * declared payments should go, so a match there is the strongest signal that
 * paying this address is correct.
 */
function candidateAddresses(record: NfdRecord): Array<{ field: string; address: string }> {
  const out: Array<{ field: string; address: string }> = [];

  if (record.depositAccount) out.push({ field: "depositAccount", address: record.depositAccount });
  if (record.owner) out.push({ field: "owner", address: record.owner });
  if (record.nfdAccount) out.push({ field: "nfdAccount", address: record.nfdAccount });

  // Verified linked addresses arrive as a comma-separated list.
  const linked = record.properties?.verified?.caAlgo;
  if (linked) {
    for (const addr of linked.split(",").map((a) => a.trim()).filter(Boolean)) {
      out.push({ field: "verified.caAlgo", address: addr });
    }
  }

  return out;
}

export async function resolveIdentity(claimed: string, address: string): Promise<IdentityResult> {
  const name = normalizeName(claimed);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(
      `${config.env.NFD_API_URL}/nfd/${encodeURIComponent(name)}?view=full`,
      { signal: controller.signal, headers: { accept: "application/json" } },
    );

    // The NFD API answers an unregistered name with 400, not 404.
    if (res.status === 400 || res.status === 404) {
      return { status: "not_found", name };
    }
    if (!res.ok) {
      return { status: "unavailable", name, reason: `nfd ${res.status}` };
    }

    const record = (await res.json()) as NfdRecord;
    const candidates = candidateAddresses(record);
    const addresses = candidates.map((c) => c.address);

    const hit = candidates.find((c) => c.address === address);

    if (record.expired) {
      return { status: "expired", name, candidates: addresses };
    }
    if (hit) {
      return { status: "match", name, matchedField: hit.field, candidates: addresses };
    }
    return { status: "mismatch", name, candidates: addresses };
  } catch (err) {
    const reason = err instanceof Error && err.name === "AbortError" ? "timeout" : String(err);
    return { status: "unavailable", name, reason };
  } finally {
    clearTimeout(timer);
  }
}
