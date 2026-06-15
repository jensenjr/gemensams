/**
 * Account helpers for Gemensams bank-import attribution.
 *
 * Framework-agnostic — no Next.js / React imports.
 * Reused by the CSV import agent, tRPC procedures, and the MCP server.
 */

import { GEMENSAMT, Owner, OwnerParticipant } from '@/lib/owners'

/** Mirror of the Prisma AccountKind enum (populated after migration). */
export const AccountKind = {
  PERSONAL: 'PERSONAL',
  SHARED: 'SHARED',
  SAVINGS: 'SAVINGS',
} as const

export type AccountKind = (typeof AccountKind)[keyof typeof AccountKind]

/** Minimal shape of an Account as returned from the DB. */
export interface AccountRecord {
  id: string
  groupId: string
  name: string
  kind: AccountKind
  ownerParticipantId: string | null
  accountNumbers: string[]
  createdAt: Date
}

/**
 * Derive the default Owner for an account given the group's participant list.
 *
 * - PERSONAL → the ownerParticipantId (validated to exist in participants).
 *              Returns null when ownerParticipantId is missing/invalid.
 * - SHARED   → 'gemensamt'
 * - SAVINGS  → null  (savings/transfer: not a regular expense owner)
 */
export function accountDefaultOwner(
  account: Pick<AccountRecord, 'kind' | 'ownerParticipantId'>,
  participants: OwnerParticipant[],
): Owner | null {
  switch (account.kind) {
    case AccountKind.PERSONAL: {
      if (!account.ownerParticipantId) return null
      const found = participants.find((p) => p.id === account.ownerParticipantId)
      return found ? found.id : null
    }
    case AccountKind.SHARED:
      return GEMENSAMT
    case AccountKind.SAVINGS:
      return null
    default:
      return null
  }
}

/**
 * Normalize a bank account number for consistent matching.
 *
 * Strips spaces, dashes, and leading zeros so that:
 *   "1234-56-789 01"  →  "123456789 01"  →  "12345678901"
 *   "00123456789"     →  "123456789"
 *
 * Used when matching CSV rows against stored accountNumbers.
 */
export function normalizeAccountNumber(s: string): string {
  // Remove spaces and dashes
  const stripped = s.replace(/[\s-]/g, '')
  // Remove leading zeros
  return stripped.replace(/^0+/, '') || '0'
}
