/**
 * Arbiter SDK — a paying client for judgment.
 *
 * Wraps fetch so that a 402 is answered automatically with an x402 payment on
 * Algorand. The agent calls `judgeTransaction(...)` and payment is invisible.
 *
 * Because the caller here is an autonomous agent holding a funded wallet, spend
 * limits are part of the client rather than something the integrator is trusted
 * to add: an agent in a retry loop against a paid endpoint is a wallet-draining
 * bug, and this is a safety product.
 */
import { toClientAvmSigner } from "@x402/avm";
import { ExactAvmScheme } from "@x402/avm/exact/client";
import { x402Client } from "@x402/core/client";
import type { PaymentRequirements } from "@x402/core/types";
import { wrapFetchWithPayment } from "@x402/fetch";

import type {
  AlgorandTransactionInput,
  CounterpartyEvidence,
  EvmEvidence,
  EvmTransactionInput,
  CounterpartyInput,
  HumanEvidence,
  HumanInput,
  TransactionEvidence,
  TransactionInput,
  Verdict,
} from "./types.js";

export * from "./types.js";

/** USDC and most Algorand stablecoins use 6 decimals. */
const USDC_DECIMALS = 6;

export interface ArbiterClientOptions {
  /** Base URL of the Arbiter deployment, e.g. https://arbiter.example.com */
  baseUrl: string;
  /**
   * Base64-encoded 64-byte Algorand private key used to pay for calls.
   * Without it every request fails at the paywall.
   */
  privateKey?: string | undefined;
  /** Reject any single call priced above this, in USD. Default 1.00. */
  maxPricePerCallUsd?: number | undefined;
  /** Cumulative cap for the lifetime of this client, in USD. Default 25.00. */
  maxTotalSpendUsd?: number | undefined;
  /** Override for testing or for injecting a proxy-aware fetch. */
  fetchImpl?: typeof globalThis.fetch | undefined;
  /** Per-request timeout in milliseconds. Default 30s; raise for /judge/human. */
  timeoutMs?: number | undefined;
}

export class ArbiterError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
    this.name = "ArbiterError";
  }
}

export class ArbiterBudgetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArbiterBudgetError";
  }
}

export class ArbiterClient {
  readonly #baseUrl: string;
  readonly #fetch: typeof globalThis.fetch;
  readonly #maxPricePerCallUsd: number;
  readonly #maxTotalSpendUsd: number;
  readonly #timeoutMs: number;
  readonly #canPay: boolean;
  #spentUsd = 0;
  #callCount = 0;
  /**
   * The x402 client wraps anything thrown by the payment selector in a generic
   * "Failed to create payment payload" error, which would destroy the error type
   * before a caller could catch it. Stashing the original here lets the real
   * ArbiterBudgetError be rethrown — callers and the proxy both branch on it.
   */
  #pendingBudgetError: ArbiterBudgetError | null = null;

  constructor(options: ArbiterClientOptions) {
    this.#baseUrl = options.baseUrl.replace(/\/$/, "");
    this.#maxPricePerCallUsd = options.maxPricePerCallUsd ?? 1;
    this.#maxTotalSpendUsd = options.maxTotalSpendUsd ?? 25;
    this.#timeoutMs = options.timeoutMs ?? 30_000;
    this.#canPay = Boolean(options.privateKey);

    const baseFetch = options.fetchImpl ?? globalThis.fetch;

    if (!options.privateKey) {
      // Left unpaid deliberately: the failure should name the missing key rather
      // than surface as an opaque 402 from deep inside a request.
      this.#fetch = baseFetch;
      return;
    }

    const signer = toClientAvmSigner(options.privateKey);
    const client = x402Client.fromConfig({
      schemes: [{ network: "algorand:*", client: new ExactAvmScheme(signer) }],
      paymentRequirementsSelector: (_version, requirements) => this.#select(requirements),
    });

    this.#fetch = wrapFetchWithPayment(baseFetch, client);
  }

