/**
 * EVM transaction firewall.
 *
 * Decodes calldata and reports what a transaction would actually do if signed.
 * The rules target how agents lose funds on EVM chains specifically — which is
 * almost never a direct transfer. It is an approval: a signature that hands a
 * third party the standing right to move tokens later, at a moment of their
 * choosing. The transaction that drains the wallet is one the victim never sees.
 *
 * ABI decoding is hand-rolled rather than pulled from a library. The subset that
 * matters here is small and fixed (address and uint256 arguments in 32-byte
 * words), and a firewall should not depend on a decoder it cannot read.
 */
import type { Finding, Verdict } from "../types.js";
import { decide, scoreFindings } from "../types.js";

export const ENGINE_VERSION = "evm-1.0.0";

/** uint256 max — the canonical "unlimited approval" value. */
const MAX_UINT256 = (1n << 256n) - 1n;
/**
 * Approvals at or above this are unlimited in practice. Some interfaces use
 * 2^255 or similar rather than exact max, so an exact comparison would miss them.
 */
const EFFECTIVELY_UNLIMITED = 1n << 200n;

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/** Public RPC per chain, used for contract-vs-EOA checks. */
const RPC: Record<number, string> = {
  1: "https://ethereum-rpc.publicnode.com",
  8453: "https://base-rpc.publicnode.com",
  42161: "https://arbitrum-one-rpc.publicnode.com",
  137: "https://polygon-bor-rpc.publicnode.com",
  11155111: "https://ethereum-sepolia-rpc.publicnode.com",
  84532: "https://base-sepolia-rpc.publicnode.com",
};

const CHAIN_NAMES: Record<number, string> = {
  1: "Ethereum",
  8453: "Base",
  42161: "Arbitrum One",
  137: "Polygon",
  11155111: "Sepolia",
  84532: "Base Sepolia",
};

/**
 * Function selectors that move value or grant the right to move it.
 * Anything not in this list is reported as undecoded rather than assumed safe.
 */
const SELECTORS: Record<string, { name: string; signature: string }> = {
  "0x095ea7b3": { name: "approve", signature: "approve(address,uint256)" },
  "0xa9059cbb": { name: "transfer", signature: "transfer(address,uint256)" },
  "0x23b872dd": { name: "transferFrom", signature: "transferFrom(address,address,uint256)" },
  "0xa22cb465": { name: "setApprovalForAll", signature: "setApprovalForAll(address,bool)" },
  "0x39509351": { name: "increaseAllowance", signature: "increaseAllowance(address,uint256)" },
  "0x42842e0e": { name: "safeTransferFrom", signature: "safeTransferFrom(address,address,uint256)" },
  "0xd505accf": { name: "permit", signature: "permit(address,address,uint256,uint256,uint8,bytes32,bytes32)" },
  "0x2e1a7d4d": { name: "withdraw", signature: "withdraw(uint256)" },
  "0xd0e30db0": { name: "deposit", signature: "deposit()" },
  "0x3593564c": { name: "execute", signature: "execute(bytes,bytes[],uint256)" },
};

export interface EvmTransactionInput {
  to: string;
  /** Hex calldata. Empty or "0x" means a plain value transfer. */
  data?: string | undefined;
  /** Wei, as a decimal or hex string. */
  value?: string | undefined;
  /** The account that would sign. */
  from?: string | undefined;
  chainId: number;
}

interface DecodedCall {
  selector: string;
  function: string | null;
  signature: string | null;
  args: Record<string, string>;
}

export interface EvmEvidence {
  chainId: number;
  chainName: string;
  to: string;
  valueWei: string;
  decoded: DecodedCall | null;
  /** Null when the code check could not be performed. */
  targetKind: AccountKind | null;
  spenderKind: AccountKind | null;
}

// --- ABI decoding -----------------------------------------------------------

/** Reads the nth 32-byte word of the argument section. */
function word(data: string, index: number): string {
  const start = 10 + index * 64; // 2 for "0x" + 8 for selector
  return data.slice(start, start + 64);
}

function wordToAddress(w: string): string {
  return `0x${w.slice(24)}`.toLowerCase();
}

function wordToBigInt(w: string): bigint {
  return w ? BigInt(`0x${w}`) : 0n;
}

