/**
 * Arbiter configuration.
 *
 * Network selection is a single switch (ARBITER_NETWORK). Everything that differs
 * between testnet and mainnet — CAIP-2 id, USDC ASA, algod endpoint — is derived
 * from it, so promoting to mainnet never means hand-editing constants in routes.
 *
 * The Global x402 Challenge requires a *single consistent payTo address* across
 * the whole competition, and rolls up volume for endpoints that share it
 * (Composite Entry). All three judgment routes therefore read PAY_TO from here
 * and nowhere else.
 */
import { z } from "zod";
import {
  ALGORAND_MAINNET_CAIP2,
  ALGORAND_TESTNET_CAIP2,
  USDC_MAINNET_ASA_ID,
  USDC_TESTNET_ASA_ID,
  isValidAlgorandAddress,
} from "@x402/avm";

import { loadEnvFile } from "./env-file.js";

// Before anything reads process.env below.
loadEnvFile();

/**
 * Required by the challenge on every route's x402 configuration; this is what
 * attributes our endpoints to the competition leaderboard. Losing it means our
 * volume silently stops counting, so it is a constant, not a config value.
 */
export const CHALLENGE_TAG = "x402-global-challenge";

const NetworkName = z.enum(["testnet", "mainnet"]);

const EnvSchema = z.object({
  ARBITER_NETWORK: NetworkName.default("testnet"),

  /** 58-char Algorand address that receives USDC for every route. */
  PAY_TO: z
    .string()
    .refine(isValidAlgorandAddress, "PAY_TO must be a valid 58-character Algorand address"),

  /** Public HTTPS origin of this deployment. Mainnet entries may not be on localhost. */
  PUBLIC_URL: z.url().default("http://localhost:4021"),

  PORT: z.coerce.number().int().positive().default(4021),

  /**
   * GoPlausible facilitator. The challenge requires routing through it rather
   * than an alternative facilitator, otherwise settlement is not tracked.
   */
  FACILITATOR_URL: z.url().default("https://facilitator.goplausible.xyz"),

  ALGOD_URL: z.url().optional(),

  /** Optional upstream data providers used by the judgment engines. */
  NFD_API_URL: z.url().default("https://api.nf.domains"),
  VESTIGE_API_URL: z.url().default("https://api.vestigelabs.org"),

  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),

  /**
   * Where marketplace state is persisted. Must point at a mounted volume in a
   * container, or reviewer payouts are lost on every redeploy.
   * Set to "off" to disable (tests, ephemeral demos).
   */
  STATE_FILE: z.string().default("./data/marketplace.json"),

  /** Seconds to let in-flight requests finish on SIGTERM before forcing exit. */
  SHUTDOWN_GRACE_SECONDS: z.coerce.number().int().min(0).max(120).default(25),

  /** Set when running behind a load balancer so client IPs are read correctly. */
  TRUST_PROXY: z.coerce.boolean().default(false),
});

export type Env = z.infer<typeof EnvSchema>;

function loadEnv(): Env {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(
      `Invalid Arbiter environment configuration:\n${issues}\n\n` +
        `Copy .env.example to .env and fill in the required values.`,
    );
  }
  return parsed.data;
}

const env = loadEnv();

const isMainnet = env.ARBITER_NETWORK === "mainnet";

export const config = {
  env,
  network: env.ARBITER_NETWORK,
  isMainnet,

  /** CAIP-2 network id handed to the x402 payment options. */
  caip2: isMainnet ? ALGORAND_MAINNET_CAIP2 : ALGORAND_TESTNET_CAIP2,

  /**
   * USDC asset id in both forms.
   *
   * The @x402/avm constants are strings ("31566704"), which x402 wants for
   * `extra.asset` but algosdk rejects for `assetIndex` — so the numeric form is
   * converted here once rather than at every call site.
   */
  usdcAssetId: Number(isMainnet ? USDC_MAINNET_ASA_ID : USDC_TESTNET_ASA_ID),
  usdcAsset: isMainnet ? USDC_MAINNET_ASA_ID : USDC_TESTNET_ASA_ID,

  algodUrl:
    env.ALGOD_URL ??
    (isMainnet ? "https://mainnet-api.algonode.cloud" : "https://testnet-api.algonode.cloud"),

  payTo: env.PAY_TO,
  publicUrl: env.PUBLIC_URL.replace(/\/$/, ""),
  facilitatorUrl: env.FACILITATOR_URL,
  port: env.PORT,
} as const;

/**
 * Per-route pricing, in USD strings as x402 expects.
 *
 * These are deliberately low. Leaderboard rank is driven by settled volume,
 * which is (price x calls); a price low enough to sit inside an agent's noise
 * budget is called far more often than one an operator has to think about.
 */
export const PRICING = {
  transaction: "$0.002",
  counterparty: "$0.01",
  human: "$0.25",
} as const;

/**
 * Fails fast at boot on a misconfiguration that would otherwise only show up as
 * an endpoint quietly missing from the competition leaderboard.
 */
export function assertChallengeReady(): void {
  const problems: string[] = [];

  if (config.isMainnet && config.publicUrl.startsWith("http://")) {
    problems.push("mainnet entries must be served over public HTTPS, not http://");
  }
  if (config.isMainnet && /localhost|127\.0\.0\.1/.test(config.publicUrl)) {
    problems.push("PUBLIC_URL points at localhost; the endpoint must be publicly reachable");
  }

  if (problems.length > 0) {
    throw new Error(`Not ready for the x402 Global Challenge:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
  }
}
