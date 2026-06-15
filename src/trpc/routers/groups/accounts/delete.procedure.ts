import { deleteAccount } from '@/lib/api'
import { baseProcedure } from '@/trpc/init'
import { z } from 'zod'

export const deleteGroupAccountProcedure = baseProcedure
  .input(z.object({ accountId: z.string().min(1) }))
  .mutation(async ({ input: { accountId } }) => {
    await deleteAccount(accountId)
  })
