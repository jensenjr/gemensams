import { prisma } from '@/lib/prisma'
import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { OnboardingWizard } from './wizard'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Onboarding')
  return { title: t('step1.title') }
}

export default async function OnboardingPage() {
  // Load current state of the hushallet group so the wizard can pre-fill.
  const group = await prisma.group.findUnique({
    where: { id: 'hushallet' },
    include: { participants: true },
  })

  const initialName = group?.name ?? 'Hushållet'
  const initialCurrency = group?.currency ?? 'kr'
  const initialCurrencyCode = group?.currencyCode ?? 'SEK'
  const initialParticipants =
    group?.participants.map((p) => ({ id: p.id, name: p.name })) ?? [
      { name: 'Användare 1' },
      { name: 'Användare 2' },
    ]

  return (
    <main className="min-h-screen">
      <OnboardingWizard
        initialName={initialName}
        initialCurrency={initialCurrency}
        initialCurrencyCode={initialCurrencyCode}
        initialParticipants={initialParticipants}
      />
    </main>
  )
}
