# Household Ekonomi Tracker — Claude Code Build Brief

**Purpose of this file:** project kickoff for Claude Code. Read top to bottom, then start at Phase 0. Decisions are locked unless listed under *Open Decisions*.

---

## 1. What we're building

A self-hosted household expense tracker for two people (Christian + wife). The core point is **friction**: manually logging purchases (and seeing who they belong to) is a deliberate speed bump against unnecessary spending. Not a budgeting/net-worth app — an attribution + awareness log with a good drill-down dashboard.

Every expense rolls up to one of four owners: **his / hers / ours / others**.

Two user mindsets must both be first-class:
- **Christian** — automate, fix later. Snap a receipt → AI reads line items → assign owners afterward. Or attach receipt + free-text note ("chips, beer, game = mine; food = ours") and let AI split it. *(Phase 2.)*
- **Wife** — no automation. Fast manual entry: what it was + what it cost. *(Phase 1, must be genuinely quick.)*

---

## 2. Base repo (do not start from scratch)

**Fork:** `https://github.com/spliit-app/spliit` (canonical). A Splitwise-style open-source expense splitter.

**Stack:** Next.js (App Router) · TypeScript · tRPC · Prisma · PostgreSQL · Tailwind + shadcn/ui · PWA. Docker/compose deployment supported.

**Why Spliit:** its participant + split model maps directly onto our owner model, and it already ships the receipt→AI pipeline we want in Phase 2 (currently OpenAI — we repoint to Claude). License: verify in the repo before any redistribution.

---

## 3. Locked decisions

- Shared single household ledger; every expense tagged with an owner (his/hers/ours/others).
- React/JS stack (Spliit fits).
- AI receipts are **Phase 2** — manual entry + dashboard must be solid first.
- Host on **Coolify** via docker compose; **Claude** (Anthropic API) and **Google** as backend services.
- Currency default **SEK**, locale **sv-SE** (confirm).

---

## 4. Domain model mapping (the key reframe)

Spliit thinks in *participants* and *splits*. We exploit that instead of adding new tables.

Fixed participant set in the one household group:
- `Christian` (his)
- `Wife` (hers)
- `Others` (third parties — kids, a friend covered, reimbursables)

Owner tag → split logic:
| Owner tag | Split |
|-----------|-------|
| **His**   | 100% → Christian |
| **Hers**  | 100% → Wife |
| **Ours**  | even split Christian + Wife |
| **Others**| 100% → Others (or a named third party) |

So "owner" is sugar over Spliit's existing split engine. A single receipt with mixed ownership becomes one expense with **multiple line items**, each line carrying its own owner tag (Spliit already supports per-expense splits; we expose it as fast owner buttons).

The "settle up / who owes whom" machinery stays in the schema but gets **de-emphasized in the UI** — we're tracking attribution, not reimbursements.

---

## 5. What Spliit already gives us (don't rebuild)

- Participants, expenses, flexible splits (equal / shares / percentage / exact amount).
- Categories + filtering.
- Receipt image attachment (currently via S3 / `next-s3-upload`).
- Receipt **scan-to-expense** + category suggestion (currently OpenAI — repoint in Phase 2).
- Recurring expenses.
- PWA (works on phones — good for in-the-moment manual entry).
- Docker / docker-compose.

## 6. What we build / change (the differentiators)

