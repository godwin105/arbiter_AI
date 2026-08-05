/**
 * Client for Arbiter's worker API.
 *
 * These routes are unpriced — reviewers are the supply side and get paid, so
 * charging them to see the queue would be backwards.
 *
 * The default base URL is empty, meaning same-origin: this app is served by the
 * Arbiter server itself, so there is no cross-origin request and no CORS to get
 * wrong. Point it elsewhere only for local development against a remote server.
 */
export const DEFAULT_BASE_URL = "";

export interface QueuedTask {
  taskId: string;
  question: string;
  attachments: string[];
  options: string[] | null;
  payoutUsdc: string;
  expiresAt: string;
  responsesReceived: number;
  quorum: number;
}

export interface Earnings {
  workerId: string;
  displayName: string;
  payoutAddress: string;
  tasksCompleted: number;
  reliability: number;
  pendingUsdc: string;
  settledUsdc: string;
  tasks: number;
}

export interface RegisteredWorker {
  workerId: string;
  token: string;
  displayName: string;
  payoutAddress: string;
}

export class ApiError extends Error {
  // Declared explicitly rather than as a constructor parameter property, which
  // `erasableSyntaxOnly` disallows — the field must survive type erasure.
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function request<T>(
  baseUrl: string,
  path: string,
  init: RequestInit = {},
  token?: string,
): Promise<T> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...(init.headers as Record<string, string> | undefined),
  };
  if (token) headers["authorization"] = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`${baseUrl.replace(/\/$/, "")}${path}`, {
      ...init,
      headers,
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    // Reviewers work on phones on unreliable connections. Say what happened
    // rather than surfacing "Failed to fetch".
    throw new ApiError(
      err instanceof Error && err.name === "TimeoutError"
        ? "The server took too long to respond."
        : "Could not reach Arbiter. Check your connection.",
      0,
    );
  }

  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }

  if (!res.ok) {
    const detail =
      body && typeof body === "object" && "error" in body
        ? String((body as { error: unknown }).error)
        : `HTTP ${res.status}`;
    throw new ApiError(detail, res.status);
  }

  return body as T;
}

export function registerWorker(
  baseUrl: string,
  displayName: string,
  payoutAddress: string,
): Promise<RegisteredWorker> {
  return request(baseUrl, "/v1/work/register", {
    method: "POST",
    body: JSON.stringify({ displayName, payoutAddress }),
  });
}

export async function fetchQueue(baseUrl: string, token: string): Promise<QueuedTask[]> {
  const body = await request<{ count: number; tasks: QueuedTask[] }>(
    baseUrl,
    "/v1/work/queue",
    { method: "GET" },
    token,
  );
  return body.tasks;
}

export function submitAnswer(
  baseUrl: string,
  token: string,
  taskId: string,
  answer: string,
  rationale: string,
  responseMs: number,
): Promise<{ accepted: boolean; status: string; payoutUsdc: string; payoutStatus: string }> {
  return request(
    baseUrl,
    `/v1/work/${taskId}/submit`,
    { method: "POST", body: JSON.stringify({ answer, rationale, responseMs }) },
    token,
  );
}

export function fetchEarnings(baseUrl: string, token: string): Promise<Earnings> {
  return request(baseUrl, "/v1/work/earnings", { method: "GET" }, token);
}

/**
 * Algorand address check, done locally so a typo is caught before it becomes a
 * payout address that silently never receives anything.
 *
 * Validates the base32 alphabet and length; the server re-validates the
 * checksum, which needs a SHA-512/256 this app has no reason to carry.
 */
export function looksLikeAlgorandAddress(value: string): boolean {
  return /^[A-Z2-7]{58}$/.test(value.trim());
}

// --- Local reviewer credential ---------------------------------------------

const STORAGE_KEY = "arbiter.worker";

export interface StoredWorker {
  workerId: string;
  token: string;
  displayName: string;
  payoutAddress: string;
  baseUrl: string;
}

export function saveWorker(worker: StoredWorker): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(worker));
}

export function loadWorker(): StoredWorker | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredWorker;
  } catch {
    // A corrupt record should send the reviewer back to sign-in, not crash.
    localStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

export function clearWorker(): void {
  localStorage.removeItem(STORAGE_KEY);
}

// --- Formatting -------------------------------------------------------------

export function shortAddress(address: string): string {
  return address.length <= 16 ? address : `${address.slice(0, 8)}…${address.slice(-6)}`;
}

/** "42m left" — reviewers care about the deadline, not the timestamp. */
export function timeUntil(iso: string): string {
  const ms = Date.parse(iso) - Date.now();
  if (Number.isNaN(ms) || ms <= 0) return "expired";
  const minutes = Math.round(ms / 60_000);
  return minutes < 60 ? `${minutes}m left` : `${Math.round(minutes / 60)}h left`;
}
