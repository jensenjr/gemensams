/**
 * Transaction classifier for Swedbank CSV rows.
 *
 * Pure logic — no React, no DB, no network.
 *
 * Takes ParsedRow[] (from parseSwedbankCsv) and a set of registered accounts
 * plus participants and classifies each row into one of:
 *   EXPENSE | INCOME | TRANSFER | SAVINGS
 */

import {
  AccountKind,
  AccountRecord,
  accountDefaultOwner,
  normalizeAccountNumber,
} from '@/lib/accounts'
import { GEMENSAMT, Owner, OwnerParticipant } from '@/lib/owners'
import { ParsedRow } from './swedbank'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TxType = 'EXPENSE' | 'INCOME' | 'TRANSFER' | 'SAVINGS'

export interface ClassifiedTx {
  /** Original parsed row. */
  row: ParsedRow

  /** Classification. */
  type: TxType

  /**
   * Default Owner for this transaction:
   *  - EXPENSE: derived from source account (participant id or 'gemensamt')
   *  - INCOME:  same derivation (who received it)
   *  - TRANSFER / SAVINGS: null (not directly expensed)
   */
  defaultOwner: Owner | null

  /** Human-readable explanation of why this classification was chosen. */
  reason: string

  /**
   * True if the source account (by account number) was found in the registered
   * accounts list. False means the UI should prompt the user to map it.
   */
  sourceAccountKnown: boolean

  /**
   * For EXPENSE rows: the positive öre amount (abs of the negative amountMinor).
   * For all other types: undefined.
   */
  expenseAmountMinor?: number

