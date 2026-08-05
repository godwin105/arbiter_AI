import { useEffect, useState } from "react";

import { looksLikeAlgorandAddress } from "../api";
import {
  CURRENCIES,
  CURRENCY_KEY,
  type FxRate,
  type Invoice,
  fetchRate,
  formatLocal,
  invoiceLink,
  listInvoices,
  newInvoiceId,
  rememberInvoice,
} from "../invoice";

interface Props {
  onCreated: (invoice: Invoice) => void;
  onOpen: (invoice: Invoice) => void;
  onBooks: () => void;
}

const ADDRESS_KEY = "arbiter.invoice.address";
const FROM_KEY = "arbiter.invoice.from";

export function InvoiceCreate({ onCreated, onOpen, onBooks }: Props) {
  // Prefilled from last time: a freelancer bills from the same name and gets
  // paid to the same address every time, and retyping 58 characters invites a
  // typo that silently sends money nowhere.
  const [from, setFrom] = useState(localStorage.getItem(FROM_KEY) ?? "");
  const [address, setAddress] = useState(localStorage.getItem(ADDRESS_KEY) ?? "");
  const [to, setTo] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");

  const [currency, setCurrency] = useState(localStorage.getItem(CURRENCY_KEY) ?? "NGN");
  const [fx, setFx] = useState<FxRate | null>(null);

  useEffect(() => {
    localStorage.setItem(CURRENCY_KEY, currency);
    void fetchRate(currency).then(setFx);
  }, [currency]);

  const history = listInvoices();

  const addressValid = looksLikeAlgorandAddress(address);
  const amountValid = Number(amount) > 0;
  const canSubmit =
    from.trim() && to.trim() && description.trim() && amountValid && addressValid;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;

    const invoice: Invoice = {
      id: newInvoiceId(),
      from: from.trim(),
      to: to.trim(),
      description: description.trim(),
      amount: Number(amount).toFixed(2),
      address: address.trim(),
      issued: new Date().toISOString(),
      ...(note.trim() ? { note: note.trim() } : {}),
    };

    localStorage.setItem(FROM_KEY, invoice.from);
    localStorage.setItem(ADDRESS_KEY, invoice.address);
    rememberInvoice(invoice);
    onCreated(invoice);
  }

  return (
    <form className="shell" onSubmit={submit}>
      <div className="row-between">
        <div>
          <h1 className="brand">Invoice</h1>
          <p className="tagline">Get paid across borders in seconds.</p>
        </div>
        <button type="button" className="chip" onClick={onBooks}>Books</button>
      </div>

      <p className="blurb">
        Send a link. Your client pays in digital dollars, straight to you. No bank in the
        middle, no three-day wait, and fees measured in fractions of a cent instead of
        percentages.
      </p>

      <label className="label" htmlFor="from">Your name or business</label>
      <input id="from" value={from} onChange={(e) => setFrom(e.target.value)}
             placeholder="Ada Okonkwo" autoComplete="organization" />

      <label className="label" htmlFor="to">Bill to</label>
      <input id="to" value={to} onChange={(e) => setTo(e.target.value)}
             placeholder="Northwind Ltd" />

      <label className="label" htmlFor="desc">For what</label>
      <input id="desc" value={description} onChange={(e) => setDescription(e.target.value)}
             placeholder="Website redesign — March" />

      <label className="label" htmlFor="amount">Amount (USDC)</label>
      <input id="amount" value={amount} onChange={(e) => setAmount(e.target.value)}
             placeholder="250.00" inputMode="decimal"
             className={amount && !amountValid ? "invalid" : ""} />
      <p className="hint">
        1 USDC is 1 US dollar.
        {fx && Number(amount) > 0
          ? ` About ${formatLocal(Number(amount), fx.rate, currency)} at today's rate.`
          : ""}
      </p>

      <label className="label" htmlFor="cur">Show me the value in</label>
      <select id="cur" value={currency} onChange={(e) => setCurrency(e.target.value)}
              style={{ width: "100%", background: "var(--surface)", color: "var(--text)",
                       border: "1px solid var(--border)", borderRadius: "var(--radius-md)",
                       padding: "14px 16px", fontSize: 16, fontFamily: "inherit" }}>
        {CURRENCIES.map((c) => (
          <option key={c.code} value={c.code}>{c.name} ({c.code})</option>
        ))}
      </select>
      <p className="hint">
        For your reference only — your client always pays in USDC. Converting to cash happens
        wherever you choose to do it, and the rate there may differ from this one.
      </p>

      <label className="label" htmlFor="addr">Where you get paid</label>
      <textarea id="addr" className={`mono${address && !addressValid ? " invalid" : ""}`}
                value={address} onChange={(e) => setAddress(e.target.value.toUpperCase())}
                placeholder="Your 58-character Algorand address" rows={3} spellCheck={false} />
      <p className="hint">
        {address.length === 0
          ? "This is checked before your client is asked to pay, so a wrong address is caught first."
          : addressValid
            ? "Looks like a valid address."
            : `${address.trim().length}/58 characters — Algorand addresses use A–Z and 2–7 only.`}
      </p>

      <label className="label" htmlFor="note">Terms (optional)</label>
      <input id="note" value={note} onChange={(e) => setNote(e.target.value)}
             placeholder="Due in 14 days" />

      <button className="button" type="submit" disabled={!canSubmit}>
        Create invoice
      </button>

      {history.length > 0 ? (
        <>
          <h2 className="title" style={{ fontSize: 19, marginTop: 40 }}>Your invoices</h2>
          <p className="hint" style={{ marginBottom: 14 }}>
            Kept in this browser only — we never store them.
          </p>
          {history.map((inv) => (
            <button key={inv.id} type="button" className="card" onClick={() => onOpen(inv)}>
              <div className="row-between">
                <span className="payout">${inv.amount} USDC</span>
                <span className="meta">{inv.id}</span>
              </div>
              <p className="question-preview">{inv.description}</p>
              <div className="row-between">
                <span className="meta">{inv.to}</span>
                <span className="meta">{new Date(inv.issued).toLocaleDateString()}</span>
              </div>
            </button>
          ))}
        </>
      ) : null}

      <p className="note">
        Invoices live entirely in their link. Nothing is stored on our servers — not the
        amount, not your client's name.{" "}
        <a href={invoiceLink({
          id: "INV-DEMO", from: "Ada Okonkwo", to: "Northwind Ltd",
          description: "Website redesign — March", amount: "250.00",
          address: "GBRO5EM4JM57PDPS4A533V7JZNWFWB7S6IRT5UZNQYPPUN7XEEGJLEHW6I",
          issued: new Date().toISOString(),
        })}>See what your client sees →</a>
      </p>
    </form>
  );
}