function decodeCall(data: string): DecodedCall | null {
  if (!data || data === "0x" || data.length < 10) return null;

  const selector = data.slice(0, 10).toLowerCase();
  const known = SELECTORS[selector];
  const args: Record<string, string> = {};

  if (known) {
    switch (known.name) {
      case "approve":
      case "increaseAllowance":
        args["spender"] = wordToAddress(word(data, 0));
        args["amount"] = wordToBigInt(word(data, 1)).toString();
        break;
      case "transfer":
        args["to"] = wordToAddress(word(data, 0));
        args["amount"] = wordToBigInt(word(data, 1)).toString();
        break;
      case "transferFrom":
      case "safeTransferFrom":
        args["from"] = wordToAddress(word(data, 0));
        args["to"] = wordToAddress(word(data, 1));
        args["amount"] = wordToBigInt(word(data, 2)).toString();
        break;
      case "setApprovalForAll":
        args["operator"] = wordToAddress(word(data, 0));
        args["approved"] = wordToBigInt(word(data, 1)) === 1n ? "true" : "false";
        break;
      case "permit":
        args["owner"] = wordToAddress(word(data, 0));
        args["spender"] = wordToAddress(word(data, 1));
        args["value"] = wordToBigInt(word(data, 2)).toString();
        break;
      case "withdraw":
        args["amount"] = wordToBigInt(word(data, 0)).toString();
        break;
    }
  }

  return {
    selector,
    function: known?.name ?? null,
    signature: known?.signature ?? null,
    args,
  };
}

// --- Chain lookups ----------------------------------------------------------

/**
 * What kind of account an address is.
 *
 * `delegated` is the case that matters and the one a naive check gets wrong.
 * Since EIP-7702, an ordinary EOA can point at contract code, so `eth_getCode`
 * returns a non-empty result for an account that is still controlled by a
 * private key. Treating that as "it's a contract, therefore it's a protocol"
 * is precisely the mistake a drainer would want a firewall to make.
 *
 * The delegation indicator is `0xef0100` followed by a 20-byte address.
 */
export type AccountKind = "eoa" | "delegated" | "contract";

const EIP7702_PREFIX = "0xef0100";

/**
 * Returns null on any failure rather than throwing: the caller has already been
 * charged, and a missing code check should cost one rule, not the request.
 */
async function classifyAccount(address: string, chainId: number): Promise<AccountKind | null> {
  const rpc = RPC[chainId];
  if (!rpc) return null;

  try {
    const res = await fetch(rpc, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_getCode",
        params: [address, "latest"],
      }),
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return null;

    const body = (await res.json()) as { result?: string };
    const code = body.result;
    if (typeof code !== "string") return null;

    if (code === "0x" || code.length <= 2) return "eoa";
    if (code.toLowerCase().startsWith(EIP7702_PREFIX)) return "delegated";
    return "contract";
  } catch {
    return null;
  }
}

/** True for anything still spendable by a private key. */
function isKeyControlled(kind: AccountKind | null): boolean {
  return kind === "eoa" || kind === "delegated";
}

/** Renders a token amount as something a human can judge. */
function describeAmount(raw: bigint): string {
  if (raw >= EFFECTIVELY_UNLIMITED) return "unlimited";
  if (raw === 0n) return "0";
  return raw.toString();
}

// --- Rules ------------------------------------------------------------------

