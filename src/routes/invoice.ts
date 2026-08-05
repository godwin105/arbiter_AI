/**
 * Support endpoint for the invoice app.
 *
 * Free and deliberately narrow. It answers only the two questions the invoice
 * page needs — can this address receive the asset, and has it been paid — rather
 * than exposing the full counterparty verdict, which is what /v1/judge/counterparty
 * sells. No identity matching, no rekey analysis, no findings list.
 *
 * Invoices themselves are never sent here. They live entirely in the URL
 * fragment of the link, so nothing about who is billing whom, or for how much,
 * reaches this server or its logs.
 */
import { Router } from "express";
import { z } from "zod";
import { isValidAlgorandAddress } from "@x402/avm";

import { config } from "../config.js";
import { getAccount, isFundedAccount } from "../engine/algorand.js";

const QuerySchema = z.object({
  address: z.string().refine(isValidAlgorandAddress, "not a valid Algorand address"),
  /** Whole units, e.g. "250.00". */
  amount: z.coerce.number().positive(),
  /** ISO timestamp the invoice was created; payments before it are not ours. */
  since: z.string().optional(),
});

export interface InvoiceStatus {
  /** Whether a USDC transfer to this address can succeed at all. */
  canReceive: boolean;
  reason: string | null;
  paid: boolean;
  payment: {
    txId: string;
    amountUsdc: number;
    round: number;
    at: string;
    from: string;
  } | null;
  /** True when the chain could not be reached; the answer is unknown, not "no". */
  degraded: boolean;
}

const indexerUrl = (): string =>
  config.isMainnet
    ? "https://mainnet-idx.algonode.cloud"
    : "https://testnet-idx.algonode.cloud";

/**
 * Looks for a payment of at least `amount` to `address` since the invoice was
 * raised. Matching on amount and recipient rather than a note, because a client
 * paying from an ordinary wallet has no way to attach one.
 */
async function findPayment(
  address: string,
  amount: number,
  since: string | undefined,
): Promise<{ payment: InvoiceStatus["payment"]; degraded: boolean }> {
  const params = new URLSearchParams({
    "asset-id": String(config.usdcAssetId),
    // Indexer takes base units; minus one so an exact payment is included.
    "currency-greater-than": String(Math.max(0, Math.round(amount * 1e6) - 1)),
    limit: "10",
  });
  if (since) params.set("after-time", since);

  try {
    const res = await fetch(
      `${indexerUrl()}/v2/accounts/${address}/transactions?${params.toString()}`,
      { signal: AbortSignal.timeout(8_000) },
    );
    if (!res.ok) return { payment: null, degraded: true };

    const body = (await res.json()) as {
      transactions?: Array<{
        id: string;
        sender: string;
        "confirmed-round": number;
        "round-time": number;
        "asset-transfer-transaction"?: { amount: number; receiver: string };
      }>;
    };

    for (const t of body.transactions ?? []) {
      const x = t["asset-transfer-transaction"];
      // Only incoming transfers count; the account's own sends appear here too.
      if (!x || x.receiver !== address) continue;
      if (x.amount < Math.round(amount * 1e6)) continue;

      return {
        payment: {
          txId: t.id,
          amountUsdc: x.amount / 1e6,
          round: t["confirmed-round"],
          at: new Date(t["round-time"] * 1000).toISOString(),
          from: t.sender,
        },
        degraded: false,
      };
    }

    return { payment: null, degraded: false };
  } catch {
    return { payment: null, degraded: true };
  }
}

export const invoiceRouter: Router = Router();

invoiceRouter.get("/v1/invoice/status", async (req, res) => {
  const parsed = QuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({
      error: "invalid_request",
      issues: parsed.error.issues.map((i) => ({ field: i.path.join("."), problem: i.message })),
    });
    return;
  }

  const { address, amount, since } = parsed.data;

  const [account, found] = await Promise.all([
    getAccount(address),
    findPayment(address, amount, since),
  ]);

  let canReceive = true;
  let reason: string | null = null;
  let degraded = found.degraded;

  if (!account.ok) {
    // Unknown, not "no" — the page says so rather than implying the address is bad.
    canReceive = true;
    reason = null;
    degraded = true;
  } else if (!isFundedAccount(account.data)) {
    canReceive = false;
    reason =
      "This account has never been funded, so it has not opted in to USDC. A payment to it " +
      "would be rejected by the network — it would not bounce, it simply would not arrive.";
  } else {
    const holding = account.data?.assets?.find((a) => a["asset-id"] === config.usdcAssetId);
    if (!holding) {
      canReceive = false;
      reason =
        "This account has not opted in to USDC. On Algorand a transfer to an account that has " +
        "not opted in is rejected outright, so the payment would never arrive and nobody " +
        "would be told.";
    } else if (holding["is-frozen"]) {
      canReceive = false;
      reason = "This account's USDC is frozen, so it cannot receive a payment right now.";
    }
  }

  const status: InvoiceStatus = {
    canReceive,
    reason,
    paid: found.payment !== null,
    payment: found.payment,
    degraded,
  };

  // Payment state changes; do not let a proxy cache "unpaid".
  res.setHeader("cache-control", "no-store");
  res.json(status);
});
