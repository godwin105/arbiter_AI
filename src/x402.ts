/**
 * x402 payment wiring for Arbiter.
 *
 * Composite Entry: all three routes share a single payTo address, so the
 * challenge leaderboard rolls their volume up into one merchant entry while each
 * route stays individually discoverable in the Bazaar catalog.
 */
import type { RequestHandler } from "express";
import { paymentMiddleware } from "@x402/express";
import type { RoutesConfig } from "@x402/core/server";
import { HTTPFacilitatorClient, x402ResourceServer } from "@x402/core/server";
import { ExactAvmScheme } from "@x402/avm/exact/server";
import { bazaarResourceServerExtension, declareDiscoveryExtension } from "@x402/extensions/bazaar";

import { CHALLENGE_TAG, PRICING, config } from "./config.js";
import { type ResolvedFacilitator, resolveFacilitator } from "./facilitator.js";

const SERVICE_NAME = "Arbiter";
const ICON_URL = `${config.publicUrl}/icon.png`;

/**
 * Worked examples for the Bazaar catalog, and they have to actually work.
 *
 * These were placeholders — a 58-character string that was not a real address,
 * and the literal text "_base64_unsigned_txn". Both passed the request schema
 * and then failed inside the engine, so an agent that discovered a route and
 * copied its advertised example paid, got nothing back, and saw a service that
 * looked broken. Sixteen of nineteen counterparty calls died that way.
 *
 * EXAMPLE_TXN is a genuine rekey transaction: it decodes, and it produces the
 * BLOCK verdict shown as the advertised output, so the example is honest about
 * what the route does.
 */
const EXAMPLE_ADDRESS = config.payTo;
const EXAMPLE_TXN =
  "iaNmZWXNA+iiZnbOA82CwKNnZW6sbWFpbm5ldC12MS4womdoxCDAYcTY/B293tLXYEvkVo4/bQQZh6w3veS2" +
  "ILWrOSSK36Jsds4DzYaoo3JjdsQgMGLukZxLO/eN8uA7vdfpy2xbB/LyIz7TLYYe+jf3IQylcmVrZXnEIBTf" +
  "MR4p4ZXQ2JLDvBYpifk9otL271yT7D2yIg6lWtVBo3NuZMQgMGLukZxLO/eN8uA7vdfpy2xbB/LyIz7TLYYe" +
  "+jf3IQykdHlwZaNwYXk=";

/**
 * Payment option shared by every route. Only the price differs per route, so
 * payTo/network/asset are defined exactly once — this is what keeps the
 * Composite Entry rollup intact.
 *
 * The network string comes from the facilitator rather than from the SDK
 * constant; see facilitator.ts for why the two disagree.
 */
function makeAccepts(resolved: ResolvedFacilitator) {
  return (price: string) => ({
    scheme: "exact",
    network: resolved.network,
    payTo: config.payTo,
    price,
    extra: {
      asset: config.usdcAsset,
      // The tag the challenge indexer actually reads. The route-level `tags`
      // array below lands in `resource.tags` of the 402 header, which is good
      // for humans but is not what gets indexed: every entry in the Bazaar
      // catalog carries its challenge tag here, at `accepts[].extra.tag`.
      // Setting only the array meant the routes advertised the tag in a field
      // nothing rolls volume up by.
      tag: CHALLENGE_TAG,
      // Lets the facilitator co-sign the fee-covering transaction in the atomic
      // group, so callers do not need ALGO for gas to pay in USDC.
      ...(resolved.feePayer ? { feePayer: resolved.feePayer } : {}),
    },
  });
}

/**
 * Route descriptions are written specifically rather than generically because
 * they are what appears in the Bazaar catalog — this is the copy that decides
 * whether another team's agent discovers and calls us.
 */
