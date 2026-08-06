import { useCallback, useEffect, useState } from "react";

import { TopBar } from "../components/Chrome";
import {
  CURRENCY_KEY,
  type FxRate,
  type Invoice,
  type InvoiceStatus,
  fetchInvoiceStatus,
  fetchRate,
  formatLocal,
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
  const [fx, setFx] = useState<FxRate | null>(null);

  useEffect(() => {
    // The client may be anywhere; this is the payee's preferred currency, shown
    // as context rather than as anything either side transacts in.
    void fetchRate(localStorage.getItem(CURRENCY_KEY) ?? "NGN").then(setFx);
  }, []);

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
    <>
      <TopBar
        name="Invoice"
        onBrandClick={onBack}
        right={
          paid ? (
            <span className="chip" data-done="true">
              Paid
            </span>
          ) : null
        }
      />

      <div className="shell wide fade-in">
        {onBack ? (
          <button className="link" onClick={onBack}>
            ← New invoice
          </button>
        ) : null}

        <div className="split" style={{ marginTop: onBack ? 14 : 0 }}>
          <div>
            <div className="row-between">
              <span className="meta">{invoice.id}</span>
              <span className="meta">{new Date(invoice.issued).toLocaleDateString()}</span>
            </div>

            <h1 className="brand" style={{ fontSize: "clamp(40px,12vw,54px)", marginTop: 10 }}>
              ${invoice.amount}
            </h1>
            <p className="tagline">
              USDC
              {fx ? (
                <span style={{ color: "var(--text-faint)", fontSize: 14 }}>
                  {" "}
                  · about {formatLocal(Number(invoice.amount), fx.rate, fx.quote)}
                </span>
              ) : null}
            </p>

            <div className="panel" style={{ marginTop: 22 }}>
              <div className="kv">
                <div className="hero-label">From</div>
                <div className="panel-value">{invoice.from}</div>
              </div>
              <div className="kv">
                <div className="hero-label">To</div>
                <div className="panel-value">{invoice.to}</div>
              </div>
              <div className="kv">
                <div className="hero-label">For</div>
                <div className="panel-value">{invoice.description}</div>
              </div>
              {invoice.note ? (
                <div className="kv">
                  <div className="hero-label">Terms</div>
                  <div className="panel-value" style={{ fontSize: 15, color: "var(--text-muted)" }}>
                    {invoice.note}
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          <div>
            {/* --- Paid ------------------------------------------------------ */}
            {paid && status?.payment ? (
              <div className="panel good fade-in">
                <div className="hero-label" style={{ color: "var(--accent)" }}>
                  ✓ Paid
                </div>
                <div style={{ fontSize: 21, fontWeight: 700, marginTop: 6 }}>
                  ${status.payment.amountUsdc.toFixed(2)} USDC received
                </div>
                <p className="hint" style={{ marginTop: 8 }}>
                  {new Date(status.payment.at).toLocaleString()} · from{" "}
                  <span className="mono">{status.payment.from.slice(0, 10)}…</span>
                </p>
                <p className="hint">
                  <a
                    href={`${explorerBase}/transaction/${status.payment.txId}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View the payment on the public ledger →
                  </a>
                </p>
                <p className="note">
                  This is the receipt. Anyone can verify it independently — it does not rely on
                  us saying so.
                </p>
              </div>
            ) : null}

            {/* --- Cannot receive -------------------------------------------- */}
            {!paid && status && !status.canReceive ? (
              <div className="panel bad fade-in">
                <div className="hero-label" style={{ color: "var(--danger)" }}>
                  Do not pay yet
                </div>
                <p style={{ margin: "8px 0 0", fontSize: 15 }}>{status.reason}</p>
                <p className="note">
                  Checked automatically before you were asked to pay. Sending anyway would lose
                  the payment silently — it would not bounce back.
                </p>
              </div>
            ) : null}

            {/* --- Ready to pay ---------------------------------------------- */}
            {!paid && status?.canReceive ? (
              <div className="fade-in">
                <p className="eyebrow">pay this invoice</p>
                <p className="hint" style={{ margin: "0 0 14px" }}>
                  Send exactly <strong>${invoice.amount} USDC</strong> on Algorand to the address
                  below. It arrives in seconds.
                </p>

                <a
                  className="button"
                  href={walletLink(invoice, usdcAssetId)}
                  style={{ textDecoration: "none", marginTop: 0 }}
                >
                  Open in wallet
                </a>

                <p className="label">Or send manually</p>
                <div className="panel" style={{ marginTop: 0 }}>
                  <div className="mono" style={{ fontSize: 13, wordBreak: "break-all" }}>
                    {invoice.address}
                  </div>
                  <button
                    className="chip"
                    data-done={copied === "address"}
                    style={{ marginTop: 12 }}
                    onClick={() => void copy(invoice.address, "address")}
                  >
                    {copied === "address" ? "Copied" : "Copy address"}
                  </button>
                </div>
                <p className="hint" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span className="pips" aria-hidden="true">
                    <i className="on" />
                  </span>
                  Watching the ledger — this page updates itself when the money arrives.
                </p>
              </div>
            ) : null}

            {status?.degraded ? (
              <p className="hint" style={{ marginTop: 14 }}>
                The ledger is slow to respond right now, so payment status may be behind. It is
                not a sign anything is wrong.
              </p>
            ) : null}

            {!status && !error ? (
              <div className="panel" style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div className="spinner" />
                <span className="hint" style={{ margin: 0 }}>
                  Checking the ledger…
                </span>
              </div>
            ) : null}
            {error ? <p className="error">{error}</p> : null}

            {/* --- Share (freelancer only) ----------------------------------- */}
            {onBack ? (
              <>
                <p className="eyebrow" style={{ marginTop: 32 }}>
                  send this to your client
                </p>
                <div className="panel" style={{ marginTop: 0 }}>
                  <div
                    className="mono"
                    style={{ fontSize: 12, wordBreak: "break-all", color: "var(--text-muted)" }}
                  >
                    {invoiceLink(invoice)}
                  </div>
                  <button
                    className="chip"
                    data-done={copied === "link"}
                    style={{ marginTop: 12 }}
                    onClick={() => void copy(invoiceLink(invoice), "link")}
                  >
                    {copied === "link" ? "Copied" : "Copy link"}
                  </button>
                </div>
                <p className="note">
                  The whole invoice is inside this link. We do not store it, so the link is the
                  only copy — but it also means it keeps working no matter what happens to us.
                </p>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </>
  );
}
