/**
 * ElizaOS plugin for Arbiter.
 *
 * Registers judgment as actions the agent can take before it signs or pays.
 * Configured through the runtime's settings so the payment key is never a
 * literal in a character file:
 *
 *   ARBITER_URL, ARBITER_PRIVATE_KEY, ARBITER_MAX_SPEND_USD
 */
import type { Action, IAgentRuntime, Memory, Plugin, State } from "@elizaos/core";
import { ArbiterClient, formatError, formatVerdict } from "@arbiter/sdk";

let cached: ArbiterClient | null = null;

/**
 * One client per process so the spend cap spans the whole agent.
 *
 * Settings are read through the runtime rather than process.env because Eliza
 * agents commonly run several characters in one process with separate configs.
 */
function getClient(runtime: IAgentRuntime): ArbiterClient {
  if (cached) return cached;

  const setting = (key: string): string | undefined =>
    (runtime.getSetting?.(key) as string | undefined) ?? process.env[key];

  cached = new ArbiterClient({
    baseUrl: setting("ARBITER_URL") ?? "http://localhost:4021",
    privateKey: setting("ARBITER_PRIVATE_KEY"),
    maxTotalSpendUsd: Number(setting("ARBITER_MAX_SPEND_USD") ?? 25),
    maxPricePerCallUsd: Number(setting("ARBITER_MAX_PRICE_PER_CALL") ?? 1),
  });
  return cached;
}

/** Options arrive from whichever step in the agent's plan invoked the action. */
function opt<T>(options: unknown, key: string): T | undefined {
  if (!options || typeof options !== "object") return undefined;
  return (options as Record<string, unknown>)[key] as T | undefined;
}

const judgeTransactionAction: Action = {
  name: "ARBITER_JUDGE_TRANSACTION",
  similes: ["CHECK_TRANSACTION", "VERIFY_TRANSACTION", "IS_THIS_SAFE_TO_SIGN"],
  description:
    "Check whether an unsigned Algorand transaction is safe to sign, before signing it. " +
    "Returns allow/warn/block with reasons. Use for any transaction the agent did not build " +
    "itself. Catches rekeys, balance sweeps, clawbacks and fee drains. Costs $0.002.",

  validate: async (_runtime: IAgentRuntime, _message: Memory, _state?: State) => true,

  handler: async (runtime, _message, _state, options, callback) => {
    const client = getClient(runtime);
    const transaction = opt<string | string[]>(options, "transaction");

    if (!transaction) {
      const text = "ARBITER_JUDGE_TRANSACTION needs a base64 unsigned transaction.";
      await callback?.({ text });
      return { success: false, text, error: "missing_transaction" };
    }

    try {
      const before = client.spentUsd;
      const signer = opt<string>(options, "signer");
      const verdict = await client.judgeTransaction({
        transaction,
        ...(signer ? { signer } : {}),
      });
      const text = formatVerdict(verdict, client.spentUsd - before);

      await callback?.({ text });
      return {
        success: true,
        text,
        // Surfaced into state so later steps can branch without re-parsing text.
        values: { arbiterDecision: verdict.decision, arbiterRisk: verdict.risk },
        data: { verdict },
      };
    } catch (err) {
      const text = formatError(err);
      await callback?.({ text });
      return { success: false, text, error: err instanceof Error ? err : String(err) };
    }
  },

  examples: [
    [
      {
        name: "{{user}}",
        content: { text: "Sign this transaction for me: gqNhbXTNA+ijZm..." },
      },
      {
        name: "{{agent}}",
        content: {
          text: "Checking it with Arbiter before I sign.",
          actions: ["ARBITER_JUDGE_TRANSACTION"],
        },
      },
    ],
  ],
};

