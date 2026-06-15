'use client'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { GEMENSAMT, OwnerOption, ownerOptions } from '@/lib/owners'
import type { ImportParsedRow } from '@/trpc/routers/groups/import/parse.procedure'
import { trpc } from '@/trpc/client'
import { AlertTriangle, CheckCircle2, Upload } from 'lucide-react'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useRef, useState, useCallback } from 'react'
import { useCurrentGroup } from '../current-group-context'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatAmount(minor: number): string {
  return (minor / 100).toFixed(2).replace('.', ',') + ' kr'
}

function typeBadgeVariant(
  type: ImportParsedRow['type'],
): 'default' | 'secondary' | 'outline' {
  switch (type) {
    case 'EXPENSE':
      return 'default'
    case 'INCOME':
      return 'secondary'
    default:
      return 'outline'
  }
}

// ---------------------------------------------------------------------------
// Types for the review-queue UI state
// ---------------------------------------------------------------------------

interface RowState {
  /** Whether this row is included (will be imported as expense). */
  included: boolean
  /** Override type (EXPENSE enables inclusion). */
  type: ImportParsedRow['type']
  /** Selected owner (participant id or 'gemensamt'). */
  owner: string
}

type RowStates = Record<number, RowState>

function buildInitialStates(rows: ImportParsedRow[]): RowStates {
  const states: RowStates = {}
  for (const row of rows) {
    const isExpense = row.type === 'EXPENSE'
    const isDupe = row.isDuplicate
    states[row.index] = {
      included: isExpense && !isDupe,
      type: row.type,
      owner: row.defaultOwner ?? GEMENSAMT,
    }
  }
  return states
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function TypeLabel({
  type,
  t,
}: {
  type: ImportParsedRow['type']
  t: ReturnType<typeof useTranslations<'Import'>>
}) {
  const label = {
    EXPENSE: t('typeExpense'),
    INCOME: t('typeIncome'),
    TRANSFER: t('typeTransfer'),
    SAVINGS: t('typeSavings'),
  }[type]
  return <Badge variant={typeBadgeVariant(type)}>{label}</Badge>
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ImportPageClient() {
  const t = useTranslations('Import')
  const { groupId } = useCurrentGroup()
  const router = useRouter()

  const { data: groupData } = trpc.groups.get.useQuery({ groupId })
  const group = groupData?.group
  const participants = group?.participants ?? []

  const options: OwnerOption[] = ownerOptions(participants, t('ownerShared'))

  const parseMutation = trpc.groups.import.parse.useMutation()
  const commitMutation = trpc.groups.import.commit.useMutation()
  const utils = trpc.useUtils()

  const fileInputRef = useRef<HTMLInputElement>(null)
  const [parseResult, setParseResult] = useState<{
    rows: ImportParsedRow[]
    parseErrors: { lineNumber: number; raw: string; reason: string }[]
    unknownAccountNumbers: string[]
  } | null>(null)
  const [rowStates, setRowStates] = useState<RowStates>({})
  const [commitResult, setCommitResult] = useState<{
    created: number
    errors: string[]
  } | null>(null)

  // ---------------------------------------------------------------------------
  // File upload
  // ---------------------------------------------------------------------------

  const handleFiles = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return
      const b64Files: string[] = []
      for (const file of Array.from(files)) {
        const arrayBuffer = await file.arrayBuffer()
        const uint8 = new Uint8Array(arrayBuffer)
        // Convert to base64
        let binary = ''
        for (let i = 0; i < uint8.length; i++) {
          binary += String.fromCharCode(uint8[i])
        }
        b64Files.push(btoa(binary))
      }
      setCommitResult(null)
      const result = await parseMutation.mutateAsync({ groupId, files: b64Files })
      setParseResult(result)
      setRowStates(buildInitialStates(result.rows))
    },
    [groupId, parseMutation],
  )

  // ---------------------------------------------------------------------------
  // Row state mutators
  // ---------------------------------------------------------------------------

  const toggleIncluded = (index: number) => {
    setRowStates((prev) => {
      const s = prev[index]
      const nextIncluded = !s.included
      // If including a non-expense row, flip its type to EXPENSE
      const nextType = nextIncluded && s.type !== 'EXPENSE' ? 'EXPENSE' : s.type
      return { ...prev, [index]: { ...s, included: nextIncluded, type: nextType } }
    })
  }

  const setType = (index: number, type: ImportParsedRow['type']) => {
    setRowStates((prev) => {
      const s = prev[index]
      const included = type === 'EXPENSE' ? s.included : false
      return { ...prev, [index]: { ...s, type, included } }
    })
  }

  const setOwner = (index: number, owner: string) => {
    setRowStates((prev) => ({
      ...prev,
      [index]: { ...prev[index], owner },
    }))
  }

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------

  const includedRows =
    parseResult?.rows.filter(
      (r) => rowStates[r.index]?.included,
    ) ?? []

  const excludedCount = (parseResult?.rows.length ?? 0) - includedRows.length

  // Total per owner among included rows
  const totalPerOwner: Record<string, number> = {}
  for (const r of includedRows) {
    const owner = rowStates[r.index]?.owner ?? GEMENSAMT
    const amount = r.expenseAmountMinor ?? 0
    totalPerOwner[owner] = (totalPerOwner[owner] ?? 0) + amount
  }

  // ---------------------------------------------------------------------------
  // Commit
  // ---------------------------------------------------------------------------

  const handleCommit = async () => {
    if (!parseResult) return
    const toInsert = includedRows.map((r) => ({
      bookedDate: r.row.bookedDate,
      description: r.row.description,
      expenseAmountMinor: r.expenseAmountMinor ?? 0,
      owner: rowStates[r.index]?.owner ?? GEMENSAMT,
    }))
    if (toInsert.length === 0) return

    const result = await commitMutation.mutateAsync({ groupId, rows: toInsert })
    setCommitResult(result)
    utils.groups.expenses.invalidate()
    // Reset upload state
    setParseResult(null)
    setRowStates({})
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="flex flex-col gap-4">
      {/* Header card */}
      <Card className="rounded-none -mx-4 border-x-0 sm:border-x sm:rounded-lg sm:mx-0">
        <CardHeader className="p-4 sm:p-6">
          <CardTitle>{t('title')}</CardTitle>
          <CardDescription>{t('description')}</CardDescription>
        </CardHeader>

        <CardContent className="p-4 pt-0 sm:p-6 sm:pt-0 flex flex-col gap-4">
          {/* Upload area */}
          <div className="flex flex-col gap-2">
            <label
              htmlFor="csv-upload"
              className="flex flex-col items-center justify-center gap-2 border-2 border-dashed rounded-lg p-8 cursor-pointer hover:bg-muted/50 transition-colors"
            >
              <Upload className="w-8 h-8 text-muted-foreground" />
              <span className="text-sm font-medium">{t('uploadLabel')}</span>
              <span className="text-xs text-muted-foreground">
                {t('uploadHint')}
              </span>
            </label>
            <input
              id="csv-upload"
              ref={fileInputRef}
              type="file"
              accept=".csv"
              multiple
              className="sr-only"
              onChange={(e) => handleFiles(e.target.files)}
            />
          </div>

          {parseMutation.isPending && (
            <p className="text-sm text-muted-foreground">{t('parsing')}</p>
          )}

          {parseMutation.isError && (
            <p className="text-sm text-destructive">
              {t('parseError')}: {parseMutation.error.message}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Success result after commit */}
      {commitResult && (
        <Card className="rounded-none -mx-4 border-x-0 sm:border-x sm:rounded-lg sm:mx-0 border-green-500">
          <CardContent className="p-4 sm:p-6 flex flex-col gap-2">
            <div className="flex items-center gap-2 text-green-600">
              <CheckCircle2 className="w-5 h-5" />
              <span className="font-medium">
                {t('commitSuccess', { count: commitResult.created })}
              </span>
            </div>
            {commitResult.errors.length > 0 && (
              <ul className="text-sm text-destructive list-disc pl-5">
                {commitResult.errors.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            )}
            <Button
              variant="outline"
              size="sm"
              className="self-start"
              onClick={() => router.push(`/groups/${groupId}`)}
            >
              {t('goToExpenses')}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Parse errors */}
      {parseResult && parseResult.parseErrors.length > 0 && (
        <Card className="rounded-none -mx-4 border-x-0 sm:border-x sm:rounded-lg sm:mx-0">
          <CardHeader className="p-4 pb-2 sm:p-6 sm:pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-500" />
              {t('parseErrorsTitle', { count: parseResult.parseErrors.length })}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0 sm:p-6 sm:pt-0">
            <ul className="text-xs text-muted-foreground space-y-1">
              {parseResult.parseErrors.slice(0, 10).map((e, i) => (
                <li key={i}>
                  {t('parseErrorLine', { line: e.lineNumber })}: {e.reason}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Unknown account numbers */}
      {parseResult && parseResult.unknownAccountNumbers.length > 0 && (
        <Card className="rounded-none -mx-4 border-x-0 sm:border-x sm:rounded-lg sm:mx-0 border-amber-400">
          <CardContent className="p-4 sm:p-6 flex flex-col gap-2">
            <div className="flex items-center gap-2 text-amber-600">
              <AlertTriangle className="w-4 h-4" />
              <span className="font-medium">{t('unknownAccountsTitle')}</span>
            </div>
            <p className="text-sm text-muted-foreground">
              {t('unknownAccountsDesc')}
            </p>
            <ul className="text-xs font-mono list-disc pl-5">
              {parseResult.unknownAccountNumbers.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
            <Link
              href={`/groups/${groupId}/edit`}
              className="text-sm underline underline-offset-4"
            >
              {t('goToAccounts')}
            </Link>
          </CardContent>
        </Card>
      )}

      {/* Review queue */}
      {parseResult && parseResult.rows.length > 0 && (
        <Card className="rounded-none -mx-4 border-x-0 sm:border-x sm:rounded-lg sm:mx-0">
          <CardHeader className="p-4 pb-2 sm:p-6 sm:pb-2">
            <CardTitle className="text-base">{t('reviewTitle')}</CardTitle>
            <CardDescription>
              {t('reviewDescription', {
                total: parseResult.rows.length,
                included: includedRows.length,
                excluded: excludedCount,
              })}
            </CardDescription>
          </CardHeader>

          {/* Summary totals */}
          {includedRows.length > 0 && (
            <div className="px-4 sm:px-6 pb-2 flex flex-wrap gap-3">
              {Object.entries(totalPerOwner).map(([ownerId, total]) => {
                const name =
                  ownerId === GEMENSAMT
                    ? t('ownerShared')
                    : (options.find((o) => o.id === ownerId)?.name ?? ownerId)
                return (
                  <div
                    key={ownerId}
                    className="text-sm bg-muted rounded px-2 py-1"
                  >
                    <span className="font-medium">{name}</span>:{' '}
                    {formatAmount(total)}
                  </div>
                )
              })}
            </div>
          )}

          <CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10 pl-4">{t('colInclude')}</TableHead>
                  <TableHead>{t('colDate')}</TableHead>
                  <TableHead>{t('colDescription')}</TableHead>
                  <TableHead className="text-right">{t('colAmount')}</TableHead>
                  <TableHead>{t('colType')}</TableHead>
                  <TableHead>{t('colOwner')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {parseResult.rows.map((row) => {
                  const state = rowStates[row.index]
                  if (!state) return null
                  const isIncluded = state.included
                  const isDupe = row.isDuplicate
                  const amount =
                    row.expenseAmountMinor != null
                      ? formatAmount(row.expenseAmountMinor)
                      : row.type === 'INCOME'
                        ? `+${formatAmount(Math.abs(row.row.amountMinor))}`
                        : '—'

                  return (
                    <TableRow
                      key={row.index}
                      className={
                        !isIncluded ? 'opacity-50' : undefined
                      }
                    >
                      {/* Include checkbox */}
                      <TableCell className="pl-4">
                        <Checkbox
                          checked={isIncluded}
                          onCheckedChange={() => toggleIncluded(row.index)}
                          aria-label={t('colInclude')}
                        />
                      </TableCell>

                      {/* Date */}
                      <TableCell className="text-xs whitespace-nowrap">
                        {row.row.bookedDate}
                      </TableCell>

                      {/* Description + badges */}
                      <TableCell className="max-w-[200px]">
                        <div className="flex flex-col gap-0.5">
                          <span
                            className="truncate text-sm font-medium"
                            title={row.row.description}
                          >
                            {row.row.description}
                          </span>
                          <span
                            className="text-xs text-muted-foreground truncate"
                            title={row.reason}
                          >
                            {row.reason}
                          </span>
                          {isDupe && (
                            <Badge variant="outline" className="w-fit text-amber-600 border-amber-400 text-xs">
                              {t('duplicate')}
                            </Badge>
                          )}
                        </div>
                      </TableCell>

                      {/* Amount */}
                      <TableCell className="text-right text-sm font-mono whitespace-nowrap">
                        {amount}
                      </TableCell>

                      {/* Type selector */}
                      <TableCell>
                        <Select
                          value={state.type}
                          onValueChange={(v) =>
                            setType(row.index, v as ImportParsedRow['type'])
                          }
                        >
                          <SelectTrigger className="h-7 text-xs w-32">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="EXPENSE">
                              {t('typeExpense')}
                            </SelectItem>
                            <SelectItem value="INCOME">
                              {t('typeIncome')}
                            </SelectItem>
                            <SelectItem value="TRANSFER">
                              {t('typeTransfer')}
                            </SelectItem>
                            <SelectItem value="SAVINGS">
                              {t('typeSavings')}
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>

                      {/* Owner selector — only meaningful for EXPENSE */}
                      <TableCell>
                        {state.type === 'EXPENSE' ? (
                          <Select
                            value={state.owner}
                            onValueChange={(v) => setOwner(row.index, v)}
                          >
                            <SelectTrigger className="h-7 text-xs w-36">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {options.map((opt) => (
                                <SelectItem key={opt.id} value={opt.id}>
                                  {opt.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </CardContent>

          {/* Commit footer */}
          <div className="p-4 sm:p-6 pt-2 sm:pt-2 flex flex-col sm:flex-row gap-3 justify-between items-start sm:items-center border-t">
            <p className="text-sm text-muted-foreground">
              {t('commitSummary', {
                count: includedRows.length,
              })}
            </p>
            <Button
              onClick={handleCommit}
              disabled={includedRows.length === 0 || commitMutation.isPending}
            >
              {commitMutation.isPending
                ? t('committing')
                : t('commit', { count: includedRows.length })}
            </Button>
          </div>
        </Card>
      )}

      {parseResult && parseResult.rows.length === 0 && !parseMutation.isPending && (
        <Card className="rounded-none -mx-4 border-x-0 sm:border-x sm:rounded-lg sm:mx-0">
          <CardContent className="p-4 sm:p-6">
            <p className="text-sm text-muted-foreground">{t('noRows')}</p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
