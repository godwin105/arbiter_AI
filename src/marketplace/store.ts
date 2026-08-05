/**
 * Task, worker and payout state for the human judgment marketplace.
 *
 * Deliberately behind a narrow interface with an in-memory implementation: the
 * shapes here (durable task history, per-worker reliability that improves with
 * every resolved task) are exactly what a persistent agent-memory backend would
 * store, so swapping the implementation does not touch the engine.
 */
import { randomUUID } from "node:crypto";

import { NullPersistence, type Persistence } from "./persistence.js";

export interface WorkerResponse {
  workerId: string;
  answer: string;
  rationale: string;
  submittedAt: string;
  /** Time from claim to submission; implausibly fast answers are a quality signal. */
  responseMs: number;
}

export interface Resolution {
  answer: string;
  /** Share of reviewers who chose the winning answer, 0–1. */
  agreement: number;
  tally: Record<string, number>;
  resolvedAt: string;
}

export interface HumanTask {
  id: string;
  question: string;
  attachments: string[];
  /** Null means free-text judgment rather than a fixed choice. */
  options: string[] | null;
  quorum: number;
  status: "open" | "resolved" | "expired";
  createdAt: string;
  expiresAt: string;
  responses: WorkerResponse[];
  resolution: Resolution | null;
  /** USDC owed to each reviewer, in whole units. */
  payoutPerReviewer: string;
}

export interface Worker {
  id: string;
  token: string;
  displayName: string;
  payoutAddress: string;
  createdAt: string;
  tasksCompleted: number;
  /** Times this worker agreed with the final consensus. */
  timesInConsensus: number;
}

export interface PayoutEntry {
  id: string;
  workerId: string;
  taskId: string;
  amountUsdc: string;
  payoutAddress: string;
  status: "pending" | "settled" | "failed";
  createdAt: string;
  settledAt?: string;
  /** Algorand transaction id once settled on-chain. */
  txId?: string;
  error?: string;
}

/** Resolves when a task reaches quorum, so the paid request can long-poll. */
type Waiter = (task: HumanTask) => void;

/** Serialisable form of the store, used for snapshots. */
interface Snapshot {
  version: 1;
  tasks: HumanTask[];
  workers: Worker[];
  payouts: PayoutEntry[];
}

export class MarketplaceStore {
  private tasks = new Map<string, HumanTask>();
  private workers = new Map<string, Worker>();
  private workersByToken = new Map<string, Worker>();
  private payouts: PayoutEntry[] = [];
  private waiters = new Map<string, Set<Waiter>>();
  private persistence: Persistence = new NullPersistence();

  /**
   * Attaches durable storage and restores any previous snapshot.
   *
   * Long-poll waiters are intentionally not restored: they belong to HTTP
   * connections that died with the old process. Tasks come back `open`, so a
   * caller re-polling the free retrieval endpoint still gets their answer.
   */
  async init(persistence: Persistence): Promise<void> {
    this.persistence = persistence;
    const snapshot = await persistence.load<Snapshot>();
    if (!snapshot) return;

    for (const task of snapshot.tasks ?? []) this.tasks.set(task.id, task);
    for (const worker of snapshot.workers ?? []) {
      this.workers.set(worker.id, worker);
      this.workersByToken.set(worker.token, worker);
    }
    this.payouts = snapshot.payouts ?? [];

    console.log(
      `[arbiter] restored ${this.tasks.size} task(s), ${this.workers.size} worker(s), ` +
        `${this.payouts.filter((p) => p.status === "pending").length} unsettled payout(s)`,
    );
  }

  private snapshot(): Snapshot {
    return {
      version: 1,
      tasks: [...this.tasks.values()],
      workers: [...this.workers.values()],
      payouts: this.payouts,
    };
  }

  /** Called after any mutation that must survive a restart. */
  private dirty(): void {
    this.persistence.schedule(() => this.snapshot());
  }

