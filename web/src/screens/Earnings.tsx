import { useCallback, useEffect, useState } from "react";

import { type Earnings as EarningsData, fetchEarnings, shortAddress } from "../api";

interface Props {
  baseUrl: string;
  token: string;
  onBack: () => void;
  onSignOut: () => void;
}

export function Earnings({ baseUrl, token, onBack, onSignOut }: Props) {
  const [data, setData] = useState<EarningsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await fetchEarnings(baseUrl, token));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [baseUrl, token]);

  useEffect(() => {
    void load().finally(() => setLoading(false));
  }, [load]);

  if (loading) {
    return (
      <div className="centre">
        <div className="spinner" />
      </div>
    );
  }

  return (
    <div className="shell">
      <button className="link" onClick={onBack}>
        ← Queue
      </button>
      <h2 className="title" style={{ marginTop: 16 }}>
        Earnings
      </h2>

      {error ? <p className="error">{error}</p> : null}

      {data ? (
        <>
          <div className="hero">
            <div className="hero-label">Awaiting settlement</div>
            <div className="hero-value">${data.pendingUsdc}</div>
            <div className="hero-unit">USDC</div>
          </div>

          <div className="stats">
            <div className="stat">
              <div className="stat-value">${data.settledUsdc}</div>
              <div className="stat-label">Settled</div>
            </div>
            <div className="stat">
              <div className="stat-value">{data.tasksCompleted}</div>
              <div className="stat-label">Reviews</div>
            </div>
            <div className="stat">
              <div className="stat-value">
                {data.tasksCompleted < 3 ? "—" : `${Math.round(data.reliability * 100)}%`}
              </div>
              <div className="stat-label">Agreement</div>
            </div>
          </div>

          {data.tasksCompleted < 3 ? (
            <p className="note">
              Agreement appears after three reviews. It tracks how often your answer matched the
              final consensus — it does not affect what you are paid.
            </p>
          ) : null}

          <div className="panel">
            <div className="hero-label">Reviewer</div>
            <div style={{ fontSize: 17, marginTop: 4 }}>{data.displayName}</div>
            <div className="hero-label" style={{ marginTop: 16 }}>
              Payout address
            </div>
            <div className="mono" style={{ fontSize: 14, marginTop: 4 }}>
              {shortAddress(data.payoutAddress)}
            </div>
          </div>

          <p className="note">
            Payouts are recorded the moment a question reaches its quorum, then settled on
            Algorand. Anything shown as awaiting settlement is already owed to you.
          </p>

          <button className="button-quiet" onClick={onSignOut}>
            Sign out
          </button>
        </>
      ) : null}
    </div>
  );
}
