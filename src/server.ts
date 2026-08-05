/**
 * Arbiter HTTP server.
 *
 * Route order matters: the x402 middleware must sit ahead of the handlers so an
 * unpaid request is answered with 402 and payment requirements, and must sit
 * behind the free introspection routes so agents can discover pricing without
 * paying to find out what things cost.
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import express from "express";

import { CHALLENGE_TAG, PRICING, assertChallengeReady, config } from "./config.js";
import { createPaymentLayer } from "./x402.js";
import { transactionRouter } from "./routes/transaction.js";
import { counterpartyRouter } from "./routes/counterparty.js";
import { humanRetrievalRouter, humanRouter } from "./routes/human.js";
import { workRouter } from "./routes/work.js";
import { invoiceRouter } from "./routes/invoice.js";
import { FilePersistence, NullPersistence } from "./marketplace/persistence.js";
import { store } from "./marketplace/store.js";
import { ARBITER_ICON_PNG } from "./assets/icon.js";
import { renderLanding } from "./landing/page.js";
import { renderDocs } from "./landing/docs.js";
import { renderAbout } from "./landing/about.js";

export async function createApp(): Promise<express.Express> {
  // Resolved before any route is mounted: the facilitator's advertised network
  // identifier is what the route configuration must be validated against.
  const { middleware, routes, resolved } = await createPaymentLayer();

  const app = express();

  app.disable("x-powered-by");
  if (config.env.TRUST_PROXY) app.set("trust proxy", true);
  app.use(express.json({ limit: "1mb" }));

  /**
   * CORS.
   *
   * Agents calling server-to-server never hit this, but two browser clients do:
   * the reviewer web app, and any browser-based x402 client.
   *
   * The exposed headers matter more than the allowed ones. x402 returns payment
   * requirements in `PAYMENT-REQUIRED` and settlement details in the response
   * headers, and a browser cannot read a non-simple response header unless it
   * is named in Access-Control-Expose-Headers. Without this, a browser client
   * receives a 402 it is structurally unable to act on.
   */
  app.use((req, res, next) => {
    const origin = req.get("origin");
    if (origin) {
      res.setHeader("access-control-allow-origin", origin);
      res.setHeader("vary", "Origin");
    }
    res.setHeader(
      "access-control-allow-headers",
      "authorization, content-type, x-payment, payment-signature, idempotency-key",
    );
    res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
    res.setHeader(
      "access-control-expose-headers",
      "payment-required, payment-response, x-payment-response, www-authenticate",
    );
    res.setHeader("access-control-max-age", "86400");

    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    next();
  });

  // One line per request. Paid endpoints need an audit trail that shows whether
  // a caller who was charged actually got a verdict.
  app.use((req, res, next) => {
    const started = Date.now();
    res.on("finish", () => {
      console.log(
        `[arbiter] ${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - started}ms`,
      );
    });
    next();
  });

  // --- Free routes -------------------------------------------------------
  // Deliberately unpriced: discovery and health must never require payment.

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", network: config.network, uptimeSeconds: Math.round(process.uptime()) });
  });

  const manifest = () => ({
    service: "Arbiter",
    tagline: "The judgment layer for autonomous agents.",
    network: config.network,
    caip2: resolved.network,
    payTo: config.payTo,
    asset: { type: "ASA", id: config.usdcAsset, symbol: "USDC" },
    facilitator: config.facilitatorUrl,
    tags: [CHALLENGE_TAG],
    routes: Object.entries(routes).map(([route, cfg]) => ({
      route,
      price: Array.isArray(cfg.accepts) ? cfg.accepts[0]?.price : cfg.accepts.price,
      description: cfg.description,
    })),
    pricing: PRICING,
  });

  /**
   * One address, two audiences.
   *
   * A browser gets the landing page; agents and the Bazaar catalog get the JSON
   * manifest. JSON is the default — anything that does not explicitly prefer
   * HTML is treated as a machine, so an agent with a missing or unusual Accept
   * header is never handed markup it cannot parse.
   */
  app.get("/", async (req, res) => {
    if (req.accepts(["json", "html"]) === "html") {
      res.type("html").send(await renderLanding());
      return;
    }
    res.json(manifest());
  });

  app.get("/docs", (_req, res) => res.type("html").send(renderDocs()));
  app.get("/about", async (_req, res) => res.type("html").send(await renderAbout()));

  // The manifest is also reachable unambiguously, for anyone who wants it
  // without depending on content negotiation.
  app.get("/manifest.json", (_req, res) => res.json(manifest()));

  // Served because the Bazaar catalog resolves merchant metadata from the
  // endpoint's own domain; the iconUrl in every route's payment requirements
  // points here, so a missing file shows up as a broken listing.
  app.get("/icon.png", (_req, res) => {
    res.setHeader("content-type", "image/png");
    res.setHeader("cache-control", "public, max-age=86400");
    res.send(ARBITER_ICON_PNG);
  });

  app.get("/.well-known/x402", (_req, res) => res.json(manifest()));

  /**
   * The reviewer app, served from this same origin.
   *
   * Same-origin is the point: reviewers reach it as a URL rather than an app
   * store, and its calls to /v1/work/* are not cross-origin, so none of the
   * CORS configuration above has to be right for the app to work.
   *
   * The path resolves identically whether running from src/ under tsx, from
   * dist/ after a build, or from /app in the container.
   */
  const webDist = fileURLToPath(new URL("../web/dist", import.meta.url));
  if (existsSync(webDist)) {
    // One bundle, two products. The app branches on the path, so both mounts
    // serve the same files.
    app.use("/work", express.static(webDist));
    app.use("/invoice", express.static(webDist));
    console.log(`[arbiter] reviewer app at ${config.publicUrl}/work`);
    console.log(`[arbiter] invoice app at ${config.publicUrl}/invoice`);
  } else {
    app.get("/work", (_req, res) => {
      res.status(503).json({
        error: "reviewer_app_not_built",
        message: "Run `npm --prefix web run build` to build the reviewer app.",
      });
    });
  }

  // Reviewers are the supply side and get paid, so the worker API is unpriced.
  app.use(workRouter);

  // Narrow, free support endpoint for the invoice app. Deliberately not a
  // substitute for /v1/judge/counterparty — no identity matching, no findings.
  app.use(invoiceRouter);

  // Retrieval of an already-purchased verdict. Mounted before the paywall so a
  // long-poll that times out does not cost the caller a second payment.
  app.use(humanRetrievalRouter);

  // --- Paid routes -------------------------------------------------------

  app.use(middleware);

  app.use(transactionRouter);
  app.use(counterpartyRouter);
  app.use(humanRouter);

  app.use((_req, res) => {
    res.status(404).json({ error: "not_found" });
  });

  // Express 5 forwards async rejections here. A thrown error after payment is
  // the worst case for a caller, so it is logged loudly rather than swallowed.
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error("[arbiter] unhandled error:", err);
    res.status(500).json({
      error: "internal_error",
      message: "The verdict could not be produced. This call should not have been charged.",
    });
  });

  return app;
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"));

