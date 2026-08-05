/**
 * Runs the counterparty engine against real Algorand mainnet accounts and the
 * live NFD registry. Read-only: no keys, no payments, nothing is signed.
 *
 *   npm run demo:counterparty
 */
import algosdk from "algosdk";

const throwaway = algosdk.generateAccount();
process.env["PAY_TO"] ??= throwaway.addr.toString();
// Mainnet because NFD identities and the accounts below live there.
process.env["ARBITER_NETWORK"] = "mainnet";

const { judgeCounterparty } = await import("../src/engine/counterparty.js");

const USDC = "31566704";

/** Real, funded, holds an NFD, but is NOT opted in to USDC. */
const SILVIO_DEPOSIT = "5NBAJP3FDBY4HXY3RZWRBE3VG4YJLXWOULC2QC4WM75KKCX4JZYG4ASVJ4";
/** Real, funded, opted in to USDC. */
const USDC_HOLDER = "ZMFK2OI7ZBD2U27ISERZC4S6LKM6WMFJPZQ4MYNJDZ2VNBNMBA67RA22AA";
/** Never funded. */
const UNFUNDED = algosdk.generateAccount().addr.toString();

interface Case {
  name: string;
  why: string;
  req: Parameters<typeof judgeCounterparty>[0];
  expect: "allow" | "warn" | "block" | "escalate";
}

const cases: Case[] = [
  {
    name: "Clean counterparty",
    why: "Real account, opted in to USDC. Must not be flagged.",
    req: { address: USDC_HOLDER, expectedAsset: USDC, amount: "250.00" },
    expect: "allow",
  },
  {
    name: "Invoice fraud — swapped address",
    why: "Invoice claims silvio.algo, but names an address that identity does not control.",
    req: { address: USDC_HOLDER, expectedAsset: USDC, claimedIdentity: "silvio.algo" },
    expect: "block",
  },
  {
    name: "Identity verified, but payment would fail",
    why: "silvio.algo really does control this address — yet it is not opted in to USDC.",
    req: { address: SILVIO_DEPOSIT, expectedAsset: USDC, claimedIdentity: "silvio.algo" },
    expect: "block",
  },
  {
    name: "Unregistered identity",
    why: "Counterparty asserts a name that does not exist in the registry.",
    req: { address: USDC_HOLDER, expectedAsset: USDC, claimedIdentity: "not-a-real-nfd-xyz123.algo" },
    expect: "warn",
  },
  {
    name: "Never-funded address",
    why: "Not opted in and never used — this USDC payment would be rejected outright.",
    req: { address: UNFUNDED, expectedAsset: USDC, amount: "5000.00" },
    expect: "block",
  },
];

const ICON: Record<string, string> = {
  allow: "[ALLOW]",
  warn: "[WARN ]",
  block: "[BLOCK]",
  escalate: "[ESCL ]",
};

console.log("\nArbiter counterparty verification — live NFD registry + Algorand mainnet\n");
console.log("=".repeat(78));

let failures = 0;

for (const c of cases) {
  const v = await judgeCounterparty(c.req);

  console.log(`\n${ICON[v.decision]}  ${c.name}`);
  console.log(`         ${c.why}`);
  console.log(
    `         risk=${v.risk}/100  confidence=${v.confidence}  ${v.meta.latencyMs}ms` +
      `${v.meta.degraded ? "  (degraded)" : ""}`,
  );

  if (v.evidence.identity) {
    console.log(
      `         identity: ${v.evidence.identity.claimed} -> ${v.evidence.identity.status}` +
        (v.evidence.identity.matchedField ? ` (via ${v.evidence.identity.matchedField})` : ""),
    );
  }
  console.log(
    `         on-chain: exists=${v.evidence.exists} optedIn=${v.evidence.optedIntoExpectedAsset}`,
  );

  for (const f of v.findings) {
    console.log(`           - [${f.severity.toUpperCase()}] ${f.title}`);
    console.log(`             ${f.detail.replace(/\s+/g, " ").slice(0, 145)}`);
  }
  if (v.findings.length === 0) console.log("           (no findings)");

  if (v.decision !== c.expect) {
    console.log(`         !! EXPECTED ${c.expect}, GOT ${v.decision}`);
    failures += 1;
  }
}

console.log(`\n${"=".repeat(78)}`);
console.log(failures === 0 ? "\nAll cases behaved as expected.\n" : `\n${failures} case(s) misbehaved.\n`);
process.exit(failures === 0 ? 0 : 1);
