/**
 * Owner helpers for Gemensams household expense attribution.
 *
 * "Owner" is pure sugar over Spliit's paidFor + splitMode fields.
 * No DB schema changes — the mapping is applied at form submission time.
 *
 * Owner is either a participant id (string) or the literal 'gemensamt'.
 *
 * Owner → paidFor mapping (all shares = 1, splitMode = EVENLY):
 *   participantId  → paidFor = [that participant], EVENLY
 *   'gemensamt'    → paidFor = [all participants], EVENLY
 */

import { SplitMode } from '@prisma/client'

/** An owner is either a participant id or the shared sentinel. */
export type Owner = string

/** The sentinel value for "shared / all participants". */
export const GEMENSAMT = 'gemensamt'

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

/** One entry in the owner-bar option list */
export interface OwnerOption {
  id: string
  name: string
}

/**
 * Returns the ordered list of owner-bar options for a group:
 * one entry per participant, followed by a 'gemensamt' entry.
 *
 * @param participants  The group's participants.
 * @param gemensamtLabel  Display label for the shared option (from i18n).
 */
export function ownerOptions(
  participants: OwnerParticipant[],
  gemensamtLabel: string,
): OwnerOption[] {
  return [
    ...participants.map((p) => ({ id: p.id, name: p.name })),
    { id: GEMENSAMT, name: gemensamtLabel },
  ]
}

/**
 * Resolve an Owner value to paidFor + splitMode.
 *
 * - owner === GEMENSAMT  → all participants, EVENLY
 * - owner is a participant id → just that participant, EVENLY
 *   (if the id is not found in participants, falls back gracefully to
 *    first participant; returns empty array only when participants is empty)
 */
export function ownerToSplit(
  participants: OwnerParticipant[],
  owner: Owner,
): OwnerSplit {
  const toEntry = (p: OwnerParticipant) => ({
    participant: p.id,
    shares: '1',
  })

  if (owner === GEMENSAMT) {
    return {
      paidFor: participants.map(toEntry),
      splitMode: 'EVENLY' as SplitMode,
    }
  }

  // owner is a participant id
  const found = participants.find((p) => p.id === owner) ?? participants[0]
  return {
    paidFor: found ? [toEntry(found)] : [],
    splitMode: 'EVENLY' as SplitMode,
  }
}

/**
 * Derive the Owner for an existing expense from its paidFor participant IDs.
 * Used to pre-fill owner buttons on the edit form.
 *
 * - Exactly one paidFor id that matches a participant → that participant's id
 * - Everything else (multiple, all, none matching) → GEMENSAMT
 */
export function ownerFromExpense(
  participants: OwnerParticipant[],
  paidForParticipantIds: string[],
): Owner {
  if (!paidForParticipantIds || paidForParticipantIds.length === 0) {
    return GEMENSAMT
  }

  if (paidForParticipantIds.length === 1) {
    const id = paidForParticipantIds[0]
    const found = participants.find((p) => p.id === id)
    if (found) return found.id
  }

  return GEMENSAMT
}
