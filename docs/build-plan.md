# Gemensams — Build Plan

> **Gemensams** — *ekonomi för de med gemensam ekonomi som gör dig transparent.*
> A self-hosted, Swedish-first household expense tracker for a couple with shared finances. Built by forking **Spliit** (MIT). The point is **friction**: logging every purchase + seeing who it belongs to is a deliberate speed bump against unnecessary spending. Not a budgeting/net-worth app — an **attribution + awareness** log with a strong drill-down dashboard.

---

## Context

We're forking the open-source Splitwise-alternative **Spliit** (`github.com/spliit-app/spliit`, **MIT-licensed**) rather than building from scratch, because its *participants + flexible splits* model maps cleanly onto our *owner* model, and it already ships expenses, categories, receipt attachment, recurring expenses, PWA, and Docker compose.

Every expense rolls up to one of four owners — **Hans / Hennes / Gemensamt / Övrigt** (his / hers / ours / others). Two equally-important users:
- **"Christian"-mindset** — automate, fix later (receipt → AI later). 
- **"Fru"-mindset** — no automation, *genuinely fast* manual entry. This is the Phase 1 priority.

**Two AI surfaces (decided this session):**
1. **App-side AI gateway** (Claude/OpenAI) — autonomous, app holds the key. For receipt vision + monthly batch. *(Phase 2/3.)*
2. **MCP server** — exposes the app's operations so the user's **own** Claude (with its built-in routines) can read/check/adjust/complete items directly, **no app-held API key on this path**. This is a first-class requirement and dictates the architecture: **all mutations flow through one shared operation layer** that the web UI, the AI gateway, *and* the MCP server call.

### Locked decisions (brief + this session)
| Topic | Decision |
|---|---|
| Base | Fork Spliit (MIT). Keep app at repo root so Spliit's scripts/Docker work unchanged. |
| Language / locale | **Swedish-first**, `sv-SE`, currency **SEK** (`kr`). New `messages/sv-SE.json` (none exists upstream; 23 other langs do). |
| Owners | His/Hers/Ours/Others = **Hans/Hennes/Gemensamt/Övrigt**, as sugar over `ExpensePaidFor` + `splitMode`. |
| "Övriga" | **Single bucket** participant (expandable later, no migration pain). |
| Auth | **Simple shared password** gate over the whole ledger (in-app). |
| Friction | **Passive only** — fast log + visible attribution is the friction. No flags/caps. |
| Scope now | **Phase 0 only → push to GitHub → PAUSE** for user to deploy. Then Phase 1. Pause again before Phase 2. Phase 3 **planned only**. |
| Deploy target | User self-hosts at **`https://gemensams.krut.it`** (Coolify, from the GitHub repo). |
| GitHub | Repo: **`https://github.com/jensenjr/gemensams`**. Claude commits & pushes (git-credential-manager handles browser auth). `gh` absent. |
| Cadence | **Each build is tested/deployed before the next phase begins.** Push to the same repo each phase so the user can pull + redeploy. |
| Settle-up | Keep in schema, **de-emphasize/hide** in UI. |
| Execution | **Opus plans (this file). Sonnet subagents execute** in batches to control tokens. |

---

## Domain model mapping (the key reframe)

Spliit's Prisma models (confirmed): `Group(currency, currencyCode)`, `Participant(name, groupId)`, `Expense(title, amount[int, minor units], expenseDate, paidById, splitMode, categoryId, notes, recurrenceRule)`, `ExpensePaidFor(expenseId, participantId, shares)`, `Category(grouping, name)`, `ExpenseDocument(url,…)`, `RecurringExpenseLink`, `Activity`.

**Participants in the one household group:** `Christian` (Hans), `Fru` (Hennes), `Övriga` (Övrigt). *(Names editable in-app; owner buttons use role labels, not names.)*

**Owner tag → split (sugar; no new tables):**
| Owner | `paidFor` | `splitMode` |
|---|---|---|
| **Hans** | `[Christian]` | EVENLY |
| **Hennes** | `[Fru]` | EVENLY |
| **Gemensamt** | `[Christian, Fru]` | EVENLY |
| **Övrigt** | `[Övriga]` | EVENLY |

