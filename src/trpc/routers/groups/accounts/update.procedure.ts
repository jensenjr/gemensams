import { updateAccount } from '@/lib/api'
import { baseProcedure } from '@/trpc/init'
import { accountFormSchema } from './create.procedure'
import { z } from 'zod'

export const updateGroupAccountProcedure = baseProcedure
  .input(
    z.object({
      accountId: z.string().min(1),
      accountFormValues: accountFormSchema,
    }),
  )
  .mutation(async ({ input: { accountId, accountFormValues } }) => {
    const account = await updateAccount(accountId, accountFormValues)
    return { account }
  })
