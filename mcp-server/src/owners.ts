/**
 * Owner helpers — mirrors src/lib/owners.ts in the web app.
 * Keep in sync if the web app's owner model changes.
 *
 * "Owner" is pure sugar over Spliit's paidFor + splitMode fields.
 * Owner is either a participant id (string) or the literal 'gemensamt'.
 *
 * Owner → paidFor mapping (all shares = 1, splitMode = EVENLY):
 *   participantId  → paidFor = [that participant], EVENLY
 *   'gemensamt'    → paidFor = [all participants], EVENLY
 */

/** The sentinel value for "shared / all participants". */
export const GEMENSAMT = 'gemensamt'

/** An owner is either a participant id or the shared sentinel. */
export type Owner = string

/** Minimal participant shape */
export interface OwnerParticipant {
  id: string
  name: string
}

/** Result of resolving an owner to split fields */
export interface OwnerSplit {
  paidFor: { participant: string; shares: string }[]
  splitMode: 'EVENLY'
}

/**
 * Resolve an Owner value to paidFor + splitMode.
 *
 * - owner === GEMENSAMT  → all participants, EVENLY
 * - owner is a participant id → just that participant, EVENLY
 *   (falls back to first participant if id not found)
 */
export function ownerToSplit(
  participants: OwnerParticipant[],
  owner: Owner,
): OwnerSplit {
  const toEntry = (p: OwnerParticipant) => ({ participant: p.id, shares: '1' })

  if (owner === GEMENSAMT) {
    return { paidFor: participants.map(toEntry), splitMode: 'EVENLY' }
  }

  const found = participants.find((p) => p.id === owner) ?? participants[0]
  return {
    paidFor: found ? [toEntry(found)] : [],
    splitMode: 'EVENLY',
  }
}

/**
 * Derive the Owner for an existing expense from its paidFor participant IDs.
 *
 * - Exactly one paidFor id that matches a participant → that participant's id
 * - Everything else → GEMENSAMT
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
