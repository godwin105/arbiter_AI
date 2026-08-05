/**
 * Invoice encoding and status.
 *
 * An invoice is never stored on a server. It is encoded into the URL fragment,
 * which browsers do not send in requests — so who is billing whom, and for how
 * much, never reaches our logs, and the link keeps working regardless of what
 * happens to the service that generated it.
 *
 * Payment status comes from the chain, which is the real ledger. Nothing here
 * has to be trusted to know whether money arrived.
 */

export interface Invoice {
  /** Short id, used for the reference line. */
  id: string;
  /** Who is billing. */
  from: string;
  /** Who is being billed. */
  to: string;
  description: string;
  /** Whole USDC, e.g. "250.00". */
  amount: string;
  /** Where the money goes. */
  address: string;
  /** ISO. Payments before this are not counted against the invoice. */
  issued: string;
  /** Optional free-text terms or a due date. */
  note?: string;
}

/** URL-safe base64 without padding, so the link survives being pasted anywhere. */
function toBase64Url(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(input: string): string {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((input.length + 3) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function encodeInvoice(invoice: Invoice): string {
  return toBase64Url(JSON.stringify(invoice));
}

export function decodeInvoice(encoded: string): Invoice | null {
  try {
    const parsed = JSON.parse(fromBase64Url(encoded)) as Invoice;
    // A malformed or truncated link should show "this link is broken" rather
    // than a half-rendered invoice for an unknown amount.
    if (!parsed.address || !parsed.amount || !parsed.from) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function invoiceLink(invoice: Invoice): string {
  return `${location.origin}/invoice/#${encodeInvoice(invoice)}`;
}

export function newInvoiceId(): string {
  return `INV-${Date.now().toString(36).toUpperCase().slice(-6)}`;
}

// --- Status ----------------------------------------------------------------

export interface InvoiceStatus {
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
  degraded: boolean;
}

export async function fetchInvoiceStatus(invoice: Invoice): Promise<InvoiceStatus> {
  const params = new URLSearchParams({
    address: invoice.address,
    amount: invoice.amount,
    since: invoice.issued,
  });

  const res = await fetch(`/v1/invoice/status?${params.toString()}`, {
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Could not check payment status (HTTP ${res.status}).`);
  return (await res.json()) as InvoiceStatus;
}

/**
 * A wallet deep link, so paying is a tap rather than copying an address.
 *
 * Pera and Defly both understand this scheme. Desktop browsers will not resolve
 * it, which is why the address is always shown alongside.
 */
export function walletLink(invoice: Invoice, assetId: string): string {
  const amount = Math.round(Number(invoice.amount) * 1e6);
  return `algorand://${invoice.address}?amount=${amount}&asset=${assetId}&note=${encodeURIComponent(invoice.id)}`;
}

// --- Local history ----------------------------------------------------------
// Kept in the browser only. Invoices are not stored server-side, so this is the
// freelancer's own record of what they have raised.

const HISTORY_KEY = "arbiter.invoices";

export function rememberInvoice(invoice: Invoice): void {
  const all = listInvoices().filter((i) => i.id !== invoice.id);
  all.unshift(invoice);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(all.slice(0, 50)));
}

export function listInvoices(): Invoice[] {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]") as Invoice[];
  } catch {
    return [];
  }
}

export function forgetInvoice(id: string): void {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(listInvoices().filter((i) => i.id !== id)));
}

// --- FX ---------------------------------------------------------------------

/**
 * Currencies offered in the picker.
 *
 * Chosen for where cross-border freelancing actually happens rather than for
 * trading volume — the point of this product is someone in Lagos or Manila
 * being paid by a client in Berlin.
 */
export const CURRENCIES = [
  { code: "NGN", name: "Nigerian naira", symbol: "₦" },
  { code: "KES", name: "Kenyan shilling", symbol: "KSh" },
  { code: "GHS", name: "Ghanaian cedi", symbol: "₵" },
  { code: "ZAR", name: "South African rand", symbol: "R" },
  { code: "INR", name: "Indian rupee", symbol: "₹" },
  { code: "PHP", name: "Philippine peso", symbol: "₱" },
  { code: "PKR", name: "Pakistani rupee", symbol: "₨" },
  { code: "BRL", name: "Brazilian real", symbol: "R$" },
  { code: "ARS", name: "Argentine peso", symbol: "$" },
  { code: "EUR", name: "Euro", symbol: "€" },
  { code: "GBP", name: "Pound sterling", symbol: "£" },
] as const;

export interface FxRate {
  base: string;
  quote: string;
  rate: number;
  asOf: string;
}

export async function fetchRate(quote: string): Promise<FxRate | null> {
  try {
    const res = await fetch(`/v1/invoice/fx?quote=${encodeURIComponent(quote)}`, {
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;
    return (await res.json()) as FxRate;
  } catch {
    return null;
  }
}

/**
 * USDC to a string that never rounds a real payment to zero.
 *
 * Two decimals is right for invoice-sized amounts, but the same rule renders a
 * genuine $0.002 receipt as "$0.00" — which reads as nothing arriving. Small
 * amounts get the precision they need instead.
 */
export function formatUsdc(amount: number): string {
  if (amount === 0) return "0.00";
  if (amount < 0.01) return amount.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
  return amount.toFixed(2);
}

export function formatLocal(amountUsd: number, rate: number, code: string): string {
  const value = amountUsd * rate;
  const symbol = CURRENCIES.find((c) => c.code === code)?.symbol ?? "";
  // Large-denomination currencies read better without decimals; tiny values
  // still need enough to show they are not zero.
  const decimals = value >= 1000 ? 0 : value < 0.01 ? 4 : 2;
  return `${symbol}${value.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

export const CURRENCY_KEY = "arbiter.invoice.currency";

// --- Ledger -----------------------------------------------------------------

export interface LedgerEntry {
  txId: string;
  from: string;
  amountUsdc: number;
  round: number;
  at: string;
  note: string | null;
}

export interface Ledger {
  address: string;
  count: number;
  totalUsdc: number;
  received: LedgerEntry[];
}

export async function fetchLedger(address: string): Promise<Ledger> {
  const res = await fetch(`/v1/invoice/ledger?address=${encodeURIComponent(address)}`, {
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) throw new Error(`Could not read the ledger (HTTP ${res.status}).`);
  return (await res.json()) as Ledger;
}

/**
 * Matches on-chain receipts against invoices raised on this device.
 *
 * A payment is attributed to the first unmatched invoice with the same amount
 * raised before it arrived. Imperfect where several invoices share an amount,
 * which is why the ledger shows unmatched receipts rather than hiding them.
 */
export function reconcile(
  entries: LedgerEntry[],
  invoices: Invoice[],
): Array<LedgerEntry & { invoice: Invoice | null }> {
  const claimed = new Set<string>();

  return entries.map((entry) => {
    const match =
      invoices.find(
        (inv) =>
          !claimed.has(inv.id) &&
          Math.abs(Number(inv.amount) - entry.amountUsdc) < 0.000001 &&
          Date.parse(inv.issued) <= Date.parse(entry.at),
      ) ?? null;
    if (match) claimed.add(match.id);
    return { ...entry, invoice: match };
  });
}

/** A spreadsheet an accountant can open, with the tx id so every line is checkable. */
export function toCsv(
  rows: Array<LedgerEntry & { invoice: Invoice | null }>,
  currency: string,
  rate: number | null,
): string {
  const header = [
    "date",
    "invoice",
    "client",
    "description",
    "amount_usdc",
    rate ? `amount_${currency.toLowerCase()}` : null,
    "from_address",
    "transaction_id",
  ].filter(Boolean);

  const lines = rows.map((r) => {
    const cells = [
      r.at.slice(0, 10),
      r.invoice?.id ?? "",
      r.invoice?.to ?? "",
      r.invoice?.description ?? "",
      r.amountUsdc.toFixed(6),
      rate ? (r.amountUsdc * rate).toFixed(2) : null,
      r.from,
      r.txId,
    ].filter((c) => c !== null);
    // Quote everything: descriptions and client names contain commas.
    return cells.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",");
  });

  return [header.join(","), ...lines].join("\n");
}
