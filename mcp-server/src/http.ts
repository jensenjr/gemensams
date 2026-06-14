#!/usr/bin/env node
/**
 * Gemensams MCP server — Streamable HTTP transport.
 *
 * Exposes MCP over HTTP on PORT (default 8787).
 * All requests are gated by a bearer token (MCP_AUTH_TOKEN env var).
 *
 * Required env vars:
 *   POSTGRES_PRISMA_URL          — Postgres connection string (pooling)
 *   POSTGRES_URL_NON_POOLING     — Postgres direct connection (optional but preferred)
 *   MCP_AUTH_TOKEN               — Secret bearer token; requests without it are rejected 401
 *
 * Optional:
 *   PORT                         — HTTP listen port (default 8787)
 *   GEMENSAMS_GROUP_ID           — Group id (default: hushallet)
 *
 * MCP endpoint: POST /mcp  (also GET /mcp for SSE, DELETE /mcp for session teardown)
 * Health check:  GET /health  → 200 OK
 */

import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import * as http from 'node:http'
import { randomUUID } from 'node:crypto'
import { disconnectPrisma } from './db.js'
import { createMcpServer } from './server.js'

const PORT = parseInt(process.env['PORT'] ?? '8787', 10)
const AUTH_TOKEN = process.env['MCP_AUTH_TOKEN'] ?? ''

if (!AUTH_TOKEN) {
  console.warn(
    '[gemensams-mcp] WARNING: MCP_AUTH_TOKEN is not set. ' +
      'All requests will be rejected with 401. Set the env var to enable access.',
  )
}

// ---------------------------------------------------------------------------
// Auth middleware
// ---------------------------------------------------------------------------

function checkAuth(req: http.IncomingMessage): boolean {
  if (!AUTH_TOKEN) return false
  const header = req.headers['authorization'] ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''
  return token === AUTH_TOKEN
}

function send401(res: http.ServerResponse): void {
  res.writeHead(401, {
    'Content-Type': 'application/json',
    'WWW-Authenticate': 'Bearer realm="gemensams-mcp"',
  })
  res.end(JSON.stringify({ error: 'Unauthorized: valid Bearer token required' }))
}

// ---------------------------------------------------------------------------
// Session management
// ---------------------------------------------------------------------------

const sessions = new Map<string, { server: ReturnType<typeof createMcpServer>; transport: StreamableHTTPServerTransport }>()

async function getOrCreateSession(sessionId: string | undefined): Promise<{
  server: ReturnType<typeof createMcpServer>
  transport: StreamableHTTPServerTransport
  isNew: boolean
}> {
  if (sessionId && sessions.has(sessionId)) {
    const existing = sessions.get(sessionId)!
    return { ...existing, isNew: false }
  }

  // Create a new session
  const newSessionId = sessionId ?? randomUUID()
  const mcpServer = createMcpServer()
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => newSessionId,
    onsessioninitialized: (sid) => {
      sessions.set(sid, { server: mcpServer, transport })
    },
  })

  transport.onclose = () => {
    for (const [sid, sess] of sessions.entries()) {
      if (sess.transport === transport) {
        sessions.delete(sid)
        break
      }
    }
  }

  await mcpServer.connect(transport)
  return { server: mcpServer, transport, isNew: true }
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

const httpServer = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`)
  const pathname = url.pathname

  // Health check (no auth required)
  if (pathname === '/health' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ status: 'ok', server: 'gemensams-mcp' }))
    return
  }

  // All MCP requests require auth
  if (pathname === '/mcp') {
    if (!checkAuth(req)) {
      send401(res)
      return
    }

    try {
      const sessionId = req.headers['mcp-session-id'] as string | undefined

      if (req.method === 'POST') {
        const bodyText = await readBody(req)
        const body = bodyText ? JSON.parse(bodyText) : undefined

        const { transport } = await getOrCreateSession(sessionId)
        await transport.handleRequest(req, res, body)
        return
      }

      if (req.method === 'GET') {
        // SSE stream for server-sent events
        if (!sessionId || !sessions.has(sessionId)) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Invalid or missing session id' }))
          return
        }
        const { transport } = sessions.get(sessionId)!
        await transport.handleRequest(req, res)
        return
      }

      if (req.method === 'DELETE') {
        // Session teardown
        if (sessionId && sessions.has(sessionId)) {
          const { server, transport } = sessions.get(sessionId)!
          await server.close()
          sessions.delete(sessionId)
        }
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ closed: true }))
        return
      }

      res.writeHead(405, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Method not allowed' }))
      return
    } catch (err) {
      console.error('[gemensams-mcp] Request error:', err)
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Internal server error' }))
      }
      return
    }
  }

  res.writeHead(404, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ error: 'Not found' }))
})

httpServer.listen(PORT, () => {
  console.log(`[gemensams-mcp] HTTP server listening on port ${PORT}`)
  console.log(`[gemensams-mcp] MCP endpoint: http://localhost:${PORT}/mcp`)
  console.log(`[gemensams-mcp] Health check: http://localhost:${PORT}/health`)
  if (!AUTH_TOKEN) {
    console.warn('[gemensams-mcp] WARNING: MCP_AUTH_TOKEN not set — all requests rejected')
  }
})

// Graceful shutdown
async function shutdown() {
  console.log('[gemensams-mcp] Shutting down...')
  for (const { server } of sessions.values()) {
    await server.close().catch(() => {})
  }
  sessions.clear()
  await disconnectPrisma()
  httpServer.close()
  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
