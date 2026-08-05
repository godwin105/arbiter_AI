import { useCallback, useEffect, useState } from "react";

import { looksLikeAlgorandAddress } from "../api";
import {
  CURRENCIES,
  CURRENCY_KEY,
  type FxRate,
  type Invoice,
  type LedgerEntry,
  fetchLedger,
  fetchRate,
  formatLocal,
  listInvoices,
  reconcile,
  toCsv,
} from "../invoice";

interface Props {
  onBack: () => void;
  explorerBase: string;
}

const ADDRESS_KEY = "arbiter.invoice.address";

type Row = LedgerEntry & { invoice: Invoice | null };

export function Books({ onBack, explorerBase }: Props) {
  const [address, setAddress] = useState(localStorage.getItem(ADDRESS_KEY) ?? "");
  const [currency, setCurrency] = useState(localStorage.getItem(CURRENCY_KEY) ?? "NGN");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [fx, setFx] = useState<FxRate | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const invoices = listInvoices();
  const addressValid = looksLikeAlgorandAddress(address);

  const load = useCallback(async () => {
    if (!looksLikeAlgorandAddress(address)) return;
    setLoading(true);
    setError(null);
    try {
      const ledger = await fetchLedger(address.trim());
      setRows(reconcile(ledger.received, listInvoices()));
      localStorage.setItem(ADDRESS_KEY, address.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    localStorage.setItem(CURRENCY_KEY, currency);
    void fetchRate(currency).then(setFx);
  }, [currency]);

  // --- Totals ---------------------------------------------------------------

  const received = rows ?? [];
  const total = received.reduce((sum, r) => sum + r.amountUsdc, 0);

  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const thisMonth = received
    .filter((r) => Date.parse(r.at) >= monthStart.getTime())
    .reduce((sum, r) => sum + r.amountUsdc, 0);

  const matchedIds = new Set(received.map((r) => r.invoice?.id).filter(Boolean));
  const outstanding = invoices.filter((inv) => !matchedIds.has(inv.id));
  const outstandingTotal = outstanding.reduce((sum, inv) => sum + Number(inv.amount), 0);

  function downloadCsv() {
    const csv = toCsv(received, currency, fx?.rate ?? null);
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `arbiter-income-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const local = (usd: number) =>
    fx ? formatLocal(usd, fx.rate, currency) : null;

  return (
    <div className="shell">
      <button className="link" onClick={onBack}>← Invoices</button>
      <h1 className="brand" style={{ fontSize: 30, marginTop: 16 }}>Books</h1>
      <p className="tagline" style={{ fontSize: 15 }}>Everything you have been paid.</p>

      <label className="label" htmlFor="addr">Your payout address</label>
      <textarea id="addr" className={`mono${address && !addressValid ? " invalid" : ""}`}
                value={address} onChange={(e) => setAddress(e.target.value.toUpperCase())}
                placeholder="Your 58-character Algorand address" rows={3} spellCheck={false} />
      <p className="hint">
        Read straight from the public ledger, so this works on any device — even one that has
        never seen your invoices.
      </p>

      <label className="label" htmlFor="cur">Show amounts in</label>
      <select id="cur" value={currency} onChange={(e) => setCurrency(e.target.value)}
              style={{ width: "100%", background: "var(--surface)", color: "var(--text)",
                       border: "1px solid var(--border)", borderRadius: "var(--radius-md)",
                       padding: "14px 16px", fontSize: 16, fontFamily: "inherit" }}>
        {CURRENCIES.map((c) => (
          <option key={c.code} value={c.code}>{c.name} ({c.code})</option>
        ))}
      </select>

      {loading ? <p className="hint" style={{ marginTop: 20 }}>Reading the ledger…</p> : null}
      {error ? <p className="error">{error}</p> : null}

      {rows ? (
        <>
          <div className="hero" style={{ marginTop: 24 }}>
            <div className="hero-label">Received all time</div>
            <div className="hero-value">${total.toFixed(2)}</div>
            <div className="hero-unit">
              USDC{local(total) ? ` · about ${local(total)}` : ""}
            </div>
          </div>

          <div className="stats">
            <div className="stat">
              <div className="stat-value">${thisMonth.toFixed(2)}</div>
              <div className="stat-label">This month</div>
            </div>
            <div className="stat">
              <div className="stat-value">{received.length}</div>
              <div className="stat-label">Payments</div>
            </div>
            <div className="stat">
              <div className="stat-value">${outstandingTotal.toFixed(2)}</div>
              <div className="stat-label">Outstanding</div>
            </div>
          </div>

          {fx ? (
            <p className="note">
              Rates are indicative, published {new Date(fx.asOf).toLocaleDateString()} — 1 USD ≈{" "}
              {fx.rate.toLocaleString()} {currency}. What you actually receive when converting
              to cash depends on where you convert, and in some markets differs noticeably from
              the published rate. Treat these figures as a guide, not a quote.
            </p>
          ) : null}

          {outstanding.length > 0 ? (
            <>
              <h2 className="title" style={{ fontSize: 19, marginTop: 32 }}>Outstanding</h2>
              <p className="hint" style={{ marginBottom: 12 }}>
                Raised on this device, no matching payment found yet.
              </p>
              {outstanding.map((inv) => (
                <div key={inv.id} className="card" style={{ cursor: "default" }}>
                  <div className="row-between">
                    <span className="payout">${inv.amount} USDC</span>
                    <span className="meta">{inv.id}</span>
                  </div>
                  <p className="question-preview">{inv.description}</p>
                  <div className="row-between">
                    <span className="meta">{inv.to}</span>
                    <span className="meta">{new Date(inv.issued).toLocaleDateString()}</span>
                  </div>
                </div>
              ))}
            </>
          ) : null}

          <div className="row-between" style={{ marginTop: 32, marginBottom: 12 }}>
            <h2 className="title" style={{ fontSize: 19 }}>Payments received</h2>
            {received.length > 0 ? (
              <button className="chip" onClick={downloadCsv}>Export CSV</button>
            ) : null}
          </div>

          {received.length === 0 ? (
            <p className="hint">
              No payments to this address yet. They appear here within seconds of arriving.
            </p>
          ) : (
            received.map((r) => (
              <div key={r.txId} className="card" style={{ cursor: "default" }}>
                <div className="row-between">
                  <span className="payout">
                    ${r.amountUsdc.toFixed(2)}
                    {local(r.amountUsdc) ? (
                      <span className="meta" style={{ marginLeft: 8 }}>≈ {local(r.amountUsdc)}</span>
                    ) : null}
                  </span>
                  <span className="meta">{new Date(r.at).toLocaleDateString()}</span>
                </div>
                <p className="question-preview">
                  {r.invoice ? r.invoice.description : "Payment (no matching invoice on this device)"}
                </p>
                <div className="row-between">
                  <span className="meta">{r.invoice ? r.invoice.to : `from ${r.from.slice(0, 10)}…`}</span>
                  <a className="meta" href={`${explorerBase}/transaction/${r.txId}`}
                     target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>
                    Receipt →
                  </a>
                </div>
              </div>
            ))
          )}

          <p className="note">
            Every line above is a real transaction on a public ledger. The CSV includes the
            transaction id for each one, so an accountant or a tax authority can verify the
            income independently rather than taking your word for it.
          </p>
        </>
      ) : null}
    </div>
  );
}
