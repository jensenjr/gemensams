import { Metadata } from 'next'
import { ImportPageClient } from './import-client'

export const metadata: Metadata = {
  title: 'Importera',
}

export default function ImportPage() {
  return <ImportPageClient />
}
