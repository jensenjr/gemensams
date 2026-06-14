/**
 * All Gemensams MCP tool definitions.
 *
 * Amounts:
 *   - DB stores integers in minor units (öre for SEK, cents for USD, etc.)
 *   - MCP inputs accept amounts in MAJOR units (SEK, USD) — we multiply by 100 on write
 *   - MCP outputs include both the raw integer (öre) and a formatted string (SEK)
 *
 * Owner:
 *   - A participant id string, or the literal 'gemensamt' for shared/all-participants
 *   - Resolved to paidFor + splitMode via ownerToSplit (mirrors src/lib/owners.ts)
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { SplitMode } from '@prisma/client'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { getPrisma } from './db.js'
import {
  GEMENSAMT,
  ownerFromExpense,
  ownerToSplit,
  type OwnerParticipant,
} from './owners.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getGroupId(): string {
  return process.env['GEMENSAMS_GROUP_ID'] ?? 'hushallet'
}

function randomId(): string {
  return randomUUID().replace(/-/g, '').slice(0, 21)
}

/** Convert minor units → "123.45 SEK" style string */
function formatAmount(minorUnits: number, currency?: string | null): string {
  const major = minorUnits / 100
  const curr = currency ?? 'SEK'
  return `${major.toFixed(2)} ${curr}`
}

async function getGroupWithParticipants() {
  const prisma = getPrisma()
  const groupId = getGroupId()
  const group = await prisma.group.findUnique({
    where: { id: groupId },
    include: { participants: true },
  })
  if (!group) throw new Error(`Group not found: ${groupId}`)
  return group
}

