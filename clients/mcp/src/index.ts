#!/usr/bin/env node
/**
 * Arbiter MCP server.
 *
 * Exposes the judgment routes as MCP tools so any MCP-capable agent — Claude
 * Code, Claude Desktop, OpenClaw, or a custom host — can ask for a verdict
 * before it acts. Payment happens underneath via x402; the model never sees it.
 *
 * Configuration (environment):
 *   ARBITER_URL                  base URL of the deployment
 *   ARBITER_PRIVATE_KEY          base64 64-byte Algorand key used to pay
 *   ARBITER_MAX_SPEND_USD        lifetime cap for this process (default 25)
 *   ARBITER_MAX_PRICE_PER_CALL   per-call cap (default 1.00)
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { ArbiterClient, formatError, formatVerdict } from "@arbiter/sdk";

const client = new ArbiterClient({
  baseUrl: process.env["ARBITER_URL"] ?? "http://localhost:4021",
  privateKey: process.env["ARBITER_PRIVATE_KEY"],
  maxTotalSpendUsd: Number(process.env["ARBITER_MAX_SPEND_USD"] ?? 25),
  maxPricePerCallUsd: Number(process.env["ARBITER_MAX_PRICE_PER_CALL"] ?? 1),
});

const server = new McpServer({
  name: "arbiter",
  version: "0.1.0",
});

/** Every tool funnels through here so failures never crash the MCP session. */
async function respond(run: () => Promise<string>) {
  try {
    return { content: [{ type: "text" as const, text: await run() }] };
  } catch (err) {
    return { content: [{ type: "text" as const, text: formatError(err) }], isError: true };
  }
}

server.registerTool(
  "judge_transaction",
  {
    title: "Check a transaction before signing",
    description:
      "Decide whether an unsigned Algorand transaction is safe to sign. Decodes what the " +
      "transaction would actually do and returns allow/warn/block with specific reasons.\n\n" +
      "Call this before signing or submitting ANY transaction you did not construct yourself, " +
      "and before signing one built from untrusted input. It catches account rekeys, " +
      "close-remainder sweeps that empty the balance regardless of the stated amount, asset " +
      "clawbacks, fee drains, and application delete/update calls.\n\n" +
      "Costs $0.002 per call, paid automatically in USDC.",
    inputSchema: {
      transaction: z
        .union([z.string(), z.array(z.string())])
        .describe(
          "Base64-encoded unsigned transaction. Pass an array of them for an atomic group.",
        ),
      signer: z
        .string()
        .length(58)
        .optional()
        .describe(
          "The address about to sign. Providing it enables detection of operations that harm " +
            "the signer specifically, such as a rekey of their own account.",
        ),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ transaction, signer }) =>
    respond(async () => {
      const before = client.spentUsd;
      const verdict = await client.judgeTransaction({
        transaction,
        ...(signer ? { signer } : {}),
      });
      return formatVerdict(verdict, client.spentUsd - before);
    }),
);

