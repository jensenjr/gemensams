import { AccountKind, AccountRecord } from '@/lib/accounts'
import { GEMENSAMT, Owner, ownerFromExpense } from '@/lib/owners'
import { prisma } from '@/lib/prisma'
import { ExpenseFormValues, GroupFormValues } from '@/lib/schemas'
import {
  ActivityType,
  Expense,
  RecurrenceRule,
  RecurringExpenseLink,
} from '@prisma/client'
import { nanoid } from 'nanoid'

export function randomId() {
  return nanoid()
}

export async function createGroup(groupFormValues: GroupFormValues) {
  return prisma.group.create({
    data: {
      id: randomId(),
      name: groupFormValues.name,
      information: groupFormValues.information,
      currency: groupFormValues.currency,
      currencyCode: groupFormValues.currencyCode,
      participants: {
        createMany: {
          data: groupFormValues.participants.map(({ name }) => ({
            id: randomId(),
            name,
          })),
        },
      },
    },
    include: { participants: true },
  })
}

export async function createExpense(
  expenseFormValues: ExpenseFormValues,
  groupId: string,
  participantId?: string,
): Promise<Expense> {
  const group = await getGroup(groupId)
  if (!group) throw new Error(`Invalid group ID: ${groupId}`)

  for (const participant of [
    expenseFormValues.paidBy,
    ...expenseFormValues.paidFor.map((p) => p.participant),
  ]) {
    if (!group.participants.some((p) => p.id === participant))
      throw new Error(`Invalid participant ID: ${participant}`)
  }

  const expenseId = randomId()
  await logActivity(groupId, ActivityType.CREATE_EXPENSE, {
    participantId,
    expenseId,
    data: expenseFormValues.title,
  })

  const isCreateRecurrence =
    expenseFormValues.recurrenceRule !== RecurrenceRule.NONE
  const recurringExpenseLinkPayload = createPayloadForNewRecurringExpenseLink(
    expenseFormValues.recurrenceRule as RecurrenceRule,
    expenseFormValues.expenseDate,
    groupId,
  )

  return prisma.expense.create({
    data: {
      id: expenseId,
      groupId,
      expenseDate: expenseFormValues.expenseDate,
      categoryId: expenseFormValues.category,
      amount: expenseFormValues.amount,
      originalAmount: expenseFormValues.originalAmount,
      originalCurrency: expenseFormValues.originalCurrency,
      conversionRate: expenseFormValues.conversionRate,
      title: expenseFormValues.title,
      paidById: expenseFormValues.paidBy,
      splitMode: expenseFormValues.splitMode,
      recurrenceRule: expenseFormValues.recurrenceRule,
      recurringExpenseLink: {
        ...(isCreateRecurrence
          ? {
              create: recurringExpenseLinkPayload,
            }
          : {}),
      },
      paidFor: {
        createMany: {
          data: expenseFormValues.paidFor.map((paidFor) => ({
            participantId: paidFor.participant,
            shares: paidFor.shares,
          })),
        },
      },
      isReimbursement: expenseFormValues.isReimbursement,
      documents: {
        createMany: {
          data: expenseFormValues.documents.map((doc) => ({
            id: randomId(),
            url: doc.url,
            width: doc.width,
            height: doc.height,
          })),
        },
      },
      notes: expenseFormValues.notes,
    },
  })
}

export async function deleteExpense(
  groupId: string,
  expenseId: string,
  participantId?: string,
) {
  const existingExpense = await getExpense(groupId, expenseId)
  await logActivity(groupId, ActivityType.DELETE_EXPENSE, {
    participantId,
    expenseId,
    data: existingExpense?.title,
  })

  await prisma.expense.delete({
    where: { id: expenseId },
    include: { paidFor: true, paidBy: true },
  })
}

export async function getGroupExpensesParticipants(groupId: string) {
  const expenses = await getGroupExpenses(groupId)
  return Array.from(
    new Set(
      expenses.flatMap((e) => [
        e.paidBy.id,
        ...e.paidFor.map((pf) => pf.participant.id),
      ]),
    ),
  )
}

