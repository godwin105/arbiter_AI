import { Router } from "express";
import { z } from "zod";

import { MAX_WAIT_SECONDS, judgeHuman, verdictForTask } from "../engine/human.js";
import { store } from "../marketplace/store.js";

const BodySchema = z.object({
  question: z.string().min(5).max(1_000),
  attachments: z.array(z.url()).max(8).optional(),
  options: z.array(z.string().min(1)).min(2).max(8).optional(),
  quorum: z.coerce.number().int().min(1).max(9).optional(),
  waitSeconds: z.coerce.number().int().min(0).max(MAX_WAIT_SECONDS).optional(),
});

/** Paid: creates the question and long-polls for reviewers. */
export const humanRouter: Router = Router();

humanRouter.post("/v1/judge/human", async (req, res) => {
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

  res.json(await judgeHuman(parsed.data));
});

/**
 * Free: retrieves a verdict for a question that was already paid for.
 *
 * Mounted ahead of the payment middleware. Charging again to collect an answer
 * the caller has already bought would make the long-poll timeout a penalty.
 */
export const humanRetrievalRouter: Router = Router();

humanRetrievalRouter.get("/v1/judge/human/:taskId", (req, res) => {
  const task = store.getTask(req.params.taskId);

  if (!task) {
    res.status(404).json({ error: "task_not_found" });
    return;
  }

  res.json(verdictForTask(task, Date.now()));
});
