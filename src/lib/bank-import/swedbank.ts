/**
 * Swedbank "Transaktioner" CSV parser.
 *
 * Pure logic — no React, no DB, no network.
 *
 * The export file is Latin-1 / CP1252 encoded. When the caller passes a
 * Buffer/Uint8Array the bytes are decoded as 'latin1'. When a string is passed
 * it is assumed to already be decoded.
 *
 * Row format (after stripping the outer-quote wrapper that Swedbank sometimes
 * emits) is standard comma-separated CSV with double-quoted string fields and
 * doubled inner quotes ("").
 */

/** One parsed data row from the Swedbank CSV. */
export interface ParsedRow {
  /** Original Radnummer from the file. */
  rowNumber: number
  /** Clearingnummer of the source account. */
  sourceClearing: string
  /** Kontonummer of the source account (unnormalized, as in the file). */
  sourceAccountNumber: string
  /** Produkt — account product name (e.g. "Personalkonto"). */
  product: string
  /** Valuta code (e.g. "SEK"). */
  currency: string
  /** Bokföringsdag as ISO-8601 date string "YYYY-MM-DD". */
  bookedDate: string
  /** Transaktionsdag as ISO-8601 date string "YYYY-MM-DD". */
  transactionDate: string
  /** Valutadag as ISO-8601 date string "YYYY-MM-DD". */
  valueDate: string
  /** Referens — counterparty reference or account number for transfers / Swish. */
  reference: string
  /** Beskrivning — merchant or description. */
  description: string
  /**
   * Signed integer öre (1/100 SEK).
   * Negative = money out, positive = money in.
   * E.g. -117.11 SEK → -11711 öre.
   */
  amountMinor: number
  /** Original decimal string from the file (e.g. "-117.11"). */
  amountText: string
}

/** Collected non-fatal parse errors (malformed lines). */
export interface ParseError {
  /** 1-based line number in the original file. */
  lineNumber: number
  raw: string
  reason: string
}

