# syntax=docker/dockerfile:1.7
#
# Only the server is containerised. The client packages under clients/ are
# published to npm and installed by consumers, so `--workspaces=false` keeps
# LangChain, ElizaOS and the MCP SDK out of a production image that never runs
# them.

# --- deps: production dependencies only ------------------------------------
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --workspaces=false --include-workspace-root

# --- build: compile TypeScript ---------------------------------------------
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --workspaces=false --include-workspace-root
COPY tsconfig.json ./
COPY src ./src
RUN npx tsc -p tsconfig.json

# --- web: the reviewer app --------------------------------------------------
# Built in the image rather than committed, so the served bundle always matches
# the source in this repo.
FROM node:24-alpine AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# --- runtime ----------------------------------------------------------------
FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

RUN addgroup -S arbiter && adduser -S arbiter -G arbiter

# Application files stay root-owned and world-readable. The service only ever
# reads them, so giving the runtime user ownership would buy nothing and let a
# compromised process rewrite its own code. It also avoids a recursive chown
# over node_modules, which added ~4.5 minutes to every build.
COPY --from=deps  /app/node_modules ./node_modules
COPY --from=build /app/dist        ./dist
COPY --from=web   /web/dist        ./web/dist
COPY package.json ./
# Rendered at /about. Without this the page falls back to a stub that looks fine
# in a status check and is empty to a reader.
COPY WHAT-IT-DOES.md ./

# Marketplace state lives on a volume. It holds unresolved reviewer questions
# that callers have already paid for, and the ledger of USDC owed to reviewers —
# losing it on redeploy means reviewers lose money they earned. This is the only
# path the service writes to, so it is the only one it needs to own.
ENV STATE_FILE=/data/marketplace.json
RUN install -d -o arbiter -g arbiter /data
VOLUME ["/data"]

USER arbiter
EXPOSE 4021

# Node installs its own SIGTERM handler (see src/server.ts), so it is safe as
# PID 1 here. Run the container with `--init` if you would rather have tini
# reap orphans as well.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4021)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/server.js"]
