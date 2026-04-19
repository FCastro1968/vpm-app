import React from 'react'
import {
  Document, Page, Text, View, StyleSheet, Svg,
  Circle, Line, Rect, Path, G, Defs, ClipPath,
} from '@react-pdf/renderer'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PDFFactor {
  id: string
  name: string
  weight: number
}

export interface PDFBenchmark {
  id: string
  name: string
  market_price: number
  market_share_pct: number
  value_index: number
  model_price: number
  residual: number
  factor_contributions: { factor_id: string; name: string; contribution: number }[]
}

export interface PDFTarget {
  id: string
  name: string
  value_index: number
  point_estimate: number
  range_low: number
  range_high: number
  factor_contributions: { factor_id: string; name: string; contribution: number }[]
}

export interface PDFReportData {
  projectName: string
  priceBasis: string
  currency: string
  geographicScope: string
  targetSegment: string
  categoryAnchor: string
  generatedAt: string
  modelParams: { b: number; m: number; r_squared: number }
  factors: PDFFactor[]
  benchmarks: PDFBenchmark[]
  targets: PDFTarget[]
  benchmarkResiduals: number[]
}

// ─── Palette ──────────────────────────────────────────────────────────────────

const TARGET_COLORS = ['#f59e0b', '#b45309', '#fcd34d']
const BENCH_COLOR   = '#3b82f6'
const GRAY          = '#6b7280'
const LIGHT_GRAY    = '#e5e7eb'
const DARK          = '#111827'
const MID           = '#374151'

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  page: {
    fontFamily: 'Helvetica',
    backgroundColor: '#ffffff',
    paddingTop: 32,
    paddingBottom: 32,
    paddingHorizontal: 48,
  },
  coverPage: {
    fontFamily: 'Helvetica',
    backgroundColor: '#f8fafc',
    paddingTop: 0,
    paddingBottom: 0,
    paddingHorizontal: 0,
  },

  // Cover
  coverAccentBar: { backgroundColor: '#f59e0b', height: 6 },
  coverTop: { flex: 1, justifyContent: 'flex-end', padding: 52, paddingBottom: 40 },
  coverBottom: { backgroundColor: '#1e293b', padding: 52, paddingTop: 24, paddingBottom: 28 },
  coverEyebrow: { fontSize: 9, color: '#94a3b8', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 20 },
  coverTitle: { fontSize: 30, color: '#0f172a', fontFamily: 'Helvetica-Bold', lineHeight: 1.2, marginBottom: 12 },
  coverSubtitle: { fontSize: 13, color: '#475569', marginBottom: 16 },
  coverMetaRow: { flexDirection: 'row', gap: 20, marginTop: 2 },
  coverMetaItem: { flexDirection: 'column', gap: 2 },
  coverMetaLabel: { fontSize: 7, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1 },
  coverMetaValue: { fontSize: 10, color: '#334155', fontFamily: 'Helvetica-Bold' },
  coverBottomLabel: { fontSize: 9, color: '#94a3b8', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 6 },
  coverBottomDate: { fontSize: 11, color: '#f1f5f9', fontFamily: 'Helvetica-Bold' },

  // Page header / footer
  pageHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, borderBottomWidth: 1, borderBottomColor: LIGHT_GRAY, paddingBottom: 8 },
  pageHeaderTitle: { fontSize: 9, color: GRAY, letterSpacing: 1, textTransform: 'uppercase' },
  pageHeaderProject: { fontSize: 9, color: GRAY },
  pageFooter: { position: 'absolute', bottom: 16, left: 48, right: 48, flexDirection: 'row', justifyContent: 'space-between' },
  pageFooterText: { fontSize: 8, color: '#9ca3af' },

  // Section titles
  sectionTitle: { fontSize: 15, fontFamily: 'Helvetica-Bold', color: DARK, marginBottom: 3 },
  sectionSubtitle: { fontSize: 9, color: GRAY, marginBottom: 12 },

  // Summary card
  summaryRow: { flexDirection: 'row', gap: 12, marginBottom: 20 },
  summaryCard: { flex: 1, backgroundColor: '#f9fafb', borderRadius: 6, padding: 14, borderWidth: 1, borderColor: LIGHT_GRAY },
  summaryCardLabel: { fontSize: 8, color: GRAY, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.8 },
  summaryCardValue: { fontSize: 22, fontFamily: 'Helvetica-Bold', color: DARK },
  summaryCardSub: { fontSize: 9, color: GRAY, marginTop: 3 },

  // Table
  table: { width: '100%' },
  tableHeader: { flexDirection: 'row', borderBottomWidth: 1.5, borderBottomColor: DARK, paddingBottom: 5, marginBottom: 2 },
  tableRow: { flexDirection: 'row', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: '#f3f4f6' },
  tableRowAlt: { flexDirection: 'row', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: '#f3f4f6', backgroundColor: '#f9fafb' },
  th: { fontSize: 8, color: GRAY, fontFamily: 'Helvetica-Bold', textTransform: 'uppercase', letterSpacing: 0.5 },
  td: { fontSize: 9, color: MID },
  tdBold: { fontSize: 9, color: DARK, fontFamily: 'Helvetica-Bold' },
})

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(val: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(val)
}
function fmt2(val: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(val)
}
function pct(val: number) { return (val * 100).toFixed(1) + '%' }

