import { completeOnboarding } from '@/lib/api'
import { baseProcedure } from '@/trpc/init'
import { z } from 'zod'

export const completeOnboardingProcedure = baseProcedure
  .input(z.object({ groupId: z.string().min(1) }))
  .mutation(async ({ input: { groupId } }) => {
    await completeOnboarding(groupId)
  })
