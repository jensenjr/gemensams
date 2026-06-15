import { createTRPCRouter } from '@/trpc/init'
import { createGroupAccountProcedure } from './create.procedure'
import { deleteGroupAccountProcedure } from './delete.procedure'
import { listGroupAccountsProcedure } from './list.procedure'
import { updateGroupAccountProcedure } from './update.procedure'

export const groupAccountsRouter = createTRPCRouter({
  list: listGroupAccountsProcedure,
  create: createGroupAccountProcedure,
  update: updateGroupAccountProcedure,
  delete: deleteGroupAccountProcedure,
})