> `paidById` (who *paid*) is attribution-irrelevant for a shared card. Default it to a configurable "shared payer" (first participant) and keep it out of the fast path. **Owner = who it's *for* (`paidFor`)**, surfaced as one tap.

A mixed receipt = **one expense with multiple line items**, each line carrying its own owner tag → Spliit already supports per-expense splits; we expose it as fast owner buttons (Phase 2 UI).

---

## Architecture: one shared operation layer

```
                    ┌───────────────────────────┐
   Web UI (tRPC) ──▶│  src/lib/api.ts            │──▶ Prisma ──▶ Postgres
   MCP server   ──▶│  (domain operations:        │
   AI gateway   ──▶│   createExpense, setOwner,   │   receipts ──▶ MinIO (S3)
   (Phase 2/3)     │   listExpenses, dashboard…)  │
                    └───────────────────────────┘
```
- Reuse/extend Spliit's existing **`src/lib/api.ts`** as the single source of truth for ledger operations. tRPC routers (`src/trpc/routers/*`) call it; the MCP server and AI scripts import the same functions. **No business logic duplicated per surface.**
- Add an **`setOwner(expenseId|draft, owner)`** helper encapsulating the table above — used by web buttons, MCP `set_owner`, and AI suggestions alike.

---

## Repo & git setup (note: `gh` not installed)

1. Clone upstream to a temp dir, then move contents (incl. `.git`) into `I:\git\gemensams`, **preserving `.claude/`** (`git clone .` refuses a non-empty dir).
2. Re-init as **`gemensams`**: reset git history (`git init` fresh), keep upstream **`LICENSE` (MIT) + copyright notice** (MIT requires it), add `NOTICE` crediting Spliit.
3. Rebrand: `package.json` name, app title/metadata, `README.md`, PWA manifest/icons → "Gemensams". Move this plan + the brief into `docs/`.
4. **Push to GitHub:** user supplies an **empty private repo URL**; we `git remote add origin <url>` and push `main`. First push triggers git-credential-manager's browser login (user authorizes once). Sensible `.gitignore` (node_modules, `.env`, `.next`, build artifacts) — **never commit secrets**.

---

## PHASE 0 — Stand it up (vanilla, Swedish, SEK)

**Goal:** stock Spliit running locally + a Coolify-ready compose stack, in Swedish with SEK, one household group seeded, behind a shared-password gate. Verifiable by logging a test expense.

**Sonnet batch 0 tasks:**
1. **Clone + rebrand + git init** (per "Repo & git setup").
2. **Local bring-up:** `./scripts/start-local-db.sh` → `cp .env.example .env` → `npm install` (runs prisma migrate+generate) → `npm run dev`, confirm `http://localhost:3000`.
3. **Locale/currency defaults:** default locale `sv-SE`; currency default **SEK / `kr`**; `sv-SE` number/date formatting. Identify the locale config (`src/lib/locale.ts`, `next.config.mjs`, middleware) and set Swedish as default.
4. **Seed the household group** via a small script/seed: group "Hushållet" (currencyCode `SEK`), participants `Christian`, `Fru`, `Övriga`; seed Swedish category set (see Phase 1 i18n).
5. **Shared-password gate:** Next.js **middleware** checking a session cookie set by a `/login` page that compares against `APP_PASSWORD` (env), signed cookie. Protects all routes except `/login` + static. Minimal, self-contained.
6. **Compose stack** for Coolify: extend `compose.yaml` → `app` (Next.js) + `db` (Postgres, volume) + `minio` (S3, volume) + console; wire `S3_*` envs + `NEXT_PUBLIC_ENABLE_EXPENSE_DOCUMENTS=true` at MinIO; document `container.env`.
7. **Env checklist** in `.env.example`/`container.env.example`: `DATABASE_URL`, `APP_PASSWORD`, `S3_UPLOAD_*` + endpoint, `NEXT_PUBLIC_BASE_URL=https://gemensams.krut.it`. (Anthropic/Google deferred to 2/3.) **No real secrets committed** — only `.example` files.
8. **Commit + push** to the user's private GitHub repo, then **PAUSE**.

