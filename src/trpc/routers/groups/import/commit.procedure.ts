/**
 * Commit selected rows from the import review queue as expenses.
 *
 * Amount units: `expenseAmountMinor` is in öre (integer). The expense schema
 * `amount` field is also stored as integer minor units (matching how Spliit
 * stores amounts). We pass it directly.
 *
 * Owner → paidFor+splitMode is resolved via `ownerToSplit`.
 * `paidBy` is the owner participant (for GEMENSAMT: first participant).
 */

import { createExpense, getGroup } from '@/lib/api'
import { ownerToSplit, GEMENSAMT, OwnerSplit } from '@/lib/owners'
import { baseProcedure } from '@/trpc/init'
import { z } from 'zod'

const commitRowSchema = z.object({
  /** ISO date string YYYY-MM-DD */
  bookedDate: z.string(),
  description: z.string(),
  /** Positive integer öre */
  expenseAmountMinor: z.number().int().positive(),
  /** Participant id or 'gemensamt' */
  owner: z.string(),
})

export const importCommitProcedure = baseProcedure
  .input(
    z.object({
      groupId: z.string().min(1),
      rows: z.array(commitRowSchema).min(1).max(500),
      participantId: z.string().optional(),
    }),
  )
  .mutation(async ({ input: { groupId, rows, participantId } }) => {
    const group = await getGroup(groupId)
    if (!group) throw new Error(`Invalid group ID: ${groupId}`)

    const participants = group.participants.map((p) => ({
      id: p.id,
      name: p.name,
    }))
    if (participants.length === 0) throw new Error('Group has no participants')

    let created = 0
    const errors: string[] = []

    for (const row of rows) {
      try {
        const splitResult: OwnerSplit = ownerToSplit(participants, row.owner)
        if (splitResult.paidFor.length === 0) {
          errors.push(`Row "${row.description}": could not resolve paidFor`)
          continue
        }

        // paidBy = owner participant; for gemensamt use first participant
        const paidByParticipantId =
          row.owner === GEMENSAMT
            ? participants[0].id
            : (participants.find((p) => p.id === row.owner)?.id ?? participants[0].id)

        // ownerToSplit returns shares as string '1'; ExpenseFormValues expects numeric
        // shares after zod transform. For EVENLY mode the transform does:
        // Math.round(Number(shares) * 100) = 100. We replicate that here.
        const paidFor = splitResult.paidFor.map((pf) => ({
          participant: pf.participant,
          shares: Math.round(Number(pf.shares) * 100),
        }))

        await createExpense(
          {
            title: row.description,
            // amount is stored as integer minor units (öre for SEK)
            amount: row.expenseAmountMinor,
            originalAmount: undefined,
            originalCurrency: null,
            conversionRate: undefined,
            expenseDate: new Date(row.bookedDate),
            category: 0, // General
            paidBy: paidByParticipantId,
            paidFor,
            splitMode: splitResult.splitMode,
            isReimbursement: false,
            documents: [],
            notes: undefined,
            recurrenceRule: 'NONE',
            saveDefaultSplittingOptions: false,
          },
          groupId,
          participantId,
        )
        created++
      } catch (err) {
        errors.push(`Row "${row.description}": ${String(err)}`)
      }
    }

    return { created, errors }
  })