if (isMain) {
  assertChallengeReady();

  await store.init(
    config.env.STATE_FILE === "off"
      ? new NullPersistence()
      : new FilePersistence(config.env.STATE_FILE),
  );

  const app = await createApp();
  const server = app.listen(config.port, () => {
    console.log(`[arbiter] listening on :${config.port}`);
    console.log(`[arbiter] network=${config.network} usdc=${config.usdcAsset}`);
    console.log(`[arbiter] payTo=${config.payTo}`);
    console.log(`[arbiter] facilitator=${config.facilitatorUrl}`);
    console.log(`[arbiter] state=${config.env.STATE_FILE}`);
  });

  /**
   * Graceful shutdown.
   *
   * Container platforms send SIGTERM on every deploy. Dropping connections then
   * means callers who were charged never receive their verdict, so in-flight
   * requests are allowed to finish and marketplace state is flushed before exit.
   */
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[arbiter] ${signal} received, draining...`);

    const forced = setTimeout(() => {
      console.error("[arbiter] grace period expired, forcing exit");
      process.exit(1);
    }, config.env.SHUTDOWN_GRACE_SECONDS * 1000);
    forced.unref();

    server.close(async () => {
      try {
        await store.flush();
        console.log("[arbiter] state flushed, exiting cleanly");
        process.exit(0);
      } catch (err) {
        console.error("[arbiter] failed to flush state:", err);
        process.exit(1);
      }
    });
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}