export async function getGroups(groupIds: string[]) {
  return (
    await prisma.group.findMany({
      where: { id: { in: groupIds } },
      include: { _count: { select: { participants: true } } },
    })
  ).map((group) => ({
    ...group,
    createdAt: group.createdAt.toISOString(),
  }))
}

export async function updateExpense(
  groupId: string,
  expenseId: string,
  expenseFormValues: ExpenseFormValues,
  participantId?: string,
) {
  const group = await getGroup(groupId)
  if (!group) throw new Error(`Invalid group ID: ${groupId}`)

  const existingExpense = await getExpense(groupId, expenseId)
  if (!existingExpense) throw new Error(`Invalid expense ID: ${expenseId}`)

  for (const participant of [
    expenseFormValues.paidBy,
    ...expenseFormValues.paidFor.map((p) => p.participant),
  ]) {
    if (!group.participants.some((p) => p.id === participant))
      throw new Error(`Invalid participant ID: ${participant}`)
  }

  await logActivity(groupId, ActivityType.UPDATE_EXPENSE, {
    participantId,
    expenseId,
    data: expenseFormValues.title,
  })

  const isDeleteRecurrenceExpenseLink =
    existingExpense.recurrenceRule !== RecurrenceRule.NONE &&
    expenseFormValues.recurrenceRule === RecurrenceRule.NONE &&
    // Delete the existing RecurrenceExpenseLink only if it has not been acted upon yet
    existingExpense.recurringExpenseLink?.nextExpenseCreatedAt === null

  const isUpdateRecurrenceExpenseLink =
    existingExpense.recurrenceRule !== expenseFormValues.recurrenceRule &&
    // Update the exisiting RecurrenceExpenseLink only if it has not been acted upon yet
    existingExpense.recurringExpenseLink?.nextExpenseCreatedAt === null
  const isCreateRecurrenceExpenseLink =
    existingExpense.recurrenceRule === RecurrenceRule.NONE &&
    expenseFormValues.recurrenceRule !== RecurrenceRule.NONE &&
    // Create a new RecurrenceExpenseLink only if one does not already exist for the expense
    existingExpense.recurringExpenseLink === null

  const newRecurringExpenseLink = createPayloadForNewRecurringExpenseLink(
    expenseFormValues.recurrenceRule as RecurrenceRule,
    expenseFormValues.expenseDate,
    groupId,
  )

  const updatedRecurrenceExpenseLinkNextExpenseDate = calculateNextDate(
    expenseFormValues.recurrenceRule as RecurrenceRule,
    existingExpense.expenseDate,
  )

  return prisma.expense.update({
    where: { id: expenseId },
    data: {
      expenseDate: expenseFormValues.expenseDate,
      amount: expenseFormValues.amount,
      originalAmount: expenseFormValues.originalAmount,
      originalCurrency: expenseFormValues.originalCurrency,
      conversionRate: expenseFormValues.conversionRate,
      title: expenseFormValues.title,
      categoryId: expenseFormValues.category,
      paidById: expenseFormValues.paidBy,
      splitMode: expenseFormValues.splitMode,
      recurrenceRule: expenseFormValues.recurrenceRule,
      paidFor: {
        create: expenseFormValues.paidFor
          .filter(
            (p) =>
              !existingExpense.paidFor.some(
                (pp) => pp.participantId === p.participant,
              ),
          )
          .map((paidFor) => ({
            participantId: paidFor.participant,
            shares: paidFor.shares,
          })),
        update: expenseFormValues.paidFor.map((paidFor) => ({
          where: {
            expenseId_participantId: {
              expenseId,
              participantId: paidFor.participant,
            },
          },
          data: {
            shares: paidFor.shares,
          },
        })),
        deleteMany: existingExpense.paidFor.filter(
          (paidFor) =>
            !expenseFormValues.paidFor.some(
              (pf) => pf.participant === paidFor.participantId,
            ),
        ),
      },
      recurringExpenseLink: {
        ...(isCreateRecurrenceExpenseLink
          ? {
              create: newRecurringExpenseLink,
            }
          : {}),
        ...(isUpdateRecurrenceExpenseLink
          ? {
              update: {
                nextExpenseDate: updatedRecurrenceExpenseLinkNextExpenseDate,
              },
            }
          : {}),
        delete: isDeleteRecurrenceExpenseLink,
      },
      isReimbursement: expenseFormValues.isReimbursement,
      documents: {
        connectOrCreate: expenseFormValues.documents.map((doc) => ({
          create: doc,
          where: { id: doc.id },
        })),
        deleteMany: existingExpense.documents
          .filter(
            (existingDoc) =>
              !expenseFormValues.documents.some(
                (doc) => doc.id === existingDoc.id,
              ),
          )
          .map((doc) => ({
            id: doc.id,
          })),
      },
      notes: expenseFormValues.notes,
    },
  })
}

