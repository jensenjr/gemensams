import { spendByDay } from '@/lib/api'
import { Owner } from '@/lib/owners'
import { baseProcedure } from '@/trpc/init'
import { z } from 'zod'

const ownerSchema = z.enum(['hans', 'hennes', 'gemensamt', 'ovrigt'])

export const spendByDayProcedure = baseProcedure
  .input(
    z.object({
      groupId: z.string().min(1),
      from: z.string(), // ISO date string
      to: z.string(), // ISO date string
      categoryId: z.number().optional(),
      owner: ownerSchema.optional(),
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
