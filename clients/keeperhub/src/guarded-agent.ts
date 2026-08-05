/**
 * An agent that cannot execute what it has not checked.
 *
 * KeeperHub makes execution reliable — retries, nonces, gas, RPC failover. It
 * does not make execution *correct*: a transaction that drains the wallet is
 * submitted just as dependably as one that does not. This wraps it so the
 * judgment happens first and refusal is the default.
 *
 * The guard is structural rather than advisory. There is no path through this
 * class that reaches KeeperHub without a verdict, so an agent cannot skip the
 * check by forgetting to call it.
 */
import { ArbiterClient, type EvmEvidence, type Verdict } from "@arbiter/sdk";
import { KeeperHubClient, type KeeperHubStatus } from "./client.js";

/** Selectors are taken from the decoder's table, so encode and decode agree. */
const SELECTOR = {
  approve: "0x095ea7b3",
  transfer: "0xa9059cbb",
} as const;

const pad32 = (hex: string): string => hex.replace(/^0x/, "").toLowerCase().padStart(64, "0");
const encodeAddress = (address: string): string => pad32(address);
const encodeUint = (value: bigint): string => pad32(value.toString(16));

/** Human-readable ether to wei, without pulling in a formatting library. */
export function etherToWei(amount: string): bigint {
  const [whole = "0", frac = ""] = amount.split(".");
  return BigInt(whole) * 10n ** 18n + BigInt((frac + "0".repeat(18)).slice(0, 18));
}

export type Intent =
  | {
      kind: "native-transfer";
      chainId: number;
      /** Recipient address. */
      to: string;
      /** Human-readable, e.g. "0.001". */
      amountEth: string;
      description: string;
    }
  | {
      kind: "erc20-approve";
      chainId: number;
      /** The token contract. */
      token: string;
      spender: string;
      /** Base units. Pass 2^256-1 for an unlimited approval. */
      amount: bigint;
      description: string;
    };

export interface GuardedResult {
  intent: Intent;
  verdict: Verdict<EvmEvidence>;
  /** True only when the verdict permitted execution AND KeeperHub accepted it. */
  executed: boolean;
  /** Why execution did not happen, when it did not. */
  refusedBecause?: string;
  execution?: KeeperHubStatus;
}

export interface GuardedAgentOptions {
  arbiterUrl: string;
  /** Base64 Algorand key used to pay Arbiter over x402. */
  arbiterPrivateKey?: string | undefined;
  keeperHubApiKey: string | undefined;
  /**
   * Decisions permitted to execute. `warn` is excluded by default: an
   * autonomous agent has no operator standing by to accept a risk, so anything
   * short of a clean verdict should stop and ask.
   */
  allowDecisions?: Array<Verdict["decision"]>;
}

/** Turns an intent into the exact calldata a wallet would be asked to sign. */
function toTransactionRequest(intent: Intent): { to: string; data: string; value: string } {
  switch (intent.kind) {
    case "native-transfer":
      return { to: intent.to, data: "0x", value: etherToWei(intent.amountEth).toString() };
    case "erc20-approve":
      return {
        to: intent.token,
        data: `${SELECTOR.approve}${encodeAddress(intent.spender)}${encodeUint(intent.amount)}`,
        value: "0",
      };
  }
}

export class GuardedAgent {
  readonly #keeper: KeeperHubClient;
  readonly #arbiterUrl: string;
  readonly #arbiterKey: string | undefined;
  readonly #allowed: Set<Verdict["decision"]>;

  constructor(options: GuardedAgentOptions) {
    this.#keeper = new KeeperHubClient(options.keeperHubApiKey);
    this.#arbiterUrl = options.arbiterUrl.replace(/\/$/, "");
    this.#arbiterKey = options.arbiterPrivateKey;
    this.#allowed = new Set(options.allowDecisions ?? ["allow"]);
  }

  get keeperHub(): KeeperHubClient {
    return this.#keeper;
  }

  /** Asks Arbiter what this intent would actually do. */
  async judge(intent: Intent): Promise<Verdict<EvmEvidence>> {
    const tx = toTransactionRequest(intent);

    const client = new ArbiterClient({
      baseUrl: this.#arbiterUrl,
      privateKey: this.#arbiterKey,
      maxPricePerCallUsd: 0.05,
      maxTotalSpendUsd: 1,
    });

    return (await client.judgeTransaction({
      chain: "evm",
      chainId: intent.chainId,
      transaction: tx,
    })) as unknown as Verdict<EvmEvidence>;
  }

  /**
   * Judges an intent and executes it through KeeperHub only if permitted.
   *
   * Returns rather than throws on refusal: a blocked transaction is a correct
   * outcome, not an error, and the caller needs the verdict either way.
   */
  async execute(intent: Intent): Promise<GuardedResult> {
    const verdict = await this.judge(intent);

    if (!this.#allowed.has(verdict.decision)) {
      const worst = verdict.findings[0];
      return {
        intent,
        verdict,
        executed: false,
        refusedBecause:
          `Arbiter returned ${verdict.decision.toUpperCase()} (risk ${verdict.risk}/100)` +
          (worst ? `: ${worst.title}` : "") +
          ". Nothing was submitted to KeeperHub.",
      };
    }

    const accepted =
      intent.kind === "native-transfer"
        ? await this.#keeper.transfer({
            chainId: intent.chainId,
            recipientAddress: intent.to,
            amount: intent.amountEth,
          })
        : await this.#keeper.contractCall({
            chainId: intent.chainId,
            contractAddress: intent.token,
            functionName: "approve",
            functionArgs: JSON.stringify([intent.spender, intent.amount.toString()]),
          });

    const execution = accepted.executionId
      ? await this.#keeper.waitForExecution(accepted.executionId)
      : ({
          executionId: "(none)",
          status: accepted.status ?? "unknown",
          ...(accepted.transactionHash ? { transactionHash: accepted.transactionHash } : {}),
          ...(accepted.transactionLink ? { transactionLink: accepted.transactionLink } : {}),
        } satisfies KeeperHubStatus);

    return { intent, verdict, executed: true, execution };
  }
}
