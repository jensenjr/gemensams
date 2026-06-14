'use client'

import { useCurrentGroup } from '@/app/groups/[groupId]/current-group-context'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { OWNER_BG_COLORS, OWNER_COLORS } from '@/lib/owner-colors'
import { Owner, OWNERS } from '@/lib/owners'
import { formatCurrency, getCurrencyFromGroup } from '@/lib/utils'
import { trpc } from '@/trpc/client'
import dayjs from 'dayjs'
import { X } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { useCallback, useMemo, useState } from 'react'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type RangePreset = 'thisMonth' | 'lastMonth' | 'last3Months' | 'thisYear' | 'custom'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function presetRange(preset: RangePreset): { from: string; to: string } {
  const now = new Date()
  const y = now.getUTCFullYear()
  const m = now.getUTCMonth()

  switch (preset) {
    case 'thisMonth':
      return {
        from: isoDate(new Date(Date.UTC(y, m, 1))),
        to: isoDate(new Date(Date.UTC(y, m + 1, 0))),
      }
    case 'lastMonth':
      return {
        from: isoDate(new Date(Date.UTC(y, m - 1, 1))),
        to: isoDate(new Date(Date.UTC(y, m, 0))),
      }
    case 'last3Months':
      return {
        from: isoDate(new Date(Date.UTC(y, m - 2, 1))),
        to: isoDate(new Date(Date.UTC(y, m + 1, 0))),
      }
    case 'thisYear':
      return {
        from: isoDate(new Date(Date.UTC(y, 0, 1))),
        to: isoDate(new Date(Date.UTC(y, 11, 31))),
      }
    default:
      return {
        from: isoDate(new Date(Date.UTC(y, m, 1))),
        to: isoDate(new Date(Date.UTC(y, m + 1, 0))),
      }
  }
}

// ---------------------------------------------------------------------------
// OwnerBadge
// ---------------------------------------------------------------------------