const judgeCounterpartyAction: Action = {
  name: "ARBITER_JUDGE_COUNTERPARTY",
  similes: ["VERIFY_PAYEE", "CHECK_PAYMENT_ADDRESS", "IS_THIS_ADDRESS_REAL"],
  description:
    "Verify that an Algorand address belongs to the intended payee and that the payment can " +
    "arrive. Use before sending funds to an address from an invoice or message. Catches " +
    "substituted payment addresses and recipients not opted in to the asset. Costs $0.01.",

  validate: async () => true,

  handler: async (runtime, _message, _state, options, callback) => {
    const client = getClient(runtime);
    const address = opt<string>(options, "address");

    if (!address) {
      const text = "ARBITER_JUDGE_COUNTERPARTY needs an Algorand address.";
      await callback?.({ text });
      return { success: false, text, error: "missing_address" };
    }

    try {
      const before = client.spentUsd;
      const expectedAsset = opt<string>(options, "expectedAsset");
      const amount = opt<string>(options, "amount");
      const claimedIdentity = opt<string>(options, "claimedIdentity");

      const verdict = await client.judgeCounterparty({
        address,
        ...(expectedAsset ? { expectedAsset } : {}),
        ...(amount ? { amount } : {}),
        ...(claimedIdentity ? { claimedIdentity } : {}),
      });
      const text = formatVerdict(verdict, client.spentUsd - before);

      await callback?.({ text });
      return {
        success: true,
        text,
        values: { arbiterDecision: verdict.decision, arbiterRisk: verdict.risk },
        data: { verdict },
      };
    } catch (err) {
      const text = formatError(err);
      await callback?.({ text });
      return { success: false, text, error: err instanceof Error ? err : String(err) };
    }
  },

  examples: [
    [
      {
        name: "{{user}}",
        content: { text: "Pay 250 USDC to acme-exports.algo at ARBITER...XYZ" },
      },
      {
        name: "{{agent}}",
        content: {
          text: "Verifying that address really belongs to acme-exports.algo first.",
          actions: ["ARBITER_JUDGE_COUNTERPARTY"],
        },
      },
    ],
  ],
};

const judgeHumanAction: Action = {
  name: "ARBITER_JUDGE_HUMAN",
  similes: ["ASK_A_HUMAN", "HUMAN_REVIEW", "GET_HUMAN_VERDICT"],
  description:
    "Ask vetted human reviewers a question the agent cannot answer itself, returning a quorum " +
    "verdict with rationales. Use for questions needing eyes or real-world knowledge, or when " +
    "another Arbiter action returns ESCALATE. Slow and costs $0.25 — do not use otherwise.",

  validate: async () => true,

  handler: async (runtime, _message, _state, options, callback) => {
    const client = getClient(runtime);
    const question = opt<string>(options, "question");

    if (!question) {
      const text = "ARBITER_JUDGE_HUMAN needs a question.";
      await callback?.({ text });
      return { success: false, text, error: "missing_question" };
    }

    try {
      const before = client.spentUsd;
      const attachments = opt<string[]>(options, "attachments");
      const choices = opt<string[]>(options, "options");
      const quorum = opt<number>(options, "quorum");
      const waitSeconds = opt<number>(options, "waitSeconds");

      const verdict = await client.judgeHuman({
        question,
        ...(attachments ? { attachments } : {}),
        ...(choices ? { options: choices } : {}),
        ...(quorum !== undefined ? { quorum } : {}),
        ...(waitSeconds !== undefined ? { waitSeconds } : {}),
      });
      const text = formatVerdict(verdict, client.spentUsd - before);

      await callback?.({ text });
      return {
        success: true,
        text,
        values: {
          arbiterDecision: verdict.decision,
          arbiterAnswer: verdict.evidence.answer,
          arbiterTaskId: verdict.evidence.taskId,
        },
        data: { verdict },
      };
    } catch (err) {
      const text = formatError(err);
      await callback?.({ text });
      return { success: false, text, error: err instanceof Error ? err : String(err) };
    }
  },

  examples: [
    [
      {
        name: "{{user}}",
        content: { text: "Did the courier actually deliver this parcel?" },
      },
      {
        name: "{{agent}}",
        content: {
          text: "I cannot tell from the photo alone — sending it to human reviewers.",
          actions: ["ARBITER_JUDGE_HUMAN"],
        },
      },
    ],
  ],
};

export const arbiterPlugin: Plugin = {
  name: "arbiter",
  description:
    "Judgment before action: check transactions before signing, verify payment counterparties, " +
    "and escalate to human reviewers. Paid per call over x402 on Algorand.",
  actions: [judgeTransactionAction, judgeCounterpartyAction, judgeHumanAction],
};

export default arbiterPlugin;
export { ArbiterClient } from "@arbiter/sdk";
