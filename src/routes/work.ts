/**
 * Worker-side API for the human judgment marketplace.
 *
 * Unpriced: the reviewer is the supply side and gets paid, so charging them to
 * see the queue would be backwards. These routes are mounted ahead of the x402
 * middleware.
 */
import type { NextFunction, Request, Response } from "express";
import { Router } from "express";
import { z } from "zod";
import { isValidAlgorandAddress } from "@x402/avm";

import { type Worker, store } from "../marketplace/store.js";

export const workRouter: Router = Router();

interface WorkerRequest<P = Record<string, string>> extends Request<P> {
  worker?: Worker;
}

function requireWorker(req: WorkerRequest<never>, res: Response, next: NextFunction): void {
  const header = req.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const worker = token ? store.workerByToken(token) : undefined;

  if (!worker) {
    res.status(401).json({ error: "unauthorized", message: "Provide a worker bearer token." });
    return;
  }

  req.worker = worker;
  next();
}

const RegisterSchema = z.object({
  displayName: z.string().min(1).max(60),
  payoutAddress: z
    .string()
    .refine(isValidAlgorandAddress, "payoutAddress must be a valid Algorand address"),
});

workRouter.post("/v1/work/register", (req, res) => {
  const parsed = RegisterSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: "invalid_request",
      issues: parsed.error.issues.map((i) => ({ field: i.path.join("."), problem: i.message })),
    });
    return;
  }

  const worker = store.registerWorker(parsed.data.displayName, parsed.data.payoutAddress);

  // The token is shown exactly once, at registration.
  res.status(201).json({
    workerId: worker.id,
    token: worker.token,
    displayName: worker.displayName,
    payoutAddress: worker.payoutAddress,
  });
});

workRouter.get("/v1/work/queue", requireWorker, (req: WorkerRequest, res) => {
  const worker = req.worker!;
  const tasks = store.queueFor(worker.id);

  res.json({
    count: tasks.length,
    tasks: tasks.map((t) => ({
      taskId: t.id,
      question: t.question,
      attachments: t.attachments,
      options: t.options,
      payoutUsdc: t.payoutPerReviewer,
      expiresAt: t.expiresAt,
      responsesReceived: t.responses.length,
      quorum: t.quorum,
    })),
  });
});

const SubmitSchema = z.object({
  answer: z.string().min(1).max(500),
  rationale: z.string().min(1).max(1_000),
  /** Time the reviewer spent, reported by the client and sanity-checked server-side. */
  responseMs: z.coerce.number().int().min(0).max(3_600_000),
});

workRouter.post("/v1/work/:taskId/submit", requireWorker, (req: WorkerRequest<{ taskId: string }>, res) => {
  const parsed = SubmitSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: "invalid_request",
      issues: parsed.error.issues.map((i) => ({ field: i.path.join("."), problem: i.message })),
    });
    return;
  }

  const worker = req.worker!;
  const result = store.submitResponse(
    req.params.taskId,
    worker,
    parsed.data.answer,
    parsed.data.rationale,
    parsed.data.responseMs,
  );

  if (!result.ok) {
    const status = result.reason === "task_not_found" ? 404 : 409;
    res.status(status).json({ error: result.reason });
    return;
  }

  res.json({
    accepted: true,
    taskId: result.task.id,
    status: result.task.status,
    responsesReceived: result.task.responses.length,
    quorum: result.task.quorum,
    payoutUsdc: result.task.payoutPerReviewer,
    // Paid on resolution, then settled on-chain by the payout worker.
    payoutStatus: result.task.status === "resolved" ? "pending_settlement" : "awaiting_quorum",
  });
});

workRouter.get("/v1/work/earnings", requireWorker, (req: WorkerRequest, res) => {
  const worker = req.worker!;
  const earnings = store.earningsFor(worker.id);

  res.json({
    workerId: worker.id,
    displayName: worker.displayName,
    payoutAddress: worker.payoutAddress,
    tasksCompleted: worker.tasksCompleted,
    reliability: Number(store.reliability(worker).toFixed(3)),
    ...earnings,
  });
});
