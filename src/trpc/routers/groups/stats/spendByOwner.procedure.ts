import { spendByOwner } from '@/lib/api'
import { Owner } from '@/lib/owners'
import { baseProcedure } from '@/trpc/init'
import { z } from 'zod'

export const spendByOwnerProcedure = baseProcedure
  .input(
    z.object({
      groupId: z.string().min(1),
      from: z.string().optional(), // ISO date string
      to: z.string().optional(), // ISO date string
      categoryId: z.number().optional(),
      /** participant id or 'gemensamt' */
      owner: z.string().optional(),
    }),
  )
  .query(async ({ input }) => {
    const filters = {
      from: input.from ? new Date(input.from) : undefined,
      to: input.to ? new Date(input.to) : undefined,
      categoryId: input.categoryId,
      owner: input.owner as Owner | undefined,
    }
    return spendByOwner(input.groupId, filters)
  })
