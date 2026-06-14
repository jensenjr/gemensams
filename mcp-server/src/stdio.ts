#!/usr/bin/env node
/**
 * Gemensams MCP server — stdio transport.
 *
 * Use with Claude Desktop / Claude Code (local).
 * The process communicates over stdin/stdout (JSON-RPC).
 *
 * Required env vars:
 *   POSTGRES_PRISMA_URL          — Postgres connection string (pooling)
 *   POSTGRES_URL_NON_POOLING     — Postgres direct connection (optional but preferred)
 *
 * Optional:
 *   GEMENSAMS_GROUP_ID           — Group id (default: hushallet)
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { disconnectPrisma } from './db.js'
import { createMcpServer } from './server.js'

async function main() {
  const server = createMcpServer()
  const transport = new StdioServerTransport()

  await server.connect(transport)

  // Graceful shutdown
  process.on('SIGINT', async () => {
    await server.close()
    await disconnectPrisma()
    process.exit(0)
  })
  process.on('SIGTERM', async () => {
    await server.close()
    await disconnectPrisma()
    process.exit(0)
  })
}

main().catch((err) => {
  console.error('[gemensams-mcp] Fatal error:', err)
  process.exit(1)
})
