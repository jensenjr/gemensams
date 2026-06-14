import { GEMENSAMT, OwnerParticipant } from '@/lib/owners'

/**
 * Stable color palette for participant slots (by index).
 * Extend the list if you ever have more than 8 participants.
 */
const PARTICIPANT_SLOT_COLORS: string[] = [
  '#3b82f6', // blue-500
  '#ec4899', // pink-500
  '#f59e0b', // amber-500
  '#8b5cf6', // violet-500
  '#14b8a6', // teal-500
  '#f97316', // orange-500
  '#06b6d4', // cyan-500
  '#84cc16', // lime-500
]

/** The fixed color for the 'gemensamt' (shared) owner */
const GEMENSAMT_COLOR = '#22c55e' // green-500

/** Tailwind text color classes for participant slots (by index) */
const PARTICIPANT_TEXT_COLORS = [
  'text-blue-500',
  'text-pink-500',
  'text-amber-500',
  'text-violet-500',
  'text-teal-500',
  'text-orange-500',
  'text-cyan-500',
  'text-lime-500',
]

/** Tailwind bg+text badge classes for participant slots (by index) */
const PARTICIPANT_BG_COLORS = [
  'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  'bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-300',
  'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300',
  'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300',
  'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
  'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300',
  'bg-lime-100 text-lime-700 dark:bg-lime-900/30 dark:text-lime-300',
]

const GEMENSAMT_TEXT_COLOR = 'text-green-500'
const GEMENSAMT_BG_COLOR =
  'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'

function participantIndex(
  owner: string,
  participants: OwnerParticipant[],
): number {
  return participants.findIndex((p) => p.id === owner)
}

/**
 * Returns the hex fill/background color for an owner.
 * Used in charts and SVG bars.
 */
export function colorForOwner(
  owner: string,
  participants: OwnerParticipant[],
): string {
  if (owner === GEMENSAMT) return GEMENSAMT_COLOR
  const idx = participantIndex(owner, participants)
  if (idx < 0) return GEMENSAMT_COLOR
  return PARTICIPANT_SLOT_COLORS[idx % PARTICIPANT_SLOT_COLORS.length]
}

/**
 * Returns the Tailwind text color class for an owner.
 */
export function textColorForOwner(
  owner: string,
  participants: OwnerParticipant[],
): string {
  if (owner === GEMENSAMT) return GEMENSAMT_TEXT_COLOR
  const idx = participantIndex(owner, participants)
  if (idx < 0) return GEMENSAMT_TEXT_COLOR
  return PARTICIPANT_TEXT_COLORS[idx % PARTICIPANT_TEXT_COLORS.length]
}

/**
 * Returns the Tailwind badge class (bg + text) for an owner.
 */
export function bgColorForOwner(
  owner: string,
  participants: OwnerParticipant[],
): string {
  if (owner === GEMENSAMT) return GEMENSAMT_BG_COLOR
  const idx = participantIndex(owner, participants)
  if (idx < 0) return GEMENSAMT_BG_COLOR
  return PARTICIPANT_BG_COLORS[idx % PARTICIPANT_BG_COLORS.length]
}
