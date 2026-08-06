/**
 * Loads .env into process.env.
 *
 * Nothing else does this: `npm run dev` runs tsx directly, and neither tsx nor
 * npm sources a .env, so on a shell that has not exported the variables by hand
 * (any PowerShell session, for one) the server used to die at boot claiming
 * PAY_TO was missing while sitting next to a .env that defines it.
 *
 * Uses Node's built-in loader, so no dependency. Real environment variables win
 * over the file, which is what lets a container or CI job override it.
 */
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

/** Package root, both from src/ under tsx and dist/ after a build. */
const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function loadEnvFile(path = resolve(PACKAGE_ROOT, ".env")): void {
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
