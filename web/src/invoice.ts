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
