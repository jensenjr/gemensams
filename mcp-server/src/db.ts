/**
 * Prisma client singleton for the MCP server.
 * Connects to the same Postgres instance as the web app via POSTGRES_PRISMA_URL.
 */
import { PrismaClient } from '@prisma/client'

let _prisma: PrismaClient | undefined

export function getPrisma(): PrismaClient {
  if (!_prisma) {
    _prisma = new PrismaClient()
  }
  return _prisma
}

export async function disconnectPrisma(): Promise<void> {
  if (_prisma) {
    await _prisma.$disconnect()
    _prisma = undefined
  }
}
