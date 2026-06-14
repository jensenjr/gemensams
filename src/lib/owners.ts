/**
 * Owner helpers for Gemensams household expense attribution.
 *
 * "Owner" is pure sugar over Spliit's paidFor + splitMode fields.
 * No DB schema changes — the mapping is applied at form submission time.
 *
 * Owner → paidFor mapping (all shares = 1, splitMode = EVENLY):
 *   hans       → [Christian]
 *   hennes     → [Fru]
 *   gemensamt  → [Christian, Fru]
 *   ovrigt     → [Övriga]
 *
 * Participants are resolved by name (case-insensitive) with order-based fallback:
 *   index 0 → hans, index 1 → hennes, index 2 → ovrigt
 */

import { SplitMode } from '@prisma/client'

export type Owner = 'hans' | 'hennes' | 'gemensamt' | 'ovrigt'

/** Ordered list of owners with their i18n label keys */
export const OWNERS: readonly { key: Owner; labelKey: string }[] = [
  { key: 'hans', labelKey: 'Owners.hans' },
  { key: 'hennes', labelKey: 'Owners.hennes' },
  { key: 'gemensamt', labelKey: 'Owners.gemensamt' },
  { key: 'ovrigt', labelKey: 'Owners.ovrigt' },
] as const

/** Minimal participant shape (subset of group.participants) */
export interface OwnerParticipant {
  id: string
  name: string
}

/** Result of resolving an owner to split fields */
export interface OwnerSplit {
  paidFor: { participant: string; shares: string }[]
  splitMode: SplitMode
}

// Name constants (case-insensitive matching)
const NAME_HANS = 'christian'
const NAME_HENNES = 'fru'
const NAME_OVRIGT = 'övriga'

function findParticipant(
  participants: OwnerParticipant[],
  name: string,
  fallbackIndex: number,
): OwnerParticipant | undefined {
  return (
    participants.find((p) => p.name.toLowerCase() === name) ??
    participants[fallbackIndex]
  )
}

/**
 * Resolve an Owner key to paidFor + splitMode.
 * Returns an empty paidFor array if no participants can be found (defensive).
 */
export function ownerToSplit(
  participants: OwnerParticipant[],
  owner: Owner,
): OwnerSplit {
  const hans = findParticipant(participants, NAME_HANS, 0)
  const hennes = findParticipant(participants, NAME_HENNES, 1)
  const ovrigt = findParticipant(participants, NAME_OVRIGT, 2)

  const toEntry = (p: OwnerParticipant | undefined) =>
    p ? { participant: p.id, shares: '1' } : null

  let entries: ({ participant: string; shares: string } | null)[]

  switch (owner) {
    case 'hans':
      entries = [toEntry(hans)]
      break
    case 'hennes':
      entries = [toEntry(hennes)]
      break
    case 'gemensamt':
      entries = [toEntry(hans), toEntry(hennes)]
      break
    case 'ovrigt':
      entries = [toEntry(ovrigt)]
      break
    default:
      entries = [toEntry(hans)]
  }

  return {
    paidFor: entries.filter(
      (e): e is { participant: string; shares: string } => e !== null,
    ),
    splitMode: 'EVENLY' as SplitMode,
  }
}

/**
 * Derive the Owner for an existing expense from its paidFor participant IDs.
 * Used to pre-fill owner buttons on the edit form.
 *
 * Matching logic:
 *   {Christian}        → hans
 *   {Fru}              → hennes
 *   {Christian, Fru}   → gemensamt  (in any order)
 *   anything else      → ovrigt
 */
export function ownerFromExpense(
  participants: OwnerParticipant[],
  paidForParticipantIds: string[],
): Owner {
  if (!paidForParticipantIds || paidForParticipantIds.length === 0) {
    return 'ovrigt'
  }

  const hans = findParticipant(participants, NAME_HANS, 0)
  const hennes = findParticipant(participants, NAME_HENNES, 1)

  const ids = new Set(paidForParticipantIds)

  const hasHans = hans ? ids.has(hans.id) : false
  const hasHennes = hennes ? ids.has(hennes.id) : false

  if (ids.size === 1 && hasHans) return 'hans'
  if (ids.size === 1 && hasHennes) return 'hennes'
  if (ids.size === 2 && hasHans && hasHennes) return 'gemensamt'
  return 'ovrigt'
}