// ─── Page shell ───────────────────────────────────────────────────────────────

function PageShell({ projectName, section, children }: { projectName: string; section: string; children: React.ReactNode }) {
  return (
    <Page size="A4" orientation="landscape" style={s.page}>
      <View style={s.pageHeader}>
        <Text style={s.pageHeaderTitle}>{section}</Text>
        <Text style={s.pageHeaderProject}>{projectName} · Value Pricing Model™</Text>
      </View>
      {children}
      <View style={s.pageFooter} fixed>
        <Text style={s.pageFooterText}>Value Pricing Model™ — Confidential</Text>
        <Text style={s.pageFooterText} render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
      </View>
    </Page>
  )
}

// ─── Cover page ───────────────────────────────────────────────────────────────

function CoverPage({ data }: { data: PDFReportData }) {
  return (
    <Page size="A4" orientation="landscape" style={s.coverPage}>
      <View style={s.coverAccentBar} />
      <View style={s.coverTop}>
        <Text style={s.coverEyebrow}>Value Pricing Model™</Text>
        <Text style={s.coverTitle}>{data.projectName}</Text>
        <Text style={s.coverSubtitle}>{data.categoryAnchor}</Text>
        <View style={s.coverMetaRow}>
          <View style={s.coverMetaItem}>
            <Text style={s.coverMetaLabel}>Price Basis</Text>
            <Text style={s.coverMetaValue}>{data.priceBasis}</Text>
          </View>
          {data.currency ? (
            <View style={s.coverMetaItem}>
              <Text style={s.coverMetaLabel}>Currency</Text>
              <Text style={s.coverMetaValue}>{data.currency}</Text>
            </View>
          ) : null}
          {data.geographicScope ? (
            <View style={s.coverMetaItem}>
              <Text style={s.coverMetaLabel}>Geography</Text>
              <Text style={s.coverMetaValue}>{data.geographicScope}</Text>
            </View>
          ) : null}
          {data.targetSegment ? (
            <View style={s.coverMetaItem}>
              <Text style={s.coverMetaLabel}>Target Segment</Text>
              <Text style={s.coverMetaValue}>{data.targetSegment}</Text>
            </View>
          ) : null}
        </View>
      </View>
      <View style={s.coverBottom}>
        <Text style={s.coverBottomLabel}>Pricing Analysis Report</Text>
        <Text style={s.coverBottomDate}>{data.generatedAt}</Text>
      </View>
    </Page>
  )
}

// ─── Price Recommendations page ───────────────────────────────────────────────

function PriceRecommendationsPage({ data }: { data: PDFReportData }) {
  const { targets, benchmarkResiduals, modelParams } = data
  const maxRes = benchmarkResiduals.length ? Math.max(...benchmarkResiduals) : 0
  const minRes = benchmarkResiduals.length ? Math.min(...benchmarkResiduals) : 0

  return (
    <PageShell projectName={data.projectName} section="Price Recommendations">
      <Text style={s.sectionTitle}>Price Recommendations</Text>
      <Text style={s.sectionSubtitle}>
        Model fit: R² = {(modelParams.r_squared * 100).toFixed(1)}% · Based on {data.benchmarks.length} reference products
      </Text>

      {/* Targets side-by-side — landscape gives ~700pt usable width */}
      <View style={{ flexDirection: 'row', gap: 14 }}>
        {targets.map((t, ti) => {
          const color = TARGET_COLORS[ti % TARGET_COLORS.length]
          const envCeiling = t.point_estimate + maxRes
          const envFloor   = t.point_estimate + minRes
          return (
            <View key={t.id} style={{ flex: 1, padding: 16, backgroundColor: '#fffbeb', borderRadius: 8, borderLeftWidth: 4, borderLeftColor: color }}>
              <Text style={{ fontSize: 12, fontFamily: 'Helvetica-Bold', color: DARK, marginBottom: 2 }}>{t.name}</Text>
              <Text style={{ fontSize: 8, color: GRAY, marginBottom: 10 }}>Value Index: {(t.value_index * 100).toFixed(1)} / 100</Text>

              <Text style={{ fontSize: 32, fontFamily: 'Helvetica-Bold', color: DARK, marginBottom: 10 }}>
                {fmt(t.point_estimate)}
              </Text>

              <View style={{ flexDirection: 'row', gap: 10 }}>
                <View style={{ flex: 1, backgroundColor: '#ffffff', borderRadius: 5, padding: 8, borderWidth: 1, borderColor: '#fde68a' }}>
                  <Text style={{ fontSize: 7, color: GRAY, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 3 }}>Statistical Range</Text>
                  <Text style={{ fontSize: 10, fontFamily: 'Helvetica-Bold', color: MID }}>
                    {fmt(t.range_low)} — {fmt(t.range_high)}
                  </Text>
                  <Text style={{ fontSize: 7, color: GRAY, marginTop: 2 }}>±1 std dev</Text>
                </View>
                <View style={{ flex: 1, backgroundColor: '#ffffff', borderRadius: 5, padding: 8, borderWidth: 1, borderColor: '#fde68a' }}>
                  <Text style={{ fontSize: 7, color: GRAY, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 3 }}>Market Envelope</Text>
                  <Text style={{ fontSize: 10, fontFamily: 'Helvetica-Bold', color: MID }}>
                    {fmt(envFloor)} — {fmt(envCeiling)}
                  </Text>
                  <Text style={{ fontSize: 7, color: GRAY, marginTop: 2 }}>Observed min / max</Text>
                </View>
              </View>
            </View>
          )
        })}
      </View>
    </PageShell>
  )
}

