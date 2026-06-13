import { PrismaClient } from '@prisma/client'
import { nanoid } from 'nanoid'

const prisma = new PrismaClient()

async function main() {
  const GROUP_ID = 'hushallet'
  const GROUP_NAME = 'Hushållet'
  const CURRENCY_CODE = 'SEK'
  const CURRENCY_SYMBOL = 'kr'
  const PARTICIPANTS = ['Christian', 'Fru', 'Övriga']

  // Check if group already exists
  const existing = await prisma.group.findUnique({ where: { id: GROUP_ID }, include: { participants: true } })

  if (existing) {
    console.log(`Group "${GROUP_NAME}" (id: ${GROUP_ID}) already exists — skipping creation.`)
    console.log(`Participants: ${existing.participants.map((p) => p.name).join(', ')}`)
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
          data: PARTICIPANTS.map((name) => ({
            id: nanoid(),
            name,
          })),
        },
      },
    },
    include: { participants: true },
  })

  console.log(`Created group "${group.name}" (id: ${group.id})`)
  console.log(`Participants: ${group.participants.map((p) => p.name).join(', ')}`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
