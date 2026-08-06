/**
 * Checks a live deployment against every Global x402 Challenge requirement.
 *
 * Written against the deployed URL rather than the local config on purpose: the
 * failure modes that actually cost a competition entry — an endpoint that is
 * reachable but not on HTTPS, a payTo that is not opted in to USDC, a challenge
 * tag lost in a refactor — are all invisible from inside the process.
 *
 *   npm run preflight -- https://arbiter.example.com
 */
// ARBITER_URL is accepted because every other script in this directory uses it;
// reading only PUBLIC_URL meant an `ARBITER_URL=https://... npm run preflight`
// quietly graded whatever was listening on localhost and reported it as a pass.
const explicit = process.argv[2] ?? process.env["ARBITER_URL"] ?? process.env["PUBLIC_URL"];
const target = (explicit ?? "http://localhost:4021").replace(/\/$/, "");

const CHALLENGE_TAG = "x402-global-challenge";
const USDC = { mainnet: 31566704, testnet: 10458941 } as const;
const GOPLAUSIBLE = "goplausible";

type Status = "pass" | "fail" | "warn";

interface Check {
  name: string;
  status: Status;
  detail: string;
  /** True when this must hold before the entry can score at all. */
  blocking: boolean;
}

const checks: Check[] = [];
const add = (name: string, status: Status, detail: string, blocking = true) =>
  checks.push({ name, status, detail, blocking });

async function json(url: string, init?: RequestInit): Promise<{ res: Response; body: unknown }> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { res, body };
}

function decodePaymentRequired(res: Response): Record<string, any> | null {
  const header = res.headers.get("payment-required");
  if (!header) return null;
  try {
    return JSON.parse(Buffer.from(header, "base64").toString());
  } catch {
    return null;
  }
}

console.log(`\nArbiter preflight — ${target}\n`);
if (!explicit) {
  console.log("  (no target given; defaulting to localhost. Pass a URL to check a deployment.)");
}
console.log("=".repeat(78));

// --- 1. HTTPS ---------------------------------------------------------------

const isLocal = /localhost|127\.0\.0\.1/.test(target);
if (target.startsWith("https://")) {
  add("Public HTTPS", "pass", "Endpoint is served over HTTPS.");
} else if (isLocal) {
  add(
    "Public HTTPS",
    "warn",
    "Running against localhost. Mainnet entries must be public HTTPS.",
    false,
  );
} else {
  add("Public HTTPS", "fail", "Mainnet entries must be served over HTTPS, not plain HTTP.");
}

// --- 2. Service reachable ---------------------------------------------------

let manifest: any = null;
try {
  const { res, body } = await json(`${target}/`);
  if (res.ok) {
    manifest = body;
    add("Service reachable", "pass", `Manifest served (${(body as any)?.service ?? "unknown"}).`);
  } else {
    add("Service reachable", "fail", `Root returned HTTP ${res.status}.`);
  }
} catch (err) {
  add("Service reachable", "fail", `Could not reach ${target}: ${(err as Error).message}`);
}

// --- 3. Paid routes return 402 ---------------------------------------------

const ROUTES = ["/v1/judge/transaction", "/v1/judge/counterparty", "/v1/judge/human"];
const requirements: Record<string, any> = {};

