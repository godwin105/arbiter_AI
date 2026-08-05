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

// --- FX ---------------------------------------------------------------------

/**
 * Indicative exchange rates.
 *
 * Cached for an hour because the upstream publishes daily, and a landing-adjacent
 * endpoint should not add a third-party call to every page view.
 *
 * These are reference rates. In several of the markets this app is aimed at the
 * rate people actually transact at differs materially from the published one, so
 * the UI labels the figure as indicative rather than presenting it as what will
 * land in someone's account.
 */
const FX_TTL_MS = 60 * 60 * 1000;
let fxCache: { at: number; rates: Record<string, number> } | null = null;

async function usdRates(): Promise<Record<string, number> | null> {
  if (fxCache && Date.now() - fxCache.at < FX_TTL_MS) return fxCache.rates;

  try {
    const res = await fetch("https://open.er-api.com/v6/latest/USD", {
      signal: AbortSignal.timeout(6_000),
    });
    if (!res.ok) return fxCache?.rates ?? null;

    const body = (await res.json()) as { rates?: Record<string, number> };
    if (!body.rates) return fxCache?.rates ?? null;

    fxCache = { at: Date.now(), rates: body.rates };
    return body.rates;
  } catch {
    // A stale rate beats no rate; the response says how old it is.
    return fxCache?.rates ?? null;
  }
}

invoiceRouter.get("/v1/invoice/fx", async (req, res) => {
  const rates = await usdRates();
  if (!rates) {
    res.status(503).json({ error: "fx_unavailable" });
    return;
  }

  const quote = String(req.query["quote"] ?? "").toUpperCase();
  res.setHeader("cache-control", "public, max-age=1800");

  if (quote) {
    const rate = rates[quote];
    if (rate === undefined) {
      res.status(404).json({ error: "unknown_currency", quote });
      return;
    }
    res.json({ base: "USD", quote, rate, asOf: new Date(fxCache?.at ?? Date.now()).toISOString() });
    return;
  }

  res.json({ base: "USD", rates, asOf: new Date(fxCache?.at ?? Date.now()).toISOString() });
});

// --- Ledger -----------------------------------------------------------------

/**
 * Every USDC payment an address has received.
 *
 * Read from the chain rather than from anything we store, so a freelancer who
 * changes device, clears their browser, or stops using this app entirely still
 * has a complete and verifiable record of what they were paid.
 */
invoiceRouter.get("/v1/invoice/ledger", async (req, res) => {
  const address = String(req.query["address"] ?? "");
  if (!isValidAlgorandAddress(address)) {
    res.status(400).json({ error: "invalid_address" });
    return;
  }

  const params = new URLSearchParams({
    "asset-id": String(config.usdcAssetId),
    "currency-greater-than": "0",
    limit: "200",
  });
  const since = req.query["since"];
  if (typeof since === "string" && since) params.set("after-time", since);

  try {
    const upstream = await fetch(
      `${indexerUrl()}/v2/accounts/${address}/transactions?${params.toString()}`,
      { signal: AbortSignal.timeout(12_000) },
    );
    if (!upstream.ok) {
      res.status(502).json({ error: "indexer_unavailable" });
      return;
    }

    const body = (await upstream.json()) as {
      transactions?: Array<{
        id: string;
        sender: string;
        "confirmed-round": number;
        "round-time": number;
        note?: string;
        "asset-transfer-transaction"?: { amount: number; receiver: string };
      }>;
    };

    const received = (body.transactions ?? [])
      .filter((t) => t["asset-transfer-transaction"]?.receiver === address)
      .filter((t) => (t["asset-transfer-transaction"]?.amount ?? 0) > 0)
      .map((t) => ({
        txId: t.id,
        from: t.sender,
        amountUsdc: (t["asset-transfer-transaction"]?.amount ?? 0) / 1e6,
        round: t["confirmed-round"],
        at: new Date(t["round-time"] * 1000).toISOString(),
        note: t.note ? Buffer.from(t.note, "base64").toString("utf8") : null,
      }));

    res.setHeader("cache-control", "no-store");
    res.json({
      address,
      count: received.length,
      totalUsdc: Number(received.reduce((sum, r) => sum + r.amountUsdc, 0).toFixed(6)),
      received,
    });
  } catch {
    res.status(502).json({ error: "indexer_unreachable" });
  }
});