  /** Total USD committed to payments by this client so far. */
  get spentUsd(): number {
    return Number(this.#spentUsd.toFixed(6));
  }

  /** Number of paid calls attempted. */
  get callCount(): number {
    return this.#callCount;
  }

  get remainingBudgetUsd(): number {
    return Number(Math.max(0, this.#maxTotalSpendUsd - this.#spentUsd).toFixed(6));
  }

  /**
   * Chooses which payment option to accept, and enforces the budget.
   *
   * Spend is counted at selection rather than at settlement, so a payment that
   * is created and then fails still consumes budget. That over-counts in the
   * failure case, which is the safe direction for a cap.
   */
  #select(requirements: PaymentRequirements[]): PaymentRequirements {
    const chosen = requirements[0];
    if (!chosen) {
      throw new ArbiterError("Server offered no payment options.", 402, requirements);
    }

    const priceUsd = Number(chosen.amount) / 10 ** USDC_DECIMALS;

    // Limits are printed at 6dp because sub-cent caps are normal here; 2dp would
    // render a $0.001 limit as "$0.00" and make the message nonsense.
    if (priceUsd > this.#maxPricePerCallUsd) {
      throw this.#budgetError(
        `Call priced at $${priceUsd.toFixed(6)} exceeds the per-call limit of ` +
          `$${this.#maxPricePerCallUsd.toFixed(6)}. Raise maxPricePerCallUsd to allow it.`,
      );
    }

    if (this.#spentUsd + priceUsd > this.#maxTotalSpendUsd) {
      throw this.#budgetError(
        `Call priced at $${priceUsd.toFixed(6)} would take total spend past the ` +
          `$${this.#maxTotalSpendUsd.toFixed(6)} limit (already spent ` +
          `$${this.#spentUsd.toFixed(6)}). Raise maxTotalSpendUsd to continue.`,
      );
    }

    this.#spentUsd += priceUsd;
    return chosen;
  }

  #budgetError(message: string): ArbiterBudgetError {
    const err = new ArbiterBudgetError(message);
    this.#pendingBudgetError = err;
    return err;
  }

  async #post<T>(path: string, body: unknown, timeoutMs?: number): Promise<T> {
    this.#callCount += 1;
    this.#pendingBudgetError = null;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs ?? this.#timeoutMs);

    let res: Response;
    try {
      res = await this.#fetch(`${this.#baseUrl}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      // Rethrown ahead of everything else: the transport may have wrapped our
      // budget error in a generic one, and the type is what callers branch on.
      if (this.#pendingBudgetError) throw this.#pendingBudgetError;
      if (err instanceof ArbiterBudgetError) throw err;
      if (err instanceof Error && err.name === "AbortError") {
        throw new ArbiterError(`Request to ${path} timed out.`, 408, null);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }

    // A refused payment can surface as a plain 402 rather than a thrown error,
    // so the guard has to be re-checked on the success path too.
    if (this.#pendingBudgetError) throw this.#pendingBudgetError;

    const text = await res.text();
    const parsed: unknown = text ? safeJson(text) : null;

    if (res.status === 402) {
      throw new ArbiterError(
        this.#canPay
          ? `Payment for ${path} was attempted but not accepted. The usual cause is the payer ` +
            `account holding no USDC, or not being opted in to the USDC asset on this network.`
          : `Payment required for ${path} and no payer is configured. Pass privateKey when ` +
            `constructing ArbiterClient.`,
        402,
        parsed,
      );
    }

    if (!res.ok) {
      throw new ArbiterError(`Arbiter returned ${res.status} for ${path}.`, res.status, parsed);
    }

    return parsed as T;
  }

  // --- Judgments ---------------------------------------------------------

  /** Decide whether an unsigned transaction is safe to sign. */
  judgeTransaction(input: AlgorandTransactionInput): Promise<Verdict<TransactionEvidence>>;
  judgeTransaction(input: EvmTransactionInput): Promise<Verdict<EvmEvidence>>;
  judgeTransaction(input: TransactionInput): Promise<Verdict<TransactionEvidence | EvmEvidence>> {
    // `chain` defaults to algorand only when absent, so the EVM discriminator
    // set by the caller is never overwritten.
    return this.#post("/v1/judge/transaction", { chain: "algorand", ...input });
  }

  /** Decide whether a payment counterparty is who they claim to be. */
  judgeCounterparty(input: CounterpartyInput): Promise<Verdict<CounterpartyEvidence>> {
    return this.#post("/v1/judge/counterparty", input);
  }

  /**
   * Ask human reviewers a question.
   *
   * Long-polls server-side, so the request timeout is raised to sit past
   * `waitSeconds` rather than aborting a question that is still being answered.
   */
  judgeHuman(input: HumanInput): Promise<Verdict<HumanEvidence>> {
    const waitSeconds = input.waitSeconds ?? 60;
    return this.#post("/v1/judge/human", input, (waitSeconds + 15) * 1000);
  }

  /**
   * Collect a human verdict that was already paid for.
   *
   * Free, and deliberately not counted against the budget: this retrieves a
   * result the caller has already bought.
   */
  async retrieveHumanVerdict(taskId: string): Promise<Verdict<HumanEvidence>> {
    const res = await (globalThis.fetch)(`${this.#baseUrl}/v1/judge/human/${taskId}`, {
      headers: { accept: "application/json" },
    });
    const text = await res.text();
    const parsed: unknown = text ? safeJson(text) : null;

    if (!res.ok) {
      throw new ArbiterError(`Could not retrieve verdict ${taskId}.`, res.status, parsed);
    }
    return parsed as Verdict<HumanEvidence>;
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
export * from "./format.js";
