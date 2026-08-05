#!/usr/bin/env node
/**
 * Arbiter paying sidecar.
 *
 * Exists because x402 payment on Algorand is only implemented in the TypeScript
 * SDK today: the published Python packages (`x402` 2.18, `x402-avm` 2.0.2) ship
 * no AVM scheme client, so a Python agent cannot pay for itself. This process
 * holds the key, pays, and exposes the same judgments unpriced on loopback.
 *
 * That is also the better security posture even where a native client exists —
 * one process holds the funded key and enforces one budget, instead of every
 * agent process carrying a copy of both.
 *
 * Configuration:
 *   ARBITER_URL, ARBITER_PRIVATE_KEY, ARBITER_MAX_SPEND_USD,
 *   ARBITER_PROXY_PORT (default 4030), ARBITER_PROXY_TOKEN (optional)
 */
import { createServer } from "node:http";

import { ArbiterClient, ArbiterBudgetError, ArbiterError } from "@arbiter/sdk";

const PORT = Number(process.env["ARBITER_PROXY_PORT"] ?? 4030);
const TOKEN = process.env["ARBITER_PROXY_TOKEN"];

const client = new ArbiterClient({
  baseUrl: process.env["ARBITER_URL"] ?? "http://localhost:4021",
  privateKey: process.env["ARBITER_PRIVATE_KEY"],
  maxTotalSpendUsd: Number(process.env["ARBITER_MAX_SPEND_USD"] ?? 25),
  maxPricePerCallUsd: Number(process.env["ARBITER_MAX_PRICE_PER_CALL"] ?? 1),
});

type Handler = (body: Record<string, unknown>) => Promise<unknown>;

const routes: Record<string, Handler> = {
  "/judge/transaction": (b) =>
    client.judgeTransaction(b as unknown as Parameters<typeof client.judgeTransaction>[0]),
  "/judge/counterparty": (b) =>
    client.judgeCounterparty(b as unknown as Parameters<typeof client.judgeCounterparty>[0]),
  "/judge/human": (b) =>
    client.judgeHuman(b as unknown as Parameters<typeof client.judgeHuman>[0]),
};

function readBody(req: import("node:http").IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      // Judgment inputs are small; anything larger is a mistake or an attack.
      if (data.length > 1_000_000) reject(new Error("body too large"));
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

const server = createServer(async (req, res) => {
  const send = (status: number, payload: unknown) => {
    const text = JSON.stringify(payload);
    res.writeHead(status, { "content-type": "application/json" });
    res.end(text);
  };

  if (TOKEN) {
    const auth = req.headers.authorization ?? "";
    if (auth !== `Bearer ${TOKEN}`) {
      send(401, { error: "unauthorized" });
      return;
    }
  }

  const url = (req.url ?? "").split("?")[0] ?? "";

  if (req.method === "GET" && url === "/health") {
    send(200, { status: "ok", target: process.env["ARBITER_URL"] ?? "http://localhost:4021" });
    return;
  }

  if (req.method === "GET" && url === "/budget") {
    send(200, {
      spentUsd: client.spentUsd,
      remainingUsd: client.remainingBudgetUsd,
      calls: client.callCount,
    });
    return;
  }

  const handler = routes[url];
  if (req.method !== "POST" || !handler) {
    send(404, { error: "not_found", routes: [...Object.keys(routes), "/health", "/budget"] });
    return;
  }

  try {
    const raw = await readBody(req);
    const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    send(200, await handler(body));
  } catch (err) {
    if (err instanceof ArbiterBudgetError) {
      // 429 rather than 500: the caller should back off, not retry immediately.
      send(429, { error: "budget_exceeded", message: err.message });
      return;
    }
    if (err instanceof ArbiterError) {
      send(err.status === 402 ? 402 : 502, { error: "upstream", message: err.message });
      return;
    }
    send(400, { error: "bad_request", message: err instanceof Error ? err.message : String(err) });
  }
});

// Loopback only. This process holds a funded key; binding it to a routable
// interface would expose a paying oracle to the network.
server.listen(PORT, "127.0.0.1", () => {
  console.error(`[arbiter-proxy] 127.0.0.1:${PORT} -> ${process.env["ARBITER_URL"] ?? "http://localhost:4021"}`);
  if (!TOKEN) {
    console.error("[arbiter-proxy] no ARBITER_PROXY_TOKEN set; any local process can spend.");
  }
});