  /** Writes pending state immediately. Called during graceful shutdown. */
  flush(): Promise<void> {
    return this.persistence.flush();
  }

  // --- Workers -----------------------------------------------------------

  registerWorker(displayName: string, payoutAddress: string): Worker {
    const worker: Worker = {
      id: `wkr_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
      token: `awt_${randomUUID().replace(/-/g, "")}`,
      displayName,
      payoutAddress,
      createdAt: new Date().toISOString(),
      tasksCompleted: 0,
      timesInConsensus: 0,
    };
    this.workers.set(worker.id, worker);
    this.workersByToken.set(worker.token, worker);
    this.dirty();
    return worker;
  }

  workerByToken(token: string): Worker | undefined {
    return this.workersByToken.get(token);
  }

  /**
   * Share of this worker's answers that matched the final consensus.
   *
   * New workers start at 0.7 rather than 0 or 1: unproven, but not punished for
   * having no history, since a 0 would exclude them from ever earning one.
   */
  reliability(worker: Worker): number {
    if (worker.tasksCompleted < 3) return 0.7;
    return worker.timesInConsensus / worker.tasksCompleted;
  }

  /** Reliability by id, defaulting to the unproven baseline for unknown workers. */
  reliabilityOf(workerId: string): number {
    const worker = this.workers.get(workerId);
    return worker ? this.reliability(worker) : 0.7;
  }

  // --- Tasks -------------------------------------------------------------

  createTask(input: {
    question: string;
    attachments: string[];
    options: string[] | null;
    quorum: number;
    ttlSeconds: number;
    payoutPerReviewer: string;
  }): HumanTask {
    const now = Date.now();
    const task: HumanTask = {
      id: `hmt_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
      question: input.question,
      attachments: input.attachments,
      options: input.options,
      quorum: input.quorum,
      status: "open",
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + input.ttlSeconds * 1000).toISOString(),
      responses: [],
      resolution: null,
      payoutPerReviewer: input.payoutPerReviewer,
    };
    this.tasks.set(task.id, task);
    this.dirty();
    return task;
  }

  getTask(id: string): HumanTask | undefined {
    return this.tasks.get(id);
  }

  /** Open, unexpired tasks this worker has not already answered. */
  queueFor(workerId: string, limit = 20): HumanTask[] {
    const now = Date.now();
    const out: HumanTask[] = [];

    for (const task of this.tasks.values()) {
      if (task.status !== "open") continue;
      if (Date.parse(task.expiresAt) <= now) {
        task.status = "expired";
        this.dirty();
        this.release(task);
        continue;
      }
      // One answer per worker per task, otherwise quorum is meaningless.
      if (task.responses.some((r) => r.workerId === workerId)) continue;
      out.push(task);
      if (out.length >= limit) break;
    }

    return out;
  }

  /**
   * Records a worker's answer and resolves the task once quorum is reached.
   *
   * @returns the task, or an error code the route can turn into a status.
   */
  submitResponse(
    taskId: string,
    worker: Worker,
    answer: string,
    rationale: string,
    responseMs: number,
  ): { ok: true; task: HumanTask } | { ok: false; reason: string } {
    const task = this.tasks.get(taskId);
    if (!task) return { ok: false, reason: "task_not_found" };
    if (task.status !== "open") return { ok: false, reason: `task_${task.status}` };
    if (Date.parse(task.expiresAt) <= Date.now()) {
      task.status = "expired";
      this.dirty();
      this.release(task);
      return { ok: false, reason: "task_expired" };
    }
    if (task.responses.some((r) => r.workerId === worker.id)) {
      return { ok: false, reason: "already_answered" };
    }
    if (task.options && !task.options.includes(answer)) {
      return { ok: false, reason: "answer_not_in_options" };
    }

    task.responses.push({
      workerId: worker.id,
      answer,
      rationale,
      submittedAt: new Date().toISOString(),
      responseMs,
    });

    if (task.responses.length >= task.quorum) {
      this.resolve(task);
    } else {
      this.dirty();
    }

    return { ok: true, task };
  }

  /** Majority vote. Ties resolve to the answer that arrived first. */
  private resolve(task: HumanTask): void {
    const tally: Record<string, number> = {};
    for (const r of task.responses) {
      tally[r.answer] = (tally[r.answer] ?? 0) + 1;
    }

    let winner = task.responses[0]?.answer ?? "";
    let best = 0;
    for (const r of task.responses) {
      const count = tally[r.answer] ?? 0;
      if (count > best) {
        best = count;
        winner = r.answer;
      }
    }

    task.resolution = {
      answer: winner,
      agreement: best / task.responses.length,
      tally,
      resolvedAt: new Date().toISOString(),
    };
    task.status = "resolved";

    // Reviewers are paid for participating, not for agreeing — otherwise the
    // incentive is to guess the majority rather than to report what they saw.
    for (const r of task.responses) {
      const worker = this.workers.get(r.workerId);
      if (!worker) continue;

      worker.tasksCompleted += 1;
      if (r.answer === winner) worker.timesInConsensus += 1;

      this.payouts.push({
        id: `pay_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
        workerId: worker.id,
        taskId: task.id,
        amountUsdc: task.payoutPerReviewer,
        payoutAddress: worker.payoutAddress,
        status: "pending",
        createdAt: new Date().toISOString(),
      });
    }

    this.dirty();
    this.release(task);
  }

  /** Marks an unresolved task expired and releases anyone waiting on it. */
  expire(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (!task || task.status !== "open") return;
    task.status = "expired";
    this.dirty();
    this.release(task);
  }

  // --- Long-poll support --------------------------------------------------

  /** Resolves when the task leaves `open`, or at timeout with the task as-is. */
  waitForResolution(taskId: string, timeoutMs: number): Promise<HumanTask | undefined> {
    const task = this.tasks.get(taskId);
    if (!task || task.status !== "open") return Promise.resolve(task);

    return new Promise((resolve) => {
      const waiter: Waiter = (t) => {
        clearTimeout(timer);
        resolve(t);
      };

      const timer = setTimeout(() => {
        this.waiters.get(taskId)?.delete(waiter);
        resolve(this.tasks.get(taskId));
      }, timeoutMs);

      // Do not hold the process open purely to wait on a reviewer.
      timer.unref?.();

      const set = this.waiters.get(taskId) ?? new Set<Waiter>();
      set.add(waiter);
      this.waiters.set(taskId, set);
    });
  }

  private release(task: HumanTask): void {
    const set = this.waiters.get(task.id);
    if (!set) return;
    for (const waiter of set) waiter(task);
    this.waiters.delete(task.id);
  }

  // --- Payouts -----------------------------------------------------------

  pendingPayouts(): PayoutEntry[] {
    return this.payouts.filter((p) => p.status === "pending");
  }

  allPayouts(): PayoutEntry[] {
    return [...this.payouts];
  }

  markPayout(id: string, update: Partial<Pick<PayoutEntry, "status" | "txId" | "error">>): void {
    const entry = this.payouts.find((p) => p.id === id);
    if (!entry) return;
    Object.assign(entry, update);
    if (update.status === "settled") entry.settledAt = new Date().toISOString();
    this.dirty();
  }

  earningsFor(workerId: string): { pendingUsdc: string; settledUsdc: string; tasks: number } {
    let pending = 0;
    let settled = 0;
    let tasks = 0;

    for (const p of this.payouts) {
      if (p.workerId !== workerId) continue;
      tasks += 1;
      const amount = Number(p.amountUsdc);
      if (p.status === "settled") settled += amount;
      else if (p.status === "pending") pending += amount;
    }

    return { pendingUsdc: pending.toFixed(6), settledUsdc: settled.toFixed(6), tasks };
  }
}

export const store = new MarketplaceStore();
