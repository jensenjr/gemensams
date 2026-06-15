/**
 * Unit tests for the Swedbank CSV parser.
 *
 * Uses anonymized values that mirror the real Swedbank export structure.
 * No real personal data is included.
 */

import { parseSwedbankCsv, toMinorUnits } from './swedbank'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a complete fake Swedbank CSV string (Latin-1-compatible ASCII for simplicity). */
function buildCsv(dataLines: string[]): string {
  const header =
    '* Transaktioner Period 2026-05-01–2026-05-31 Skapad 2026-06-13 10:34 CEST\n' +
    'Radnummer,Clearingnummer,Kontonummer,Produkt,Valuta,Bokföringsdag,Transaktionsdag,Valutadag,Referens,Beskrivning,Belopp,Bokfört saldo\n'
  return header + dataLines.join('\n')
}

// ---------------------------------------------------------------------------
// toMinorUnits
// ---------------------------------------------------------------------------

describe('toMinorUnits', () => {
  it('converts a negative decimal correctly', () => {
    expect(toMinorUnits('-117.11')).toBe(-11711)
  })

  it('converts a positive decimal correctly', () => {
    expect(toMinorUnits('3275.95')).toBe(327595)
  })

  it('handles whole numbers (no decimal point)', () => {
    expect(toMinorUnits('100')).toBe(10000)
    expect(toMinorUnits('-50')).toBe(-5000)
  })

  it('handles single fractional digit', () => {
    expect(toMinorUnits('10.5')).toBe(1050)
  })

  it('handles zero', () => {
    expect(toMinorUnits('0.00')).toBe(0)
    expect(toMinorUnits('0')).toBe(0)
  })

  it('handles large salary amount', () => {
    expect(toMinorUnits('32500.00')).toBe(3250000)
  })

  it('handles negative zero-ish', () => {
    expect(toMinorUnits('-0.01')).toBe(-1)
  })
})

// ---------------------------------------------------------------------------
// Parsing — plain CSV rows
// ---------------------------------------------------------------------------

describe('parseSwedbankCsv — plain rows', () => {
  const plainRow =
    '1,82347,0036297935,"Personalkonto",SEK,2026-05-29,2026-05-29,2026-05-29,"HEMKOP MELLERUD","HEMKOP MELLERUD",-117.11,3275.95'

  it('skips the metadata line and header', () => {
    const { rows } = parseSwedbankCsv(buildCsv([plainRow]))
    expect(rows).toHaveLength(1)
  })

  it('parses field values correctly', () => {
    const { rows } = parseSwedbankCsv(buildCsv([plainRow]))
    const row = rows[0]
    expect(row.rowNumber).toBe(1)
    expect(row.sourceClearing).toBe('82347')
    expect(row.sourceAccountNumber).toBe('0036297935')
    expect(row.product).toBe('Personalkonto')
    expect(row.currency).toBe('SEK')
    expect(row.bookedDate).toBe('2026-05-29')
    expect(row.transactionDate).toBe('2026-05-29')
    expect(row.valueDate).toBe('2026-05-29')
    expect(row.reference).toBe('HEMKOP MELLERUD')
    expect(row.description).toBe('HEMKOP MELLERUD')
    expect(row.amountMinor).toBe(-11711)
    expect(row.amountText).toBe('-117.11')
  })

  it('parses multiple rows', () => {
    const row2 =
      '2,82347,0036297935,"Personalkonto",SEK,2026-05-28,2026-05-28,2026-05-28,"Swish","ANDERS ANDERSSON",250.00,3393.06'
    const { rows, errors } = parseSwedbankCsv(buildCsv([plainRow, row2]))
    expect(errors).toHaveLength(0)
    expect(rows).toHaveLength(2)
    expect(rows[1].amountMinor).toBe(25000)
  })

  it('returns no errors for well-formed input', () => {
    const { errors } = parseSwedbankCsv(buildCsv([plainRow]))
    expect(errors).toHaveLength(0)
  })

  it('ignores empty lines gracefully', () => {
    const { rows, errors } = parseSwedbankCsv(buildCsv([plainRow, '', '  ']))
    expect(rows).toHaveLength(1)
    expect(errors).toHaveLength(0)
  })

  it('collects errors for malformed lines without throwing', () => {
    const bad = 'this,is,not,enough,fields'
    const { rows, errors } = parseSwedbankCsv(buildCsv([plainRow, bad]))
    expect(rows).toHaveLength(1)
    expect(errors).toHaveLength(1)
    expect(errors[0].raw).toBe(bad)
  })
})

