import { spendByDay } from '@/lib/api'
import { Owner } from '@/lib/owners'
import { baseProcedure } from '@/trpc/init'
import { z } from 'zod'

export const spendByDayProcedure = baseProcedure
  .input(
    z.object({
      groupId: z.string().min(1),
      from: z.string(), // ISO date string
      to: z.string(), // ISO date string
      categoryId: z.number().optional(),
      /** participant id or 'gemensamt' */
      owner: z.string().optional(),
    }),
  )
  .query(async ({ input }) => {
    const filters = {
      from: new Date(input.from),
      to: new Date(input.to),
      categoryId: input.categoryId,
      owner: input.owner as Owner | undefined,
    }
    return spendByDay(input.groupId, filters)
  })
