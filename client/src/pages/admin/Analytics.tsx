import { useEffect, useState, useMemo, useCallback } from 'react'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell,
} from 'recharts'
import { supabase } from '@/lib/supabase'
import { downloadCsv } from '@/lib/csv'
import { useChartWidth, tickInterval } from '@/hooks/useChartWidth'
import EmptyState, { EMPTY_ICONS } from '@/components/ui/EmptyState'
import type { Order } from '@/types'

const PIE_COLORS = ['#9b5e28', '#c47a2e', '#dba96a', '#ecddd0']
type PeriodPreset = 'today' | 'week' | 'month' | 'custom'

/** Formats a Date as local YYYY-MM-DD (avoids UTC off-by-one shifts in PH timezone). */
function toLocalDateKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function formatReadableDate(dateStr: string): string {
  const parsed = new Date(`${dateStr}T00:00:00`)
  if (Number.isNaN(parsed.getTime())) return dateStr
  return parsed.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function Analytics() {
  const [period, setPeriod] = useState<PeriodPreset>('week')
  const [customFrom, setCustomFrom] = useState(() => toLocalDateKey(new Date(Date.now() - 7 * 86400000)))
  const [customTo, setCustomTo] = useState(() => toLocalDateKey(new Date()))
  const [showCustom, setShowCustom] = useState(false)
  const [granularity, setGranularity] = useState<'hourly' | 'daily' | 'monthly'>('daily')

  const [trendData, setTrendData] = useState<{ label: string; revenue: number; orders: number }[]>([])
  const [categoryData, setCategoryData] = useState<{ name: string; value: number }[]>([])
  const [topProducts, setTopProducts] = useState<{ name: string; orders: number; revenue: number }[]>([])
  const [loading, setLoading] = useState(true)

  // Adapt the trend chart's tick density to the space it actually gets.
  const [trendRef, trendWidth] = useChartWidth<HTMLDivElement>()

  const trendAxis = useMemo(() => {
    const usable = Math.max(0, trendWidth - 46)
    // "May 26" at 11px monospace is ~44px.
    const labelWidth = 44
    const angle = usable > 0 && usable < trendData.length * 74 ? -45 : 0
    return {
      angle,
      tickInterval: tickInterval(usable, trendData.length, labelWidth),
    }
  }, [trendWidth, trendData.length])

  const trendAngle = trendAxis.angle
  const trendTickInterval = trendAxis.tickInterval

  const periodLabel = useMemo(() => {
    if (period === 'today') return 'Today'
    if (period === 'week') return 'This Week (Last 7 Days)'
    if (period === 'month') return 'This Month (Last 30 Days)'
    const [fromStr, toStr] = customFrom <= customTo ? [customFrom, customTo] : [customTo, customFrom]
    return `${formatReadableDate(fromStr)} – ${formatReadableDate(toStr)}`
  }, [period, customFrom, customTo])

  const fetchData = useCallback(async () => {
    setLoading(true)
    const now = new Date()
    let since: Date
    let until: Date = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999)

    if (period === 'today') {
      since = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0)
    } else if (period === 'week') {
      // Exactly 7 calendar days inclusive of today (matches Dashboard)
      since = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6, 0, 0, 0, 0)
    } else if (period === 'month') {
      // Exactly 30 calendar days inclusive of today (matches Dashboard)
      since = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29, 0, 0, 0, 0)
    } else {
      const [fromStr, toStr] = customFrom <= customTo ? [customFrom, customTo] : [customTo, customFrom]
      since = new Date(`${fromStr}T00:00:00`)
      until = new Date(`${toStr}T23:59:59.999`)
    }

    const { data } = await supabase
      .from('orders')
      .select('*, order_items(*, products(name, category:product_categories(name)))')
      .eq('status', 'completed')
      .gte('created_at', since.toISOString())
      .lte('created_at', until.toISOString())

    const orders: Order[] = data ?? []

    if (period === 'today') {
      setGranularity('hourly')
      const hourMap = new Map<string, { label: string; revenue: number; orders: number; timestamp: number }>()
      for (let h = 8; h <= 22; h += 2) {
        const label = `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? 'AM' : 'PM'}`
        const key = String(h).padStart(2, '0')
        hourMap.set(key, { label, revenue: 0, orders: 0, timestamp: h })
      }
      for (const o of orders) {
        const h = new Date(o.created_at).getHours()
        const bucketHour = Math.floor(h / 2) * 2
        const key = String(bucketHour).padStart(2, '0')
        const existing = hourMap.get(key)
        if (existing) {
          existing.revenue += Number(o.total_amount)
          existing.orders += 1
        }
      }
      setTrendData(
        Array.from(hourMap.values())
          .sort((a, b) => a.timestamp - b.timestamp)
          .map(item => ({ label: item.label, revenue: Math.round(item.revenue * 100) / 100, orders: item.orders }))
      )
    } else {
      const startDay = new Date(since.getFullYear(), since.getMonth(), since.getDate())
      const endDay = new Date(until.getFullYear(), until.getMonth(), until.getDate())
      const spanDays = Math.max(1, Math.round((endDay.getTime() - startDay.getTime()) / 86400000) + 1)

      if (spanDays <= 62) {
        setGranularity('daily')
        const dayMap = new Map<string, { label: string; revenue: number; orders: number; timestamp: number }>()
        for (let i = 0; i < spanDays; i++) {
          const d = new Date(startDay.getFullYear(), startDay.getMonth(), startDay.getDate() + i)
          const key = toLocalDateKey(d)
          const label = d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })
          dayMap.set(key, { label, revenue: 0, orders: 0, timestamp: d.getTime() })
        }
        for (const o of orders) {
          const key = toLocalDateKey(new Date(o.created_at))
          const existing = dayMap.get(key)
          if (existing) {
            existing.revenue += Number(o.total_amount)
            existing.orders += 1
          }
        }
        setTrendData(
          Array.from(dayMap.values())
            .sort((a, b) => a.timestamp - b.timestamp)
            .map(item => ({ label: item.label, revenue: Math.round(item.revenue * 100) / 100, orders: item.orders }))
        )
      } else {
        setGranularity('monthly')
        const monthMap = new Map<string, { label: string; revenue: number; orders: number; timestamp: number }>()
        const cursor = new Date(startDay.getFullYear(), startDay.getMonth(), 1)
        const endMonth = new Date(endDay.getFullYear(), endDay.getMonth(), 1)
        while (cursor <= endMonth) {
          const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`
          const label = cursor.toLocaleDateString('en-PH', { month: 'short', year: '2-digit' })
          monthMap.set(key, { label, revenue: 0, orders: 0, timestamp: cursor.getTime() })
          cursor.setMonth(cursor.getMonth() + 1)
        }
        for (const o of orders) {
          const d = new Date(o.created_at)
          const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
          const existing = monthMap.get(key)
          if (existing) {
            existing.revenue += Number(o.total_amount)
            existing.orders += 1
          } else {
            const label = d.toLocaleDateString('en-PH', { month: 'short', year: '2-digit' })
            monthMap.set(key, { label, revenue: Number(o.total_amount), orders: 1, timestamp: d.getTime() })
          }
        }
        setTrendData(
          Array.from(monthMap.values())
            .sort((a, b) => a.timestamp - b.timestamp)
            .map(item => ({ label: item.label, revenue: Math.round(item.revenue * 100) / 100, orders: item.orders }))
        )
      }
    }

    // Category breakdown
    const catMap: Record<string, number> = {}
    for (const o of orders) {
      for (const item of (o.order_items as unknown as Array<{ quantity: number; products?: { category?: { name: string } } }> ?? [])) {
        const cat = item.products?.category?.name ?? 'Other'
        catMap[cat] = (catMap[cat] ?? 0) + item.quantity
      }
    }
    const catTotal = Object.values(catMap).reduce((s, v) => s + v, 0)
    setCategoryData(catTotal > 0 ? Object.entries(catMap).map(([name, v]) => ({ name, value: Math.round((v / catTotal) * 100) })) : [])

    // Top products
    const prodMap: Record<string, { orders: number; revenue: number }> = {}
    for (const o of orders) {
      for (const item of (o.order_items as unknown as Array<{ product_name: string; quantity: number; line_total: number }> ?? [])) {
        if (!prodMap[item.product_name]) prodMap[item.product_name] = { orders: 0, revenue: 0 }
        prodMap[item.product_name].orders += item.quantity
        prodMap[item.product_name].revenue += Number(item.line_total)
      }
    }
    setTopProducts(
      Object.entries(prodMap)
        .map(([name, v]) => ({ name, ...v }))
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 6)
    )

    setLoading(false)
  }, [period, customFrom, customTo])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const totalRev  = trendData.reduce((s, m) => s + m.revenue, 0)
  const totalOrd  = trendData.reduce((s, m) => s + m.orders, 0)
  const avgOrder  = totalOrd > 0 ? totalRev / totalOrd : 0
  const bestSlot  = trendData.reduce((best, m) => m.revenue > (best?.revenue ?? 0) ? m : best, trendData[0])

  const trendTitle =
    granularity === 'hourly'
      ? 'Hourly Revenue Trend'
      : granularity === 'daily'
        ? 'Daily Revenue Trend'
        : 'Monthly Revenue Trend'

  function handleExportAnalyticsCsv() {
    const today = toLocalDateKey(new Date())
    const trendSection =
      granularity === 'hourly' ? 'HOURLY TREND' : granularity === 'daily' ? 'DAILY TREND' : 'MONTHLY TREND'
    const headers = ['Section', 'Metric / Item', 'Orders / Share', 'Revenue (PHP)']
    const rows: Array<Array<string | number>> = [
      ['SUMMARY KPI', `Period (${periodLabel}) — Total Orders`, totalOrd, totalRev.toFixed(2)],
      ['SUMMARY KPI', 'Average Order Value', 1, avgOrder.toFixed(2)],
      ...(bestSlot ? [['SUMMARY KPI', `Best Period (${bestSlot.label})`, bestSlot.orders, bestSlot.revenue.toFixed(2)]] : []),
      ...trendData.map(m => [trendSection, m.label, m.orders, m.revenue.toFixed(2)]),
      ...categoryData.map(c => ['CATEGORY SHARE', c.name, `${c.value}%`, '']),
      ...topProducts.map(p => ['TOP PRODUCT', p.name, p.orders, p.revenue.toFixed(2)]),
    ]
    downloadCsv(`wings-zone-sales-analytics-${today}.csv`, headers, rows)
  }

  return (
    <div className="page">
      {/* Header */}
      <div style={{ marginBottom: showCustom && period === 'custom' ? 14 : 26, display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
        <div>
          <p className="overline" style={{ marginBottom: 6, textDecoration: 'none' }}>Wing&apos;s Zone · Analytics</p>
          <h1 className="page-title" style={{ fontSize: 26 }}>Wing&apos;s Zone — Sales Analytics</h1>
          <p style={{ fontSize: 13, color: 'var(--muted-foreground)' }}>Performance overview for Wing&apos;s Zone · Powered by WINGTRACK</p>
        </div>

        {/* Period controls — matching Dashboard */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            id="btn-export-analytics-csv"
            type="button"
            onClick={handleExportAnalyticsCsv}
            disabled={loading}
            style={{
              padding: '8px 14px', borderRadius: 8, fontSize: 13, fontWeight: 500,
              fontFamily: 'Inter',
              border: '1px solid var(--border)',
              background: 'var(--card)',
              color: 'var(--foreground)',
              boxShadow: 'var(--shadow-xs)',
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.6 : 1,
              display: 'flex', alignItems: 'center', gap: 6,
              transition: 'all var(--t-fast) var(--ease)',
            }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            Export CSV
          </button>

          <div
            role="group"
            aria-label="Reporting period"
            style={{
              display: 'flex', gap: 2, padding: 3,
              background: 'var(--muted)', borderRadius: 10,
              boxShadow: 'inset 0 1px 2px rgba(25,21,18,0.05)',
            }}
          >
            {(['today', 'week', 'month'] as const).map((p, i) => {
              const active = period === p
              return (
                <button
                  key={p}
                  id={`analytics-period-${p}`}
                  type="button"
                  aria-pressed={active}
                  onClick={() => { setPeriod(p); setShowCustom(false) }}
                  style={{
                    padding: '7px 15px', borderRadius: 7, fontSize: 13, cursor: 'pointer',
                    fontFamily: 'Inter', fontWeight: active ? 600 : 500,
                    border: 'none',
                    background: active ? 'var(--card)' : 'transparent',
                    color: active ? 'var(--primary)' : 'var(--muted-foreground)',
                    boxShadow: active ? 'var(--shadow-sm)' : 'none',
                    transition: 'background var(--t-fast) var(--ease), color var(--t-fast) var(--ease)',
                  }}
                >
                  {['Today', 'This Week', 'This Month'][i]}
                </button>
              )
            })}
          </div>

          {/* Custom date range toggle */}
          <button
            id="analytics-period-custom"
            type="button"
            aria-pressed={period === 'custom'}
            onClick={() => { setPeriod('custom'); setShowCustom(s => !s) }}
            style={{
              padding: '8px 14px', borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: 'pointer',
              fontFamily: 'Inter',
              border: '1px solid var(--border)',
              background: period === 'custom' ? 'var(--primary)' : 'var(--card)',
              color: period === 'custom' ? 'var(--primary-foreground)' : 'var(--muted-foreground)',
              boxShadow: period === 'custom' ? 'var(--shadow-brand)' : 'var(--shadow-xs)',
              display: 'flex', alignItems: 'center', gap: 6,
              transition: 'all var(--t-fast) var(--ease)',
            }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
              <line x1="16" y1="2" x2="16" y2="6"/>
              <line x1="8" y1="2" x2="8" y2="6"/>
              <line x1="3" y1="10" x2="21" y2="10"/>
            </svg>
            Custom Range
          </button>
        </div>
      </div>

      {/* Custom date picker row */}
      {showCustom && period === 'custom' && (
        <div className="card fade-in" style={{ padding: '14px 18px', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--foreground)' }}>Date Range:</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <input
              id="analytics-date-from"
              type="date"
              className="input"
              value={customFrom}
              max={customTo}
              onChange={e => setCustomFrom(e.target.value)}
              style={{ padding: '8px 12px', fontSize: 13, width: 160 }}
            />
            <span style={{ color: 'var(--muted-foreground)', fontSize: 13 }}>to</span>
            <input
              id="analytics-date-to"
              type="date"
              className="input"
              value={customTo}
              min={customFrom}
              max={toLocalDateKey(new Date())}
              onChange={e => setCustomTo(e.target.value)}
              style={{ padding: '8px 12px', fontSize: 13, width: 160 }}
            />
          </div>
          <button
            id="analytics-apply-range"
            type="button"
            onClick={fetchData}
            className="btn-primary"
            style={{ padding: '8px 18px', fontSize: 13 }}
          >
            Apply
          </button>
        </div>
      )}

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 60 }}>
          <div className="spinner" style={{ width: 32, height: 32, borderWidth: 3 }} />
        </div>
      ) : (
        <>
          {/* Summary KPIs */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16, marginBottom: 26 }}>
            {[
              { label: 'Total Revenue',   val: `₱${totalRev.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, note: periodLabel, color: '#9b5e28' },
              { label: 'Total Orders',    val: totalOrd.toLocaleString(), note: 'Completed', color: '#c47a2e' },
              { label: 'Avg Order Value', val: `₱${avgOrder.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, note: 'Per transaction', color: '#7a4520' },
              { label: 'Best Period',     val: bestSlot?.label ?? '-', note: `₱${(bestSlot?.revenue ?? 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, color: '#4a7c4e' },
            ].map(k => (
              <div key={k.label} className="card" style={{ padding: '22px 24px', textAlign: 'center' }}>
                <p style={{ fontSize: 11, color: 'var(--muted-foreground)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8, fontFamily: 'IBM Plex Mono' }}>{k.label}</p>
                <p style={{ fontFamily: 'Inter', fontSize: 28, fontWeight: 700, color: k.color, lineHeight: 1, textAlign: 'center' }}>{k.val}</p>
                <p style={{ fontSize: 12, color: 'var(--muted-foreground)', marginTop: 8 }}>{k.note}</p>
              </div>
            ))}
          </div>

          {/* Revenue trend + pie */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))', gap: 18, marginBottom: 20 }}>
            <div className="card" style={{ padding: '24px 26px', minWidth: 0 }}>
              <h3 style={{ fontFamily: 'Inter', fontSize: 17, fontWeight: 600, marginBottom: 4, color: 'var(--foreground)' }}>
                {trendTitle}
              </h3>
              <p style={{ fontSize: 12, color: 'var(--muted-foreground)', marginBottom: 18 }}>{periodLabel}</p>
              <div ref={trendRef} style={{ width: '100%', minWidth: 0 }}>
              <ResponsiveContainer width="100%" height={trendAngle ? 200 : 230}>
                <AreaChart data={trendData} margin={{ top: 8, right: 24, left: 4, bottom: 8 }}>
                  <defs>
                    <linearGradient id="mrev" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#c47a2e" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="#c47a2e" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 11, fill: 'var(--muted-foreground)', fontFamily: 'IBM Plex Mono' }}
                    axisLine={false}
                    tickLine={false}
                    interval={trendTickInterval}
                    angle={trendAngle}
                    textAnchor={trendAngle ? 'end' : 'middle'}
                    height={trendAngle ? 46 : 26}
                    dy={trendAngle ? 6 : 0}
                    padding={{ left: 8, right: 12 }}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: 'var(--muted-foreground)', fontFamily: 'IBM Plex Mono' }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v: number) => {
                      if (v === 0) return '₱0'
                      if (Math.abs(v) < 1000) return `₱${Math.round(v)}`
                      const k = v / 1000
                      return `₱${Number.isInteger(k) ? k : k.toFixed(1)}k`
                    }}
                    width={50}
                  />
                  <Tooltip contentStyle={{ background: 'var(--sidebar)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8 }} labelStyle={{ color: 'var(--sidebar-muted)', fontSize: 12 }} formatter={(v) => [`₱${Number(v).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, 'Revenue']} itemStyle={{ color: 'var(--sidebar-foreground)', fontSize: 13 }} />
                  <Area type="monotone" dataKey="revenue" stroke="#c47a2e" strokeWidth={2.5} fill="url(#mrev)" />
                </AreaChart>
              </ResponsiveContainer>
              </div>
            </div>

            <div className="card" style={{ padding: '24px 26px' }}>
              <h3 style={{ fontFamily: 'Inter', fontSize: 17, fontWeight: 600, marginBottom: 4, color: 'var(--foreground)' }}>Sales by Category</h3>
              <p style={{ fontSize: 12, color: 'var(--muted-foreground)', marginBottom: 12 }}>% of total orders</p>
              <ResponsiveContainer width="100%" height={150}>
                <PieChart>
                  <Pie data={categoryData} cx="50%" cy="50%" innerRadius={40} outerRadius={68} paddingAngle={3} dataKey="value">
                    {categoryData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v) => [`${v}%`, '']} contentStyle={{ background: 'var(--sidebar)', border: 'none', borderRadius: 8, fontSize: 13 }} />
                </PieChart>
              </ResponsiveContainer>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
                {categoryData.map((c, i) => (
                  <div key={c.name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ width: 9, height: 9, borderRadius: 2, background: PIE_COLORS[i % PIE_COLORS.length], display: 'inline-block' }} />
                      <span style={{ fontSize: 12, color: 'var(--foreground)' }}>{c.name}</span>
                    </div>
                    <span style={{ fontSize: 12, fontFamily: 'IBM Plex Mono', color: 'var(--muted-foreground)' }}>{c.value}%</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Top Products */}
          <div className="card" style={{ padding: '24px 26px' }}>
            <h3 style={{ fontFamily: 'Inter', fontSize: 17, fontWeight: 600, marginBottom: 18, color: 'var(--foreground)' }}>Top Products by Revenue</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 90px 120px', gap: 10, padding: '0 0 10px', borderBottom: '1px solid var(--border)', marginBottom: 10 }}>
              {['Product', 'Orders', 'Revenue'].map(h => <span key={h} style={{ fontSize: 11, fontFamily: 'IBM Plex Mono', color: 'var(--muted-foreground)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{h}</span>)}
            </div>
            {topProducts.map((p, i) => (
              <div key={p.name} style={{ display: 'grid', gridTemplateColumns: '1fr 90px 120px', gap: 10, padding: '10px 0', borderBottom: '1px solid var(--muted)', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 12, fontFamily: 'IBM Plex Mono', color: 'var(--muted-foreground)', minWidth: 16 }}>{i + 1}</span>
                  <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--foreground)' }}>{p.name}</span>
                </div>
                <span style={{ fontSize: 13, fontFamily: 'IBM Plex Mono', color: 'var(--muted-foreground)' }}>{p.orders}</span>
                <span style={{ fontSize: 14, fontFamily: 'IBM Plex Mono', fontWeight: 700, color: 'var(--primary)' }}>₱{p.revenue.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </div>
            ))}
            {topProducts.length === 0 && (
              <EmptyState
                compact
                icon={EMPTY_ICONS.chart}
                title="No data for this period"
                hint="Pick a wider date range, or check back after more orders are completed."
              />
            )}
          </div>
        </>
      )}
    </div>
  )
}