function OwnerBadge({
  owner,
  label,
}: {
  owner: Owner
  label: string
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${OWNER_BG_COLORS[owner]}`}
    >
      {label}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Bar chart (pure CSS/SVG, no external dependency)
// ---------------------------------------------------------------------------

type DayBar = {
  date: string
  total: number
  perOwner: Record<Owner, number>
}

function SpendChart({
  data,
  onClickDay,
  selectedDay,
}: {
  data: DayBar[]
  onClickDay: (date: string) => void
  selectedDay: string | null
}) {
  const maxTotal = Math.max(...data.map((d) => d.total), 1)
  const CHART_HEIGHT = 120
  const MIN_BAR_WIDTH = 8
  const BAR_GAP = 2

  // If many days, group by month
  const tooManyDays = data.length > 62

  const displayData = useMemo(() => {
    if (!tooManyDays) return data
    // Group by YYYY-MM
    const grouped = new Map<string, DayBar>()
    for (const d of data) {
      const key = d.date.slice(0, 7)
      if (!grouped.has(key)) {
        grouped.set(key, {
          date: key,
          total: 0,
          perOwner: { hans: 0, hennes: 0, gemensamt: 0, ovrigt: 0 },
        })
      }
      const entry = grouped.get(key)!
      entry.total += d.total
      for (const o of OWNERS) {
        entry.perOwner[o.key] += d.perOwner[o.key]
      }
    }
    return Array.from(grouped.values())
  }, [data, tooManyDays])

  if (displayData.length === 0) return null

  const barWidth = Math.max(MIN_BAR_WIDTH, Math.min(40, Math.floor(600 / displayData.length) - BAR_GAP))
  const totalWidth = displayData.length * (barWidth + BAR_GAP)

  return (
    <div className="overflow-x-auto">
      <div style={{ minWidth: totalWidth }} className="relative">
        <svg
          width={totalWidth}
          height={CHART_HEIGHT + 24}
          aria-label="Spending chart"
        >
          {displayData.map((d, i) => {
            const x = i * (barWidth + BAR_GAP)
            let stackY = CHART_HEIGHT
            const isSelected = d.date === selectedDay || (tooManyDays && selectedDay?.startsWith(d.date))

            return (
              <g
                key={d.date}
                onClick={() => onClickDay(d.date)}
                style={{ cursor: 'pointer' }}
                role="button"
                aria-label={d.date}
              >
                {/* Background highlight for selected */}
                {isSelected && (
                  <rect
                    x={x - 1}
                    y={0}
                    width={barWidth + 2}
                    height={CHART_HEIGHT + 24}
                    fill="currentColor"
                    className="text-muted/40"
                    rx={2}
                  />
                )}
                {/* Stacked owner segments */}
                {OWNERS.map(({ key: owner }) => {
                  const val = d.perOwner[owner]
                  if (val <= 0) return null
                  const barH = Math.max(2, Math.round((val / maxTotal) * CHART_HEIGHT))
                  stackY -= barH
                  return (
                    <rect
                      key={owner}
                      x={x}
                      y={stackY}
                      width={barWidth}
                      height={barH}
                      fill={OWNER_COLORS[owner]}
                      opacity={isSelected ? 1 : 0.85}
                    />
                  )
                })}
                {/* Date label */}
                <text
                  x={x + barWidth / 2}
                  y={CHART_HEIGHT + 14}
                  textAnchor="middle"
                  fontSize={9}
                  fill="currentColor"
                  className="text-muted-foreground"
                >
                  {tooManyDays
                    ? d.date.slice(5, 7) // MM
                    : d.date.slice(5)}   {/* MM-DD */}
                </text>
              </g>
            )
          })}
        </svg>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// DayDetail panel
// ---------------------------------------------------------------------------

function DayDetail({
  groupId,
  date,
  onClose,
}: {
  groupId: string
  date: string
  onClose: () => void
}) {
  const t = useTranslations('Stats.Dashboard')
  const tOwners = useTranslations('Owners')
  const locale = useLocale()
  const { group } = useCurrentGroup()
  const currency = group ? getCurrencyFromGroup(group) : null

  const { data, isLoading } = trpc.groups.stats.expensesForDay.useQuery({
    groupId,
    date,
  })

  const perOwner = useMemo(() => {
    if (!data) return {} as Record<Owner, number>
    return data.reduce(
      (acc, e) => {
        if (!e.isReimbursement) acc[e.owner] = (acc[e.owner] ?? 0) + e.amount
        return acc
      },
      {} as Record<Owner, number>,
    )
  }, [data])

  const dayTotal = useMemo(
    () => Object.values(perOwner).reduce((s, v) => s + v, 0),
    [perOwner],
  )

  const fmt = useCallback(
    (amount: number) =>
      currency ? formatCurrency(currency, amount, locale) : String(amount),
    [currency, locale],
  )

  return (
    <Card className="mt-4 border-primary/30">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-base">
            {t('dayDetail', { date })}
          </CardTitle>
          <Button variant="ghost" size="icon" onClick={onClose} className="h-7 w-7 shrink-0">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading && (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-5 w-full" />
            ))}
          </div>
        )}
        {data && (
          <>
            {/* Expense list */}
            <div className="mb-4 space-y-1">
              {data.map((e) => (
                <div
                  key={e.id}
                  className="flex items-center justify-between gap-2 rounded-md px-1 py-0.5 hover:bg-muted/50 text-sm"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <OwnerBadge
                      owner={e.owner}
                      label={tOwners(e.owner as Parameters<typeof tOwners>[0])}
                    />
                    <span className="truncate text-muted-foreground text-xs">
                      {e.category?.name ?? '–'}
                    </span>
                    <span className="truncate font-medium">{e.title}</span>
                    {e.isReimbursement && (
                      <span className="text-xs text-muted-foreground">({t('reimbursement')})</span>
                    )}
                  </div>
                  <span className="shrink-0 tabular-nums">{fmt(e.amount)}</span>
                </div>
              ))}
            </div>

            {/* Per-owner breakdown */}
            <div className="border-t pt-3">
              <div className="mb-1 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                {t('dayOwnerBreakdown')}
              </div>
              <div className="space-y-1">
                {OWNERS.map(({ key: owner }) => {
                  const amt = perOwner[owner] ?? 0
                  if (amt === 0) return null
                  return (
                    <div key={owner} className="flex items-center justify-between text-sm">
                      <OwnerBadge
                        owner={owner}
                        label={tOwners(owner as Parameters<typeof tOwners>[0])}
                      />
                      <span className="tabular-nums">{fmt(amt)}</span>
                    </div>
                  )
                })}
              </div>
              <div className="mt-2 flex items-center justify-between border-t pt-1 text-sm font-semibold">
                <span>{t('dayTotal')}</span>
                <span className="tabular-nums">{fmt(dayTotal)}</span>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// OwnerBreakdown
// ---------------------------------------------------------------------------

function OwnerBreakdown({
  groupId,
  from,
  to,
  categoryId,
  owner: ownerFilter,
}: {
  groupId: string
  from: string
  to: string
  categoryId?: number
  owner?: Owner
}) {
  const t = useTranslations('Stats.Dashboard')
  const tOwners = useTranslations('Owners')
  const locale = useLocale()
  const { group } = useCurrentGroup()
  const currency = group ? getCurrencyFromGroup(group) : null

  const { data, isLoading } = trpc.groups.stats.spendByOwner.useQuery({
    groupId,
    from,
    to,
    categoryId,
    owner: ownerFilter,
  })

  const fmt = useCallback(
    (amount: number) =>
      currency ? formatCurrency(currency, amount, locale) : String(amount),
    [currency, locale],
  )

  if (isLoading)
    return (
      <div className="space-y-2">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-6 w-full" />
        ))}
      </div>
    )

  if (!data) return null

  const { grandTotal, ...ownerAmounts } = data

  return (
    <div className="space-y-2">
      {OWNERS.map(({ key: owner }) => {
        const amt = ownerAmounts[owner] ?? 0
        const pct = grandTotal > 0 ? ((amt / grandTotal) * 100).toFixed(1) : '0.0'
        const barPct = grandTotal > 0 ? (amt / grandTotal) * 100 : 0

        return (
          <div key={owner} className="space-y-0.5">
            <div className="flex items-center justify-between text-sm">
              <OwnerBadge
                owner={owner}
                label={tOwners(owner as Parameters<typeof tOwners>[0])}
              />
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">{pct}%</span>
                <span className="tabular-nums font-medium">{fmt(amt)}</span>
              </div>
            </div>
            {/* Mini progress bar */}
            <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${barPct}%`,
                  backgroundColor: OWNER_COLORS[owner],
                }}
              />
            </div>
          </div>
        )
      })}
      <div className="flex items-center justify-between border-t pt-2 text-sm font-semibold">
        <span>{t('dayTotal')}</span>
        <span className="tabular-nums">{fmt(grandTotal)}</span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Legend
