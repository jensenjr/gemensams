import { createTRPCRouter } from '@/trpc/init'
import { importParseProcedure } from './parse.procedure'
import { importCommitProcedure } from './commit.procedure'

export const groupImportRouter = createTRPCRouter({
  parse: importParseProcedure,
  commit: importCommitProcedure,
})