export function buildRoutes(resolved: ResolvedFacilitator): RoutesConfig {
  const accepts = makeAccepts(resolved);

  return {
  "POST /v1/judge/transaction": {
    accepts: accepts(PRICING.transaction),
    description:
      "Pre-flight safety verdict for an unsigned blockchain transaction: decodes what the " +
      "transaction actually does, scores the counterparty and any asset involved, detects " +
      "drain patterns such as unlimited approvals, rekeys and close-remainder-to, and returns " +
      "allow/warn/block with itemised reasons before the agent signs.",
    serviceName: SERVICE_NAME,
    tags: [CHALLENGE_TAG, "security", "agents", "transaction-simulation", "risk"],
    iconUrl: ICON_URL,
    mimeType: "application/json",
    extensions: declareDiscoveryExtension({
      bodyType: "json",
      input: {
        chain: "algorand",
        transaction: EXAMPLE_TXN,
        signer: EXAMPLE_ADDRESS,
      },
      inputSchema: {
        type: "object",
        properties: {
          chain: { type: "string", enum: ["algorand"] },
          transaction: {
            type: "string",
            description: "Base64-encoded unsigned transaction, or a msgpack transaction group.",
          },
          signer: {
            type: "string",
            description: "Address that is about to sign, used to detect self-harming operations.",
          },
        },
        required: ["chain", "transaction"],
      },
      output: {
        example: {
          id: "vrd_01J8ZQ",
          decision: "block",
          risk: 92,
          confidence: 0.91,
          findings: [
            {
              code: "txn.rekey_to_third_party",
              severity: "critical",
              title: "Transaction rekeys your account to another address",
              detail:
                "rekeyTo is set to VZ2K...D4QA, which permanently transfers signing authority.",
              source: "arbiter:decoder",
            },
          ],
        },
      },
    }),
  },

  "POST /v1/judge/counterparty": {
    accepts: accepts(PRICING.counterparty),
    description:
      "Trust verdict for a payment counterparty before funds move: on-chain settlement " +
      "history, account age and funding pattern, NFD/domain identity resolution, asset " +
      "opt-in sanity, and known-bad list screening. Built for cross-border payout and " +
      "invoicing agents that must decide whether an address really belongs to the payee.",
    serviceName: SERVICE_NAME,
    tags: [CHALLENGE_TAG, "payments", "agents", "kyc", "reputation"],
    iconUrl: ICON_URL,
    mimeType: "application/json",
    extensions: declareDiscoveryExtension({
      bodyType: "json",
      input: {
        address: EXAMPLE_ADDRESS,
        expectedAsset: "31566704",
        amount: "250.00",
        claimedIdentity: "acme-exports.algo",
      },
      inputSchema: {
        type: "object",
        properties: {
          address: { type: "string", description: "Counterparty Algorand address." },
          expectedAsset: { type: "string", description: "ASA id the payment will be sent in." },
          amount: { type: "string", description: "Payment amount, for size-anomaly checks." },
          claimedIdentity: {
            type: "string",
            description: "NFD or domain the counterparty claims, verified against the address.",
          },
        },
        required: ["address"],
      },
      output: {
        example: {
          id: "vrd_01J8ZR",
          decision: "warn",
          risk: 41,
          confidence: 0.78,
          findings: [
            {
              code: "account.no_settlement_history",
              severity: "medium",
              title: "No prior settlement history with this asset",
              detail: "Account has never held ASA 31566704 before this payment.",
              source: "algod:account_info",
            },
          ],
        },
      },
    }),
  },

  "POST /v1/judge/human": {
    accepts: accepts(PRICING.human),
    description:
      "Human judgment on demand for questions a model cannot settle alone: does this photo " +
      "show a delivered package, does this business exist at this address, is this " +
      "translation faithful. Routes the question to vetted human reviewers, returns a " +
      "quorum verdict with per-reviewer rationale, and settles payment to reviewers on-chain.",
    serviceName: SERVICE_NAME,
    tags: [CHALLENGE_TAG, "human-in-the-loop", "agents", "verification", "oracle"],
    iconUrl: ICON_URL,
    mimeType: "application/json",
    extensions: declareDiscoveryExtension({
      bodyType: "json",
      input: {
        question: "Does this photo show a package left at a front door?",
        attachments: ["https://example.com/parcel.jpg"],
        options: ["yes", "no", "unclear"],
        quorum: 3,
      },
      inputSchema: {
        type: "object",
        properties: {
          question: { type: "string", description: "A question a human can answer in seconds." },
          attachments: {
            type: "array",
            items: { type: "string" },
            description: "Public HTTPS URLs of images or documents to review.",
          },
          options: {
            type: "array",
            items: { type: "string" },
            description: "Allowed answers. Omit for free-text judgment.",
          },
          quorum: {
            type: "number",
            description: "Independent reviewers required before returning (default 3).",
          },
        },
        required: ["question"],
      },
      output: {
        example: {
          id: "vrd_01J8ZS",
          decision: "allow",
          risk: 5,
          confidence: 1,
          evidence: {
            answer: "yes",
            agreement: "3/3",
            reviewers: [{ rationale: "Package visible on doormat, label facing up." }],
          },
        },
      },
    }),
  },
  };
}

/**
 * Builds the x402 payment middleware.
 *
 * The Bazaar extension is registered on the resource server so each route's
 * discovery metadata is published to the catalog; without it the endpoints
 * settle payments correctly but never become discoverable, which is half the
 * point of entering.
 */
export async function createPaymentLayer(): Promise<{
  middleware: RequestHandler;
  routes: RoutesConfig;
  resolved: ResolvedFacilitator;
}> {
  const resolved = await resolveFacilitator();
  const routes = buildRoutes(resolved);

  const facilitator = new HTTPFacilitatorClient({ url: config.facilitatorUrl });

  const resourceServer = new x402ResourceServer(facilitator);
  // Registered under the facilitator's identifier so route validation matches;
  // the AVM scheme normalizes it internally, so settlement is unaffected.
  resourceServer.register(resolved.network, new ExactAvmScheme());
  resourceServer.registerExtension(bazaarResourceServerExtension);

  return { middleware: paymentMiddleware(routes, resourceServer), routes, resolved };
}
