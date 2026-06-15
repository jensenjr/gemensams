import { createAccount } from '@/lib/api'
import { baseProcedure } from '@/trpc/init'
import { z } from 'zod'

export const accountFormSchema = z.object({
  name: z.string().min(1),
  kind: z.enum(['PERSONAL', 'SHARED', 'SAVINGS']),
  ownerParticipantId: z.string().optional().nullable(),
  accountNumbers: z.array(z.string()),
})

export const createGroupAccountProcedure = baseProcedure
  .input(
    z.object({
      groupId: z.string().min(1),
      accountFormValues: accountFormSchema,
    }),
  )
  .mutation(async ({ input: { groupId, accountFormValues } }) => {
    const account = await createAccount(groupId, accountFormValues)
    return { account }
  })