export async function updateGroup(
  groupId: string,
  groupFormValues: GroupFormValues,
  participantId?: string,
) {
  const existingGroup = await getGroup(groupId)
  if (!existingGroup) throw new Error('Invalid group ID')

  await logActivity(groupId, ActivityType.UPDATE_GROUP, { participantId })

  return prisma.group.update({
    where: { id: groupId },
    data: {
      name: groupFormValues.name,
      information: groupFormValues.information,
      currency: groupFormValues.currency,
      currencyCode: groupFormValues.currencyCode,
      participants: {
        deleteMany: existingGroup.participants.filter(
          (p) => !groupFormValues.participants.some((p2) => p2.id === p.id),
        ),
        updateMany: groupFormValues.participants
          .filter((participant) => participant.id !== undefined)
          .map((participant) => ({
            where: { id: participant.id },
            data: {
              name: participant.name,
            },
          })),
        createMany: {
          data: groupFormValues.participants
            .filter((participant) => participant.id === undefined)
            .map((participant) => ({
              id: randomId(),
              name: participant.name,
            })),
        },
      },
    },
  })
}

export async function getGroup(groupId: string) {
  return prisma.group.findUnique({
    where: { id: groupId },
    include: { participants: true },
  })
}

export async function completeOnboarding(groupId: string) {
  return prisma.group.update({
    where: { id: groupId },
    data: { onboardedAt: new Date() },
  })
}

export async function getCategories() {
  return prisma.category.findMany()
}

export async function getGroupExpenses(
  groupId: string,
  options?: { offset?: number; length?: number; filter?: string },
) {
  await createRecurringExpenses()

  return prisma.expense.findMany({
    select: {
      amount: true,
      category: true,
      createdAt: true,
      expenseDate: true,
      id: true,
      isReimbursement: true,
      paidBy: { select: { id: true, name: true } },
      paidFor: {
        select: {
          participant: { select: { id: true, name: true } },
          shares: true,
        },
      },
      splitMode: true,
      recurrenceRule: true,
      title: true,
      _count: { select: { documents: true } },
    },
    where: {
      groupId,
      title: options?.filter
        ? { contains: options.filter, mode: 'insensitive' }
        : undefined,
    },
    orderBy: [{ expenseDate: 'desc' }, { createdAt: 'desc' }],
    skip: options && options.offset,
    take: options && options.length,
  })
}

export async function getGroupExpenseCount(groupId: string) {
  return prisma.expense.count({ where: { groupId } })
}

export async function getExpense(groupId: string, expenseId: string) {
  return prisma.expense.findUnique({
    where: { id: expenseId },
    include: {
      paidBy: true,
      paidFor: true,
      category: true,
      documents: true,
      recurringExpenseLink: true,
    },
  })
}