// ─── Value Map page ───────────────────────────────────────────────────────────

function ValueMapPage({ data }: { data: PDFReportData }) {
  const { benchmarks, targets, modelParams } = data
  const { b, m } = modelParams

  // Landscape A4: 842×595, padding 32 top/bottom, 48 left/right → usable 531×746 (height is the constraint)
  // Overhead: pageHeader ~40pt + title ~18pt + subtitle ~21pt + legend ~20pt = ~99pt → 432pt available for chart
  const W = 700, H = 400
  const pad = { t: 16, r: 16, b: 40, l: 64 }
  const plotW = W - pad.l - pad.r
  const plotH = H - pad.t - pad.b

  // Domain — include all prices + target ranges
  const benchmarkResiduals = benchmarks.map(bm => bm.residual)
  const maxRes = benchmarkResiduals.length ? Math.max(...benchmarkResiduals) : 0
  const minRes = benchmarkResiduals.length ? Math.min(...benchmarkResiduals) : 0

  const allPrices = [
    ...benchmarks.map(bm => bm.market_price),
    ...benchmarks.map(bm => bm.model_price),
    ...targets.flatMap(t => [t.point_estimate, t.range_low, t.range_high, t.point_estimate + maxRes, t.point_estimate + minRes]),
  ]
  const priceMin = Math.min(...allPrices)
  const priceMax = Math.max(...allPrices)
  const padding  = (priceMax - priceMin) * 0.12
  const rawRange = (priceMax + padding) - Math.max(0, priceMin - padding)
  const rawInt   = rawRange / 5
  const mag      = Math.pow(10, Math.floor(Math.log10(rawInt)))
  const norm     = rawInt / mag
  const tickUnit = norm < 1.5 ? mag : norm < 3.5 ? 2 * mag : norm < 7.5 ? 5 * mag : 10 * mag
  const axisMin  = Math.max(0, Math.floor((priceMin - padding) / tickUnit) * tickUnit)
  const axisMax  = Math.ceil((priceMax + padding) / tickUnit) * tickUnit

  const toX = (v: number) => pad.l + ((v - axisMin) / (axisMax - axisMin)) * plotW
  const toY = (v: number) => pad.t + (1 - (v - axisMin) / (axisMax - axisMin)) * plotH

  // Ticks
  const ticks: number[] = []
  for (let t = axisMin; t <= axisMax + 0.01; t += tickUnit) ticks.push(t)

  // Max bubble size proportional to market share
  const maxShare = Math.max(...benchmarks.map(b => b.market_share_pct), 1)

  return (
    <PageShell projectName={data.projectName} section="Value Map">
      <Text style={s.sectionTitle}>Value Map</Text>
      <Text style={s.sectionSubtitle}>
        Market price vs. model-implied price. Products on the diagonal are priced at fair value.
        Above = priced above value; below = priced below value.
      </Text>

      <View style={{ alignItems: 'center', marginBottom: 10 }}>
        <Svg width={W} height={H}>
          {/* Grid lines */}
          {ticks.map(t => (
            <G key={t}>
              <Line x1={pad.l} y1={toY(t)} x2={pad.l + plotW} y2={toY(t)}
                stroke={LIGHT_GRAY} strokeWidth={0.5} strokeDasharray="3 3" />
              <Line x1={toX(t)} y1={pad.t} x2={toX(t)} y2={pad.t + plotH}
                stroke={LIGHT_GRAY} strokeWidth={0.5} strokeDasharray="3 3" />
            </G>
          ))}

          {/* Axis lines */}
          <Line x1={pad.l} y1={pad.t} x2={pad.l} y2={pad.t + plotH} stroke="#d1d5db" strokeWidth={1} />
          <Line x1={pad.l} y1={pad.t + plotH} x2={pad.l + plotW} y2={pad.t + plotH} stroke="#d1d5db" strokeWidth={1} />

          {/* Axis tick labels */}
          {ticks.map(t => (
            <G key={t}>
              <Text style={{ fontSize: 7, fill: GRAY }}
                x={pad.l - 4} y={toY(t) + 2.5}
                textAnchor="end">
                {'$' + Math.round(t / 1000) + 'k'}
              </Text>
              <Text style={{ fontSize: 7, fill: GRAY }}
                x={toX(t)} y={pad.t + plotH + 10}
                textAnchor="middle">
                {'$' + Math.round(t / 1000) + 'k'}
              </Text>
            </G>
          ))}

          {/* Axis labels */}
          <Text style={{ fontSize: 8, fill: GRAY }} x={pad.l + plotW / 2} y={H - 4} textAnchor="middle">
            Model-Implied Price
          </Text>
          <Text style={{ fontSize: 8, fill: GRAY, transform: `rotate(-90, 12, ${pad.t + plotH / 2})` }}
            x={12} y={pad.t + plotH / 2} textAnchor="middle">
            {data.priceBasis}
          </Text>

          {/* y=x diagonal (fair value line) */}
          <Line
            x1={toX(axisMin)} y1={toY(axisMin)}
            x2={toX(axisMax)} y2={toY(axisMax)}
            stroke="#94a3b8" strokeWidth={1.2} strokeDasharray="5 4"
          />

          {/* Benchmark bubbles */}
          {benchmarks.map(bm => {
            const cx = toX(bm.model_price)
            const cy = toY(bm.market_price)
            const r  = 3 + (bm.market_share_pct / maxShare) * 8
            return (
              <G key={bm.id}>
                <Circle cx={cx} cy={cy} r={r} fill={BENCH_COLOR} fillOpacity={0.75} />
              </G>
            )
          })}

          {/* Target whisker strips */}
          {targets.map((t, ti) => {
            const color   = TARGET_COLORS[ti % TARGET_COLORS.length]
            const cx      = toX(t.point_estimate)
            const envCeil = t.point_estimate + maxRes
            const envFlr  = t.point_estimate + minRes
            const ys = [toY(envFlr), toY(t.range_low), toY(t.point_estimate), toY(t.range_high), toY(envCeil)]
            const yBot = Math.max(...ys)
            const yTop = Math.min(...ys)
            return (
              <G key={t.id}>
                <Line x1={cx} y1={yBot} x2={cx} y2={yTop} stroke={color} strokeWidth={1} strokeOpacity={0.5} />
                <Circle cx={cx} cy={toY(envFlr)}         r={3} fill="white" stroke={color} strokeWidth={1.2} strokeOpacity={0.8} />
                <Circle cx={cx} cy={toY(envCeil)}        r={3} fill="white" stroke={color} strokeWidth={1.2} strokeOpacity={0.8} />
                <Circle cx={cx} cy={toY(t.range_low)}    r={4} fill={color} fillOpacity={0.8} />
                <Circle cx={cx} cy={toY(t.range_high)}   r={4} fill={color} fillOpacity={0.8} />
                <Circle cx={cx} cy={toY(t.point_estimate)} r={7} fill={color} />
              </G>
            )
          })}
        </Svg>
      </View>

      {/* Legend */}
      <View style={{ flexDirection: 'row', gap: 20, justifyContent: 'center', flexWrap: 'wrap' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
          <Svg width={10} height={10}><Circle cx={5} cy={5} r={4} fill={BENCH_COLOR} fillOpacity={0.75} /></Svg>
          <Text style={{ fontSize: 8, color: GRAY }}>Reference product (size = market share)</Text>
        </View>
        {targets.map((t, ti) => (
          <View key={t.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
            <Svg width={10} height={10}><Circle cx={5} cy={5} r={4} fill={TARGET_COLORS[ti % TARGET_COLORS.length]} /></Svg>
            <Text style={{ fontSize: 8, color: GRAY }}>{t.name} (recommended price)</Text>
          </View>
        ))}
      </View>
    </PageShell>
  )
}

// ─── Split-dot SVG helper (matches Phase 6 drawSplitDot logic) ────────────────

function SvgSplitDot({ cx, cy, r, colors, hollow, uid }: {
  cx: number; cy: number; r: number
  colors: string[]; hollow: boolean; uid: string
}) {
  const c0 = colors[0] ?? '#9ca3af'
  if (hollow || colors.length === 0) {
    return <Circle cx={cx} cy={cy} r={r} fill="white" stroke={c0} strokeWidth={1.4} />
  }
  if (colors.length === 1) {
    return <Circle cx={cx} cy={cy} r={r} fill={c0} />
  }
  if (colors.length === 2) {
    // Right half = colors[0] (clockwise top→bottom), left half = colors[1]
    return (
      <G>
        <Path d={`M ${cx} ${cy - r} A ${r} ${r} 0 0 1 ${cx} ${cy + r} Z`} fill={colors[0]} />
        <Path d={`M ${cx} ${cy - r} A ${r} ${r} 0 0 0 ${cx} ${cy + r} Z`} fill={colors[1]} />
      </G>
    )
  }
  // 3 colors — vertical thirds via ClipPath (matches Phase 6 boundary logic)
  const b0 = cx - r, b1 = cx - r / 3, b2 = cx + r / 3, b3 = cx + r
  const ht = r * 2 + 2
  return (
    <G>
      <Defs>
        <ClipPath id={`sp-l-${uid}`}><Rect x={b0 - 0.5} y={cy - r - 1} width={b1 - b0 + 1} height={ht} /></ClipPath>
        <ClipPath id={`sp-m-${uid}`}><Rect x={b1}       y={cy - r - 1} width={b2 - b1 + 1} height={ht} /></ClipPath>
        <ClipPath id={`sp-r-${uid}`}><Rect x={b2}       y={cy - r - 1} width={b3 - b2 + 1} height={ht} /></ClipPath>
      </Defs>
      <Circle cx={cx} cy={cy} r={r} fill={colors[0]} clipPath={`url(#sp-l-${uid})`} />
      <Circle cx={cx} cy={cy} r={r} fill={colors[1]} clipPath={`url(#sp-m-${uid})`} />
      <Circle cx={cx} cy={cy} r={r} fill={colors[2]} clipPath={`url(#sp-r-${uid})`} />
    </G>
  )
}

// ─── Factor Contributions page ────────────────────────────────────────────────

const REF_COLORS = ['#3b82f6','#10b981','#8b5cf6','#ef4444','#06b6d4','#f97316','#ec4899','#94a3b8']

function FactorContributionsPage({ data }: { data: PDFReportData }) {
  const { factors, benchmarks, targets, modelParams } = data
  const priceRange = modelParams.m - modelParams.b

  // Each product gets a distinct color — refs from cool palette, targets from amber family
  const allProducts = [
    ...benchmarks.map((bm, i) => ({
      ...bm, isTarget: false,
      color: REF_COLORS[i % REF_COLORS.length],
    })),
    ...targets.map((t, i) => ({
      ...t, isTarget: true,
      color: TARGET_COLORS[i % TARGET_COLORS.length],
    })),
  ]

  // Sort factors by max contribution across all products (descending) — matches Phase 6 default
  const factorMaxContrib = (f: PDFFactor) => {
    const vals = allProducts.map(p => {
      const fc = p.factor_contributions.find(fc => fc.factor_id === f.id)
      return fc ? fc.contribution * priceRange : 0
    })
    return Math.max(...vals)
  }
  const sorted = [...factors].sort((a, b) => factorMaxContrib(b) - factorMaxContrib(a))

  // Layout constants
  const W = 700
  const LABEL_W = 152   // factor name
  const PILL_W  = 46    // importance score badge
  const BAR_X   = LABEL_W + PILL_W + 6   // where bars start
  const BAR_W   = W - BAR_X - 6          // bar area width
  const ROW_H   = 22
  const HEADER_H = 24   // taller to fit scale tick labels
  const TOTAL_H  = 28   // total row taller
  const H = HEADER_H + sorted.length * ROW_H + 4 + TOTAL_H   // +4 for divider gap

  // Per-factor scale: max contribution across all products and factors
  const allFactorContribs = allProducts.flatMap(p =>
    p.factor_contributions.map(fc => fc.contribution * priceRange)
  )
  const maxFactorContrib = Math.max(...allFactorContribs, 1)
  const toX = (val: number) => BAR_X + (val / maxFactorContrib) * BAR_W

  // Total scale: model-implied price = b + differentiated value (matches Phase 6 "model" mode)
  const b = modelParams.b
  const productTotals = allProducts.map(p =>
    b + p.factor_contributions.reduce((sum, fc) => sum + fc.contribution * priceRange, 0)
  )
  const tMin = Math.min(...productTotals) * 0.96
  const tMax = Math.max(...productTotals, 1) * 1.04
  const toTotalX = (val: number) => BAR_X + ((val - tMin) / (tMax - tMin)) * BAR_W

  return (
    <PageShell projectName={data.projectName} section="Factor Contributions">
      <Text style={s.sectionTitle}>Factor Contributions</Text>
      <Text style={s.sectionSubtitle}>
        Dollar contribution of each factor to the model-implied price, per product.
      </Text>

      <Svg width={W} height={H}>

        {/* ── Column headers ── */}
        <Text style={{ fontSize: 7, fill: GRAY }}
          x={LABEL_W} y={HEADER_H - 12} textAnchor="start">Importance Score</Text>

        {/* ── X-axis scale ticks (0, 25%, 50%, 75%, 100% of maxFactorContrib) ── */}
        {[0, 0.25, 0.5, 0.75, 1].map(t => {
          const val = maxFactorContrib * t
          const x   = toX(val)
          const label = '$' + (Math.round(val / 50) * 50).toLocaleString()
          return (
            <G key={t}>
              {/* Dashed grid line through full chart body (not header) */}
              <Line
                x1={x} y1={HEADER_H - 2}
                x2={x} y2={HEADER_H + sorted.length * ROW_H}
                stroke={t === 0 ? '#9ca3af' : 'rgba(0,0,0,0.08)'}
                strokeWidth={t === 0 ? 0.75 : 0.5}
                strokeDasharray={t === 0 ? '' : '3,3'}
              />
              {/* Tick label */}
              <Text style={{ fontSize: 7, fill: '#6b7280' }}
                x={x} y={HEADER_H - 4} textAnchor="middle">{label}</Text>
            </G>
          )
        })}

        {/* ── Factor rows ── */}
        {sorted.map((factor, fi) => {
          const rowY  = HEADER_H + fi * ROW_H
          const dotCY = rowY + ROW_H / 2
          const bg    = fi % 2 === 0 ? '#f9fafb' : '#ffffff'

          const contribs = allProducts.map(p => {
            const fc = p.factor_contributions.find(fc => fc.factor_id === factor.id)
            return fc ? fc.contribution * priceRange : 0
          })
          const rangeMin = Math.min(...contribs)
          const rangeMax = Math.max(...contribs)
          const avg      = contribs.reduce((a, b) => a + b, 0) / contribs.length

          return (
            <G key={factor.id}>
              {/* Row background */}
              <Rect x={0} y={rowY} width={W} height={ROW_H} fill={bg} />

              {/* Factor name */}
              <Text style={{ fontSize: 8, fill: DARK }}
                x={4} y={dotCY + 3} textAnchor="start">
                {factor.name.length > 21 ? factor.name.slice(0, 19) + '…' : factor.name}
              </Text>

              {/* Importance score pill */}
              <Rect x={LABEL_W} y={dotCY - 7} width={PILL_W} height={14} rx={3} fill="#e0f2fe" />
              <Text style={{ fontSize: 7.5, fill: '#0369a1', fontFamily: 'Helvetica-Bold' }}
                x={LABEL_W + PILL_W / 2} y={dotCY + 3} textAnchor="middle">
                {(factor.weight * 100).toFixed(0)} %
              </Text>

              {/* Range bar — gray, min to max */}
              <Rect
                x={toX(rangeMin)} y={dotCY - 3.5}
                width={Math.max(toX(rangeMax) - toX(rangeMin), 2)}
                height={7} rx={2} fill="#d1d5db"
              />

              {/* Average tick — short vertical mark on range bar */}
              <Line
                x1={toX(avg)} y1={dotCY - 5}
                x2={toX(avg)} y2={dotCY + 5}
                stroke="#6b7280" strokeWidth={1.5}
              />

              {/* Per-product dots — grouped by x position, split-color + count badge when multiple share a value */}
              {(() => {
                const groups = new Map<number, number[]>()
                allProducts.forEach((_, pi) => {
                  const rx = Math.round(toX(contribs[pi]))
                  if (!groups.has(rx)) groups.set(rx, [])
                  groups.get(rx)!.push(pi)
                })
                return Array.from(groups.entries()).map(([cx, pis], gi) => {
                  const r = 4.5
                  if (pis.length === 1) {
                    const p = allProducts[pis[0]]
                    return (
                      <G key={gi}>
                        {/* White halo lifts dot off the gray range bar */}
                        <Circle cx={cx} cy={dotCY} r={r + 1.5} fill="white" />
                        <Circle cx={cx} cy={dotCY} r={r}
                          fill={p.isTarget ? p.color : 'white'}
                          stroke={p.color} strokeWidth={1.4}
                        />
                      </G>
                    )
                  }
                  const targetPis = pis.filter(pi => allProducts[pi].isTarget)
                  let splitColors: string[]
                  let hollow = false
                  if (targetPis.length >= 1) {
                    splitColors = targetPis.slice(0, 3).map(pi => allProducts[pi].color)
                  } else {
                    splitColors = ['#9ca3af']
                    hollow = true
                  }
                  return (
                    <G key={gi}>
                      <Circle cx={cx} cy={dotCY} r={r + 1.5} fill="white" />
                      <SvgSplitDot cx={cx} cy={dotCY} r={r} colors={splitColors} hollow={hollow} uid={`f-${fi}-${gi}`} />
                      <Text style={{ fontSize: 5.5, fill: hollow ? '#6b7280' : 'white', fontFamily: 'Helvetica-Bold' }}
                        x={cx} y={dotCY + 2} textAnchor="middle">{String(pis.length)}</Text>
                    </G>
                  )
                })
              })()}
            </G>
          )
        })}

        {/* ── Total row ── */}
        {(() => {
          const divY   = HEADER_H + sorted.length * ROW_H + 2
          const totalY = divY + 2
          const dotCY  = totalY + TOTAL_H / 2

          return (
            <G>
              {/* Divider */}
              <Line x1={0} y1={divY} x2={W} y2={divY} stroke="#9ca3af" strokeWidth={1} />
              <Rect x={0} y={totalY} width={W} height={TOTAL_H} fill="#f3f4f6" />

              <Text style={{ fontSize: 8, fill: DARK, fontFamily: 'Helvetica-Bold' }}
                x={4} y={dotCY + 3} textAnchor="start">Total</Text>

              {/* Total range bar */}
              <Rect
                x={toTotalX(Math.min(...productTotals))} y={dotCY - 3.5}
                width={Math.max(toTotalX(Math.max(...productTotals)) - toTotalX(Math.min(...productTotals)), 2)}
                height={7} rx={2} fill="#d1d5db"
              />

              {/* Total dots — grouped by x position, split-color when multiple share a value */}
              {(() => {
                // Group products by rounded x position
                const groups = new Map<number, number[]>()
                allProducts.forEach((_, pi) => {
                  const rx = Math.round(toTotalX(productTotals[pi]))
                  if (!groups.has(rx)) groups.set(rx, [])
                  groups.get(rx)!.push(pi)
                })
                return Array.from(groups.entries()).map(([cx, pis], gi) => {
                  const r = 5.5
                  if (pis.length === 1) {
                    const p = allProducts[pis[0]]
                    return (
                      <G key={gi}>
                        <Circle cx={cx} cy={dotCY} r={r + 1.5} fill="white" />
                        <Circle cx={cx} cy={dotCY} r={r}
                          fill={p.isTarget ? p.color : 'white'}
                          stroke={p.color} strokeWidth={1.4}
                        />
                      </G>
                    )
                  }
                  // Multiple products — determine split colors (targets take priority)
                  const targetPis = pis.filter(pi => allProducts[pi].isTarget)
                  let splitColors: string[]
                  let hollow = false
                  if (targetPis.length >= 1) {
                    splitColors = targetPis.slice(0, 3).map(pi => allProducts[pi].color)
                  } else {
                    splitColors = ['#9ca3af']
                    hollow = true
                  }
                  return (
                    <G key={gi}>
                      <Circle cx={cx} cy={dotCY} r={r + 1.5} fill="white" />
                      <SvgSplitDot cx={cx} cy={dotCY} r={r} colors={splitColors} hollow={hollow} uid={`t-${gi}`} />
                      {/* Count badge */}
                      <Text style={{ fontSize: 5.5, fill: hollow ? '#6b7280' : 'white', fontFamily: 'Helvetica-Bold' }}
                        x={cx} y={dotCY + 2} textAnchor="middle">{String(pis.length)}</Text>
                    </G>
                  )
                })
              })()}

              {/* Three reference labels: min, midpoint, max (matches Phase 6) */}
              {[tMin, (tMin + tMax) / 2, tMax].map((v, i) => (
                <Text key={i}
                  style={{ fontSize: 7, fill: '#6b7280' }}
                  x={toTotalX(v)} y={dotCY - 8}
                  textAnchor="middle">
                  {'$' + (Math.round(v / 100) * 100).toLocaleString()}
                </Text>
              ))}
            </G>
          )
        })()}

      </Svg>

      {/* Legend */}
      <View style={{ flexDirection: 'row', gap: 14, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {allProducts.map((p, pi) => (
          <View key={pi} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Svg width={10} height={10}>
              <Circle cx={5} cy={5} r={p.isTarget ? 4 : 3.5}
                fill={p.isTarget ? p.color : 'white'}
                stroke={p.color} strokeWidth={1.4} />
            </Svg>
            <Text style={{ fontSize: 8, color: GRAY }}>{p.name}</Text>
          </View>
        ))}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Svg width={14} height={10}>
            <Rect x={0} y={3} width={14} height={4} rx={2} fill="#d1d5db" />
            <Line x1={7} y1={1} x2={7} y2={9} stroke="#6b7280" strokeWidth={1.5} />
          </Svg>
          <Text style={{ fontSize: 8, color: GRAY }}>Range (tick = avg)</Text>
        </View>
      </View>
    </PageShell>
  )
}

// ─── Competitive Positioning page ─────────────────────────────────────────────

function PositioningTablePage({ data }: { data: PDFReportData }) {
  const { benchmarks, targets, factors } = data

  const allProducts = [
    ...targets.map(t => ({ id: t.id, name: t.name, isTarget: true, value_index: t.value_index, market_price: t.point_estimate, model_price: t.point_estimate, residual: 0, factor_contributions: t.factor_contributions })),
    ...benchmarks.map(bm => ({ ...bm, isTarget: false })),
  ].sort((a, b) => b.value_index - a.value_index)

  return (
    <PageShell projectName={data.projectName} section="Competitive Positioning">
      <Text style={s.sectionTitle}>Competitive Positioning</Text>
      <Text style={s.sectionSubtitle}>
        All products ranked by Value Index. Factor contributions shown as % of differentiated value.
      </Text>

      {/* Main table */}
      <View style={s.table}>
        <View style={s.tableHeader}>
          <Text style={[s.th, { flex: 2.2 }]}>Product</Text>
          <Text style={[s.th, { flex: 1, textAlign: 'right' }]}>Value Index</Text>
          <Text style={[s.th, { flex: 1, textAlign: 'right' }]}>Market Price</Text>
          <Text style={[s.th, { flex: 1, textAlign: 'right' }]}>Model Price</Text>
          <Text style={[s.th, { flex: 1, textAlign: 'right' }]}>Gap</Text>
        </View>

        {allProducts.map((p, i) => {
          const isTarget = p.isTarget
          const gap = p.market_price - p.model_price
          const rowStyle = i % 2 === 0 ? s.tableRow : s.tableRowAlt
          return (
            <View key={p.id} style={rowStyle}>
              <View style={{ flex: 2.2, flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                {isTarget && (
                  <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: TARGET_COLORS[targets.findIndex(t => t.id === p.id) % TARGET_COLORS.length] }} />
                )}
                <Text style={isTarget ? s.tdBold : s.td}>{p.name}</Text>
              </View>
              <Text style={[s.td, { flex: 1, textAlign: 'right' }]}>{(p.value_index * 100).toFixed(1)}</Text>
              <Text style={[isTarget ? s.tdBold : s.td, { flex: 1, textAlign: 'right' }]}>
                {isTarget ? '—' : fmt(p.market_price)}
              </Text>
              <Text style={[s.td, { flex: 1, textAlign: 'right' }]}>{fmt(p.model_price)}</Text>
              <Text style={[s.td, { flex: 1, textAlign: 'right', color: isTarget ? GRAY : gap > 0 ? '#2563eb' : gap < 0 ? '#dc2626' : GRAY }]}>
                {isTarget ? '★ Target' : gap === 0 ? '—' : (gap > 0 ? '+' : '') + fmt(gap)}
              </Text>
            </View>
          )
        })}
      </View>

      {/* Factor weights summary */}
      <View style={{ marginTop: 28 }}>
        <Text style={{ fontSize: 11, fontFamily: 'Helvetica-Bold', color: DARK, marginBottom: 10 }}>
          Importance Scores
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {[...factors].sort((a, b) => b.weight - a.weight).map(f => (
            <View key={f.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#f9fafb', borderRadius: 4, paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1, borderColor: LIGHT_GRAY }}>
              <Text style={{ fontSize: 9, color: DARK, fontFamily: 'Helvetica-Bold' }}>{(f.weight * 100).toFixed(0)}%</Text>
              <Text style={{ fontSize: 9, color: GRAY }}>{f.name}</Text>
            </View>
          ))}
        </View>
      </View>
    </PageShell>
  )
}

// ─── Root document ────────────────────────────────────────────────────────────

export function VPMReport({ data }: { data: PDFReportData }) {
  return (
    <Document
      title={`${data.projectName} — Value Pricing Model™`}
      author="Value Pricing Model™"
      subject="Pricing Analysis Report"
    >
      <CoverPage data={data} />
      <PriceRecommendationsPage data={data} />
      <ValueMapPage data={data} />
      <FactorContributionsPage data={data} />
      <PositioningTablePage data={data} />
    </Document>
  )
}
