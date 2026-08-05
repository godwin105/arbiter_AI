import { useState } from "react";

import { type StoredWorker, looksLikeAlgorandAddress, registerWorker } from "../api";

interface Props {
  onRegistered: (worker: StoredWorker) => void;
}

export function SignIn({ onRegistered }: Props) {
  const [displayName, setDisplayName] = useState("");
  const [payoutAddress, setPayoutAddress] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    <form className="shell" onSubmit={submit}>
      <h1 className="brand">Arbiter</h1>
      <p className="tagline">Review work. Get paid in USDC.</p>

      <p className="blurb">
        AI agents pay for judgments they cannot make alone — whether a photo shows what it
        claims, whether a business exists, whether a document is genuine. You answer; the
        payment settles on Algorand.
      </p>

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
      <p className="hint">
        {payoutAddress.length === 0
          ? "Where your earnings are sent. It must be opted in to USDC."
          : addressValid
            ? "Looks like a valid address."
            : `${payoutAddress.trim().length}/58 characters — Algorand addresses use A–Z and 2–7 only.`}
      </p>

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

      {error ? <p className="error">{error}</p> : null}

      <button className="button" type="submit" disabled={!canSubmit}>
        {busy ? "Registering…" : "Start reviewing"}
      </button>

      <p className="note">
        Your reviewer token is stored in this browser. Registering again creates a separate
        reviewer with separate earnings.
      </p>
    </form>
  );
}