export async function getActivities(
  groupId: string,
  options?: { offset?: number; length?: number },
) {
  const activities = await prisma.activity.findMany({
    where: { groupId },
    orderBy: [{ time: 'desc' }],
    skip: options?.offset,
    take: options?.length,
  })

  const expenseIds = activities
    .map((activity) => activity.expenseId)
    .filter(Boolean)
  const expenses = await prisma.expense.findMany({
    where: {
      groupId,
      id: { in: expenseIds },
    },
  })

  return activities.map((activity) => ({
    ...activity,
    expense:
      activity.expenseId !== null
        ? expenses.find((expense) => expense.id === activity.expenseId)
        : undefined,
  }))
}

export async function logActivity(
  groupId: string,
  activityType: ActivityType,
  extra?: { participantId?: string; expenseId?: string; data?: string },
) {
  return prisma.activity.create({
    data: {
      id: randomId(),
      groupId,
      activityType,
      ...extra,
    },
  })
}

async function createRecurringExpenses() {
  const localDate = new Date() // Current local date
  const utcDateFromLocal = new Date(
    Date.UTC(
      localDate.getUTCFullYear(),
      localDate.getUTCMonth(),
      localDate.getUTCDate(),
      // More precision beyond date is required to ensure that recurring Expenses are created within <most precises unit> of when expected
      localDate.getUTCHours(),
      localDate.getUTCMinutes(),
    ),
  )

  const recurringExpenseLinksWithExpensesToCreate =
    await prisma.recurringExpenseLink.findMany({
      where: {
        nextExpenseCreatedAt: null,
        nextExpenseDate: {
          lte: utcDateFromLocal,
        },
      },
      include: {
        currentFrameExpense: {
          include: {
            paidBy: true,
            paidFor: true,
            category: true,
            documents: true,
          },
        },
      },
    })

  for (const recurringExpenseLink of recurringExpenseLinksWithExpensesToCreate) {
    let newExpenseDate = recurringExpenseLink.nextExpenseDate

    let currentExpenseRecord = recurringExpenseLink.currentFrameExpense
    let currentReccuringExpenseLinkId = recurringExpenseLink.id

    while (newExpenseDate < utcDateFromLocal) {
      const newExpenseId = randomId()
      const newRecurringExpenseLinkId = randomId()

      const newRecurringExpenseNextExpenseDate = calculateNextDate(
        currentExpenseRecord.recurrenceRule as RecurrenceRule,
        newExpenseDate,
      )

      const {
        category,
        paidBy,
        paidFor,
        documents,
        ...destructeredCurrentExpenseRecord
      } = currentExpenseRecord

      // Use a transacton to ensure that the only one expense is created for the RecurringExpenseLink
      // just in case two clients are processing the same RecurringExpenseLink at the same time
      const newExpense = await prisma
        .$transaction(async (transaction) => {
          const newExpense = await transaction.expense.create({
            data: {
              ...destructeredCurrentExpenseRecord,
              categoryId: currentExpenseRecord.categoryId,
              paidById: currentExpenseRecord.paidById,
              paidFor: {
                createMany: {
                  data: currentExpenseRecord.paidFor.map((paidFor) => ({
                    participantId: paidFor.participantId,
                    shares: paidFor.shares,
                  })),
                },
              },
              documents: {
                connect: currentExpenseRecord.documents.map(
                  (documentRecord) => ({
                    id: documentRecord.id,
                  }),
                ),
              },
              id: newExpenseId,
              expenseDate: newExpenseDate,
              recurringExpenseLink: {
                create: {
                  groupId: currentExpenseRecord.groupId,
                  id: newRecurringExpenseLinkId,
                  nextExpenseDate: newRecurringExpenseNextExpenseDate,
                },
              },
            },
            // Ensure that the same information is available on the returned record that was created
            include: {
              paidFor: true,
              documents: true,
              category: true,
              paidBy: true,
            },
          })

          // Mark the RecurringExpenseLink as being "completed" since the new Expense was created
          // if an expense hasn't been created for this RecurringExpenseLink yet
          await transaction.recurringExpenseLink.update({
            where: {
              id: currentReccuringExpenseLinkId,
              nextExpenseCreatedAt: null,
            },
            data: {
              nextExpenseCreatedAt: newExpense.createdAt,
            },
          })

          return newExpense
        })
        .catch(() => {
          console.error(
            'Failed to created recurringExpense for expenseId: %s',
            currentExpenseRecord.id,
          )
          return null
        })

      // If the new expense failed to be created, break out of the while-loop
      if (newExpense === null) break

      // Set the values for the next iteration of the for-loop in case multiple recurring Expenses need to be created
      currentExpenseRecord = newExpense
      currentReccuringExpenseLinkId = newRecurringExpenseLinkId
      newExpenseDate = newRecurringExpenseNextExpenseDate
    }
  }
}

