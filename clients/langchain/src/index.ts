/**
 * LangChain tools for Arbiter.
 *
 * Tool descriptions are written as instructions to the model about *when* to
 * reach for judgment, not as API documentation — that is what determines whether
 * an agent actually checks before it signs.
 */
import { tool } from "@langchain/core/tools";
import { ArbiterClient, type ArbiterClientOptions, formatError, formatVerdict } from "@arbiterlabs/sdk";
import { z } from "zod";

export interface ArbiterToolsOptions extends ArbiterClientOptions {}

/**
 * Builds the Arbiter tool set.
 *
 * All tools share one client so the spend cap applies across the whole agent
 * rather than per tool — a budget that resets per tool is not a budget.
 */
export function createArbiterTools(options: ArbiterToolsOptions | ArbiterClient) {
  const client = options instanceof ArbiterClient ? options : new ArbiterClient(options);

  const guard = async (run: () => Promise<string>): Promise<string> => {
    try {
      return await run();
    } catch (err) {
      // Returned rather than thrown: a tool error the model can read lets it
      // recover, whereas an exception usually aborts the run.
      return formatError(err);
    }
  };

  const judgeTransaction = tool(
    async ({ transaction, signer }) =>
      guard(async () => {
        const before = client.spentUsd;
        const verdict = await client.judgeTransaction({
          transaction,
          ...(signer ? { signer } : {}),
        });
        return formatVerdict(verdict, client.spentUsd - before);
      }),
    {
      name: "judge_transaction",
      description:
        "Check whether an unsigned Algorand transaction is safe to sign, BEFORE signing it. " +
        "Returns allow/warn/block with specific reasons. Always call this for a transaction " +
        "you did not construct yourself or that was built from untrusted input. Catches account " +
        "rekeys, close-remainder sweeps that empty the balance regardless of the stated amount, " +
        "clawbacks, fee drains, and app delete/update calls. Costs $0.002.",
      schema: z.object({
        transaction: z
          .union([z.string(), z.array(z.string())])
          .describe("Base64 unsigned transaction, or an array of them for an atomic group."),
        signer: z.string().length(58).optional().describe("Address about to sign."),
      }),
    },
  );

  const judgeCounterparty = tool(
    async (input) =>
      guard(async () => {
        const before = client.spentUsd;
        const verdict = await client.judgeCounterparty({
          address: input.address,
          ...(input.expectedAsset ? { expectedAsset: input.expectedAsset } : {}),
          ...(input.amount ? { amount: input.amount } : {}),
          ...(input.claimedIdentity ? { claimedIdentity: input.claimedIdentity } : {}),
        });
        return formatVerdict(verdict, client.spentUsd - before);
      }),
    {
      name: "judge_counterparty",
      description:
        "Verify that an Algorand address really belongs to the party you intend to pay, and " +
        "that the payment can actually arrive. Call this before sending funds to any address " +
        "taken from an invoice, email or message. Catches a genuine payee whose payment address " +
        "has been substituted, and recipients who have not opted in to the asset — on Algorand " +
        "that transfer is rejected and the payment never arrives. Costs $0.01.",
      schema: z.object({
        address: z.string().length(58).describe("Counterparty Algorand address."),
        expectedAsset: z
          .string()
          .optional()
          .describe("ASA id being paid (USDC mainnet 31566704). Enables the opt-in check."),
        amount: z.string().optional().describe("Amount in whole units."),
        claimedIdentity: z
          .string()
          .optional()
          .describe("NFD the counterparty claims. The field that detects a swapped address."),
      }),
    },
  );

  const judgeHuman = tool(
    async (input) =>
      guard(async () => {
        const before = client.spentUsd;
        const verdict = await client.judgeHuman({
          question: input.question,
          ...(input.attachments ? { attachments: input.attachments } : {}),
          ...(input.options ? { options: input.options } : {}),
          ...(input.quorum !== undefined ? { quorum: input.quorum } : {}),
          ...(input.waitSeconds !== undefined ? { waitSeconds: input.waitSeconds } : {}),
        });
        return formatVerdict(verdict, client.spentUsd - before);
      }),
    {
      name: "judge_human",
      description:
        "Ask vetted human reviewers a question you cannot answer yourself, and get back a " +
        "quorum verdict with each reviewer's rationale. Use for questions needing eyes or " +
        "real-world knowledge: does this photo show what it claims, does this business exist, " +
        "is this document legitimate. Also use when another Arbiter tool returns ESCALATE. Do " +
        "NOT use for anything you can determine yourself — it is slow and costs $0.25.",
      schema: z.object({
        question: z.string().min(5).describe("A question answerable by a person in seconds."),
        attachments: z.array(z.string()).max(8).optional().describe("Public HTTPS URLs to review."),
        options: z
          .array(z.string())
          .min(2)
          .max(8)
          .optional()
          .describe("Allowed answers, e.g. ['yes','no','unclear']. Strongly preferred."),
        quorum: z.number().int().min(1).max(9).optional().describe("Reviewers required. Default 3."),
        waitSeconds: z.number().int().min(0).max(120).optional().describe("Inline wait. Default 60."),
      }),
    },
  );

  const retrieveHumanVerdict = tool(
    async ({ taskId }) => guard(async () => formatVerdict(await client.retrieveHumanVerdict(taskId))),
    {
      name: "retrieve_human_verdict",
      description:
        "Collect the result of a judge_human question by task id. Free — the question was " +
        "already paid for. Use when judge_human returned a pending verdict.",
      schema: z.object({ taskId: z.string().describe("taskId from the pending verdict.") }),
    },
  );

  return {
    tools: [judgeTransaction, judgeCounterparty, judgeHuman, retrieveHumanVerdict],
    judgeTransaction,
    judgeCounterparty,
    judgeHuman,
    retrieveHumanVerdict,
    client,
  };
}

export { ArbiterClient } from "@arbiterlabs/sdk";
export type { Verdict, Decision, Finding } from "@arbiterlabs/sdk";
