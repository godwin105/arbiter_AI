/**
 * KeeperHub client — the execution layer.
 *
 * KeeperHub owns transaction submission: nonce management, retries, gas, RPC
 * failover, and a hardware-backed org wallet. Arbiter owns the decision about
 * whether the transaction should be submitted at all. The two compose in one
 * direction only — nothing is executed that has not first been judged.
 */
const BASE_URL = process.env["KEEPERHUB_URL"] ?? "https://app.keeperhub.com";

export interface KeeperHubExecution {
  executionId?: string;
  status?: string;
  transactionHash?: string;
  transactionLink?: string;
  /** Present on read calls, which return immediately. */
  result?: unknown;
  /** Set on simulate: true. */
  success?: boolean;
  gasEstimate?: string;
  wouldRevert?: boolean;
  from?: string;
  to?: string;
}

export interface KeeperHubStatus {
  executionId: string;
  status: string;
  type?: string;
  transactionHash?: string;
  transactionLink?: string;
  sponsored?: boolean;
  receipts?: Array<{
    hash: string;
    chainId: number;
    verified: boolean;
    receiptStatus: string;
    blockNumber: number;
    gasUsed: string;
  }>;
}

export class KeeperHubError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
    this.name = "KeeperHubError";
  }
}

export class KeeperHubClient {
  readonly #apiKey: string | undefined;

  /**
   * A missing key is not an error until execution is actually attempted.
   * Judging an intent never touches KeeperHub, so refusing a dangerous
   * transaction has to work whether or not an execution layer is configured.
   */
  constructor(apiKey: string | undefined) {
    this.#apiKey = apiKey;
  }

  get configured(): boolean {
    return Boolean(this.#apiKey);
  }

  async #request<T>(path: string, init: RequestInit, idempotencyKey?: string): Promise<T> {
    if (!this.#apiKey) {
      throw new KeeperHubError(
        "KEEPERHUB_API_KEY is not set. Create an organization API key at " +
          "app.keeperhub.com and put it in .env — it is a secret and must not be " +
          "pasted into a chat or committed.",
        0,
        null,
      );
    }

    const headers: Record<string, string> = {
      authorization: `Bearer ${this.#apiKey}`,
      "content-type": "application/json",
    };
    // Lets a retry after a network blip reuse the original execution rather than
    // submitting a second transaction.
    if (idempotencyKey) headers["idempotency-key"] = idempotencyKey;

    const res = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers,
      signal: AbortSignal.timeout(60_000),
    });

    const text = await res.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }

    if (!res.ok) {
      const detail =
        body && typeof body === "object" && "detail" in body
          ? String((body as { detail: unknown }).detail)
          : `HTTP ${res.status}`;
      throw new KeeperHubError(`KeeperHub ${path} failed: ${detail}`, res.status, body);
    }

    // Some endpoints wrap in { data }, others return bare objects.
    if (body && typeof body === "object" && "data" in body) {
      return (body as { data: T }).data;
    }
    return body as T;
  }

  /** Supported networks, used to confirm a chain is enabled before executing. */
  chains(): Promise<
    Array<{ chainId: number; name: string; symbol: string; isTestnet: boolean; isEnabled: boolean }>
  > {
    return this.#request("/api/chains", { method: "GET" });
  }

  /** Native or ERC-20 transfer. `amount` is human-readable, e.g. "0.001". */
  transfer(
    input: {
      chainId: number;
      recipientAddress: string;
      amount: string;
      tokenAddress?: string;
      simulate?: boolean;
    },
    idempotencyKey?: string,
  ): Promise<KeeperHubExecution> {
    return this.#request("/api/execute/transfer", {
      method: "POST",
      body: JSON.stringify(input),
    }, idempotencyKey);
  }

  /** Call a contract function. Reads return immediately; writes return an execution. */
  contractCall(
    input: {
      chainId: number;
      contractAddress: string;
      functionName: string;
      functionArgs?: string;
      abi?: string;
      value?: string;
      simulate?: boolean;
    },
    idempotencyKey?: string,
  ): Promise<KeeperHubExecution> {
    return this.#request("/api/execute/contract-call", {
      method: "POST",
      body: JSON.stringify(input),
    }, idempotencyKey);
  }

  status(executionId: string): Promise<KeeperHubStatus> {
    return this.#request(`/api/execute/${executionId}/status`, { method: "GET" });
  }

  /**
   * Polls until the execution leaves a pending state.
   *
   * KeeperHub accepts a write with 202 and settles asynchronously, so the
   * transaction hash is not available on the initial response.
   */
  async waitForExecution(executionId: string, timeoutMs = 120_000): Promise<KeeperHubStatus> {
    const deadline = Date.now() + timeoutMs;
    let last: KeeperHubStatus | null = null;

    while (Date.now() < deadline) {
      last = await this.status(executionId);
      const state = (last.status ?? "").toLowerCase();
      if (state === "completed" || state === "failed" || state === "error") return last;
      if (last.transactionHash) return last;
      await new Promise((r) => setTimeout(r, 3_000));
    }

    if (last) return last;
    throw new KeeperHubError(`Execution ${executionId} did not settle in time.`, 408, null);
  }
}
