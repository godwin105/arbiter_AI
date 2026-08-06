/**
 * Shared app chrome.
 *
 * Both products in this bundle sit under the same top bar so a person who
 * arrived from the landing page does not feel handed off somewhere else.
 *
 * The network chip is read from /health rather than baked in at build time: the
 * same bundle is served by a testnet and a mainnet deployment, and a chip that
 * said "TestNet" on mainnet would be worse than no chip at all. If /health does
 * not answer, nothing is claimed.
 */
import { type ReactNode, useEffect, useState } from "react";

interface TopBarProps {
  /** Where /health lives. Empty string means the origin this page came from. */
  baseUrl?: string;
  /** Action slot on the right — a chip, usually. */
  right?: ReactNode;
  /** Product name beside the mark. */
  name?: string;
  onBrandClick?: () => void;
}

export function TopBar({ baseUrl = "", right, name = "Arbiter", onBrandClick }: TopBarProps) {
  const [network, setNetwork] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`${baseUrl}/health`)
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (live && body?.network) setNetwork(String(body.network));
      })
      .catch(() => {
        /* A chip is not worth an error state. */
      });
    return () => {
      live = false;
    };
  }, [baseUrl]);

  const label = network === "mainnet" ? "MainNet" : network === "testnet" ? "TestNet" : null;

  return (
    <div className="topbar">
      <div className="topbar-inner">
        {onBrandClick ? (
          <button type="button" className="brand-mark" onClick={onBrandClick}>
            <span className="brand-dot" aria-hidden="true" />
            <span>{name}</span>
            {label ? <span className="netchip">{label}</span> : null}
          </button>
        ) : (
          <a className="brand-mark" href="/">
            <span className="brand-dot" aria-hidden="true" />
            <span>{name}</span>
            {label ? <span className="netchip">{label}</span> : null}
          </a>
        )}
        {right}
      </div>
    </div>
  );
}

/** Momentary confirmation for an action whose result is off-screen. */
export function Toast({ message }: { message: string }) {
  return (
    <div className="toast" role="status">
      {message}
    </div>
  );
}

/** Placeholder in the shape of the list that is coming. */
export function CardSkeletons({ count = 3 }: { count?: number }) {
  return (
    <div className="card-grid" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="skeleton card-ghost" />
      ))}
    </div>
  );
}
