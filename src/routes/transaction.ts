import { Router } from "express";
import { z } from "zod";

import { judgeTransaction } from "../engine/transaction.js";
import { judgeEvmTransaction } from "../engine/evm.js";

/** Algorand: a base64 transaction, or a group of them. */
const AlgorandSchema = z.object({
  chain: z.literal("algorand").default("algorand"),
  transaction: z.union([
    z.string().min(1, "transaction must be a non-empty base64 string"),
    z.array(z.string().min(1)).min(1).max(16, "an atomic group holds at most 16 transactions"),
  ]),
  signer: z.string().length(58, "signer must be a 58-character Algorand address").optional(),
});

const HexAddress = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "must be a 0x-prefixed 20-byte address");

/** EVM: an unsigned transaction request, the shape a wallet would be asked to sign. */
const EvmSchema = z.object({
  chain: z.literal("evm"),
  chainId: z.coerce.number().int().positive(),
  transaction: z.object({
    to: HexAddress,
    data: z.string().regex(/^0x[0-9a-fA-F]*$/, "data must be hex").optional(),
    value: z.string().optional(),
    from: HexAddress.optional(),
  }),
});

// Discriminated on `chain` so a caller who omits it still gets the Algorand
// path, preserving the existing contract.
const BodySchema = z.union([EvmSchema, AlgorandSchema]);

export const transactionRouter: Router = Router();

transactionRouter.post("/v1/judge/transaction", async (req, res) => {
  const parsed = BodySchema.safeParse(req.body);

  if (!parsed.success) {
    // The caller has already paid at this point, so the error has to be
    // actionable enough that they can fix the call and not just retry blindly.
    res.status(400).json({
      error: "invalid_request",
      message: "Request body did not match the expected schema.",
      issues: parsed.error.issues.map((i) => ({
        field: i.path.join(".") || "(root)",
        problem: i.message,
      })),
    });
    return;
  }

  if (parsed.data.chain === "evm") {
    const { chainId, transaction } = parsed.data;
    res.json(
      await judgeEvmTransaction({
        to: transaction.to,
        chainId,
        ...(transaction.data !== undefined ? { data: transaction.data } : {}),
        ...(transaction.value !== undefined ? { value: transaction.value } : {}),
        ...(transaction.from !== undefined ? { from: transaction.from } : {}),
      }),
    );
    return;
  }

  res.json(await judgeTransaction(parsed.data));
});
