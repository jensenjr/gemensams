/**
 * Parse + classify CSV rows server-side (Buffer is Node-only).
 *
 * Accepts one or more base64-encoded CSV files, parses them all, combines the
 * rows, and classifies them together so cross-account transfer pairs are
 * detected across multiple files.
 *
 * Also loads existing expenses in the covered date range and flags likely
 * duplicates (same date + same absolute amount + similar description).
 */

import { getAccounts, getGroup } from '@/lib/api'
import { classifyTransactions, ClassifiedTx } from '@/lib/bank-import/classify'
import { parseSwedbankCsv, ParseError, ParsedRow } from '@/lib/bank-import/swedbank'
import { normalizeAccountNumber } from '@/lib/accounts'
import { baseProcedure } from '@/trpc/init'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

export interface ImportParsedRow {
  /** Index into the combined rows array — used as stable key in the UI. */
  index: number
  row: ParsedRow
  type: ClassifiedTx['type']
  defaultOwner: ClassifiedTx['defaultOwner']
  reason: string
  sourceAccountKnown: boolean
  expenseAmountMinor?: number
  transferPairRowNumber?: number
  /** True when a very similar expense already exists in the DB. */
  isDuplicate: boolean
}

export interface ImportParseResult {
  rows: ImportParsedRow[]
  parseErrors: ParseError[]
  /** Set of account numbers that appeared in the CSV but are NOT registered. */
  unknownAccountNumbers: string[]
}

/** Levenshtein distance, capped at max for fast short-circuit. */
function levenshtein(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let prev = i
    for (let j = 1; j <= b.length; j++) {
      const val =
        a[i - 1] === b[j - 1]
          ? dp[j - 1]
          : 1 + Math.min(dp[j], dp[j - 1], prev)
      dp[j - 1] = prev
      prev = val
    }
    dp[b.length] = prev
  }
  return dp[b.length]
}

function similarDescription(a: string, b: string): boolean {
  const na = a.toLowerCase().trim()
  const nb = b.toLowerCase().trim()
  if (na === nb) return true
  // Allow up to 4 edits for short-ish strings
  const threshold = Math.min(4, Math.floor(Math.max(na.length, nb.length) * 0.2))
  return levenshtein(na, nb, threshold) <= threshold
}

export const importParseProcedure = baseProcedure
  .input(
    z.object({
      groupId: z.string().min(1),
      /** One or more base64-encoded CSV file contents. */
      files: z.array(z.string()).min(1).max(20),
    }),
  )
  .mutation(async ({ input: { groupId, files } }): Promise<ImportParseResult> => {
    const group = await getGroup(groupId)
    if (!group) throw new Error(`Invalid group ID: ${groupId}`)

    const accounts = await getAccounts(groupId)
    const participants = group.participants.map((p) => ({
      id: p.id,
      name: p.name,
    }))

    // Parse all files
    const allRows: ParsedRow[] = []
    const allErrors: ParseError[] = []
    for (const b64 of files) {
      const buf = Buffer.from(b64, 'base64')
      const { rows, errors } = parseSwedbankCsv(buf)
      allRows.push(...rows)
      allErrors.push(...errors)
    }

    // Classify combined rows (so transfer pairs across files are detected)
    const classified = classifyTransactions(allRows, accounts, participants)

    // Build registered account-number set for unknown-account detection
    const registeredNums = new Set<string>()
    for (const acc of accounts) {
      for (const n of acc.accountNumbers) {
        const norm = normalizeAccountNumber(n)
        if (norm) registeredNums.add(norm)
      }
    }

    const unknownAccountNumbers = Array.from(
      new Set(
        classified
          .filter((c) => !c.sourceAccountKnown)
          .map((c) => c.row.sourceAccountNumber),
      ),
    )

    // Load existing expenses in the date range covered by the CSV rows for
    // duplicate detection. Only do this when there are rows to check.
    let existingExpenses: { title: string; amount: number; expenseDate: Date }[] = []
    if (allRows.length > 0) {
      const dates = allRows.map((r) => r.bookedDate).sort()
      const minDate = new Date(dates[0])
      const maxDate = new Date(dates[dates.length - 1])
      // Expand by 1 day on each side to catch edge-case timezone differences
      minDate.setUTCDate(minDate.getUTCDate() - 1)
      maxDate.setUTCDate(maxDate.getUTCDate() + 1)

      existingExpenses = await prisma.expense.findMany({
        where: {
          groupId,
          expenseDate: { gte: minDate, lte: maxDate },
        },
        select: { title: true, amount: true, expenseDate: true },
      })
    }

    // Build result rows with duplicate flags
    const importRows: ImportParsedRow[] = classified.map((c, index) => {
      let isDuplicate = false
      if (c.type === 'EXPENSE' && c.expenseAmountMinor !== undefined) {
        const targetDate = c.row.bookedDate
        isDuplicate = existingExpenses.some((e) => {
          const eDateStr = e.expenseDate.toISOString().slice(0, 10)
          if (eDateStr !== targetDate) return false
          if (e.amount !== c.expenseAmountMinor) return false
          return similarDescription(e.title, c.row.description)
        })
      }

      return {
        index,
        row: c.row,
        type: c.type,
        defaultOwner: c.defaultOwner,
        reason: c.reason,
        sourceAccountKnown: c.sourceAccountKnown,
        expenseAmountMinor: c.expenseAmountMinor,
        transferPairRowNumber: c.transferPairRowNumber,
        isDuplicate,
      }
    })

    // Sort by bookedDate desc (newest first), stable
    importRows.sort((a, b) => b.row.bookedDate.localeCompare(a.row.bookedDate))

    return {
      rows: importRows,
      parseErrors: allErrors,
      unknownAccountNumbers,
    }
  })
