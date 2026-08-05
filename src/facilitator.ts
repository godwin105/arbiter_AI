/**
 * Facilitator capability discovery.
 *
 * The GoPlausible facilitator advertises Algorand networks using the full,
 * padded base64 genesis hash as the CAIP-2 reference
 * (`algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI=`), while the
 * @x402/avm constants use the CAIP-2-legal 32-character truncation
 * (`algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDe`). Both normalize to the same
 * network inside the AVM scheme, but the resource server validates route
 * configuration against the facilitator's advertised strings using exact
 * equality — so a hardcoded constant fails startup with "missing_facilitator".
 *
 * Resolving the identifier from /supported at boot keeps us compatible with
 * whichever form the facilitator serves, including after they fix the padding.
 */
import { normalizeAlgorandNetwork } from "@x402/avm";
import type { Network } from "@x402/core/types";

import { config } from "./config.js";

interface SupportedKind {
  x402Version: number;
  scheme: string;
  network: string;
  extra?: { feePayer?: string };
}

interface SupportedResponse {
  kinds?: SupportedKind[];
}

export interface ResolvedFacilitator {
  /** Network identifier exactly as the facilitator advertises it. */
  network: Network;
  /** Fee payer that co-signs the fee-covering transaction, when offered. */
  feePayer: string | undefined;
  /** False when discovery failed and we fell back to the SDK constant. */
  discovered: boolean;
}

/**
 * Picks the facilitator's advertised identifier for our configured network.
 *
 * Matching is done by normalizing both sides rather than by string equality, so
 * the padded and truncated forms are treated as the same network.
 */
export async function resolveFacilitator(timeoutMs = 8_000): Promise<ResolvedFacilitator> {
  const fallback: ResolvedFacilitator = {
    network: config.caip2,
    feePayer: undefined,
    discovered: false,
  };

  const target = normalizeAlgorandNetwork(config.caip2);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${config.facilitatorUrl}/supported`, {
      signal: controller.signal,
      headers: { accept: "application/json" },
    });
    if (!res.ok) return fallback;

    const body = (await res.json()) as SupportedResponse;

    const match = (body.kinds ?? []).find((kind) => {
      if (kind.scheme !== "exact") return false;
      // v2 is the current wire version; the v1 aliases ("algorand-testnet") are
      // legacy and are not what the resource server validates against.
      if (kind.x402Version !== 2) return false;
      if (!kind.network.startsWith("algorand:")) return false;
      try {
        return normalizeAlgorandNetwork(kind.network) === target;
      } catch {
        return false;
      }
    });

    if (!match) return fallback;

    return {
      // Guarded by the startsWith("algorand:") check above.
      network: match.network as Network,
      feePayer: match.extra?.feePayer,
      discovered: true,
    };
  } catch {
    return fallback;
  } finally {
    clearTimeout(timer);
  }
}
