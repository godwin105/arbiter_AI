import { useState } from "react";

import { type StoredWorker, looksLikeAlgorandAddress, registerWorker } from "../api";
import { TopBar } from "../components/Chrome";

interface Props {
  onRegistered: (worker: StoredWorker) => void;
}

const STEPS = [
  ["01", "An agent gets stuck", "It cannot tell what a photo shows, or whether a document is real."],
  ["02", "You answer", "A question, the evidence, and what you actually saw. A minute at most."],
  ["03", "You are paid", "USDC to your Algorand address, recorded the moment quorum is reached."],
] as const;

export function SignIn({ onRegistered }: Props) {
  const [displayName, setDisplayName] = useState("");
  const [payoutAddress, setPayoutAddress] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [advanced, setAdvanced] = useState(false);

  const addressValid = looksLikeAlgorandAddress(payoutAddress);
  const canSubmit = displayName.trim().length > 0 && addressValid && !busy;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;

    setBusy(true);
    setError(null);
    try {
      const worker = await registerWorker(baseUrl, displayName.trim(), payoutAddress.trim());
      onRegistered({ ...worker, baseUrl });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <TopBar />
      <form className="shell fade-in" onSubmit={submit}>
        <p className="eyebrow">reviewer</p>
        <h1 className="brand">
          Review work.
          <br />
          Get paid in USDC.
        </h1>
        <p className="blurb">
          AI agents pay for judgments they cannot make alone — whether a photo shows what it
          claims, whether a business exists, whether a document is genuine. You answer; the
          payment settles on Algorand.
        </p>

        <div className="card-grid compact">
          {STEPS.map(([n, title, body]) => (
            <div key={n} className="card">
              <span className="meta">{n}</span>
              <h3 style={{ margin: "6px 0 4px", fontSize: 16 }}>{title}</h3>
              <p style={{ margin: 0, color: "var(--text-muted)", fontSize: 14 }}>{body}</p>
            </div>
          ))}
        </div>

        <label className="label" htmlFor="name">
          Display name
        </label>
        <input
          id="name"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="Ada"
          autoComplete="nickname"
          disabled={busy}
        />

        <label className="label" htmlFor="address">
          Payout address
        </label>
        <textarea
          id="address"
          className={`mono${payoutAddress.length > 0 && !addressValid ? " invalid" : ""}`}
          value={payoutAddress}
          onChange={(e) => setPayoutAddress(e.target.value.toUpperCase())}
          placeholder="58-character Algorand address"
          spellCheck={false}
          autoCapitalize="characters"
          rows={3}
          disabled={busy}
        />
        <p className={`hint${addressValid ? " ok" : ""}`}>
          {payoutAddress.length === 0
            ? "Where your earnings are sent. It must be opted in to USDC."
            : addressValid
              ? "Looks like a valid address."
              : `${payoutAddress.trim().length}/58 characters — Algorand addresses use A–Z and 2–7 only.`}
        </p>

        {/* Almost nobody points the app at another server, so it does not get to
            be the third thing a new reviewer has to think about. */}
        {advanced ? (
          <>
            <label className="label" htmlFor="server">
              Server
            </label>
            <input
              id="server"
              className="mono"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="(this server)"
              spellCheck={false}
              disabled={busy}
            />
            <p className="hint">Leave blank to use the server this page came from.</p>
          </>
        ) : (
          <button type="button" className="link" onClick={() => setAdvanced(true)}>
            Use a different server
          </button>
        )}

        {error ? <p className="error">{error}</p> : null}

        <button className="button" type="submit" disabled={!canSubmit}>
          {busy ? "Registering…" : "Start reviewing"}
        </button>

        <p className="note">
          Your reviewer token is stored in this browser. Registering again creates a separate
          reviewer with separate earnings.
        </p>
      </form>
    </>
  );
}