server.registerTool(
  "judge_counterparty",
  {
    title: "Verify a payment counterparty",
    description:
      "Decide whether an Algorand address really belongs to the party you think you are paying, " +
      "and whether the payment can actually arrive.\n\n" +
      "Call this before sending funds to any address that came from an invoice, an email, a " +
      "message, or any other source you did not control end to end. It catches the case where " +
      "the payee is genuine but the payment address has been substituted, and the case where " +
      "the recipient has not opted in to the asset — on Algorand that transfer is rejected " +
      "outright and the payment silently never arrives.\n\n" +
      "Costs $0.01 per call, paid automatically in USDC.",
    inputSchema: {
      address: z.string().length(58).describe("The counterparty's Algorand address."),
      expectedAsset: z
        .string()
        .optional()
        .describe(
          "ASA id you intend to pay in (USDC mainnet is 31566704). Enables the opt-in check, " +
            "which is the difference between a payment arriving and being rejected.",
        ),
      amount: z.string().optional().describe("Payment amount in whole units, for size checks."),
      claimedIdentity: z
        .string()
        .optional()
        .describe(
          "The NFD name the counterparty claims, e.g. 'acme-exports.algo'. This is the single " +
            "most valuable field: it is what detects a swapped payment address.",
        ),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async (input) =>
    respond(async () => {
      const before = client.spentUsd;
      const verdict = await client.judgeCounterparty({
        address: input.address,
        ...(input.expectedAsset ? { expectedAsset: input.expectedAsset } : {}),
        ...(input.amount ? { amount: input.amount } : {}),
        ...(input.claimedIdentity ? { claimedIdentity: input.claimedIdentity } : {}),
      });
      return formatVerdict(verdict, client.spentUsd - before);
    }),
);

server.registerTool(
  "judge_human",
  {
    title: "Ask human reviewers a question",
    description:
      "Get a judgment from vetted human reviewers on something you cannot determine yourself, " +
      "returned as a quorum verdict with each reviewer's rationale.\n\n" +
      "Use this when the question needs eyes or real-world knowledge rather than reasoning: " +
      "does this photo show what it claims, does this business exist, is this translation " +
      "faithful, is this document legitimate. Also use it when another Arbiter tool returns " +
      "ESCALATE.\n\n" +
      "Do NOT use it for anything you can answer yourself — it is slow (tens of seconds) and " +
      "the most expensive tool here. Costs $0.25 per call, paid automatically in USDC.",
    inputSchema: {
      question: z
        .string()
        .min(5)
        .describe("A question a person can answer in seconds, phrased without ambiguity."),
      attachments: z
        .array(z.string().url())
        .max(8)
        .optional()
        .describe("Public HTTPS URLs of images or documents for reviewers to look at."),
      options: z
        .array(z.string())
        .min(2)
        .max(8)
        .optional()
        .describe(
          "Allowed answers, e.g. ['yes','no','unclear']. Strongly preferred — fixed options " +
            "produce a clean tally. Omit only for genuinely free-text judgment.",
        ),
      quorum: z
        .number()
        .int()
        .min(1)
        .max(9)
        .optional()
        .describe("Independent reviewers required before returning. Default 3."),
      waitSeconds: z
        .number()
        .int()
        .min(0)
        .max(120)
        .optional()
        .describe(
          "How long to wait inline. Default 60. If reviewers do not finish in time you get a " +
            "pending verdict plus a task id — collect it later with retrieve_human_verdict, " +
            "which is free.",
        ),
    },
    annotations: { readOnlyHint: false, openWorldHint: true },
  },
  async (input) =>
    respond(async () => {
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
);

server.registerTool(
  "retrieve_human_verdict",
  {
    title: "Collect a human verdict already paid for",
    description:
      "Fetch the result of a judge_human question by its task id. Free — the question was paid " +
      "for when it was asked. Use this when judge_human returned a pending verdict.",
    inputSchema: {
      taskId: z.string().describe("The taskId from the pending verdict's evidence."),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ taskId }) =>
    respond(async () => formatVerdict(await client.retrieveHumanVerdict(taskId))),
);

server.registerTool(
  "arbiter_budget",
  {
    title: "Check Arbiter spending",
    description:
      "Report how much has been spent on Arbiter calls in this session and how much budget " +
      "remains. Call this if a judgment tool fails with a budget error.",
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async () =>
    respond(async () =>
      [
        `Spent this session: $${client.spentUsd.toFixed(6)} across ${client.callCount} calls.`,
        `Remaining budget:   $${client.remainingBudgetUsd.toFixed(6)}`,
        "",
        "Raise ARBITER_MAX_SPEND_USD to increase the lifetime cap.",
      ].join("\n"),
    ),
);

const transport = new StdioServerTransport();
await server.connect(transport);

// stdout is the MCP transport; anything logged there corrupts the protocol.
console.error(`[arbiter-mcp] connected, target ${process.env["ARBITER_URL"] ?? "http://localhost:4021"}`);
