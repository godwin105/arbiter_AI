/**
 * Durable state for the marketplace.
 *
 * This exists because of what the in-memory store holds: unresolved reviewer
 * questions the caller has already paid for, and a payout ledger recording USDC
 * owed to reviewers. On a container platform a redeploy is routine, and losing
 * that state means reviewers lose money they earned. Persistence is therefore a
 * correctness requirement, not an optimisation.
 *
 * Writes are atomic (temp file then rename) so a process killed mid-write leaves
 * the previous good snapshot intact rather than a truncated file.
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface Persistence {
  load<T>(): Promise<T | null>;
  save(snapshot: unknown): Promise<void>;
  /** Coalesces bursts of mutations into one write. */
  schedule(snapshot: () => unknown): void;
  flush(): Promise<void>;
}

/** No-op used when persistence is disabled, so callers need no branching. */
export class NullPersistence implements Persistence {
  async load<T>(): Promise<T | null> {
    return null;
  }
  async save(): Promise<void> {}
  schedule(): void {}
  async flush(): Promise<void> {}
}

export class FilePersistence implements Persistence {
  #timer: NodeJS.Timeout | null = null;
  #pending: (() => unknown) | null = null;
  #writing: Promise<void> = Promise.resolve();

  constructor(
    private readonly path: string,
    private readonly debounceMs = 1_000,
  ) {}

  async load<T>(): Promise<T | null> {
    try {
      return JSON.parse(await readFile(this.path, "utf8")) as T;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return null;
      // A corrupt snapshot must not stop the service from booting; starting
      // empty is recoverable, refusing to start is not.
      console.error(`[arbiter] could not read state from ${this.path}:`, err);
      return null;
    }
  }

  async save(snapshot: unknown): Promise<void> {
    // Serialised against itself so two flushes cannot interleave their renames.
    this.#writing = this.#writing.then(async () => {
      await mkdir(dirname(this.path), { recursive: true });
      const tmp = `${this.path}.${process.pid}.tmp`;
      await writeFile(tmp, JSON.stringify(snapshot), "utf8");
      await rename(tmp, this.path);
    });
    return this.#writing;
  }

  schedule(snapshot: () => unknown): void {
    this.#pending = snapshot;
    if (this.#timer) return;

    this.#timer = setTimeout(() => {
      this.#timer = null;
      const take = this.#pending;
      this.#pending = null;
      if (take) void this.save(take()).catch((err) => console.error("[arbiter] state save failed:", err));
    }, this.debounceMs);

    // A pending snapshot must never be the reason the process stays alive.
    this.#timer.unref?.();
  }

  /** Writes any pending snapshot immediately. Called on shutdown. */
  async flush(): Promise<void> {
    if (this.#timer) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
    const take = this.#pending;
    this.#pending = null;
    if (take) await this.save(take());
    await this.#writing;
  }
}