**Phase 0 deliverable:** Gemensams runs on localhost (Swedish default, SEK, household group seeded, password-gated, test expense saves) **and is pushed to GitHub**. → **User deploys to `https://gemensams.krut.it`** via Coolify (app+db+minio compose) and confirms it works. **Only then do we start Phase 1.**

---

## PHASE 1 — Reframe to household tracker

**Goal:** both users log & attribute purchases *fast*; settle-up de-emphasized; click a day → every expense + owner breakdown. Swedish throughout.

**Sonnet batch 1 tasks (split across subagents):**

**1a — Swedish i18n.** Create `messages/sv-SE.json` (translate from `en-US.json`; `fi-FI` nearby as structural reference), register the locale, set default. Owner labels **Hans/Hennes/Gemensamt/Övrigt**; Swedish category names; relabel reimbursement/"settle up" strings toward attribution wording.

**1b — Owner-first + fast manual entry** (the wife flow; highest priority). In the expense create/edit form (`src/app/groups/[groupId]/expenses/…`):
- Replace payer+split UI on the fast path with **four big owner buttons** (Hans/Hennes/Gemensamt/Övrigt) driving `setOwner()` → `paidFor`+`splitMode`.
- Minimal fast-entry surface: **belopp (amount) + benämning (label) + owner**, as few taps as possible; sensible defaults (date=today, payer=shared, category optional); large numeric keypad-friendly inputs; submit + "spara och ny".
- Keep the full/advanced form reachable for power edits.

**1c — UI reframe.** Hide/relabel `balances/` + `reimbursement-list.tsx` and "settle up" surfaces. Lead the group page with **spend-by-owner** summary, not balances. Navigation/labels reoriented to attribution.

**1d — Drill-down dashboard** (genuinely new; extend `stats/`). Calendar/time chart of spend → **click a day → list every expense that day + per-owner breakdown**. Filters by **owner / category / date range**. Spend-by-owner totals for the period. Read-only queries added to `src/lib/api.ts` (e.g. `spendByOwner(period)`, `expensesForDay(date)`) so MCP/AI can reuse them.

**Phase 1 deliverable:** fast logging + attribution for both users, attribution-led UI, and a working day-drill-down dashboard. Swedish default.

> **MCP readiness check (end of Phase 1):** confirm every mutation/query above lives in `src/lib/api.ts` (not inline in components/routers), so the Phase 2 MCP server wraps them with zero rewrites. This is the gate before we resume.

---

## PHASE 2 — AI surfaces *(planned now; BUILD ONLY AFTER USER SAYS GO)*

Two parallel workstreams sharing the `src/lib/api.ts` layer:

**2a — MCP server (the priority).** New `mcp-server/` using `@modelcontextprotocol/sdk`, importing `src/lib/api.ts` + Prisma.
- **Tools:** `list_expenses(filters)`, `get_expense(id)`, `create_expense({title,amount,owner,date,category,notes})`, `update_expense(id,…)`, `set_owner(id,owner)`, `delete_expense(id)`, `list_participants`, `list_categories`, `spend_by_owner(period)`, `expenses_for_day(date)`. (Phase 2b adds receipt tools.)
- **Transports:** **stdio** (local Claude Code/desktop) **+ streamable-HTTP** (remote Claude over the Cloudflare Tunnel). HTTP gated by `MCP_AUTH_TOKEN` (bearer) so only the user's Claude can mutate. No Anthropic key needed on this path — the user's Claude brings the intelligence.
- Ship a ready-to-paste MCP client config + a `mcp` service in compose.

