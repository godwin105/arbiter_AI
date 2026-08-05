import { useCallback, useEffect, useState } from "react";

import {
  type Invoice,
  type InvoiceStatus,
  fetchInvoiceStatus,
  invoiceLink,
  walletLink,
} from "../invoice";

interface Props {
  invoice: Invoice;
  /** Present when the freelancer is looking at their own invoice. */
  onBack?: () => void;
  usdcAssetId: string;
  explorerBase: string;
}

export function InvoiceView({ invoice, onBack, usdcAssetId, explorerBase }: Props) {
  const [status, setStatus] = useState<InvoiceStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<"link" | "address" | null>(null);

  const load = useCallback(async () => {
    try {
      setStatus(await fetchInvoiceStatus(invoice));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [invoice]);

  useEffect(() => {
    void load();
    // Someone waiting on a payment should see it land without reloading.
    const timer = setInterval(() => void load(), 10_000);
    return () => clearInterval(timer);
  }, [load]);

  async function copy(text: string, what: "link" | "address") {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setError("Could not copy — select the text and copy it manually.");
    }
  }

  const paid = status?.paid ?? false;

  return (
    <div className="shell">
      {onBack ? (
        <button className="link" onClick={onBack}>← New invoice</button>
      ) : null}

      <div className="row-between" style={{ marginTop: onBack ? 20 : 0 }}>
        <span className="meta">{invoice.id}</span>
        <span className="meta">{new Date(invoice.issued).toLocaleDateString()}</span>
      </div>

      <h1 className="brand" style={{ fontSize: 40, marginTop: 8 }}>${invoice.amount}</h1>
      <p className="tagline">USDC</p>

      <div className="panel" style={{ marginTop: 24 }}>
        <div className="hero-label">From</div>
        <div style={{ fontSize: 17, marginTop: 4 }}>{invoice.from}</div>
        <div className="hero-label" style={{ marginTop: 16 }}>To</div>
        <div style={{ fontSize: 17, marginTop: 4 }}>{invoice.to}</div>
        <div className="hero-label" style={{ marginTop: 16 }}>For</div>
        <div style={{ fontSize: 17, marginTop: 4 }}>{invoice.description}</div>
        {invoice.note ? (
          <>
            <div className="hero-label" style={{ marginTop: 16 }}>Terms</div>
            <div style={{ fontSize: 15, marginTop: 4, color: "var(--text-muted)" }}>{invoice.note}</div>
          </>
        ) : null}
      </div>

      {/* --- Paid ---------------------------------------------------------- */}
      {paid && status?.payment ? (
        <div className="panel" style={{ borderColor: "var(--accent)", marginTop: 16 }}>
          <div className="hero-label" style={{ color: "var(--accent)" }}>Paid</div>
          <div style={{ fontSize: 21, fontWeight: 700, marginTop: 6 }}>
            ${status.payment.amountUsdc.toFixed(2)} USDC received
          </div>
          <p className="hint" style={{ marginTop: 8 }}>
            {new Date(status.payment.at).toLocaleString()} · from{" "}
            <span className="mono">{status.payment.from.slice(0, 10)}…</span>
          </p>
          <p className="hint">
            <a href={`${explorerBase}/transaction/${status.payment.txId}`}
               target="_blank" rel="noreferrer">
              View the payment on the public ledger →
            </a>
          </p>
          <p className="note">
            This is the receipt. Anyone can verify it independently — it does not rely on us
            saying so.
          </p>
        </div>
      ) : null}

      {/* --- Cannot receive ------------------------------------------------ */}
      {!paid && status && !status.canReceive ? (
        <div className="panel" style={{ borderColor: "var(--danger)", marginTop: 16 }}>
          <div className="hero-label" style={{ color: "var(--danger)" }}>Do not pay yet</div>
          <p style={{ margin: "8px 0 0", fontSize: 15 }}>{status.reason}</p>
          <p className="note">
            Checked automatically before you were asked to pay. Sending anyway would lose the
            payment silently — it would not bounce back.
          </p>
        </div>
      ) : null}

      {/* --- Ready to pay -------------------------------------------------- */}
      {!paid && status?.canReceive ? (
        <>
          <h2 className="title" style={{ fontSize: 19, marginTop: 28 }}>Pay this invoice</h2>
          <p className="hint" style={{ marginBottom: 14 }}>
            Send exactly <strong>${invoice.amount} USDC</strong> on Algorand to the address
            below. It arrives in seconds.
          </p>

          <a className="button" href={walletLink(invoice, usdcAssetId)}
             style={{ display: "block", textAlign: "center", textDecoration: "none", marginTop: 0 }}>
            Open in wallet
          </a>

          <p className="label">Or send manually</p>
          <div className="panel">
            <div className="mono" style={{ fontSize: 13, wordBreak: "break-all" }}>
              {invoice.address}
            </div>
            <button className="chip" style={{ marginTop: 12 }}
                    onClick={() => void copy(invoice.address, "address")}>
              {copied === "address" ? "Copied" : "Copy address"}
            </button>
          </div>
          <p className="hint">
            Checking for payment automatically — this page updates itself when the money
            arrives.
          </p>
        </>
      ) : null}

      {status?.degraded ? (
        <p className="hint" style={{ marginTop: 14 }}>
          The ledger is slow to respond right now, so payment status may be behind. It is not
          a sign anything is wrong.
        </p>
      ) : null}

      {!status && !error ? <p className="hint" style={{ marginTop: 20 }}>Checking…</p> : null}
      {error ? <p className="error">{error}</p> : null}

      {/* --- Share (freelancer only) --------------------------------------- */}
      {onBack ? (
        <>
          <h2 className="title" style={{ fontSize: 19, marginTop: 36 }}>Send this to your client</h2>
          <div className="panel">
            <div className="mono" style={{ fontSize: 12, wordBreak: "break-all", color: "var(--text-muted)" }}>
              {invoiceLink(invoice)}
            </div>
            <button className="chip" style={{ marginTop: 12 }}
                    onClick={() => void copy(invoiceLink(invoice), "link")}>
              {copied === "link" ? "Copied" : "Copy link"}
            </button>
          </div>
          <p className="note">
            The whole invoice is inside this link. We do not store it, so the link is the only
            copy — but it also means it keeps working no matter what happens to us.
          </p>
        </>
      ) : null}
    </div>
  );
}
