import { Router } from "express";
import { z } from "zod";
import algosdk from "algosdk";

import { judgeCounterparty } from "../engine/counterparty.js";

/**
 * Length alone is not validation. An Algorand address carries a checksum, so a
 * 58-character string can pass a length check and still be undecodable — which
 * sent the failure past this schema and into the engine, where the caller saw
 * an opaque error instead of "that address is malformed".
 */
const algorandAddress = (label: string) =>
  z
    .string()
    .length(58, `${label} must be a 58-character Algorand address`)
    .refine(algosdk.isValidAddress, `${label} is not a valid Algorand address (bad checksum)`);

const BodySchema = z.object({
  address: algorandAddress("address"),
  expectedAsset: z.string().regex(/^\d+$/, "expectedAsset must be a numeric ASA id").optional(),
  amount: z.string().optional(),
  claimedIdentity: z.string().min(1).max(256).optional(),
});

export const counterpartyRouter: Router = Router();

counterpartyRouter.post("/v1/judge/counterparty", async (req, res) => {
  const parsed = BodySchema.safeParse(req.body);

  if (!parsed.success) {
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

  res.json(await judgeCounterparty(parsed.data));
});
