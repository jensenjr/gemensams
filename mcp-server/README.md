# Gemensams MCP Server

An [MCP](https://modelcontextprotocol.io/) server that exposes the Gemensams household expense ledger to AI assistants (Claude Desktop, Claude Code, remote Claude via Cloudflare tunnel).

The MCP server is **fully isolated** from the web app — it has its own `package.json`, its own build, and its own Docker image. It connects directly to the same Postgres database as the web app.

---

## Tools

| Tool | Description |
|---|---|
| `get_group` | Returns group name, currency, participants list. Call first in a fresh session. |
| `list_participants` | Returns all participants (id + name). |
| `list_categories` | Returns all expense categories. |
| `list_expenses` | Filtered expense list with owner, formatted amounts, dates, categories. |
| `get_expense` | Single expense by id. |
| `create_expense` | Create a new expense (amount in major units, e.g. 49.90 SEK). |
| `update_expense` | Update fields of an existing expense. |
| `set_owner` | Re-attribute an expense to a different owner. |
| `delete_expense` | Delete an expense by id. |
| `spend_by_owner` | Per-owner spend totals + grand total over an optional date/category range. |
| `expenses_for_day` | All expenses on a given calendar day with day total. |

**Owner values:** a participant id (from `list_participants`) or the string `"gemensamt"` (shared/all participants).

**Amounts:** inputs to `create_expense` and `update_expense` are in **major currency units** (e.g. `49.90` for 49.90 SEK). Outputs include both the raw integer in minor units (`amount_ore`) and a formatted string (`amount_formatted`).

---

## Local setup (stdio — for Claude Desktop / Claude Code)

### 1. Prerequisites

- Node.js 18+
- The Gemensams Postgres database running and accessible

### 2. Build

```bash
cd mcp-server
npm install
npm run build
```

The build runs `prisma generate` (against `../prisma/schema.prisma`) and then compiles with tsup. Output is in `mcp-server/dist/`.

### 3. Claude Desktop config

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "gemensams": {
      "command": "node",
      "args": ["C:/path/to/gemensams/mcp-server/dist/stdio.js"],
      "env": {
        "POSTGRES_PRISMA_URL": "postgresql://user:pass@localhost:5432/gemensams?schema=public",
        "POSTGRES_URL_NON_POOLING": "postgresql://user:pass@localhost:5432/gemensams?schema=public",
        "GEMENSAMS_GROUP_ID": "hushallet"
      }
    }
  }
}
```

Replace the path and connection strings with your values.

### 4. Claude Code (`.claude/settings.json`)

```json
{
  "mcpServers": {
    "gemensams": {
      "command": "node",
      "args": ["/absolute/path/to/gemensams/mcp-server/dist/stdio.js"],
      "env": {
        "POSTGRES_PRISMA_URL": "postgresql://user:pass@localhost:5432/gemensams?schema=public",
        "POSTGRES_URL_NON_POOLING": "postgresql://user:pass@localhost:5432/gemensams?schema=public",
        "GEMENSAMS_GROUP_ID": "hushallet"
      }
    }
  }
}
```

---

## HTTP server (remote Claude via Cloudflare tunnel)

### 1. Environment variables

| Variable | Required | Description |
|---|---|---|
| `POSTGRES_PRISMA_URL` | Yes | Postgres connection URL (with connection pooling) |
| `POSTGRES_URL_NON_POOLING` | Recommended | Postgres direct connection URL |
| `MCP_AUTH_TOKEN` | Yes | Secret bearer token for HTTP auth |
| `PORT` | No | Listen port (default `8787`) |
| `GEMENSAMS_GROUP_ID` | No | Group id (default `hushallet`) |

### 2. Run locally

```bash
cd mcp-server
npm run build
MCP_AUTH_TOKEN=mysecret POSTGRES_PRISMA_URL=postgresql://... node dist/http.js
```

The server listens on `http://localhost:8787`.
- MCP endpoint: `POST /mcp` (also `GET /mcp` for SSE, `DELETE /mcp` for session teardown)
- Health check: `GET /health` → `{"status":"ok"}`

### 3. Run with Docker Compose (standalone)

```bash
# From repo root:
cp .env.example .env   # or set vars in shell
docker compose -f mcp-server/compose.mcp.yaml up -d
```

See comments in `compose.mcp.yaml` for how to attach to the web app's Docker network.

### 4. Deploy on Coolify (separate resource)

1. In Coolify, create a **new resource** → "Docker Compose" (or Docker image).
2. Point at the repo root; set **Compose file** to `mcp-server/compose.mcp.yaml`.
3. Set environment variables: `POSTGRES_PRISMA_URL`, `MCP_AUTH_TOKEN`, optionally `POSTGRES_URL_NON_POOLING`, `GEMENSAMS_GROUP_ID`.
4. The Postgres URL should be the **internal** Coolify DB hostname (same as used by the web app).
5. Do **not** expose the MCP port directly. Instead, add the Cloudflare tunnel to forward `https://mcp.gemensams.krut.it` → `http://mcp-server:8787`.

### 5. Connect Claude (remote) to the HTTP server

In Claude's MCP config (remote/API):

```json
{
  "mcpServers": {
    "gemensams": {
      "type": "http",
      "url": "https://mcp.gemensams.krut.it/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_MCP_AUTH_TOKEN"
      }
    }
  }
}
```

Or for Claude Code connected to a remote server:

```json
{
  "mcpServers": {
    "gemensams": {
      "type": "http",
      "url": "https://mcp.gemensams.krut.it/mcp",
      "env": {},
      "headers": {
        "Authorization": "Bearer YOUR_MCP_AUTH_TOKEN"
      }
    }
  }
}
```

---

## Architecture notes

- **Owner model:** The MCP server reimplements the owner logic from `src/lib/owners.ts` inline (`mcp-server/src/owners.ts`). If the web app's owner model changes, update both files.
- **Amounts:** stored as integers in minor units (öre/cents). The MCP layer accepts SEK/major-unit input and converts internally.
- **Group id:** hardcoded default is `hushallet`; override with `GEMENSAMS_GROUP_ID` for multi-group setups.
- **No API key required on the MCP path:** the bearer token is purely for transport security; the server queries Postgres directly.

---

## Development

```bash
cd mcp-server
npm install
npm run build          # prisma generate + tsup
npm run start:stdio    # test stdio locally
npm run start:http     # test HTTP locally
```