export async function judgeEvmTransaction(
  input: EvmTransactionInput,
): Promise<Verdict<EvmEvidence>> {
  const started = Date.now();
  const findings: Finding[] = [];
  let degraded = false;

  const to = input.to.toLowerCase();
  const data = (input.data ?? "0x").toLowerCase();
  const valueWei = input.value ? BigInt(input.value).toString() : "0";
  const decoded = decodeCall(data);

  const evidence: EvmEvidence = {
    chainId: input.chainId,
    chainName: CHAIN_NAMES[input.chainId] ?? `chain ${input.chainId}`,
    to,
    valueWei,
    decoded,
    targetKind: null,
    spenderKind: null,
  };

  // The address being granted power, if any — the one that matters most.
  const grantee = decoded?.args["spender"] ?? decoded?.args["operator"] ?? null;

  const [targetKind, granteeKind] = await Promise.all([
    classifyAccount(to, input.chainId),
    grantee ? classifyAccount(grantee, input.chainId) : Promise.resolve(null),
  ]);

  evidence.targetKind = targetKind;
  evidence.spenderKind = granteeKind;
  if (targetKind === null) degraded = true;

  if (!RPC[input.chainId]) {
    findings.push({
      code: "evm.unknown_chain",
      severity: "medium",
      title: "Unrecognised chain",
      detail:
        `chainId ${input.chainId} is not one this engine knows, so no on-chain checks were ` +
        `performed. Only the decoded calldata was assessed.`,
      source: "arbiter:evm",
    });
    degraded = true;
  }

  // --- Approvals: the primary EVM drain vector ------------------------------

  if (decoded?.function === "approve" || decoded?.function === "increaseAllowance") {
    const amount = BigInt(decoded.args["amount"] ?? "0");
    const spender = decoded.args["spender"] ?? "";

    if (amount >= EFFECTIVELY_UNLIMITED) {
      findings.push({
        code: "evm.unlimited_approval",
        severity: "critical",
        title: "Grants unlimited permission to spend this token",
        detail:
          `${spender} would be able to move your entire balance of the token at ${to}, ` +
          `any time, without another signature — and to keep doing so until the approval is ` +
          `revoked. The approved amount is ${amount === MAX_UINT256 ? "uint256 max" : amount.toString()}.`,
        source: "arbiter:evm",
      });
    } else if (amount > 0n) {
      findings.push({
        code: "evm.approval",
        severity: "low",
        title: "Grants permission to spend a fixed amount",
        detail: `${spender} may move up to ${amount.toString()} units of the token at ${to}.`,
        source: "arbiter:evm",
      });
    }

    if (spender && isKeyControlled(granteeKind)) {
      findings.push({
        code: "evm.approval_to_eoa",
        severity: "high",
        title: "Spending rights granted to a wallet, not a protocol",
        detail:
          granteeKind === "delegated"
            ? `${spender} looks like a contract but is an EOA with EIP-7702 delegated code — ` +
              `it is still spendable by whoever holds its private key. Presenting a wallet as ` +
              `a contract is how a drainer defeats a naive code check.`
            : `${spender} has no deployed code, so it is an ordinary account under someone's ` +
              `private key rather than a protocol. Legitimate approvals are almost always to ` +
              `contracts; this pattern is characteristic of a drainer.`,
        source: "rpc:eth_getCode",
      });
    }
  }

  if (decoded?.function === "setApprovalForAll" && decoded.args["approved"] === "true") {
    findings.push({
      code: "evm.set_approval_for_all",
      severity: "critical",
      title: "Grants control of every NFT in this collection",
      detail:
        `${decoded.args["operator"]} would be able to transfer any and all of your tokens ` +
        `from the collection at ${to}, at any time, without further approval.`,
      source: "arbiter:evm",
    });
  }

  if (decoded?.function === "permit") {
    const value = BigInt(decoded.args["value"] ?? "0");
    findings.push({
      code: "evm.permit",
      severity: value >= EFFECTIVELY_UNLIMITED ? "critical" : "medium",
      title:
        value >= EFFECTIVELY_UNLIMITED
          ? "Off-chain signature granting unlimited spending"
          : "Off-chain signature granting spending rights",
      detail:
        `permit() authorises ${decoded.args["spender"]} to spend ${describeAmount(value)} ` +
        `on behalf of ${decoded.args["owner"]}. Permits are granted by signature, so this ` +
        `leaves no approval transaction in your history to notice later.`,
      source: "arbiter:evm",
    });
  }

  // --- Transfers -------------------------------------------------------------

  const recipient = decoded?.args["to"];
  if (recipient === ZERO_ADDRESS) {
    findings.push({
      code: "evm.transfer_to_zero",
      severity: "critical",
      title: "Sends tokens to the zero address",
      detail: "Anything sent to 0x000…000 is permanently destroyed and cannot be recovered.",
      source: "arbiter:evm",
    });
  }

  if (to === ZERO_ADDRESS) {
    findings.push({
      code: "evm.call_to_zero",
      severity: "critical",
      title: "Transaction target is the zero address",
      detail: `Sending ${valueWei} wei to 0x000…000 destroys it permanently.`,
      source: "arbiter:evm",
    });
  }

  // --- Undecodable calldata ---------------------------------------------------

  if (decoded && !decoded.function) {
    findings.push({
      code: "evm.unknown_selector",
      severity: "medium",
      title: "Cannot determine what this call does",
      detail:
        `Selector ${decoded.selector} is not one this engine recognises, so the effect of ` +
        `this transaction has not been established. It is not known to be safe — it is ` +
        `unknown.`,
      source: "arbiter:evm",
    });
  }

  // Only a true EOA cannot execute calldata; a delegated account runs the code
  // it points at, so this rule must not fire for one.
  if (data !== "0x" && targetKind === "eoa") {
    findings.push({
      code: "evm.calldata_to_eoa",
      severity: "high",
      title: "Sending calldata to an address with no code",
      detail:
        `${to} is not a contract, so the calldata will not execute. Any value sent is ` +
        `transferred anyway, which usually means the target address is wrong.`,
      source: "rpc:eth_getCode",
    });
  }

  let confidence = 1;
  if (degraded) confidence -= 0.25;
  if (decoded && !decoded.function) confidence -= 0.2;
  confidence = Math.max(0.35, Number(confidence.toFixed(2)));

  const risk = scoreFindings(findings);

  return {
    id: `vrd_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`,
    decision: decide(risk, confidence),
    risk,
    confidence,
    findings: findings.sort((a, b) => scoreFindings([b]) - scoreFindings([a])),
    evidence,
    issuedAt: new Date().toISOString(),
    ttlSeconds: 60,
    meta: {
      route: "/v1/judge/transaction",
      network: evidence.chainName,
      engineVersion: ENGINE_VERSION,
      latencyMs: Date.now() - started,
      degraded,
    },
  };
}
