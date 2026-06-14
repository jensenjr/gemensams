// Production-safe seed: plain ESM using @prisma/client (no tsx/devDeps required),
// so it can run from the container entrypoint. Idempotent.
import { PrismaClient } from '@prisma/client'
import { randomUUID } from 'node:crypto'

const prisma = new PrismaClient()

const GROUP_ID = 'hushallet'
const GROUP_NAME = 'Hushållet'
const CURRENCY_CODE = 'SEK'
const CURRENCY_SYMBOL = 'kr'
const PARTICIPANTS = ['Christian', 'Fru', 'Övriga']

async function main() {
  const existing = await prisma.group.findUnique({
    where: { id: GROUP_ID },
    include: { participants: true },
  })

  if (existing) {
    console.log(
      `Seed: group "${GROUP_NAME}" (${GROUP_ID}) already exists — skipping. ` +
        `Participants: ${existing.participants.map((p) => p.name).join(', ')}`,
    )
    return
  }

  const group = await prisma.group.create({
    data: {
      id: GROUP_ID,
      name: GROUP_NAME,
      currency: CURRENCY_SYMBOL,
      currencyCode: CURRENCY_CODE,
      participants: {
        createMany: {
          data: PARTICIPANTS.map((name) => ({ id: randomUUID(), name })),
        },
      },
    },
    include: { participants: true },
  })

  console.log(
    `Seed: created group "${group.name}" (${group.id}) with participants ` +
      group.participants.map((p) => p.name).join(', '),
  )
}

main()
  .catch((e) => {
    console.error('Seed failed:', e)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