export interface ParseResult {
  rows: ParsedRow[]
  errors: ParseError[]
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Decode a Buffer/Uint8Array from Latin-1 (cp1252) to a JS string.
 * In Node.js the 'latin1' encoding maps byte values 0x00-0xFF to the
 * equivalent Unicode code points, which is correct for cp1252's lower half and
 * gives the right characters for common Swedish letters (å ä ö etc.).
 */
function decodeLatin1(buf: Buffer | Uint8Array): string {
  if (typeof Buffer !== 'undefined' && buf instanceof Buffer) {
    return buf.toString('latin1')
  }
  // Uint8Array fallback (edge / browser)
  return Array.from(buf)
    .map((b) => String.fromCharCode(b))
    .join('')
}

/**
 * Minimal CSV row tokenizer.
 *
 * Handles:
 *  - bare fields: foo,bar,baz
 *  - quoted fields: "hello","world"
 *  - doubled inner quotes: "say ""hello"""  → say "hello"
 *  - Swedbank's outer-quote wrapper:
 *      the whole row is wrapped in " ... " with all inner " doubled,
 *      so the raw line starts and ends with " and every internal quote
 *      appears as "". We detect and strip this before normal tokenizing.
 *
 * Returns null if the line cannot be tokenized.
 */
function tokenizeRow(raw: string): string[] | null {
  // Swedbank sometimes wraps the entire logical row in an extra pair of quotes
  // and doubles all internal quotes. Detect this: the raw value starts with "
  // and ends with " and contains no unescaped unquoted commas outside the
  // outer wrapper.
  // A simpler heuristic: if the string starts and ends with `"`, try stripping
  // the outer quotes and un-doubling. If the result tokenizes to ≥12 fields
  // we know it worked. We always try the wrapped interpretation first.
  let line = raw.trim()

  if (line.startsWith('"') && line.endsWith('"')) {
    // Strip outer quotes and unescape doubled inner quotes
    const inner = line.slice(1, -1).replace(/""/g, '"')
    const fields = splitCsvRow(inner)
    if (fields !== null && fields.length >= 12) {
      return fields
    }
  }

  // Plain form
  return splitCsvRow(line)
}

/** Split a single CSV line into fields (handles quoted fields + "" escaping). */
function splitCsvRow(line: string): string[] | null {
  const fields: string[] = []
  let i = 0

  while (i <= line.length) {
    if (i === line.length) {
      // trailing comma produced an empty last field; handled below
      break
    }

    if (line[i] === '"') {
      // Quoted field
      i++ // skip opening quote
      let field = ''
      while (i < line.length) {
        if (line[i] === '"') {
          if (line[i + 1] === '"') {
            // Escaped quote
            field += '"'
            i += 2
          } else {
            // End of quoted field
            i++
            break
          }
        } else {
          field += line[i]
          i++
        }
      }
      fields.push(field)
      // Expect comma or end of line
      if (i < line.length) {
        if (line[i] !== ',') return null // malformed
        i++ // skip comma
      }
    } else {
      // Bare field — read until next comma or end
      const start = i
      while (i < line.length && line[i] !== ',') i++
      fields.push(line.slice(start, i))
      if (i < line.length) i++ // skip comma
    }
  }

  return fields
}

/**
 * Convert a decimal string like "-117.11" or "3275.95" to integer öre.
 *
 * Strategy: split on '.', combine integer and fractional parts as integers,
 * applying sign. This avoids floating-point rounding issues.
 */
export function toMinorUnits(text: string): number {
  const trimmed = text.trim()
  if (trimmed === '' || trimmed === '-' || trimmed === '+') return 0

  const negative = trimmed.startsWith('-')
  const abs = trimmed.replace(/^[+-]/, '').replace(/\s/g, '')

  const dotIdx = abs.indexOf('.')
  let intPart: string
  let fracPart: string

  if (dotIdx === -1) {
    intPart = abs
    fracPart = '00'
  } else {
    intPart = abs.slice(0, dotIdx)
    fracPart = abs.slice(dotIdx + 1)
  }

  // Normalize fractional part to exactly 2 digits
  if (fracPart.length === 0) fracPart = '00'
  else if (fracPart.length === 1) fracPart = fracPart + '0'
  else if (fracPart.length > 2) fracPart = fracPart.slice(0, 2) // truncate

  const minor = parseInt(intPart || '0', 10) * 100 + parseInt(fracPart, 10)
  return negative ? -minor : minor
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse a Swedbank "Transaktioner" CSV export.
 *
 * @param input  Raw file bytes (Buffer or Uint8Array — decoded as Latin-1)
 *               OR an already-decoded string.
 * @returns      Parsed rows + non-fatal errors for malformed lines.
 */
export function parseSwedbankCsv(input: Buffer | Uint8Array | string): ParseResult {
  const text =
    typeof input === 'string'
      ? input
      : decodeLatin1(input as Buffer | Uint8Array)

  const lines = text.split(/\r?\n/)
  const rows: ParsedRow[] = []
  const errors: ParseError[] = []

  // Line 1 (index 0): metadata — skip.
  // Line 2 (index 1): headers — skip.
  // Data starts at index 2.

  for (let i = 2; i < lines.length; i++) {
    const raw = lines[i].trim()
    if (raw === '') continue

    const fields = tokenizeRow(raw)

    if (fields === null || fields.length < 12) {
      errors.push({
        lineNumber: i + 1,
        raw,
        reason:
          fields === null
            ? 'CSV tokenizer failed'
            : `Expected ≥12 fields, got ${fields.length}`,
      })
      continue
    }

    const [
      radnummer,
      clearingnummer,
      kontonummer,
      produkt,
      valuta,
      bokforingsdag,
      transaktionsdag,
      valutadag,
      referens,
      beskrivning,
      belopp,
      // bokfortSaldo (index 11) — present but not included in ParsedRow
    ] = fields

    const rowNumber = parseInt(radnummer, 10)
    if (isNaN(rowNumber)) {
      errors.push({
        lineNumber: i + 1,
        raw,
        reason: `Invalid Radnummer: "${radnummer}"`,
      })
      continue
    }

    let amountMinor: number
    try {
      amountMinor = toMinorUnits(belopp)
    } catch {
      errors.push({
        lineNumber: i + 1,
        raw,
        reason: `Invalid Belopp: "${belopp}"`,
      })
      continue
    }

    rows.push({
      rowNumber,
      sourceClearing: clearingnummer.trim(),
      sourceAccountNumber: kontonummer.trim(),
      product: produkt.trim(),
      currency: valuta.trim(),
      bookedDate: bokforingsdag.trim(),
      transactionDate: transaktionsdag.trim(),
      valueDate: valutadag.trim(),
      reference: referens.trim(),
      description: beskrivning.trim(),
      amountMinor,
      amountText: belopp.trim(),
    })
  }

  return { rows, errors }
}
