/**
 * Loads .env for standalone scripts.
 *
 * The server is normally started through a shell that has already sourced .env,
 * but a demo run by hand has no such shell. Without this, a script silently sees
 * no API key and reports it as "not configured" rather than "not loaded" — which
 * sends you looking in the wrong place.
 *
 * Uses Node's built-in loader, so no dependency.
 */
export function loadEnv(path = ".env"): void {
  try {
    process.loadEnvFile(path);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    // A missing .env is fine — the caller may be passing everything explicitly.
    if (code !== "ENOENT") {
      console.error(`[env] could not read ${path}:`, err);
    }
  }
}

/**
 * Fails with an explanation rather than a stack trace when the server is down.
 *
 * A raw ECONNREFUSED from deep inside fetch tells you a socket failed, not that
 * you forgot to start the thing it was trying to reach.
 */
export async function requireArbiter(baseUrl: string): Promise<void> {
  try {
    const res = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(5_000) });
    if (res.ok) return;
    console.error(`\n  Arbiter at ${baseUrl} replied ${res.status} to /health.\n`);
  } catch {
    console.error(
      `\n  Arbiter is not running at ${baseUrl}.\n\n` +
        `  Start it in another terminal:\n\n` +
        `      cd ${process.cwd()}\n` +
        `      npm run dev\n\n` +
        `  then run this again. Override the target with ARBITER_URL if it is\n` +
        `  listening somewhere else.\n`,
    );
  }
  process.exit(1);
}