function buildExpenseOutput(
  expense: {
    id: string
    title: string
    amount: number
    expenseDate: Date
    notes: string | null
    splitMode: SplitMode
    isReimbursement: boolean
    paidBy?: { id: string; name: string } | null
    paidById?: string
    paidFor: Array<{ participantId?: string; participant?: { id: string; name: string } }>
    category?: { id: number; name: string; grouping: string } | null
  },
  participants: OwnerParticipant[],
  currency?: string | null,
) {
  const paidForIds = expense.paidFor.map((pf) =>
    pf.participantId ?? pf.participant?.id ?? '',
  )
  const owner = ownerFromExpense(participants, paidForIds)

  return {
    id: expense.id,
    title: expense.title,
    amount_ore: expense.amount,
    amount_formatted: formatAmount(expense.amount, currency),
    date: expense.expenseDate.toISOString().slice(0, 10),
    owner,
    owner_label:
      owner === GEMENSAMT
        ? 'Gemensamt'
        : participants.find((p) => p.id === owner)?.name ?? owner,
    paidBy: expense.paidBy
      ? { id: expense.paidBy.id, name: expense.paidBy.name }
      : { id: expense.paidById ?? '', name: '' },
    category: expense.category
      ? { id: expense.category.id, name: expense.category.name, grouping: expense.category.grouping }
      : null,
    splitMode: expense.splitMode,
    isReimbursement: expense.isReimbursement,
    notes: expense.notes ?? null,
  }
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

export function registerTools(server: McpServer): void {
  // ------------------------------------------------------------------
  // get_group — orientation: group name, participants, currency
  // ------------------------------------------------------------------
  server.registerTool(
    'get_group',
    {
      title: 'Get Group',
      description:
        'Returns the household group info: name, currency, participants list. ' +
        'Call this first in a fresh session to get participant IDs needed for owner fields.',
      inputSchema: {},
    },
    async () => {
      const group = await getGroupWithParticipants()
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              id: group.id,
              name: group.name,
              currency: group.currency,
              currencyCode: group.currencyCode ?? 'SEK',
              participants: group.participants.map((p) => ({
                id: p.id,
                name: p.name,
              })),
              ownerNote:
                'Use a participant id or "gemensamt" (shared) as the owner field.',
            }),
          },
        ],
      }
    },
  )

  // ------------------------------------------------------------------
  // list_participants
  // ------------------------------------------------------------------
  server.registerTool(
    'list_participants',
    {
      title: 'List Participants',
      description: 'Returns all participants in the household (id + name). ' +
        'Use participant ids as owner values in expense tools.',
      inputSchema: {},
    },
    async () => {
      const group = await getGroupWithParticipants()
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              group.participants.map((p) => ({ id: p.id, name: p.name })),
            ),
          },
        ],
      }
    },
  )

  // ------------------------------------------------------------------
  // list_categories
  // ------------------------------------------------------------------
  server.registerTool(
    'list_categories',
    {
      title: 'List Categories',
      description: 'Returns all expense categories (id, name, grouping).',
      inputSchema: {},
    },
    async () => {
      const prisma = getPrisma()
      const categories = await prisma.category.findMany({
        orderBy: [{ grouping: 'asc' }, { name: 'asc' }],
      })
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(categories),
          },
        ],
      }
    },
  )

  // ------------------------------------------------------------------
  // list_expenses
  // ------------------------------------------------------------------
  server.registerTool(
    'list_expenses',
    {
      title: 'List Expenses',
      description:
        'Returns a filtered list of expenses, each annotated with owner, ' +
        'formatted amount, date and category. ' +
        'Dates are ISO strings (YYYY-MM-DD). ' +
        'Amounts are returned in both minor units (öre) and formatted (e.g. "12.50 SEK"). ' +
        'Owner is a participant id or "gemensamt".',
      inputSchema: {
        from: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .describe('Start date (YYYY-MM-DD, inclusive)'),
        to: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .describe('End date (YYYY-MM-DD, inclusive)'),
        owner: z
          .string()
          .optional()
          .describe('Filter by owner: participant id or "gemensamt"'),
        categoryId: z
          .number()
          .int()
          .optional()
          .describe('Filter by category id'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(500)
          .default(50)
          .describe('Max number of expenses to return (default 50, max 500)'),
      },
    },
    async ({ from, to, owner, categoryId, limit = 50 }) => {
      const prisma = getPrisma()
      const group = await getGroupWithParticipants()

      const fromDate = from ? new Date(from + 'T00:00:00.000Z') : undefined
      const toDate = to ? new Date(to + 'T00:00:00.000Z') : undefined

      const expenses = await prisma.expense.findMany({
        where: {
          groupId: group.id,
          ...(fromDate || toDate
            ? {
                expenseDate: {
                  ...(fromDate ? { gte: fromDate } : {}),
                  ...(toDate ? { lte: toDate } : {}),
                },
              }
            : {}),
          ...(categoryId !== undefined ? { categoryId } : {}),
        },
        include: {
          paidBy: true,
          paidFor: { include: { participant: true } },
          category: true,
        },
        orderBy: [{ expenseDate: 'desc' }, { createdAt: 'desc' }],
        take: limit,
      })

      let results = expenses.map((e) =>
        buildExpenseOutput(
          {
            ...e,
            paidFor: e.paidFor.map((pf) => ({
              participantId: pf.participantId,
              participant: pf.participant,
            })),
          },
          group.participants,
          group.currency,
        ),
      )

      // Filter by owner after derivation (owner is computed, not stored directly)
      if (owner !== undefined) {
        results = results.filter((r) => r.owner === owner)
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ count: results.length, expenses: results }),
          },
        ],
      }
    },
  )

  // ------------------------------------------------------------------
  // get_expense
  // ------------------------------------------------------------------
  server.registerTool(
    'get_expense',
    {
      title: 'Get Expense',
      description: 'Returns a single expense by id, with full details including owner, amount, category, notes.',
      inputSchema: {
        id: z.string().describe('Expense id'),
      },
    },
    async ({ id }) => {
      const prisma = getPrisma()
      const group = await getGroupWithParticipants()

      const expense = await prisma.expense.findUnique({
        where: { id },
        include: {
          paidBy: true,
          paidFor: { include: { participant: true } },
          category: true,
        },
      })

      if (!expense || expense.groupId !== group.id) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: `Expense not found: ${id}` }) }],
          isError: true,
        }
      }

      const result = buildExpenseOutput(
        {
          ...expense,
          paidFor: expense.paidFor.map((pf) => ({
            participantId: pf.participantId,
            participant: pf.participant,
          })),
        },
        group.participants,
        group.currency,
      )

      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
      }
    },
  )

  // ------------------------------------------------------------------
  // create_expense
  // ------------------------------------------------------------------
  server.registerTool(
    'create_expense',
    {
      title: 'Create Expense',
      description:
        'Creates a new expense. ' +
        'amount is in major currency units (SEK), e.g. 49.90 — it is converted to öre internally. ' +
        'owner is a participant id or "gemensamt" (shared); determines paidFor and splitMode. ' +
        'The payer (paidBy) defaults to the owner if the owner is a participant, ' +
        'otherwise defaults to the first participant.',
      inputSchema: {
        title: z.string().min(1).describe('Expense title'),
        amount: z
          .number()
          .positive()
          .describe('Amount in major currency units (e.g. 49.90 SEK)'),
        owner: z
          .string()
          .describe('Owner: participant id or "gemensamt"'),
        date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .describe('Date YYYY-MM-DD (defaults to today)'),
        categoryId: z
          .number()
          .int()
          .optional()
          .default(0)
          .describe('Category id (0 = uncategorized)'),
        notes: z.string().optional().describe('Optional notes'),
      },
    },
    async ({ title, amount, owner, date, categoryId = 0, notes }) => {
      const prisma = getPrisma()
      const group = await getGroupWithParticipants()

      const split = ownerToSplit(group.participants, owner)

      // paidBy: if owner is a specific participant, they pay; otherwise first participant
      const paidById =
        owner !== GEMENSAMT && group.participants.some((p) => p.id === owner)
          ? owner
          : (group.participants[0]?.id ?? '')

      if (!paidById) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: 'Group has no participants' }) }],
          isError: true,
        }
      }

      const expenseDate = date
        ? new Date(date + 'T00:00:00.000Z')
        : new Date(
            Date.UTC(
              new Date().getUTCFullYear(),
              new Date().getUTCMonth(),
              new Date().getUTCDate(),
            ),
          )

      const amountOre = Math.round(amount * 100)

      const expense = await prisma.expense.create({
        data: {
          id: randomId(),
          groupId: group.id,
          title,
          amount: amountOre,
          expenseDate,
          categoryId,
          paidById,
          splitMode: split.splitMode,
          recurrenceRule: 'NONE',
          isReimbursement: false,
          notes: notes ?? null,
          paidFor: {
            createMany: {
              data: split.paidFor.map((pf) => ({
                participantId: pf.participant,
                shares: parseInt(pf.shares, 10),
              })),
            },
          },
        },
        include: {
          paidBy: true,
          paidFor: { include: { participant: true } },
          category: true,
        },
      })

      const result = buildExpenseOutput(
        {
          ...expense,
          paidFor: expense.paidFor.map((pf) => ({
            participantId: pf.participantId,
            participant: pf.participant,
          })),
        },
        group.participants,
        group.currency,
      )

      return {
        content: [{ type: 'text', text: JSON.stringify({ created: true, expense: result }) }],
      }
    },
  )

  // ------------------------------------------------------------------
  // update_expense
  // ------------------------------------------------------------------
  server.registerTool(
    'update_expense',
    {
      title: 'Update Expense',
      description:
        'Updates an existing expense. Only provided fields are changed. ' +
        'amount is in major currency units (SEK). ' +
        'If owner is provided it recomputes paidFor + splitMode. ' +
        'To change only the owner, prefer set_owner.',
      inputSchema: {
        id: z.string().describe('Expense id to update'),
        title: z.string().min(1).optional().describe('New title'),
        amount: z.number().positive().optional().describe('New amount in major units (SEK)'),
        owner: z.string().optional().describe('New owner: participant id or "gemensamt"'),
        date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .describe('New date YYYY-MM-DD'),
        categoryId: z.number().int().optional().describe('New category id'),
        notes: z.string().nullable().optional().describe('New notes (null to clear)'),
      },
    },
    async ({ id, title, amount, owner, date, categoryId, notes }) => {
      const prisma = getPrisma()
      const group = await getGroupWithParticipants()

      const existing = await prisma.expense.findUnique({
        where: { id },
        include: { paidFor: true },
      })
      if (!existing || existing.groupId !== group.id) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: `Expense not found: ${id}` }) }],
          isError: true,
        }
      }

      // Build paidFor update if owner is changing
      let paidForUpdate: object | undefined
      let splitModeUpdate: SplitMode | undefined
      let paidByIdUpdate: string | undefined

      if (owner !== undefined) {
        const split = ownerToSplit(group.participants, owner)
        splitModeUpdate = split.splitMode
        paidByIdUpdate =
          owner !== GEMENSAMT && group.participants.some((p) => p.id === owner)
            ? owner
            : existing.paidById

        const newParticipantIds = split.paidFor.map((pf) => pf.participant)
        const oldParticipantIds = existing.paidFor.map((pf) => pf.participantId)

        paidForUpdate = {
          // Delete removed participants
          deleteMany: oldParticipantIds
            .filter((pid) => !newParticipantIds.includes(pid))
            .map((participantId) => ({ expenseId: id, participantId })),
          // Upsert new ones
          upsert: split.paidFor.map((pf) => ({
            where: {
              expenseId_participantId: { expenseId: id, participantId: pf.participant },
            },
            create: { participantId: pf.participant, shares: parseInt(pf.shares, 10) },
            update: { shares: parseInt(pf.shares, 10) },
          })),
        }
      }

      const expense = await prisma.expense.update({
        where: { id },
        data: {
          ...(title !== undefined ? { title } : {}),
          ...(amount !== undefined ? { amount: Math.round(amount * 100) } : {}),
          ...(date !== undefined ? { expenseDate: new Date(date + 'T00:00:00.000Z') } : {}),
          ...(categoryId !== undefined ? { categoryId } : {}),
          ...(notes !== undefined ? { notes } : {}),
          ...(splitModeUpdate !== undefined ? { splitMode: splitModeUpdate } : {}),
          ...(paidByIdUpdate !== undefined ? { paidById: paidByIdUpdate } : {}),
          ...(paidForUpdate !== undefined ? { paidFor: paidForUpdate } : {}),
        },
        include: {
          paidBy: true,
          paidFor: { include: { participant: true } },
          category: true,
        },
      })

      const result = buildExpenseOutput(
        {
          ...expense,
          paidFor: expense.paidFor.map((pf) => ({
            participantId: pf.participantId,
            participant: pf.participant,
          })),
        },
        group.participants,
        group.currency,
      )

      return {
        content: [{ type: 'text', text: JSON.stringify({ updated: true, expense: result }) }],
      }
    },
  )

  // ------------------------------------------------------------------
  // set_owner — re-attribute an expense to a different owner
  // ------------------------------------------------------------------
  server.registerTool(
    'set_owner',
    {
      title: 'Set Owner',
      description:
        'Re-attributes an expense to a different owner (participant id or "gemensamt"). ' +
        'Recomputes paidFor and splitMode; updates paidBy if the new owner is a specific participant.',
      inputSchema: {
        id: z.string().describe('Expense id'),
        owner: z.string().describe('New owner: participant id or "gemensamt"'),
      },
    },
    async ({ id, owner }) => {
      const prisma = getPrisma()
      const group = await getGroupWithParticipants()

      const existing = await prisma.expense.findUnique({
        where: { id },
        include: { paidFor: true },
      })
      if (!existing || existing.groupId !== group.id) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: `Expense not found: ${id}` }) }],
          isError: true,
        }
      }

      const split = ownerToSplit(group.participants, owner)
      const paidById =
        owner !== GEMENSAMT && group.participants.some((p) => p.id === owner)
          ? owner
          : existing.paidById

      const newParticipantIds = split.paidFor.map((pf) => pf.participant)
      const oldParticipantIds = existing.paidFor.map((pf) => pf.participantId)

      const expense = await prisma.expense.update({
        where: { id },
        data: {
          splitMode: split.splitMode,
          paidById,
          paidFor: {
            deleteMany: oldParticipantIds
              .filter((pid) => !newParticipantIds.includes(pid))
              .map((participantId) => ({ expenseId: id, participantId })),
            upsert: split.paidFor.map((pf) => ({
              where: {
                expenseId_participantId: { expenseId: id, participantId: pf.participant },
              },
              create: { participantId: pf.participant, shares: parseInt(pf.shares, 10) },
              update: { shares: parseInt(pf.shares, 10) },
            })),
          },
        },
        include: {
          paidBy: true,
          paidFor: { include: { participant: true } },
          category: true,
        },
      })

      const result = buildExpenseOutput(
        {
          ...expense,
          paidFor: expense.paidFor.map((pf) => ({
            participantId: pf.participantId,
            participant: pf.participant,
          })),
        },
        group.participants,
        group.currency,
      )

      return {
        content: [{ type: 'text', text: JSON.stringify({ updated: true, expense: result }) }],
      }
    },
  )

  // ------------------------------------------------------------------
  // delete_expense
  // ------------------------------------------------------------------
  server.registerTool(
    'delete_expense',
    {
      title: 'Delete Expense',
      description: 'Permanently deletes an expense by id.',
      inputSchema: {
        id: z.string().describe('Expense id to delete'),
      },
    },
    async ({ id }) => {
      const prisma = getPrisma()
      const group = await getGroupWithParticipants()

      const existing = await prisma.expense.findUnique({ where: { id } })
      if (!existing || existing.groupId !== group.id) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: `Expense not found: ${id}` }) }],
          isError: true,
        }
      }

      await prisma.expense.delete({ where: { id } })

      return {
        content: [{ type: 'text', text: JSON.stringify({ deleted: true, id }) }],
      }
    },
  )

  // ------------------------------------------------------------------
  // spend_by_owner
  // ------------------------------------------------------------------
  server.registerTool(
    'spend_by_owner',
    {
      title: 'Spend by Owner',
      description:
        'Returns total spending per owner over an optional date/category range. ' +
        'Reimbursements are excluded. ' +
        'Keys are participant ids, "gemensamt", and "grandTotal". ' +
        'Amounts are in minor units (öre) and also formatted.',
      inputSchema: {
        from: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .describe('Start date YYYY-MM-DD (inclusive)'),
        to: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .describe('End date YYYY-MM-DD (inclusive)'),
        categoryId: z.number().int().optional().describe('Filter by category id'),
      },
    },
    async ({ from, to, categoryId }) => {
      const prisma = getPrisma()
      const group = await getGroupWithParticipants()

      const fromDate = from ? new Date(from + 'T00:00:00.000Z') : undefined
      const toDate = to ? new Date(to + 'T00:00:00.000Z') : undefined

      const expenses = await prisma.expense.findMany({
        where: {
          groupId: group.id,
          isReimbursement: false,
          ...(fromDate || toDate
            ? {
                expenseDate: {
                  ...(fromDate ? { gte: fromDate } : {}),
                  ...(toDate ? { lte: toDate } : {}),
                },
              }
            : {}),
          ...(categoryId !== undefined ? { categoryId } : {}),
        },
        select: {
          amount: true,
          isReimbursement: true,
          paidFor: { select: { participant: { select: { id: true, name: true } } } },
        },
      })

      const totals: Record<string, number> = { grandTotal: 0 }
      for (const p of group.participants) totals[p.id] = 0
      totals[GEMENSAMT] = 0

      for (const e of expenses) {
        const owner = ownerFromExpense(
          group.participants,
          e.paidFor.map((pf) => pf.participant.id),
        )
        totals[owner] = (totals[owner] ?? 0) + e.amount
        totals.grandTotal += e.amount
      }

      // Build human-readable output
      const formatted: Record<string, { ore: number; formatted: string }> = {}
      for (const [key, value] of Object.entries(totals)) {
        formatted[key] = {
          ore: value,
          formatted: formatAmount(value, group.currency),
        }
      }

      // Add participant names for readability
      const ownerNames: Record<string, string> = { gemensamt: 'Gemensamt', grandTotal: 'Grand Total' }
      for (const p of group.participants) ownerNames[p.id] = p.name

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              ownerNames,
              totals: formatted,
              currency: group.currency,
              filters: { from, to, categoryId },
            }),
          },
        ],
      }
    },
  )

  // ------------------------------------------------------------------
  // expenses_for_day
  // ------------------------------------------------------------------
  server.registerTool(
    'expenses_for_day',
    {
      title: 'Expenses for Day',
      description: 'Returns all expenses on a specific calendar day (UTC), each with owner annotation.',
      inputSchema: {
        date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .describe('Date to query (YYYY-MM-DD)'),
      },
    },
    async ({ date }) => {
      const prisma = getPrisma()
      const group = await getGroupWithParticipants()

      const dayStart = new Date(date + 'T00:00:00.000Z')
      const dayEnd = new Date(date + 'T00:00:00.000Z')
      dayEnd.setUTCDate(dayEnd.getUTCDate() + 1)

      const expenses = await prisma.expense.findMany({
        where: {
          groupId: group.id,
          expenseDate: { gte: dayStart, lt: dayEnd },
        },
        include: {
          paidBy: true,
          paidFor: { include: { participant: true } },
          category: true,
        },
        orderBy: [{ expenseDate: 'asc' }, { id: 'asc' }],
      })

      const results = expenses.map((e) =>
        buildExpenseOutput(
          {
            ...e,
            paidFor: e.paidFor.map((pf) => ({
              participantId: pf.participantId,
              participant: pf.participant,
            })),
          },
          group.participants,
          group.currency,
        ),
      )

      const dayTotal = results.reduce((sum, e) => sum + e.amount_ore, 0)

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              date,
              count: results.length,
              day_total_ore: dayTotal,
              day_total_formatted: formatAmount(dayTotal, group.currency),
              expenses: results,
            }),
          },
        ],
      }
    },
  )
}
