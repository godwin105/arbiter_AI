import { Router } from "express";
import { z } from "zod";

import { judgeCounterparty } from "../engine/counterparty.js";

const BodySchema = z.object({
  address: z.string().length(58, "address must be a 58-character Algorand address"),
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
