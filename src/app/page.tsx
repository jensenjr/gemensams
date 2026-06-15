import { prisma } from '@/lib/prisma'
import { redirect } from 'next/navigation'

// Redirect root to the single household group, unless onboarding is needed.
export default async function HomePage() {
  const group = await prisma.group.findUnique({
    where: { id: 'hushallet' },
    select: { onboardedAt: true },
  })

  if (!group || group.onboardedAt === null) {
    redirect('/onboarding')
  }

  redirect('/groups/hushallet')
}
