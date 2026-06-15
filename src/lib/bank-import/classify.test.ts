/**
 * Unit tests for the transaction classifier.
 *
 * Uses anonymized data. No real personal information is included.
 */

import { AccountKind, AccountRecord } from '@/lib/accounts'
import { GEMENSAMT, OwnerParticipant } from '@/lib/owners'
import { classifyTransactions } from './classify'
import { ParsedRow } from './swedbank'

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const PARTICIPANTS: OwnerParticipant[] = [
  { id: 'participant-alice', name: 'Alice' },
  { id: 'participant-bob', name: 'Bob' },
]

/** Alice's personal current account */
const ALICE_PERSONAL: AccountRecord = {
  id: 'acc-alice',
  groupId: 'group-1',
  name: "Alice's account",
  kind: AccountKind.PERSONAL,
  ownerParticipantId: 'participant-alice',
  accountNumbers: ['0036297935'],
  createdAt: new Date('2024-01-01'),
}

/** Bob's personal current account */
const BOB_PERSONAL: AccountRecord = {
  id: 'acc-bob',
  groupId: 'group-1',
  name: "Bob's account",
  kind: AccountKind.PERSONAL,
  ownerParticipantId: 'participant-bob',
  accountNumbers: ['0036111111'],
  createdAt: new Date('2024-01-01'),
}

/** Shared household account */
const SHARED_ACCOUNT: AccountRecord = {
  id: 'acc-shared',
  groupId: 'group-1',
  name: 'Household account',
  kind: AccountKind.SHARED,
  ownerParticipantId: null,
  accountNumbers: ['0036999999'],
  createdAt: new Date('2024-01-01'),
}

/** Savings account */
const SAVINGS_ACCOUNT: AccountRecord = {
  id: 'acc-savings',
  groupId: 'group-1',
  name: 'Savings account',
  kind: AccountKind.SAVINGS,
  ownerParticipantId: null,
  accountNumbers: ['0036888888'],
  createdAt: new Date('2024-01-01'),
}

const ALL_ACCOUNTS = [ALICE_PERSONAL, BOB_PERSONAL, SHARED_ACCOUNT, SAVINGS_ACCOUNT]