// ---------------------------------------------------------------------------
// Parsing — outer-quote-wrapped rows (Swedbank's alternate export form)
// ---------------------------------------------------------------------------

describe('parseSwedbankCsv — wrapped-quote rows', () => {
  // The Swedbank export wraps the whole row in extra quotes and doubles inner ones.
  // Raw line:
  //   "1,82347,0036297935,""Personalkonto"",SEK,2026-05-29,2026-05-29,2026-05-29,""HEMKOP MELLERUD"",""HEMKOP MELLERUD"",-117.11,3275.95"
  const wrappedRow =
    '"1,82347,0036297935,""Personalkonto"",SEK,2026-05-29,2026-05-29,2026-05-29,""HEMKOP MELLERUD"",""HEMKOP MELLERUD"",-117.11,3275.95"'

  it('parses the wrapped form identically to the plain form', () => {
    const { rows, errors } = parseSwedbankCsv(buildCsv([wrappedRow]))
    expect(errors).toHaveLength(0)
    expect(rows).toHaveLength(1)
    const row = rows[0]
    expect(row.rowNumber).toBe(1)
    expect(row.product).toBe('Personalkonto')
    expect(row.description).toBe('HEMKOP MELLERUD')
    expect(row.amountMinor).toBe(-11711)
  })

  it('handles a mix of wrapped and plain rows in the same file', () => {
    const plainRow =
      '2,82347,0036297935,"Sparmanad",SEK,2026-05-27,2026-05-27,2026-05-27,"Salary","EMPLOYER AB",32500.00,21893.06'
    const { rows, errors } = parseSwedbankCsv(buildCsv([wrappedRow, plainRow]))
    expect(errors).toHaveLength(0)
    expect(rows).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------
// Latin-1 / CP1252 decoding
// ---------------------------------------------------------------------------

describe('parseSwedbankCsv — Latin-1 decoding', () => {
  it('correctly decodes å ä ö in descriptions from a Buffer', () => {
    // Build the data line as a Latin-1 encoded string containing Swedish chars.
    // å = 0xE5, ä = 0xE4, ö = 0xF6 in Latin-1.
    const description = 'Överföring sparande'
    // Build CSV entirely in ASCII-safe characters except the description field
    const plainPart = '3,82347,0036297935,"Personalkonto",SEK,2026-05-15,2026-05-15,2026-05-15,"0036111111",'
    const suffix = ',-500.00,5000.00'
    const csvString =
      '* Transaktioner Period 2026-05-01–2026-05-31 Skapad 2026-06-13\n' +
      'Radnummer,Clearingnummer,Kontonummer,Produkt,Valuta,Bokföringsdag,Transaktionsdag,Valutadag,Referens,Beskrivning,Belopp,Bokfört saldo\n' +
      plainPart +
      '"' + description + '"' +
      suffix

    // Encode as Latin-1 bytes
    const latin1Bytes = Buffer.from(csvString, 'latin1')

    const { rows, errors } = parseSwedbankCsv(latin1Bytes)
    expect(errors).toHaveLength(0)
    expect(rows).toHaveLength(1)
    // After decoding the Buffer as latin1 → the Swedish chars should be intact
    expect(rows[0].description).toBe('Överföring sparande')
  })

  it('accepts a pre-decoded string with Swedish characters', () => {
    const row =
      '4,82347,0036297935,"Personalkonto",SEK,2026-05-10,2026-05-10,2026-05-10,"ICA MAXI ÅMÅL","ICA MAXI ÅMÅL",-234.50,6500.00'
    const { rows, errors } = parseSwedbankCsv(buildCsv([row]))
    expect(errors).toHaveLength(0)
    expect(rows[0].description).toBe('ICA MAXI ÅMÅL')
  })
})