for (const route of ROUTES) {
  try {
    const res = await fetch(`${target}${route}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(20_000),
    });

    if (res.status !== 402) {
      add(`402 gating ${route}`, "fail", `Expected HTTP 402 without payment, got ${res.status}.`);
      continue;
    }

    const pr = decodePaymentRequired(res);
    if (!pr) {
      add(`402 gating ${route}`, "fail", "402 returned but no decodable PAYMENT-REQUIRED header.");
      continue;
    }

    requirements[route] = pr;
    add(`402 gating ${route}`, "pass", `HTTP 402 with payment requirements (x402 v${pr.x402Version}).`);
  } catch (err) {
    add(`402 gating ${route}`, "fail", `Request failed: ${(err as Error).message}`);
  }
}

// --- 4. Challenge tag -------------------------------------------------------

// Two places, and only one of them counts. `resource.tags` is the readable
// array in the 402 header; `accepts[].extra.tag` is the field the Bazaar
// catalog stores and the leaderboard rolls volume up by. Checking only the
// array passed this entry for two days while the indexed field was empty.
for (const [route, pr] of Object.entries(requirements)) {
  const tags: string[] = pr?.resource?.tags ?? [];
  const inArray = tags.includes(CHALLENGE_TAG);
  const accepts: any[] = pr?.accepts ?? [];
  const indexed = accepts.length > 0 && accepts.every((a) => a?.extra?.tag === CHALLENGE_TAG);

  if (indexed && inArray) {
    add(`Challenge tag ${route}`, "pass", `"${CHALLENGE_TAG}" in accepts[].extra.tag and resource.tags.`);
  } else {
    // Non-blocking on purpose. The leaderboard attributes by payTo address, not
    // by this tag — verified against /data/leaderboards, which offers no tag
    // filter at all. The tag still belongs in extra (nearly every catalogued
    // resource carries it there) but a missing one does not cost attribution,
    // and failing the entry over it would be a false alarm.
    add(
      `Challenge tag ${route}`,
      "warn",
      !indexed
        ? `accepts[].extra.tag is not "${CHALLENGE_TAG}". Catalog discovery only — ` +
          `attribution is by payTo, checked separately below.`
        : `Indexed tag is set, but resource.tags omits "${CHALLENGE_TAG}".`,
      false,
    );
  }
}

// --- 5. Bazaar discovery extension -----------------------------------------

for (const [route, pr] of Object.entries(requirements)) {
  if (pr?.extensions?.bazaar) {
    add(`Bazaar discovery ${route}`, "pass", "Discovery extension declared.");
  } else {
    add(
      `Bazaar discovery ${route}`,
      "fail",
      "No bazaar extension — the route settles payments but is not discoverable.",
    );
  }
}

// --- 6. Single consistent payTo (Composite Entry) --------------------------

const payTos = new Set<string>();
const networks = new Set<string>();
const assets = new Set<string>();

for (const pr of Object.values(requirements)) {
  const accepts = pr?.accepts?.[0];
  if (!accepts) continue;
  payTos.add(accepts.payTo);
  networks.add(accepts.network);
  assets.add(String(accepts.asset));
}

if (payTos.size === 1) {
  add("Single payTo", "pass", `All routes settle to ${[...payTos][0]}.`);
} else if (payTos.size === 0) {
  add("Single payTo", "fail", "Could not read payTo from any route.");
} else {
  add(
    "Single payTo",
    "fail",
    `Routes use ${payTos.size} different payTo addresses; Composite Entry requires one.`,
  );
}

// --- 7. GoPlausible facilitator --------------------------------------------

const facilitator: string = manifest?.facilitator ?? "";
if (facilitator.includes(GOPLAUSIBLE)) {
  add("GoPlausible facilitator", "pass", facilitator);
} else {
  add(
    "GoPlausible facilitator",
    "fail",
    `Facilitator is "${facilitator || "unknown"}". The challenge requires GoPlausible, or ` +
      `settlement is not tracked for the leaderboard.`,
  );
}

// --- 8. Network and asset consistency --------------------------------------

const network = [...networks][0] ?? "";
const isMainnet = network.includes("wGHE2Pwdvd7S12BL5FaOP20EGYesN73k");
const expectedAsset = String(isMainnet ? USDC.mainnet : USDC.testnet);

if (networks.size > 1) {
  add("Network consistency", "fail", `Routes advertise ${networks.size} different networks.`);
} else if (!network.startsWith("algorand:")) {
  add("Network consistency", "fail", `Network "${network}" is not an Algorand CAIP-2 id.`);
} else {
  add(
    "Network consistency",
    isMainnet ? "pass" : "warn",
    isMainnet
      ? "Mainnet — counts toward the leaderboard."
      : "Testnet. Valid for testing, but testnet activity does NOT count toward the leaderboard.",
    false,
  );
}

if (assets.size === 1 && [...assets][0] === expectedAsset) {
  add("USDC asset", "pass", `ASA ${expectedAsset} matches the ${isMainnet ? "mainnet" : "testnet"} network.`);
} else {
  add(
    "USDC asset",
    "fail",
    `Routes advertise asset(s) ${[...assets].join(", ")}; expected ${expectedAsset} for this network.`,
  );
}

// --- 9. payTo is opted in to USDC (the silent settlement killer) ------------

const payTo = [...payTos][0];
if (payTo) {
  const algod = isMainnet
    ? "https://mainnet-api.algonode.cloud"
    : "https://testnet-api.algonode.cloud";
  try {
    const { res, body } = await json(`${algod}/v2/accounts/${payTo}`);
    if (!res.ok) {
      add("payTo opted in to USDC", "warn", `Could not check on-chain: algod ${res.status}.`, false);
    } else {
      const account = body as any;
      const holding = (account.assets ?? []).find(
        (a: any) => String(a["asset-id"]) === expectedAsset,
      );
      if (holding) {
        add("payTo opted in to USDC", "pass", `Opted in to ASA ${expectedAsset}.`);
      } else {
        add(
          "payTo opted in to USDC",
          "fail",
          `${payTo} is NOT opted in to ASA ${expectedAsset}. Every settlement will fail — ` +
            `opt in before taking payments.`,
        );
      }
      if ((account.amount ?? 0) === 0) {
        add(
          "payTo funded",
          "fail",
          "payTo holds 0 ALGO. An account below the minimum balance cannot hold assets.",
        );
      }
    }
  } catch (err) {
    add("payTo opted in to USDC", "warn", `On-chain check failed: ${(err as Error).message}`, false);
  }
}

// --- 9b. The entry is actually on the leaderboard ---------------------------
//
// Every other check here verifies an input to attribution — the tag, the payTo,
// the network. This one reads the output. The leaderboard ranks by payTo
// address and exposes no tag filter, so appearing on it under the right network
// and asset is the only direct evidence that settled volume is being counted.
//
// Absence is not a failure: a correctly configured entry that has not yet
// settled a payment is legitimately missing, which is a different problem from
// a misconfigured one.

if (payTo && isMainnet) {
  const slug = "algorand-mainnet";
  const url =
    `https://facilitator.goplausible.xyz/data/leaderboards` +
    `?cat=merchants&network=${slug}&asset=USDC&range=all&limit=200`;
  try {
    const { res, body } = await json(url);
    if (!res.ok) {
      add("Leaderboard attribution", "warn", `Leaderboard unavailable (HTTP ${res.status}).`, false);
    } else {
      const items: any[] = (body as any)?.items ?? [];
      const entry = items.find((i) => i?.address === payTo);
      if (entry) {
        add(
          "Leaderboard attribution",
          "pass",
          `Rank ${entry.rank} of ${items.length} — $${Number(entry.volume).toFixed(4)} ` +
            `across ${entry.settles} settlement(s), listed as "${entry.label}".`,
        );
      } else {
        add(
          "Leaderboard attribution",
          "warn",
          `${payTo.slice(0, 10)}... is not on the Algorand mainnet USDC leaderboard yet. ` +
            `Expected until the first mainnet payment settles.`,
          false,
        );
      }
    }
  } catch (err) {
    add("Leaderboard attribution", "warn", `Lookup failed: ${(err as Error).message}`, false);
  }
}

// --- 10. Discovery metadata -------------------------------------------------

for (const path of ["/icon.png", "/.well-known/x402", "/health"]) {
  try {
    const res = await fetch(`${target}${path}`, { signal: AbortSignal.timeout(15_000) });
    add(
      `Metadata ${path}`,
      res.ok ? "pass" : "warn",
      res.ok ? `HTTP ${res.status}` : `HTTP ${res.status} — enriches the Bazaar merchant page.`,
      false,
    );
  } catch (err) {
    add(`Metadata ${path}`, "warn", `Unreachable: ${(err as Error).message}`, false);
  }
}

// --- Report -----------------------------------------------------------------

const ICON: Record<Status, string> = { pass: "[ OK ]", fail: "[FAIL]", warn: "[WARN]" };

console.log("");
for (const c of checks) {
  console.log(`${ICON[c.status]}  ${c.name}`);
  console.log(`        ${c.detail}`);
}

const blockingFailures = checks.filter((c) => c.status === "fail" && c.blocking);
const warnings = checks.filter((c) => c.status === "warn");

console.log(`\n${"=".repeat(78)}\n`);
console.log(
  `${checks.filter((c) => c.status === "pass").length} passed, ` +
    `${blockingFailures.length} blocking failure(s), ${warnings.length} warning(s).`,
);

if (blockingFailures.length > 0) {
  console.log("\nNot ready to enter. Fix:");
  for (const f of blockingFailures) console.log(`  - ${f.name}: ${f.detail}`);
  console.log("");
  process.exit(1);
}

// Naming the target again here: the verdict is about one deployment, and the
// header has scrolled off by the time anyone reads this line.
// Report what was observed, not what is expected to happen. The leaderboard
// check above already knows the answer, so predicting it here would restate a
// hope as a forecast when the fact is in hand.
const listed = checks.find((c) => c.name === "Leaderboard attribution");

console.log(
  `\nAll blocking requirements satisfied for ${target}.` +
    (!isMainnet
      ? " Still on testnet — promote to mainnet before the leaderboard window.\n"
      : listed?.status === "pass"
        ? ` Listed on the Algorand mainnet USDC leaderboard: ${listed.detail}\n`
        : " Endpoint is mainnet; settle a payment to appear on the leaderboard.\n"),
);
