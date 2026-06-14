# Gemensams MCP Server — HTTP transport
# Runs the streamable-HTTP MCP server; exposes port 8787 by default.

FROM node:22-alpine AS base

# Install openssl for Prisma
RUN apk add --no-cache openssl

WORKDIR /app

# ── deps ──────────────────────────────────────────────────────────────────────
FROM base AS deps

COPY mcp-server/package.json mcp-server/package-lock.json* ./mcp-server/
COPY prisma/schema.prisma ./prisma/

WORKDIR /app/mcp-server
RUN npm ci --omit=dev

# ── build ─────────────────────────────────────────────────────────────────────
FROM base AS builder

COPY mcp-server/package.json mcp-server/package-lock.json* ./mcp-server/
COPY mcp-server/tsconfig.json mcp-server/tsup.config.ts ./mcp-server/
COPY mcp-server/src ./mcp-server/src
COPY prisma/schema.prisma ./prisma/

WORKDIR /app/mcp-server
RUN npm ci
RUN npm run build

# ── runtime ───────────────────────────────────────────────────────────────────
FROM base AS runner

WORKDIR /app

# Copy prisma schema for prisma generate at runtime (or bake client in)
COPY prisma/schema.prisma ./prisma/

# Copy production node_modules
COPY --from=deps /app/mcp-server/node_modules ./node_modules

# Copy built JS
COPY --from=builder /app/mcp-server/dist ./dist

# Generate Prisma client (needs schema + @prisma/client in node_modules)
RUN node node_modules/.bin/prisma generate --schema=./prisma/schema.prisma

# Non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 mcpuser
USER mcpuser

ENV PORT=8787
ENV NODE_ENV=production

EXPOSE 8787

CMD ["node", "dist/http.js"]