// ---------------------------------------------------------------------------

function ChartLegend() {
  const tOwners = useTranslations('Owners')
  return (
    <div className="flex flex-wrap gap-3 text-xs">
      {OWNERS.map(({ key: owner }) => (
        <div key={owner} className="flex items-center gap-1">
          <span
            className="inline-block h-3 w-3 rounded-sm"
            style={{ backgroundColor: OWNER_COLORS[owner] }}
          />
          <span>{tOwners(owner as Parameters<typeof tOwners>[0])}</span>
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main Dashboard
// ---------------------------------------------------------------------------

export function Dashboard() {
  const { groupId } = useCurrentGroup()
  const t = useTranslations('Stats.Dashboard')
  const tOwners = useTranslations('Owners')

  // Filters
  const [rangePreset, setRangePreset] = useState<RangePreset>('thisMonth')
  const [customFrom, setCustomFrom] = useState<string>('')
  const [customTo, setCustomTo] = useState<string>('')
  const [ownerFilter, setOwnerFilter] = useState<Owner | 'all'>('all')
  const [categoryFilter, setCategoryFilter] = useState<number | undefined>(undefined)
  const [selectedDay, setSelectedDay] = useState<string | null>(null)

  // Categories
  const { data: categoriesData } = trpc.categories.list.useQuery()
  const categories = categoriesData?.categories

  const { from, to } = useMemo(() => {
    if (rangePreset === 'custom') {
      return {
        from: customFrom || isoDate(new Date()),
        to: customTo || isoDate(new Date()),
      }
    }
    return presetRange(rangePreset)
  }, [rangePreset, customFrom, customTo])

  const ownerArg = ownerFilter === 'all' ? undefined : ownerFilter

  // Chart data
  const { data: chartData, isLoading: chartLoading } =
    trpc.groups.stats.spendByDay.useQuery({
      groupId,
      from,
      to,
      categoryId: categoryFilter,
      owner: ownerArg,
    })

  const handleBarClick = useCallback((date: string) => {
    setSelectedDay((prev) => (prev === date ? null : date))
  }, [])

  return (
    <Card className="mb-4">
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* ── Filters ── */}
        <div className="flex flex-wrap gap-2">
          {/* Range preset */}
          <Select
            value={rangePreset}
            onValueChange={(v) => {
              setRangePreset(v as RangePreset)
              setSelectedDay(null)
            }}
          >
            <SelectTrigger className="h-8 w-[150px] text-xs">
              <SelectValue placeholder={t('filterRange')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="thisMonth">{t('rangeThisMonth')}</SelectItem>
              <SelectItem value="lastMonth">{t('rangeLastMonth')}</SelectItem>
              <SelectItem value="last3Months">{t('rangeLast3Months')}</SelectItem>
              <SelectItem value="thisYear">{t('rangeThisYear')}</SelectItem>
              <SelectItem value="custom">{t('rangeCustom')}</SelectItem>
            </SelectContent>
          </Select>

          {/* Custom date inputs */}
          {rangePreset === 'custom' && (
            <>
              <div className="flex items-center gap-1">
                <span className="text-xs text-muted-foreground">{t('rangeFrom')}</span>
                <Input
                  type="date"
                  value={customFrom}
                  onChange={(e) => { setCustomFrom(e.target.value); setSelectedDay(null) }}
                  className="h-8 w-[130px] text-xs"
                />
              </div>
              <div className="flex items-center gap-1">
                <span className="text-xs text-muted-foreground">{t('rangeTo')}</span>
                <Input
                  type="date"
                  value={customTo}
                  onChange={(e) => { setCustomTo(e.target.value); setSelectedDay(null) }}
                  className="h-8 w-[130px] text-xs"
                />
              </div>
            </>
          )}

          {/* Owner filter */}
          <Select
            value={ownerFilter}
            onValueChange={(v) => {
              setOwnerFilter(v as Owner | 'all')
              setSelectedDay(null)
            }}
          >
            <SelectTrigger className="h-8 w-[140px] text-xs">
              <SelectValue placeholder={t('filterOwner')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('filterOwnerAll')}</SelectItem>
              {OWNERS.map(({ key: owner }) => (
                <SelectItem key={owner} value={owner}>
                  {tOwners(owner as Parameters<typeof tOwners>[0])}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Category filter */}
          <Select
            value={categoryFilter !== undefined ? String(categoryFilter) : 'all'}
            onValueChange={(v) => {
              setCategoryFilter(v === 'all' ? undefined : Number(v))
              setSelectedDay(null)
            }}
          >
            <SelectTrigger className="h-8 w-[160px] text-xs">
              <SelectValue placeholder={t('filterCategory')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('filterCategoryAll')}</SelectItem>
              {categories?.map((cat) => (
                <SelectItem key={cat.id} value={String(cat.id)}>
                  {cat.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* ── Chart ── */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">{t('chartTitle')}</span>
            <ChartLegend />
          </div>

          {chartLoading && (
            <div className="flex gap-1 items-end h-[120px]">
              {Array.from({ length: 15 }).map((_, i) => (
                <Skeleton
                  key={i}
                  className="flex-1"
                  style={{ height: `${20 + Math.random() * 80}%` }}
                />
              ))}
            </div>
          )}

          {!chartLoading && chartData && chartData.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {t('noData')}
            </p>
          )}

          {!chartLoading && chartData && chartData.length > 0 && (
            <SpendChart
              data={chartData}
              onClickDay={handleBarClick}
              selectedDay={selectedDay}
            />
          )}
        </div>

        {/* ── Day drill-down ── */}
        {selectedDay && (
          <DayDetail
            groupId={groupId}
            date={selectedDay}
            onClose={() => setSelectedDay(null)}
          />
        )}

        {/* ── Owner breakdown ── */}
        <div>
          <div className="mb-3 text-sm font-medium">{t('ownerBreakdown')}</div>
          <OwnerBreakdown
            groupId={groupId}
            from={from}
            to={to}
            categoryId={categoryFilter}
            owner={ownerArg}
          />
        </div>
      </CardContent>
    </Card>
  )
}
