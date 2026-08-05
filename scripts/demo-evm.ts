/**
 * Runs the EVM firewall against the calldata patterns that actually drain
 * wallets, built by hand so the bytes are exactly what a wallet would be asked
 * to sign. Contract-vs-EOA checks hit live public RPC.
 *
 *   npm run demo:evm
 */
import algosdk from "algosdk";

const throwaway = algosdk.generateAccount();
process.env["PAY_TO"] ??= throwaway.addr.toString();
process.env["ARBITER_NETWORK"] ??= "testnet";

const { judgeEvmTransaction } = await import("../src/engine/evm.js");

const MAINNET = 1;

/** Real addresses, so the contract/EOA checks are meaningful. */
const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"; // USDC token
const UNISWAP_ROUTER = "0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD"; // Universal Router
const BAYC = "0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D"; // NFT collection
const VITALIK = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"; // EOA with EIP-7702 delegated code
const ZERO = "0x0000000000000000000000000000000000000000";

const pad = (hex: string) => hex.replace(/^0x/, "").toLowerCase().padStart(64, "0");
const MAX = "f".repeat(64);

const approve = (spender: string, amountHex: string) => `0x095ea7b3${pad(spender)}${amountHex}`;
const setApprovalForAll = (op: string, yes: boolean) =>
  `0xa22cb465${pad(op)}${pad(yes ? "0x1" : "0x0")}`;
const transfer = (to: string, amountHex: string) => `0xa9059cbb${pad(to)}${amountHex}`;

interface Case {
  name: string;
  why: string;
  to: string;
  data?: string;
  value?: string;
  expect: "allow" | "warn" | "block" | "escalate";
}

const cases: Case[] = [
  {
    name: "Unlimited approval to a wallet",
    why: "The classic drainer: infinite spending rights handed to someone's private key.",
    to: USDC,
    data: approve(VITALIK, MAX),
    expect: "block",
  },
  {
    name: "Unlimited approval to a real router",
    why: "Same infinite allowance, but to a known contract. Still dangerous, less damning.",
    to: USDC,
    data: approve(UNISWAP_ROUTER, MAX),
    expect: "block",
  },
  {
    name: "setApprovalForAll on an NFT collection",
    why: "One signature hands over every NFT you own in the collection.",
    to: BAYC,
    data: setApprovalForAll(VITALIK, true),
    expect: "block",
  },
  {
    name: "Transfer to the zero address",
    why: "Tokens sent here are destroyed permanently.",
    to: USDC,
    data: transfer(ZERO, pad("0x3b9aca00")),
    expect: "block",
  },
  {
    name: "Bounded approval to a real router",
    why: "1000 USDC allowance to a contract. Ordinary DeFi — must NOT be blocked.",
    to: USDC,
    data: approve(UNISWAP_ROUTER, pad("0x3b9aca00")),
    expect: "allow",
  },
  {
    name: "Unknown selector",
    why: "Undecodable calldata must read as unknown, never as safe.",
    to: UNISWAP_ROUTER,
    data: `0xdeadbeef${pad(VITALIK)}`,
    expect: "warn",
  },
  {
    name: "Plain ETH transfer to a wallet",
    why: "No calldata, ordinary payment. Must be clean.",
    to: VITALIK,
    value: "1000000000000000000",
    expect: "allow",
  },
];

const ICON: Record<string, string> = {
  allow: "[ALLOW]",
  warn: "[WARN ]",
  block: "[BLOCK]",
  escalate: "[ESCL ]",
};

console.log("\nArbiter EVM firewall — real calldata, live RPC\n");
console.log("=".repeat(78));

let failures = 0;

for (const c of cases) {
  const v = await judgeEvmTransaction({
    to: c.to,
    chainId: MAINNET,
    ...(c.data ? { data: c.data } : {}),
    ...(c.value ? { value: c.value } : {}),
  });

  console.log(`\n${ICON[v.decision]}  ${c.name}`);
  console.log(`         ${c.why}`);
  console.log(
    `         risk=${v.risk}/100  confidence=${v.confidence}  ${v.meta.latencyMs}ms` +
      `${v.meta.degraded ? "  (degraded)" : ""}`,
  );
  console.log(
    `         decoded: ${v.evidence.decoded?.function ?? v.evidence.decoded?.selector ?? "(no calldata)"}` +
      `  target=${v.evidence.targetKind ?? "?"}` +
      (v.evidence.spenderKind !== null
        ? `  spender=${v.evidence.spenderKind}`
        : ""),
  );

  for (const f of v.findings) {
    console.log(`           - [${f.severity.toUpperCase()}] ${f.title}`);
    console.log(`             ${f.detail.replace(/\s+/g, " ").slice(0, 140)}`);
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
