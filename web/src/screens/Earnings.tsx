import { useCallback, useEffect, useState } from "react";

import { type Earnings as EarningsData, fetchEarnings, shortAddress } from "../api";
import { TopBar } from "../components/Chrome";

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
  const [copied, setCopied] = useState(false);

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

  async function copyAddress() {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(data.payoutAddress);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Could not copy — select the address and copy it manually.");
    }
  }

  return (
    <>
      <TopBar
        baseUrl={baseUrl}
        onBrandClick={onBack}
        right={
          <button className="chip" onClick={onBack}>
            Queue
          </button>
        }
      />

      <div className="shell">
        <button className="link" onClick={onBack}>
          ← Queue
        </button>

        <p className="eyebrow" style={{ marginTop: 14 }}>
          reviewer account
        </p>
        <h2 className="title">Earnings</h2>

        {error ? <p className="error">{error}</p> : null}

        {loading ? (
          <>
            <div className="skeleton" style={{ height: 132, marginTop: 20 }} />
            <div className="stats">
              <div className="skeleton" style={{ height: 74 }} />
              <div className="skeleton" style={{ height: 74 }} />
              <div className="skeleton" style={{ height: 74 }} />
            </div>
          </>
        ) : data ? (
          <div className="fade-in">
            <div className="hero">
              <div className="hero-label">Awaiting settlement</div>
              <div className="hero-value">${data.pendingUsdc}</div>
              <div className="hero-unit">USDC · already owed to you</div>
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
                Agreement appears after three reviews. It tracks how often your answer matched
                the final consensus — it does not affect what you are paid.
              </p>
            ) : null}

            <div className="panel">
              <div className="kv">
                <div className="hero-label">Reviewer</div>
                <div className="panel-value">{data.displayName}</div>
              </div>
              <div className="kv">
                <div className="hero-label">Payout address</div>
                <div className="panel-value mono" style={{ fontSize: 14 }}>
                  {shortAddress(data.payoutAddress)}
                </div>
                <button
                  type="button"
                  className="chip"
                  data-done={copied}
                  style={{ marginTop: 12 }}
                  onClick={() => void copyAddress()}
                >
                  {copied ? "Copied" : "Copy address"}
                </button>
              </div>
            </div>

            <p className="note">
              Payouts are recorded the moment a question reaches its quorum, then settled on
              Algorand. Anything shown as awaiting settlement is already owed to you.
            </p>

            <button className="button-quiet" onClick={onSignOut}>
              Sign out
            </button>
          </div>
        ) : null}
      </div>
    </>
  );
}