function createPayloadForNewRecurringExpenseLink(
  recurrenceRule: RecurrenceRule,
  priorDateToNextRecurrence: Date,
  groupId: String,
): RecurringExpenseLink {
  const nextExpenseDate = calculateNextDate(
    recurrenceRule,
    priorDateToNextRecurrence,
  )

  const recurringExpenseLinkId = randomId()
  const recurringExpenseLinkPayload = {
    id: recurringExpenseLinkId,
    groupId: groupId,
    nextExpenseDate: nextExpenseDate,
  }

  return recurringExpenseLinkPayload as RecurringExpenseLink
}

// TODO: Modify this function to use a more comprehensive recurrence Rule library like rrule (https://github.com/jkbrzt/rrule)
//
// Current limitations:
// - If a date is intended to be repeated monthly on the 29th, 30th or 31st, it will change to repeating on the smallest
// date that the reccurence has encountered. Ex. If a recurrence is created for Jan 31st on 2025, the recurring expense
// will be created for Feb 28th, March 28, etc. until it is cancelled or fixed
function calculateNextDate(
  recurrenceRule: RecurrenceRule,
  priorDateToNextRecurrence: Date,
): Date {
  const nextDate = new Date(priorDateToNextRecurrence)
  switch (recurrenceRule) {
    case RecurrenceRule.DAILY:
      nextDate.setUTCDate(nextDate.getUTCDate() + 1)
      break
    case RecurrenceRule.WEEKLY:
      nextDate.setUTCDate(nextDate.getUTCDate() + 7)
      break
    case RecurrenceRule.MONTHLY:
      const nextYear = nextDate.getUTCFullYear()
      const nextMonth = nextDate.getUTCMonth() + 1
      let nextDay = nextDate.getUTCDate()

      // Reduce the next day until it is within the direct next month
      while (!isDateInNextMonth(nextYear, nextMonth, nextDay)) {
        nextDay -= 1
      }
      nextDate.setUTCMonth(nextMonth, nextDay)
      break
  }

  return nextDate
}

function isDateInNextMonth(
  utcYear: number,
  utcMonth: number,
  utcDate: number,
): Boolean {
  const testDate = new Date(Date.UTC(utcYear, utcMonth, utcDate))

  // We're not concerned if the year or month changes. We only want to make sure that the date is our target date
  if (testDate.getUTCDate() !== utcDate) {
    return false
  }

  return true
}

// ---------------------------------------------------------------------------
// Account CRUD
// ---------------------------------------------------------------------------

export interface AccountFormValues {
  name: string
  kind: AccountKind
  ownerParticipantId?: string | null
  accountNumbers: string[]
}

export async function getAccounts(groupId: string): Promise<AccountRecord[]> {
  return prisma.account.findMany({
    where: { groupId },
    orderBy: [{ createdAt: 'asc' }],
  })
}

export async function createAccount(
  groupId: string,
  values: AccountFormValues,
): Promise<AccountRecord> {
  return prisma.account.create({
    data: {
      id: randomId(),
      groupId,
      name: values.name,
      kind: values.kind,
      ownerParticipantId:
        values.kind === AccountKind.PERSONAL
          ? (values.ownerParticipantId ?? null)
          : null,
      accountNumbers: values.accountNumbers,
    },
  })
}

