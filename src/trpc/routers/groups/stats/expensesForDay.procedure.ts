import { expensesForDay } from '@/lib/api'
import { baseProcedure } from '@/trpc/init'
import { z } from 'zod'

export const expensesForDayProcedure = baseProcedure
  .input(
    z.object({
      groupId: z.string().min(1),
      date: z.string(), // ISO date string YYYY-MM-DD
    }),
  )
  .query(async ({ input }) => {
    const date = new Date(input.date)
    return expensesForDay(input.groupId, date)
  })
