import { EditGroup } from '@/app/groups/[groupId]/edit/edit-group'
import { getTranslations } from 'next-intl/server'
import { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Settings',
}

export default async function EditGroupPage() {
  const t = await getTranslations('Footer')
  return (
    <>
      <EditGroup />
      <div className="mt-6 mb-8 flex justify-center">
        <Link
          href="/onboarding"
          className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground transition-colors"
        >
          {t('rerunOnboarding')}
        </Link>
      </div>
    </>
  )
}
