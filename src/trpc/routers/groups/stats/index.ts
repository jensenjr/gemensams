import { createTRPCRouter } from '@/trpc/init'
import { expensesForDayProcedure } from '@/trpc/routers/groups/stats/expensesForDay.procedure'
import { getGroupStatsProcedure } from '@/trpc/routers/groups/stats/get.procedure'
import { spendByDayProcedure } from '@/trpc/routers/groups/stats/spendByDay.procedure'
import { spendByOwnerProcedure } from '@/trpc/routers/groups/stats/spendByOwner.procedure'

export const groupStatsRouter = createTRPCRouter({
  get: getGroupStatsProcedure,
  spendByOwner: spendByOwnerProcedure,
  expensesForDay: expensesForDayProcedure,
  spendByDay: spendByDayProcedure,
})