export async function updateAccount(
  accountId: string,
  values: AccountFormValues,
): Promise<AccountRecord> {
  return prisma.account.update({
    where: { id: accountId },
    data: {
      name: values.name,
      kind: values.kind,
      ownerParticipantId:
        values.kind === AccountKind.PERSONAL
          ? (values.ownerParticipantId ?? null)
          : null,
      accountNumbers: values.accountNumbers,
    },
  })
}

export async function deleteAccount(accountId: string): Promise<void> {
  await prisma.account.delete({ where: { id: accountId } })
}

// ---------------------------------------------------------------------------
// Dashboard attribution helpers
// ---------------------------------------------------------------------------

/** Minimal shape of an expense used by attribution queries */
type AttributableExpense = {
  id: string
  title: string
  amount: number
  expenseDate: Date
  isReimbursement: boolean
  category: { id: number; name: string; grouping: string } | null
  paidFor: { participant: { id: string; name: string } }[]
}

/** Internal: fetch all group expenses with the fields needed for attribution */
async function getAttributableExpenses(groupId: string) {
  await createRecurringExpenses()
  return prisma.expense.findMany({
    where: { groupId },
    select: {
      id: true,
      title: true,
      amount: true,
      expenseDate: true,
      isReimbursement: true,
      category: { select: { id: true, name: true, grouping: true } },
      paidFor: {
        select: { participant: { select: { id: true, name: true } } },
      },
    },
    orderBy: [{ expenseDate: 'asc' }, { id: 'asc' }],
  })
}

/** Internal: derive owner for one expense given the group participants list */
function deriveOwner(
  participants: { id: string; name: string }[],
  expense: Pick<AttributableExpense, 'paidFor'>,
): Owner {
  return ownerFromExpense(
    participants,
    expense.paidFor.map((pf) => pf.participant.id),
  )
}

// ---------------------------------------------------------------------------
// spendByOwner
// ---------------------------------------------------------------------------

/**
 * Per-owner spend totals.
 * Keys are participant ids or GEMENSAMT, plus 'grandTotal'.
 */
export type OwnerTotals = { [owner: string]: number; grandTotal: number }

export interface SpendByOwnerFilters {
  /** Inclusive start date (UTC day boundary). Absent = all time. */
  from?: Date
  /** Inclusive end date (UTC day boundary). Absent = all time. */
  to?: Date
  /** Filter by category id */
  categoryId?: number
  /** Filter by owner (participant id or 'gemensamt') */
  owner?: Owner
}

/**
 * Returns total spending per owner + grand total over the filtered range.
 * Amounts are integers in minor units (öre for SEK).
 * Reimbursements are excluded.
 *
 * Owner keys are participant ids or GEMENSAMT ('gemensamt').
 */
export async function spendByOwner(
  groupId: string,
  filters: SpendByOwnerFilters = {},
): Promise<OwnerTotals> {
  const group = await getGroup(groupId)
  if (!group) throw new Error(`Invalid group ID: ${groupId}`)

  const expenses = await getAttributableExpenses(groupId)

  // Seed totals for all participants + gemensamt
  const totals: OwnerTotals = { grandTotal: 0 }
  for (const p of group.participants) totals[p.id] = 0
  totals[GEMENSAMT] = 0

  for (const expense of expenses) {
    if (expense.isReimbursement) continue

    // Date filter (compare UTC date strings to avoid TZ drift)
    const expDate = expense.expenseDate
    if (filters.from && expDate < filters.from) continue
    if (filters.to) {
      // to is inclusive: expense date must be <= to (day boundary)
      const toEnd = new Date(filters.to)
      toEnd.setUTCDate(toEnd.getUTCDate() + 1)
      if (expDate >= toEnd) continue
    }

    // Category filter
    if (
      filters.categoryId !== undefined &&
      expense.category?.id !== filters.categoryId
    )
      continue

    const owner = deriveOwner(group.participants, expense)

    // Owner filter
    if (filters.owner !== undefined && owner !== filters.owner) continue

    totals[owner] = (totals[owner] ?? 0) + expense.amount
    totals.grandTotal += expense.amount
  }

  return totals
}