1. **Owner-first UX** — fixed participants + one-tap his/hers/ours/others on each line. Fast.
2. **Manual-entry-fast path** — minimal-friction-to-*log*, high-friction-to-*spend*: amount + label + owner in as few taps as possible (wife's flow).
3. **Reframe UI** — hide/relabel reimbursement/"settle up" surfaces; lead with spend-by-owner.
4. **Drill-down dashboard** — calendar/time chart → click a day → list every expense + owner breakdown for that day. Filters by owner / category / date range. (Spliit's native reporting is balance-oriented, so this is genuinely new.)
5. **Phase 2 — Claude receipts** — swap OpenAI → Anthropic API for scan + categorization; add line-item interpretation, post-hoc owner assignment UI, and free-text comment splitting.
6. **Phase 3 — monthly Claude batch** — ingest bank export (+ other docs) → normalize/categorize/attribute via Claude → review queue → insert into Postgres → feeds the dashboard.

Optional friction add-ons (decide later): a "necessary?" flag per expense, or a soft monthly cap warning per owner.

---

## 7. Hosting / infra (Coolify)

docker compose services:
- `app` — the forked Next.js Spliit.
- `db` — PostgreSQL (persistent volume).
- `minio` — S3-compatible object store for receipts (replaces AWS S3; set the `S3_*` / `NEXT_PUBLIC_ENABLE_EXPENSE_DOCUMENTS` envs at it). Alternative: local-volume upload adapter.

Auth: rather than building app-level login, gate the app behind **Cloudflare Access** on the existing Cloudflare Tunnel (fits current infra, two allow-listed Google identities). Confirm in Open Decisions.

Env / secrets checklist:
- `DATABASE_URL`
- `ANTHROPIC_API_KEY` (Phase 2/3)
- Google service-account creds — **Drive monthly-inbox only** (Phase 3); not used for receipts
- `S3_UPLOAD_KEY` / `S3_UPLOAD_SECRET` / endpoint (MinIO) + `NEXT_PUBLIC_ENABLE_EXPENSE_DOCUMENTS=true`
- `NEXT_PUBLIC_BASE_URL` / app URL

### Automation runtime & triggers
The "Claude routine" is a **scheduled script that calls the Anthropic API**, not a Claude Code agent on a timer. Build and maintain it *with* Claude Code; run it as a **Coolify scheduled task** (or a small cron container), 1–2×/day.

- **Receipt processing (Phase 2)** reads the app's *own* store — no Google Drive. It queries Postgres for expenses with an un-interpreted receipt, pulls the image from MinIO, runs Claude vision + comment parsing, writes back line items with **suggested** owners at status `needs-review`. Christian confirms in-app.
- **Monthly batch (Phase 3)** reads a **Google Drive folder** (service account) as the collaborative inbox for bank exports + misc docs. (Alternative: an in-app import page → MinIO, if you want zero Google dependency.)
- **Trigger = scheduled** by default (matches "1–2×/day", robust, no live endpoint). Optional upgrade: a **MinIO bucket-create webhook** for near-instant receipt processing — add only if the daily delay bugs you. Avoid Drive push channels (they expire and need renewal).

---

## 8. Phased execution plan

**Phase 0 — Stand it up (vanilla)**
Fork, clone, run locally, then deploy unmodified Spliit on Coolify (app + Postgres + MinIO), behind Cloudflare Access. Create the single household group with participants Christian / Wife / Others. Set SEK + sv-SE.
*Deliverable:* working stock Spliit on your domain, logging a test expense.

**Phase 1 — Reframe to household tracker**
Owner-first UX + fast manual entry + UI reframe + the day drill-down dashboard.
*Deliverable:* both of you can log and attribute purchases fast, and click a day to see all expenses + owner split.

**Phase 2 — Claude receipts**
Repoint scan/categorize OpenAI→Anthropic. Scheduled script reads un-interpreted receipts from MinIO, parses line items + the free-text comment, writes **suggested** owners as `needs-review`. Build an in-app review queue to confirm/correct ownership.
*Deliverable:* snap a receipt → a scheduled run interprets it into owner-tagged line items waiting in your review queue.

**Phase 3 — Monthly Claude batch**
Scheduled script reads bank export + docs from the Drive inbox → Claude normalize/categorize/attribute → reconcile against existing expenses → review queue → Postgres → dashboard. This step may warrant an agentic `claude -p` run if reconciliation needs judgment each time.
*Deliverable:* one monthly run reconciles the month into the dashboard with a human review step.

---

## 9. Suggested model usage in Claude Code

- **Opus** (architecture / judgment): data-model reframe (§4), dashboard design, the OpenAI→Claude provider swap, the batch reconciliation/attribution logic.
- **Sonnet** (volume work): CRUD, shadcn UI components, i18n/labels, env wiring, docker compose, tests, styling, config.

---

## 10. Open decisions (answer before or during the build)

1. **Google's role — DECIDED:** Drive folder as the Phase-3 monthly-document inbox only (service account, read on schedule). *Not* used for receipts (those stay in MinIO) and *not* Google Vision (Claude does vision). In-app login is handled by Cloudflare Access, not Google OAuth.
2. **Auth** — Cloudflare Access (recommended, fits your infra) vs app-level login?
3. **Receipt storage** — MinIO container (recommended) vs local-volume adapter?
4. **Bank export format** — which bank, and what does it export (CSV / CAMT.053 / OFX)? Drives the Phase 3 parser.
5. **"Others" granularity** — one bucket, or multiple named third parties?
6. **Friction** — passive (manual logging only), or add the "necessary?" flag / monthly cap warnings?
7. **Confirm** SEK + sv-SE.

---

## 11. First commands (Phase 0)

```bash
# fork on GitHub first, then:
git clone https://github.com/<you>/spliit && cd spliit
./scripts/start-local-db.sh        # local Postgres for dev
npm install                        # also runs prisma migrate + generate
cp .env.example .env               # fill DATABASE_URL etc.
npm run dev                        # http://localhost:3000
```

Then containerize for Coolify (app + db + minio compose) and wire Cloudflare Tunnel/Access.