  /**
   * If this row is one leg of a detected transfer pair, the rowNumber of the
   * matching leg is stored here. Both legs are classified TRANSFER.
   */
  transferPairRowNumber?: number
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Build a lookup map: normalized account number → AccountRecord. */
function buildAccountIndex(
  accounts: AccountRecord[],
): Map<string, AccountRecord> {
  const map = new Map<string, AccountRecord>()
  for (const acc of accounts) {
    for (const num of acc.accountNumbers) {
      const normalized = normalizeAccountNumber(num)
      if (normalized) map.set(normalized, acc)
    }
  }
  return map
}

/** All normalized own-account numbers as a Set for quick membership tests. */
function buildOwnAccountSet(accounts: AccountRecord[]): Set<string> {
  const set = new Set<string>()
  for (const acc of accounts) {
    for (const num of acc.accountNumbers) {
      const normalized = normalizeAccountNumber(num)
      if (normalized) set.add(normalized)
    }
  }
  return set
}

const TRANSFER_DESCRIPTION_PATTERNS = [
  /överföring/i,
  /transfer/i,
  /internet/i, // "Överföring via internet"
]

function looksLikeTransferDescription(desc: string): boolean {
  return TRANSFER_DESCRIPTION_PATTERNS.some((re) => re.test(desc))
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Classify an array of ParsedRow objects.
 *
 * @param rows         Output from parseSwedbankCsv.
 * @param accounts     All registered AccountRecord objects for the group.
 * @param participants Participant list for the group.
 */
export function classifyTransactions(
  rows: ParsedRow[],
  accounts: AccountRecord[],
  participants: OwnerParticipant[],
): ClassifiedTx[] {
  const accountIndex = buildAccountIndex(accounts)
  const ownAccountSet = buildOwnAccountSet(accounts)

  // First pass: classify each row independently.
  const results: ClassifiedTx[] = rows.map((row) => {
    return classifyRow(row, accountIndex, ownAccountSet, participants)
  })

  // Second pass: pair-match transfers within the batch.
  // An outflow (−X) and an inflow (+X) on the same bookedDate across two
  // different own accounts constitute a transfer pair — both legs become TRANSFER.
  pairMatchTransfers(results, ownAccountSet)

  return results
}

function classifyRow(
  row: ParsedRow,
  accountIndex: Map<string, AccountRecord>,
  ownAccountSet: Set<string>,
  participants: OwnerParticipant[],
): ClassifiedTx {
  const normalizedSource = normalizeAccountNumber(row.sourceAccountNumber)
  const sourceAccount = accountIndex.get(normalizedSource) ?? null
  const sourceAccountKnown = sourceAccount !== null

  const normalizedRef = row.reference
    ? normalizeAccountNumber(row.reference)
    : ''
  const refIsOwnAccount = normalizedRef !== '' && ownAccountSet.has(normalizedRef)

  // Resolve defaultOwner for EXPENSE/INCOME
  const defaultOwner: Owner | null = sourceAccount
    ? accountDefaultOwner(sourceAccount, participants)
    : GEMENSAMT // unknown source → shared fallback

  // ---- SAVINGS ----
  // Source is a savings account, OR the counterparty (reference) is a savings account.
  const counterpartyAccount = normalizedRef
    ? accountIndex.get(normalizedRef) ?? null
    : null

  const sourceIsSavings = sourceAccount?.kind === AccountKind.SAVINGS
  const counterpartyIsSavings = counterpartyAccount?.kind === AccountKind.SAVINGS

  if (sourceIsSavings || counterpartyIsSavings) {
    return {
      row,
      type: 'SAVINGS',
      defaultOwner: null,
      reason: sourceIsSavings
        ? 'Source account is a SAVINGS account'
        : 'Counterparty account is a SAVINGS account',
      sourceAccountKnown,
    }
  }

  // ---- TRANSFER ----
  // Reference matches a known own account (excluding savings, handled above),
  // or description contains transfer keywords AND reference is a known account.
  const descLooksLikeTransfer = looksLikeTransferDescription(row.description)

  if (refIsOwnAccount) {
    const reason = descLooksLikeTransfer
      ? `Reference ${row.reference} is a known own account and description indicates transfer`
      : `Reference ${row.reference} is a known own account`
    return {
      row,
      type: 'TRANSFER',
      defaultOwner: null,
      reason,
      sourceAccountKnown,
    }
  }

  // ---- INCOME ----
  if (row.amountMinor > 0) {
    return {
      row,
      type: 'INCOME',
      defaultOwner,
      reason: `Positive amount (${row.amountText}); not a transfer`,
      sourceAccountKnown,
    }
  }

  // ---- EXPENSE ----
  // amount < 0 and external
  const expenseAmountMinor = Math.abs(row.amountMinor)
  const ownerReason = sourceAccount
    ? `Source account ${row.sourceAccountNumber} (${sourceAccount.kind}) → owner`
    : `Source account ${row.sourceAccountNumber} not registered; defaulting to gemensamt`

  return {
    row,
    type: 'EXPENSE',
    defaultOwner,
    reason: ownerReason,
    sourceAccountKnown,
    expenseAmountMinor,
  }
}

/**
 * Second pass: detect transfer pairs.
 *
 * Criteria: within the parsed batch, find an EXPENSE row (amountMinor < 0)
 * and an INCOME row (amountMinor > 0) where:
 *  - abs(amounts) match
 *  - same bookedDate
 *  - BOTH have sourceAccountKnown=true (both are own accounts)
 *  - they come from different account numbers
 *
 * Mutates results in place.
 */
function pairMatchTransfers(
  results: ClassifiedTx[],
  ownAccountSet: Set<string>,
): void {
  // Only consider rows where source is known (i.e. own account)
  const candidates = results.filter(
    (r) =>
      r.sourceAccountKnown &&
      ownAccountSet.has(normalizeAccountNumber(r.row.sourceAccountNumber)) &&
      // Not already classified as TRANSFER or SAVINGS
      (r.type === 'EXPENSE' || r.type === 'INCOME'),
  )

  // Group by (date, absAmount)
  type Key = string
  const outflows = new Map<Key, ClassifiedTx[]>()
  const inflows = new Map<Key, ClassifiedTx[]>()

  for (const result of candidates) {
    const key: Key = `${result.row.bookedDate}:${Math.abs(result.row.amountMinor)}`
    if (result.row.amountMinor < 0) {
      const list = outflows.get(key) ?? []
      list.push(result)
      outflows.set(key, list)
    } else if (result.row.amountMinor > 0) {
      const list = inflows.get(key) ?? []
      list.push(result)
      inflows.set(key, list)
    }
  }

  const usedOutflow = new Set<number>()
  const usedInflow = new Set<number>()

  for (const [key, outs] of Array.from(outflows.entries())) {
    const ins = inflows.get(key)
    if (!ins) continue

    for (const out of outs) {
      if (usedOutflow.has(out.row.rowNumber)) continue

      // Find a matching inflow from a different account
      const match = ins.find(
        (inf) =>
          !usedInflow.has(inf.row.rowNumber) &&
          normalizeAccountNumber(inf.row.sourceAccountNumber) !==
            normalizeAccountNumber(out.row.sourceAccountNumber),
      )

      if (!match) continue

      usedOutflow.add(out.row.rowNumber)
      usedInflow.add(match.row.rowNumber)

      out.type = 'TRANSFER'
      out.defaultOwner = null
      out.expenseAmountMinor = undefined
      out.reason = `Pair-matched transfer: outflow paired with row ${match.row.rowNumber} (same date + amount, different own accounts)`
      out.transferPairRowNumber = match.row.rowNumber

      match.type = 'TRANSFER'
      match.defaultOwner = null
      match.reason = `Pair-matched transfer: inflow paired with row ${out.row.rowNumber} (same date + amount, different own accounts)`
      match.transferPairRowNumber = out.row.rowNumber
    }
  }
}