/** Build a minimal ParsedRow with sensible defaults. */
function makeRow(overrides: Partial<ParsedRow> & { amountMinor: number }): ParsedRow {
  return {
    rowNumber: overrides.rowNumber ?? 1,
    sourceClearing: '82347',
    sourceAccountNumber: overrides.sourceAccountNumber ?? '0036297935',
    product: 'Personalkonto',
    currency: 'SEK',
    bookedDate: overrides.bookedDate ?? '2026-05-29',
    transactionDate: '2026-05-29',
    valueDate: '2026-05-29',
    reference: overrides.reference ?? '',
    description: overrides.description ?? 'MERCHANT AB',
    amountMinor: overrides.amountMinor,
    amountText: String(overrides.amountMinor / 100),
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// EXPENSE
// ---------------------------------------------------------------------------

describe('classifyTransactions — EXPENSE', () => {
  it('classifies a card purchase as EXPENSE with the account owner', () => {
    const rows = [
      makeRow({
        rowNumber: 1,
        sourceAccountNumber: '0036297935', // Alice's account
        description: 'HEMKOP MELLERUD',
        reference: 'HEMKOP MELLERUD',
        amountMinor: -11711,
      }),
    ]
    const [tx] = classifyTransactions(rows, ALL_ACCOUNTS, PARTICIPANTS)
    expect(tx.type).toBe('EXPENSE')
    expect(tx.defaultOwner).toBe('participant-alice')
    expect(tx.sourceAccountKnown).toBe(true)
    expect(tx.expenseAmountMinor).toBe(11711)
  })

  it('sets defaultOwner to gemensamt for a SHARED source account', () => {
    const rows = [
      makeRow({
        sourceAccountNumber: '0036999999', // shared account
        description: 'ICA MAXI',
        amountMinor: -5000,
      }),
    ]
    const [tx] = classifyTransactions(rows, ALL_ACCOUNTS, PARTICIPANTS)
    expect(tx.type).toBe('EXPENSE')
    expect(tx.defaultOwner).toBe(GEMENSAMT)
  })

  it('flags sourceAccountKnown=false and defaults to gemensamt for unknown accounts', () => {
    const rows = [
      makeRow({
        sourceAccountNumber: '9999000001', // not registered
        description: 'UNKNOWN MERCHANT',
        amountMinor: -2000,
      }),
    ]
    const [tx] = classifyTransactions(rows, ALL_ACCOUNTS, PARTICIPANTS)
    expect(tx.type).toBe('EXPENSE')
    expect(tx.sourceAccountKnown).toBe(false)
    expect(tx.defaultOwner).toBe(GEMENSAMT)
  })
})

// ---------------------------------------------------------------------------
// INCOME
// ---------------------------------------------------------------------------

describe('classifyTransactions — INCOME', () => {
  it('classifies a positive salary deposit as INCOME', () => {
    const rows = [
      makeRow({
        sourceAccountNumber: '0036297935',
        description: 'Lön',
        reference: 'EMPLOYER AB',
        amountMinor: 3250000, // 32 500 SEK
      }),
    ]
    const [tx] = classifyTransactions(rows, ALL_ACCOUNTS, PARTICIPANTS)
    expect(tx.type).toBe('INCOME')
    expect(tx.defaultOwner).toBe('participant-alice')
    expect(tx.expenseAmountMinor).toBeUndefined()
  })

  it('classifies a Swish inbound payment as INCOME', () => {
    const rows = [
      makeRow({
        sourceAccountNumber: '0036297935',
        description: 'Swish',
        reference: '+46701234567',
        amountMinor: 50000, // 500 SEK
      }),
    ]
    const [tx] = classifyTransactions(rows, ALL_ACCOUNTS, PARTICIPANTS)
    expect(tx.type).toBe('INCOME')
  })
})

// ---------------------------------------------------------------------------
// TRANSFER — reference is own account
// ---------------------------------------------------------------------------

describe('classifyTransactions — TRANSFER (reference is own account)', () => {
  it('classifies as TRANSFER when reference matches a known own account number', () => {
    const rows = [
      makeRow({
        rowNumber: 1,
        sourceAccountNumber: '0036297935', // Alice
        description: 'Överföring via internet',
        reference: '0036111111', // Bob's account
        amountMinor: -50000,
      }),
    ]
    const [tx] = classifyTransactions(rows, ALL_ACCOUNTS, PARTICIPANTS)
    expect(tx.type).toBe('TRANSFER')
    expect(tx.defaultOwner).toBeNull()
  })

  it('classifies as TRANSFER even without a transfer keyword in description', () => {
    const rows = [
      makeRow({
        sourceAccountNumber: '0036297935',
        description: 'Some text',
        reference: '0036999999', // shared account
        amountMinor: -10000,
      }),
    ]
    const [tx] = classifyTransactions(rows, ALL_ACCOUNTS, PARTICIPANTS)
    expect(tx.type).toBe('TRANSFER')
  })

  it('does NOT classify as TRANSFER when reference is an external account', () => {
    const rows = [
      makeRow({
        sourceAccountNumber: '0036297935',
        description: 'Swish',
        reference: '9990009999', // external
        amountMinor: -30000,
      }),
    ]
    const [tx] = classifyTransactions(rows, ALL_ACCOUNTS, PARTICIPANTS)
    expect(tx.type).toBe('EXPENSE')
  })
})

// ---------------------------------------------------------------------------
// SAVINGS
// ---------------------------------------------------------------------------

describe('classifyTransactions — SAVINGS', () => {
  it('classifies as SAVINGS when source is a SAVINGS account', () => {
    const rows = [
      makeRow({
        sourceAccountNumber: '0036888888', // savings account
        description: 'Ränta',
        amountMinor: 150,
      }),
    ]
    const [tx] = classifyTransactions(rows, ALL_ACCOUNTS, PARTICIPANTS)
    expect(tx.type).toBe('SAVINGS')
    expect(tx.defaultOwner).toBeNull()
  })

  it('classifies as SAVINGS when counterparty (reference) is a SAVINGS account', () => {
    const rows = [
      makeRow({
        sourceAccountNumber: '0036297935', // Alice's personal
        description: 'Sparande',
        reference: '0036888888', // savings account
        amountMinor: -100000,
      }),
    ]
    const [tx] = classifyTransactions(rows, ALL_ACCOUNTS, PARTICIPANTS)
    expect(tx.type).toBe('SAVINGS')
  })
})

// ---------------------------------------------------------------------------
// TRANSFER — pair matching (outflow + inflow across two own accounts)
// ---------------------------------------------------------------------------

describe('classifyTransactions — TRANSFER pair matching', () => {
  it('detects a pair: outflow from one own account and inflow to another on same date', () => {
    const outRow = makeRow({
      rowNumber: 1,
      sourceAccountNumber: '0036297935', // Alice
      description: 'Betalning',
      reference: '', // no reference — won't be caught by reference check alone
      bookedDate: '2026-05-20',
      amountMinor: -50000,
    })
    const inRow = makeRow({
      rowNumber: 2,
      sourceAccountNumber: '0036111111', // Bob
      description: 'Betalning mottagen',
      reference: '',
      bookedDate: '2026-05-20',
      amountMinor: 50000, // same amount, opposite sign
    })

    const [txOut, txIn] = classifyTransactions(
      [outRow, inRow],
      ALL_ACCOUNTS,
      PARTICIPANTS,
    )
    expect(txOut.type).toBe('TRANSFER')
    expect(txIn.type).toBe('TRANSFER')
    expect(txOut.transferPairRowNumber).toBe(2)
    expect(txIn.transferPairRowNumber).toBe(1)
    expect(txOut.defaultOwner).toBeNull()
    expect(txIn.defaultOwner).toBeNull()
  })

  it('does NOT pair rows on different dates', () => {
    const outRow = makeRow({
      rowNumber: 1,
      sourceAccountNumber: '0036297935',
      reference: '',
      description: 'Purchase',
      bookedDate: '2026-05-20',
      amountMinor: -50000,
    })
    const inRow = makeRow({
      rowNumber: 2,
      sourceAccountNumber: '0036111111',
      reference: '',
      description: 'Payment',
      bookedDate: '2026-05-21', // different date
      amountMinor: 50000,
    })

    const [txOut, txIn] = classifyTransactions(
      [outRow, inRow],
      ALL_ACCOUNTS,
      PARTICIPANTS,
    )
    expect(txOut.type).toBe('EXPENSE')
    expect(txIn.type).toBe('INCOME')
  })

  it('does NOT pair rows with different amounts', () => {
    const outRow = makeRow({
      rowNumber: 1,
      sourceAccountNumber: '0036297935',
      reference: '',
      description: 'Purchase',
      bookedDate: '2026-05-20',
      amountMinor: -50000,
    })
    const inRow = makeRow({
      rowNumber: 2,
      sourceAccountNumber: '0036111111',
      reference: '',
      description: 'Payment',
      bookedDate: '2026-05-20',
      amountMinor: 49999, // slightly different
    })

    const [txOut, txIn] = classifyTransactions(
      [outRow, inRow],
      ALL_ACCOUNTS,
      PARTICIPANTS,
    )
    expect(txOut.type).toBe('EXPENSE')
    expect(txIn.type).toBe('INCOME')
  })

  it('does NOT pair a row with itself (same account number)', () => {
    const outRow = makeRow({
      rowNumber: 1,
      sourceAccountNumber: '0036297935',
      reference: '',
      bookedDate: '2026-05-20',
      amountMinor: -50000,
    })
    const inRow = makeRow({
      rowNumber: 2,
      sourceAccountNumber: '0036297935', // same account
      reference: '',
      bookedDate: '2026-05-20',
      amountMinor: 50000,
    })

    const results = classifyTransactions([outRow, inRow], ALL_ACCOUNTS, PARTICIPANTS)
    // Should NOT be paired because they're from the same account
    const types = results.map((r) => r.type)
    // At least one should not be TRANSFER (both would be wrong)
    expect(types).not.toEqual(['TRANSFER', 'TRANSFER'])
  })

  it('handles multiple rows with no pair candidates gracefully', () => {
    const rows = [
      makeRow({ rowNumber: 1, sourceAccountNumber: '0036297935', amountMinor: -500 }),
      makeRow({ rowNumber: 2, sourceAccountNumber: '0036297935', amountMinor: -800 }),
    ]
    const results = classifyTransactions(rows, ALL_ACCOUNTS, PARTICIPANTS)
    expect(results.every((r) => r.type === 'EXPENSE')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('classifyTransactions — edge cases', () => {
  it('handles empty rows array', () => {
    const results = classifyTransactions([], ALL_ACCOUNTS, PARTICIPANTS)
    expect(results).toHaveLength(0)
  })

  it('handles accounts with leading-zero account numbers (normalizes correctly)', () => {
    // The stored account number is '0036297935' but the CSV row has it as-is
    // normalizeAccountNumber('0036297935') → '36297935'
    // Our index stores by normalized key so matching must also normalize
    const rows = [
      makeRow({
        sourceAccountNumber: '0036297935',
        amountMinor: -1000,
      }),
    ]
    const [tx] = classifyTransactions(rows, ALL_ACCOUNTS, PARTICIPANTS)
    expect(tx.sourceAccountKnown).toBe(true)
    expect(tx.defaultOwner).toBe('participant-alice')
  })

  it('EXPENSE rows expose expenseAmountMinor as positive öre', () => {
    const rows = [makeRow({ amountMinor: -11711 })]
    const [tx] = classifyTransactions(rows, ALL_ACCOUNTS, PARTICIPANTS)
    expect(tx.expenseAmountMinor).toBe(11711)
  })

  it('INCOME rows do not have expenseAmountMinor', () => {
    const rows = [makeRow({ amountMinor: 50000 })]
    const [tx] = classifyTransactions(rows, ALL_ACCOUNTS, PARTICIPANTS)
    expect(tx.expenseAmountMinor).toBeUndefined()
  })
})
