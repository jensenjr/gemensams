import { Owner } from '@/lib/owners'

/** Tailwind fill/background color for each owner — consistent across chart + UI */
export const OWNER_COLORS: Record<Owner, string> = {
  hans: '#3b82f6', // blue-500
  hennes: '#ec4899', // pink-500
  gemensamt: '#22c55e', // green-500
  ovrigt: '#f59e0b', // amber-500
}

/** Tailwind text color class for each owner */
export const OWNER_TEXT_COLORS: Record<Owner, string> = {
  hans: 'text-blue-500',
  hennes: 'text-pink-500',
  gemensamt: 'text-green-500',
  ovrigt: 'text-amber-500',
}

/** Tailwind bg color class for each owner badge */
export const OWNER_BG_COLORS: Record<Owner, string> = {
  hans: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  hennes:
    'bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-300',
  gemensamt:
    'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  ovrigt:
    'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
}