// ---------------------------------------------------------------------------
// expensesForDay
// ---------------------------------------------------------------------------

export type DayExpense = {
  id: string
  title: string
  amount: number
  owner: Owner
  category: { id: number; name: string; grouping: string } | null
  isReimbursement: boolean
}

/**
 * Returns all expenses on a given calendar day (UTC), each annotated with its owner.
 */
export async function expensesForDay(
  groupId: string,
  date: Date,
): Promise<DayExpense[]> {
  const group = await getGroup(groupId)
  if (!group) throw new Error(`Invalid group ID: ${groupId}`)

  // Build UTC day range
  const dayStart = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  )
  const dayEnd = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1),
  )

  const raw = await prisma.expense.findMany({
    where: {
      groupId,
      expenseDate: { gte: dayStart, lt: dayEnd },
    },
    select: {
      id: true,
      title: true,
      amount: true,
      expenseDate: true,
      isReimbursement: true,
      category: { select: { id: true, name: true, grouping: true } },
      paidFor: {
        select: { participant: { select: { id: true, name: true } } },
      },
    },
    orderBy: [{ expenseDate: 'asc' }, { id: 'asc' }],
  })

  return raw.map((e) => ({
    id: e.id,
    title: e.title,
    amount: e.amount,
    owner: deriveOwner(group.participants, e),
    category: e.category,
    isReimbursement: e.isReimbursement,
  }))
}

// ---------------------------------------------------------------------------
// spendByDay
// ---------------------------------------------------------------------------

export type DaySpend = {
  /** ISO date string YYYY-MM-DD */
  date: string
  total: number
  /** Keys are participant ids or 'gemensamt' */
  perOwner: Record<string, number>
}

/**
 * Returns daily spending totals (and per-owner breakdown) over a date range.
 * Reimbursements are excluded.
 * perOwner keys are participant ids or GEMENSAMT.
 */
export async function spendByDay(
  groupId: string,
  filters: SpendByOwnerFilters & { from: Date; to: Date },
): Promise<DaySpend[]> {
  const group = await getGroup(groupId)
  if (!group) throw new Error(`Invalid group ID: ${groupId}`)

  const expenses = await getAttributableExpenses(groupId)

  const map = new Map<string, DaySpend>()

  // Build a zeroed perOwner seed for each day entry
  const seedPerOwner = (): Record<string, number> => {
    const obj: Record<string, number> = { [GEMENSAMT]: 0 }
    for (const p of group.participants) obj[p.id] = 0
    return obj
  }

  for (const expense of expenses) {
    if (expense.isReimbursement) continue

    const expDate = expense.expenseDate
    if (expDate < filters.from) continue
    const toEnd = new Date(filters.to)
    toEnd.setUTCDate(toEnd.getUTCDate() + 1)
    if (expDate >= toEnd) continue

    if (
      filters.categoryId !== undefined &&
      expense.category?.id !== filters.categoryId
    )
      continue

    const owner = deriveOwner(group.participants, expense)
    if (filters.owner !== undefined && owner !== filters.owner) continue

    const dateStr = expDate.toISOString().slice(0, 10)
    if (!map.has(dateStr)) {
      map.set(dateStr, {
        date: dateStr,
        total: 0,
        perOwner: seedPerOwner(),
      })
    }
    const entry = map.get(dateStr)!
    entry.total += expense.amount
    entry.perOwner[owner] = (entry.perOwner[owner] ?? 0) + expense.amount
  }

  // Return sorted by date
  return Array.from(map.values()).sort((a, b) =>
    a.date.localeCompare(b.date),
  )
}