**2b — Claude receipts.** Repoint Spliit's existing OpenAI receipt scan/categorize → **Anthropic API** (`ANTHROPIC_API_KEY`). Subagent greps the repo for the OpenAI usage after clone (likely an API route + a `scanReceipt` procedure). A **scheduled script** (Coolify scheduled task / cron container, 1–2×/day) reads expenses with an un-interpreted `ExpenseDocument` from MinIO → Claude vision + free-text note parsing → writes **suggested** owner-tagged line items at status `needs-review`. **In-app review queue** to confirm/correct. (Add a lightweight `status`/review flag — smallest schema touch.)

**Phase 2 deliverable:** snap a receipt → scheduled run interprets it into owner-tagged line items in a review queue; **and** the user's Claude can directly query/adjust/complete items in the app via MCP.

---

## PHASE 3 — Monthly CSV batch *(planned only; needs sample data before build)*

**Inputs (from user):** bank export is **CSV, one per account, several accounts to compile**. Shared-account users also have a **shared card → that's where daily expenses land**.

**Design:**
- **Import page** (in-app, zero Google dependency) accepting **multiple CSV uploads** → MinIO/temp. *(Drive-inbox alternative deferred.)*
- **Normalizer** per bank-CSV schema (columns vary by bank) → canonical rows. **Shared-card** rows default owner = **Gemensamt**; account-specific rows hint Hans/Hennes.
- **Reconcile** against existing expenses (dedupe vs already-logged manual/receipt entries — match on date+amount±, fuzzy title).
- **Claude attribute/categorize** the un-reconciled remainder → owner + category (may warrant an agentic `claude -p` run for monthly judgment).
- **Review queue** → confirm → insert into Postgres → feeds dashboard.

**Phase 3 prerequisites (collect before building):** 1–2 **real sample CSVs** per bank/account (headers + a few rows, anonymized) to write the parser; confirm in-app import vs Google Drive inbox.

---

## Subagent execution model (token control)

- **Opus** = this plan + review gates + the OpenAI→Claude swap design + Phase 3 reconciliation logic.
- **Sonnet subagents** = volume work, one focused batch at a time, each with explicit scope + "discover exact file paths after clone via grep" instructions (so they don't guess upstream paths):
  - **Batch 0:** clone/rebrand/git, local bring-up, locale+SEK, seed group, password gate, compose stack → **push to GitHub → PAUSE** (user deploys to gemensams.krut.it & confirms).
  - **Batch 1 (after deploy confirmed; parallelizable):** `1a` i18n · `1b` owner-first fast entry · `1c` reframe · `1d` dashboard → push → user redeploys & tests.
  - **Batch 2 (after explicit GO):** `2a` MCP server · `2b` Claude receipts + review queue.
- **Test/deploy-verify after every batch before starting the next** — this is the user's required cadence.

---

## Verification

- **Phase 0:** `npm run dev` boots; UI is Swedish; new expense defaults to SEK; the household group shows Christian/Fru/Övriga; visiting any route unauthenticated redirects to `/login`; correct password lets a test expense save. `docker compose up` brings app+db+minio healthy.
- **Phase 1:** Create an expense in ≤3 taps via owner buttons; verify `Gemensamt` writes an even Christian+Fru split, `Hans` writes 100% Christian (inspect via UI + DB). Balances/settle-up not surfaced on main flow. Dashboard: pick a date range, click a day, see that day's expenses + per-owner totals; filter by owner/category. Use the Claude Preview MCP (`preview_start`/`preview_screenshot`/`preview_click`) to drive the running app and screenshot the fast-entry + drill-down flows.
- **Phase 2 (later):** From a Claude client, point at the MCP server and run `create_expense` + `set_owner` + `spend_by_owner`; confirm rows appear in the web UI. Receipt: upload an image, run the scheduled script, confirm `needs-review` line items appear in the queue.

---

## Open items
- **Phase 3:** sample CSVs per bank/account; in-app import vs Google Drive inbox.
- **Deploy:** Coolify wiring + Cloudflare Tunnel are user-side ops (we provide compose + env templates + the remote-MCP token). `gh` absent → user attaches the GitHub remote.
- Participant display names (`Christian`/`Fru`) are placeholders — editable in-app.
