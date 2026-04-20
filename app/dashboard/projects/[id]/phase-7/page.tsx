'use client'

import { useState, useEffect, Fragment } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter, useParams } from 'next/navigation'
import { HelpTip } from '@/app/components/HelpTip'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Factor { id: string; name: string }

interface Benchmark {
  id: string
  name: string
  market_price: number
  market_share_pct: number
  included_in_regression: boolean
  price_range_pct: number
}

interface TargetProduct { id: string; name: string }

interface SensitivityRow {
  excluded_attribute_id: string
  weighted_sse: number | null
  r_squared_weighted: number | null
  point_estimate: number | null
  delta_from_full_model: number | null
  flagged: boolean
}

interface RespondentModelResult {
  respondent_id: string
  name: string
  factor_weights: Record<string, number>
  target_prices: number[]
  r_squared: number
  is_outlier: boolean
}

interface BenchSensRow {
  benchId: string
  benchName: string
  rangePct: number
  basePrice: number
  lowPrices: number[]   // per target
  highPrices: number[]  // per target
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatCurrency(val: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(val)
}

function formatCurrencyFull(val: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', minimumFractionDigits: 2,
  }).format(val)
}

const TARGET_COLORS = ['#2563eb', '#f59e0b', '#7c3aed']
const TARGET_COLORS_LIGHT = ['#dbeafe', '#fef3c7', '#ede9fe']

// ─── Tornado Chart ────────────────────────────────────────────────────────────

function TornadoChart({
  rows,
  targets,
  baselines,
}: {
  rows: BenchSensRow[]
  targets: TargetProduct[]
  baselines: Record<string, number>
}) {
  const ROW_H = 44
  const LABEL_W = 250
  const RIGHT_W = 180
  const CHART_W = 480
  const TOTAL_W = LABEL_W + CHART_W + RIGHT_W
  const TOP_PAD = 32
  const BOT_PAD = 28
  const HEIGHT = TOP_PAD + rows.length * ROW_H + BOT_PAD

  // X scale: min/max across all rows & targets
  const allPrices: number[] = []
  for (const row of rows) {
    row.lowPrices.forEach(p => allPrices.push(p))
    row.highPrices.forEach(p => allPrices.push(p))
    targets.forEach(t => { const b = baselines[t.id]; if (b) allPrices.push(b) })
  }
  if (allPrices.length === 0) return null
  const rawMin = Math.min(...allPrices)
  const rawMax = Math.max(...allPrices)
  const pad = (rawMax - rawMin) * 0.08 || 100
  const xMin = rawMin - pad
  const xMax = rawMax + pad
  const xRange = xMax - xMin

  const toX = (price: number) => LABEL_W + ((price - xMin) / xRange) * CHART_W

  // X axis ticks
  const tickCount = 5
  const ticks: number[] = []
  for (let i = 0; i <= tickCount; i++) {
    ticks.push(xMin + (xRange * i) / tickCount)
  }

  const BAR_H = 10
  const BAR_GAP = 3

  return (
    <svg
      viewBox={`0 0 ${TOTAL_W} ${HEIGHT}`}
      width="100%"
      style={{ fontFamily: 'inherit', overflow: 'visible' }}
    >
      {/* X axis ticks + labels */}
      {ticks.map((tick, i) => {
        const x = toX(tick)
        return (
          <g key={i}>
            <line x1={x} y1={TOP_PAD + rows.length * ROW_H} x2={x} y2={TOP_PAD + rows.length * ROW_H + 4} stroke="#cbd5e1" strokeWidth={1} />
            <text x={x} y={TOP_PAD + rows.length * ROW_H + 14} textAnchor="middle" fontSize={9} fill="#94a3b8">
              {formatCurrency(tick)}
            </text>
          </g>
        )
      })}

      {/* Row axis line */}
      <line
        x1={LABEL_W} y1={TOP_PAD + rows.length * ROW_H}
        x2={LABEL_W + CHART_W} y2={TOP_PAD + rows.length * ROW_H}
        stroke="#e2e8f0" strokeWidth={1}
      />

      {/* Rows */}
      {rows.map((row, ri) => {
        const yCenter = TOP_PAD + ri * ROW_H + ROW_H / 2
        const totalBarH = targets.length * BAR_H + (targets.length - 1) * BAR_GAP
        const yTop = yCenter - totalBarH / 2

        return (
          <g key={row.benchId}>
            {/* Benchmark label */}
            <text
              x={LABEL_W - 8} y={yCenter + 4}
              textAnchor="end" fontSize={11} fill="#374151" fontWeight={500}
            >
              {row.benchName.length > 34 ? row.benchName.slice(0, 33) + '…' : row.benchName}
            </text>

            {/* ±% label */}
            <text
              x={LABEL_W - 8} y={yCenter + 15}
              textAnchor="end" fontSize={9} fill="#9ca3af"
            >
              ±{row.rangePct}%
            </text>

            {/* Row background */}
            <rect
              x={LABEL_W} y={TOP_PAD + ri * ROW_H}
              width={CHART_W} height={ROW_H}
              fill={ri % 2 === 0 ? '#f8fafc' : 'white'}
            />

            {/* Bars per target */}
            {targets.map((target, ti) => {
              const low  = row.lowPrices[ti]  ?? 0
              const high = row.highPrices[ti] ?? 0
              const xLow  = toX(low)
              const xHigh = toX(high)
              const barY = yTop + ti * (BAR_H + BAR_GAP)

              return (
                <g key={target.id}>
                  <rect
                    x={Math.min(xLow, xHigh)}
                    y={barY}
                    width={Math.abs(xHigh - xLow)}
                    height={BAR_H}
                    fill={TARGET_COLORS[ti] ?? '#94a3b8'}
                    opacity={0.85}
                    rx={2}
                  />
                  {/* Low endpoint tick */}
                  <line x1={xLow} y1={barY - 2} x2={xLow} y2={barY + BAR_H + 2} stroke={TARGET_COLORS[ti] ?? '#94a3b8'} strokeWidth={1.5} />
                  {/* High endpoint tick */}
                  <line x1={xHigh} y1={barY - 2} x2={xHigh} y2={barY + BAR_H + 2} stroke={TARGET_COLORS[ti] ?? '#94a3b8'} strokeWidth={1.5} />
                </g>
              )
            })}

            {/* Right-side low — high per target, aligned to each bar */}
            {targets.map((target, ti) => {
              const low  = row.lowPrices[ti]  ?? 0
              const high = row.highPrices[ti] ?? 0
              const totalBarH = targets.length * BAR_H + (targets.length - 1) * BAR_GAP
              const barY = (yCenter - totalBarH / 2) + ti * (BAR_H + BAR_GAP)
              return (
                <text
                  key={target.id}
                  x={LABEL_W + CHART_W + 8}
                  y={barY + BAR_H / 2 + 3}
                  fontSize={9}
                  fill={TARGET_COLORS[ti] ?? '#6b7280'}
                >
                  {formatCurrency(low)} — {formatCurrency(high)}
                </text>
              )
            })}
          </g>
        )
      })}

      {/* Per-target baseline lines — rendered last so they appear above bars */}
      {targets.map((t, ti) => {
        const bx = toX(baselines[t.id] ?? 0)
        return (
          <line
            key={t.id}
            x1={bx} y1={TOP_PAD}
            x2={bx} y2={TOP_PAD + rows.length * ROW_H}
            stroke={TARGET_COLORS[ti] ?? '#94a3b8'}
            strokeWidth={1.5}
            strokeDasharray="4 3"
            opacity={0.7}
          />
        )
      })}

    </svg>
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function Phase7Page() {
  const params    = useParams()
  const projectId = params.id as string
  const router    = useRouter()
  const supabase  = createClient()

  // ── Shared data ────────────────────────────────────────────────────────────
  const [factors,           setFactors]           = useState<Factor[]>([])
  const [benchmarks,        setBenchmarks]        = useState<Benchmark[]>([])
  const [targetProducts,    setTargetProducts]    = useState<TargetProduct[]>([])
  const [attributeWeights,  setAttributeWeights]  = useState<Record<string, number>>({})
  const [levelUtilities,    setLevelUtilities]    = useState<Record<string, number>>({})
  const [attributeLevels,   setAttributeLevels]   = useState<Record<string, string[]>>({})
  const [benchAssignments,  setBenchAssignments]  = useState<Record<string, string>[]>([])
  const [targetAssignments, setTargetAssignments] = useState<Record<string, string>[]>([])
  const [targetBaselines,   setTargetBaselines]   = useState<Record<string, number>>({})
  const [loaded,            setLoaded]            = useState(false)
  const [loadError,         setLoadError]         = useState('')

  // ── Benchmark price sensitivity ────────────────────────────────────────────
  const [benchRanges,    setBenchRanges]    = useState<Record<string, number>>({})
  const [benchSensRows,  setBenchSensRows]  = useState<BenchSensRow[] | null>(null)
  const [benchRunning,   setBenchRunning]   = useState(false)
  const [benchError,     setBenchError]     = useState('')

  // ── Factor sensitivity ─────────────────────────────────────────────────────
  const [factorSens,     setFactorSens]     = useState<SensitivityRow[] | null>(null)
  const [factorR2,       setFactorR2]       = useState<number>(0)
  const [factorRunning,  setFactorRunning]  = useState(false)
  const [factorError,    setFactorError]    = useState('')

  // ── PDF export ─────────────────────────────────────────────────────────────
  const [pdfLoading,     setPdfLoading]     = useState(false)

  // ── Market-implied ─────────────────────────────────────────────────────────
  const [impliedResult,  setImpliedResult]  = useState<{
    implied_weights: Record<string, number>
    b_value: number; m_value: number
    weighted_sse: number; success: boolean
    r_squared_weighted?: number
  } | null>(null)
  const [impliedRunning, setImpliedRunning] = useState(false)
  const [impliedError,   setImpliedError]   = useState('')

  // ── Respondent analysis ────────────────────────────────────────────────────
  const [respondentAnalysis, setRespondentAnalysis] = useState<RespondentModelResult[] | null>(null)
  const [respondentRunning,  setRespondentRunning]  = useState(false)
  const [respondentError,    setRespondentError]    = useState('')

  // ── Load ───────────────────────────────────────────────────────────────────

  useEffect(() => {
    async function load() {
      try {
        const [
          { data: factorData },
          { data: benchData },
          { data: targetData },
          { data: weightData },
          { data: utilityData },
        ] = await Promise.all([
          supabase.from('attribute').select('id, name').eq('project_id', projectId).order('display_order'),
          supabase.from('benchmark').select('id, name, market_price, market_share_pct, included_in_regression, price_range_pct').eq('project_id', projectId).order('name'),
          supabase.from('target_product').select('id, name').eq('project_id', projectId).order('display_order'),
          supabase.from('attribute_weight').select('attribute_id, weight').eq('project_id', projectId),
          supabase.from('level_utility').select('level_id, utility').eq('project_id', projectId),
        ])

        if (!factorData?.length || !benchData?.length || !targetData?.length) {
          setLoadError('Missing data — complete Phases 1–5 before running sensitivity analysis.')
          setLoaded(true)
          return
        }

        setFactors(factorData)
        setBenchmarks(benchData.map(b => ({ ...b, price_range_pct: b.price_range_pct ?? 10 })))
        setTargetProducts(targetData)

        const weights: Record<string, number> = {}
        for (const w of weightData ?? []) weights[w.attribute_id] = w.weight
        setAttributeWeights(weights)

        const utilities: Record<string, number> = {}
        for (const u of utilityData ?? []) utilities[u.level_id] = u.utility
        setLevelUtilities(utilities)

        // Levels per attribute
        const { data: levelData } = await supabase
          .from('level').select('id, attribute_id').in('attribute_id', factorData.map(f => f.id))
        const attrLevels: Record<string, string[]> = {}
        for (const l of levelData ?? []) {
          if (!attrLevels[l.attribute_id]) attrLevels[l.attribute_id] = []
          attrLevels[l.attribute_id].push(l.id)
        }
        setAttributeLevels(attrLevels)

        // Benchmark assignments (included only)
        const includedBenches = benchData.filter(b => b.included_in_regression)
        const { data: benchAssignData } = await supabase
          .from('benchmark_level_assignment').select('benchmark_id, attribute_id, level_id')
          .in('benchmark_id', includedBenches.map(b => b.id))
        const bAssigns = includedBenches.map(b => {
          const a: Record<string, string> = {}
          for (const x of benchAssignData ?? []) if (x.benchmark_id === b.id) a[x.attribute_id] = x.level_id
          return a
        })
        setBenchAssignments(bAssigns)

        // Target assignments + baselines from stored scores
        const { data: targetScoreData } = await supabase
          .from('target_score').select('target_product_id, level_assignments_json, point_estimate')
          .eq('project_id', projectId).is('scenario_id', null)
          .in('target_product_id', targetData.map(t => t.id))
        const tAssigns = targetData.map(t => {
          const ts = targetScoreData?.find(ts => ts.target_product_id === t.id)
          return (ts?.level_assignments_json as Record<string, string>) ?? {}
        })
        setTargetAssignments(tAssigns)

        const baselines: Record<string, number> = {}
        for (const ts of targetScoreData ?? []) baselines[ts.target_product_id] = ts.point_estimate ?? 0
        setTargetBaselines(baselines)

        // Initial ranges from DB (or default 15)
        const ranges: Record<string, number> = {}
        for (const b of benchData) ranges[b.id] = b.price_range_pct ?? 10
        setBenchRanges(ranges)

        // Auto-advance to COMPLETE on first Phase 7 visit after full model run
        const { data: proj } = await supabase
          .from('project').select('status').eq('id', projectId).single()
        if (proj?.status === 'MODEL_RUN') {
          await supabase.from('project').update({ status: 'COMPLETE' }).eq('id', projectId)
          router.refresh()
        }

      } catch (e: any) {
        setLoadError(e.message ?? 'Failed to load data')
      }
      setLoaded(true)
    }
    load()
  }, [projectId]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Solver payload builder ─────────────────────────────────────────────────

  function buildSolverPayload(priceOverrides?: Record<string, number>) {
    const includedBenches = benchmarks.filter(b => b.included_in_regression)
    const prices = includedBenches.map(b => priceOverrides?.[b.id] ?? b.market_price)
    const totalShare = includedBenches.reduce((s, b) => s + (b.market_share_pct ?? 0), 0)
    const marketShareWeights = includedBenches.map(b =>
      totalShare > 0 ? (b.market_share_pct ?? 0) / totalShare : 1 / includedBenches.length
    )
    return {
      attribute_ids:         factors.map(f => f.id),
      attribute_weights:     attributeWeights,
      level_utilities:       levelUtilities,
      attribute_levels:      attributeLevels,
      benchmark_ids:         includedBenches.map(b => b.id),
      benchmark_assignments: benchAssignments,
      market_prices:         prices,
      market_share_weights:  marketShareWeights,
      target_ids:            targetProducts.map(t => t.id),
      target_assignments:    targetAssignments,
    }
  }

  // ── Run benchmark price sensitivity ───────────────────────────────────────

  async function runBenchmarkSensitivity() {
    setBenchRunning(true)
    setBenchError('')
    setBenchSensRows(null)
    try {
      const includedBenches = benchmarks.filter(b => b.included_in_regression)
      if (includedBenches.length < 3) throw new Error('At least 3 reference products must be included.')
      if (!Object.keys(attributeWeights).length) throw new Error('No weights found — complete Phase 5 first.')

      // Save updated ranges to DB
      await Promise.all(
        includedBenches.map(b =>
          supabase.from('benchmark').update({ price_range_pct: benchRanges[b.id] ?? 10 }).eq('id', b.id)
        )
      )

      // For each benchmark: run solver at low price and high price
      const rows: BenchSensRow[] = await Promise.all(
        includedBenches.map(async (bench) => {
          const rangePct = benchRanges[bench.id] ?? 10
          const lowPrice  = bench.market_price * (1 - rangePct / 100)
          const highPrice = bench.market_price * (1 + rangePct / 100)

          const [lowRes, highRes] = await Promise.all([
            fetch('/api/solver?endpoint=solve', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ...buildSolverPayload({ [bench.id]: lowPrice }), run_sensitivity: false }),
            }).then(r => r.json()),
            fetch('/api/solver?endpoint=solve', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ...buildSolverPayload({ [bench.id]: highPrice }), run_sensitivity: false }),
            }).then(r => r.json()),
          ])

          const lowPrices  = (lowRes.target_results  ?? []).map((tr: any) => tr.point_estimate as number)
          const highPrices = (highRes.target_results ?? []).map((tr: any) => tr.point_estimate as number)

          return {
            benchId:   bench.id,
            benchName: bench.name,
            rangePct,
            basePrice: bench.market_price,
            lowPrices,
            highPrices,
          }
        })
      )

      // Sort by max swing across targets (widest bar at top)
      rows.sort((a, b) => {
        const swingA = Math.max(...a.lowPrices.map((lp, i) => Math.abs((a.highPrices[i] ?? 0) - lp)))
        const swingB = Math.max(...b.lowPrices.map((lp, i) => Math.abs((b.highPrices[i] ?? 0) - lp)))
        return swingB - swingA
      })

      setBenchSensRows(rows)
    } catch (e: any) {
      setBenchError(e.message ?? 'Sensitivity run failed')
    }
    setBenchRunning(false)
  }

  // ── Run factor sensitivity ─────────────────────────────────────────────────

  async function runFactorSensitivity() {
    setFactorRunning(true)
    setFactorError('')
    setFactorSens(null)
    try {
      const includedBenches = benchmarks.filter(b => b.included_in_regression)
      if (includedBenches.length < 3) throw new Error('At least 3 reference products must be included.')

      const res = await fetch('/api/solver?endpoint=solve', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...buildSolverPayload(), run_sensitivity: true }),
      })
      if (!res.ok) throw new Error(`Solver error: ${res.status}`)
      const data = await res.json()
      if (!data.success) throw new Error(data.error ?? 'Solver failed')
      setFactorSens(data.sensitivity ?? [])
      setFactorR2(data.r_squared_weighted ?? 0)
    } catch (e: any) {
      setFactorError(e.message ?? 'Analysis failed')
    }
    setFactorRunning(false)
  }

  // ── Run market-implied weights ─────────────────────────────────────────────

  async function runMarketImplied() {
    setImpliedRunning(true)
    setImpliedError('')
    try {
      const includedBenches = benchmarks.filter(b => b.included_in_regression)
      const totalShare = includedBenches.reduce((s, b) => s + (b.market_share_pct ?? 0), 0)
      const marketShareWeights = includedBenches.map(b =>
        totalShare > 0 ? (b.market_share_pct ?? 0) / totalShare : 1 / includedBenches.length
      )
      const res = await fetch('/api/solver?endpoint=market-implied-weights', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          attribute_ids:         factors.map(f => f.id),
          level_utilities:       levelUtilities,
          attribute_levels:      attributeLevels,
          benchmark_assignments: benchAssignments,
          market_prices:         includedBenches.map(b => b.market_price),
          market_share_weights:  marketShareWeights,
        }),
      })
      if (!res.ok) throw new Error('Solver returned an error')
      const data = await res.json()

      // Compute implied R² from survey SSE (proxy via stored regression)
      const { data: regData } = await supabase
        .from('regression_result').select('r_squared_weighted, weighted_sse')
        .eq('project_id', projectId).is('scenario_id', null).maybeSingle()
      if (regData) {
        const surveyR2  = regData.r_squared_weighted ?? 0
        const sst = surveyR2 < 1 ? regData.weighted_sse / (1 - surveyR2) : null
        const impliedR2 = sst && sst > 0 ? 1 - data.weighted_sse / sst : null
        setImpliedResult({ ...data, r_squared_weighted: impliedR2 ?? undefined })
      } else {
        setImpliedResult(data)
      }
    } catch (e: any) {
      setImpliedError(e.message ?? 'Analysis failed')
    }
    setImpliedRunning(false)
  }

  // ── Run respondent-level analysis ──────────────────────────────────────────

  async function runRespondentAnalysis() {
    setRespondentRunning(true)
    setRespondentError('')
    try {
      const { data: respondentData } = await supabase
        .from('respondent').select('id, name, email, mode, submitted_at, included')
        .eq('project_id', projectId).eq('included', true)
      const eligible = (respondentData ?? []).filter(r =>
        r.mode === 'FACILITATED' || r.submitted_at != null
      )
      if (eligible.length < 2) throw new Error('Need at least 2 respondents for comparison.')

      const { data: allResponses } = await supabase
        .from('pairwise_response').select('respondent_id, comparison_type, item_a_id, item_b_id, score, direction')
        .in('respondent_id', eligible.map(r => r.id))

      const includedBenches = benchmarks.filter(b => b.included_in_regression)
      const totalShare = includedBenches.reduce((s, b) => s + (b.market_share_pct ?? 0), 0)
      const marketShareWeights = includedBenches.map(b =>
        totalShare > 0 ? (b.market_share_pct ?? 0) / totalShare : 1 / includedBenches.length
      )

      const results = await Promise.all(eligible.map(async (respondent) => {
        try {
          const rResps = (allResponses ?? []).filter(r => r.respondent_id === respondent.id)
          const N = factors.length
          const attrMatrix: number[][] = Array.from({ length: N }, () => Array(N).fill(1))
          for (const resp of rResps.filter(r => r.comparison_type === 'ATTRIBUTE')) {
            const iIdx = factors.findIndex(f => f.id === resp.item_a_id)
            const jIdx = factors.findIndex(f => f.id === resp.item_b_id)
            if (iIdx === -1 || jIdx === -1) continue
            if (resp.direction === 'EQUAL') {
              attrMatrix[iIdx][jIdx] = 1; attrMatrix[jIdx][iIdx] = 1
            } else if (resp.direction === 'A') {
              attrMatrix[iIdx][jIdx] = resp.score; attrMatrix[jIdx][iIdx] = 1 / resp.score
            } else {
              attrMatrix[jIdx][iIdx] = resp.score; attrMatrix[iIdx][jIdx] = 1 / resp.score
            }
          }

          const [attrResult, ...levelResults] = await Promise.all([
            fetch('/api/solver?endpoint=priority-vector', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ matrix: attrMatrix }),
            }).then(r => r.json()),
            ...factors.map(async (factor) => {
              const levelIds = attributeLevels[factor.id] ?? []
              const K = levelIds.length
              if (K < 2) return { factor_id: factor.id, utilities: Object.fromEntries(levelIds.map(id => [id, 1])) }
              const matrix: number[][] = Array.from({ length: K }, () => Array(K).fill(1))
              for (const resp of rResps.filter(r =>
                r.comparison_type === 'LEVEL' &&
                levelIds.includes(r.item_a_id) && levelIds.includes(r.item_b_id)
              )) {
                const iIdx = levelIds.indexOf(resp.item_a_id)
                const jIdx = levelIds.indexOf(resp.item_b_id)
                if (iIdx === -1 || jIdx === -1) continue
                if (resp.direction === 'EQUAL') {
                  matrix[iIdx][jIdx] = 1; matrix[jIdx][iIdx] = 1
                } else if (resp.direction === 'A') {
                  matrix[iIdx][jIdx] = resp.score; matrix[jIdx][iIdx] = 1 / resp.score
                } else {
                  matrix[jIdx][iIdx] = resp.score; matrix[iIdx][jIdx] = 1 / resp.score
                }
              }
              const res = await fetch('/api/solver?endpoint=priority-vector', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ matrix }),
              })
              const data = await res.json()
              return { factor_id: factor.id, utilities: Object.fromEntries(levelIds.map((id, i) => [id, data.weights?.[i] ?? 0])) }
            }),
          ])

          const factorWeights: Record<string, number> = {}
          factors.forEach((f, i) => { factorWeights[f.id] = attrResult.weights?.[i] ?? (1 / N) })
          const rLevelUtilities: Record<string, number> = {}
          for (const lr of levelResults) {
            if (lr?.utilities) Object.assign(rLevelUtilities, lr.utilities)
          }

          const solveRes = await fetch('/api/solver?endpoint=solve', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              attribute_ids:         factors.map(f => f.id),
              attribute_weights:     factorWeights,
              level_utilities:       rLevelUtilities,
              attribute_levels:      attributeLevels,
              benchmark_ids:         includedBenches.map(b => b.id),
              benchmark_assignments: benchAssignments,
              market_prices:         includedBenches.map(b => b.market_price),
              market_share_weights:  marketShareWeights,
              target_ids:            targetProducts.map(t => t.id),
              target_assignments:    targetAssignments,
              run_sensitivity:       false,
            }),
          })
          const solveData = await solveRes.json()
          if (!solveData.success) return null

          return {
            respondent_id: respondent.id,
            name: respondent.name || respondent.email || 'Respondent',
            factor_weights: factorWeights,
            target_prices: (solveData.target_results ?? []).map((tr: any) => tr.point_estimate as number),
            r_squared: solveData.r_squared_weighted as number,
            is_outlier: false,
          } as RespondentModelResult
        } catch { return null }
      }))

      const valid = results.filter(r => r !== null) as RespondentModelResult[]
      if (valid.length < 2) throw new Error('Fewer than 2 respondents produced valid results.')

      if (valid.length >= 3 && targetProducts.length > 0) {
        const prices = valid.map(r => r.target_prices[0] ?? 0)
        const mean = prices.reduce((a, b) => a + b, 0) / prices.length
        const std = Math.sqrt(prices.reduce((a, b) => a + (b - mean) ** 2, 0) / prices.length)
        for (const r of valid) {
          r.is_outlier = std > 0 && Math.abs((r.target_prices[0] ?? 0) - mean) > 2 * std
        }
      }

      setRespondentAnalysis(valid)
    } catch (e: any) {
      setRespondentError(e.message ?? 'Analysis failed')
    }
    setRespondentRunning(false)
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  if (!loaded) return <div className="text-gray-400 text-sm p-8">Loading…</div>
  if (loadError) return (
    <div className="max-w-2xl mx-auto p-8">
      <div className="bg-amber-50 border border-amber-200 rounded-md px-4 py-3 text-sm text-amber-700">{loadError}</div>
    </div>
  )

  const includedBenches = benchmarks.filter(b => b.included_in_regression)
  const surveyR2Stored = factorR2

  return (
    <div className="w-full max-w-5xl mx-auto">

      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Sensitivity Analysis</h1>
        <p className="text-gray-500 mt-1 text-sm">
          Explore how input assumptions drive the price recommendation — reference product prices, factor weights, and respondent variation.
        </p>
      </div>

      <div className="space-y-8">

        {/* ── 1. Benchmark Price Sensitivity ─────────────────────────────── */}
        <section className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-start justify-between mb-1">
            <div>
              <div className="flex items-center gap-1.5">
                <h2 className="text-base font-semibold text-gray-900">Reference Product Price Sensitivity</h2>
                <HelpTip content="This shows how much your target price recommendation moves when a reference product's price turns out to be wrong — for example if its list price is different from what buyers actually pay. Each bar represents one reference product: wider means it has more influence over your recommendation. Use this to identify which market prices you should verify most carefully before locking in a pricing decision." width="w-96" />
              </div>
              <p className="text-xs text-gray-500 mt-0.5">
                Shows how the price recommendation shifts when each reference product's price varies through its uncertainty range, holding all others constant. Wider bars indicate higher influence on the recommendation.
              </p>
            </div>
            <button
              onClick={runBenchmarkSensitivity}
              disabled={benchRunning || includedBenches.length < 3}
              className="ml-4 flex-shrink-0 px-4 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-md hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1.5"
            >
              {benchRunning
                ? <><span className="inline-block w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" /> Running…</>
                : benchSensRows ? '↺ Re-run' : 'Run Sensitivity'}
            </button>
          </div>

          {benchError && (
            <div className="mb-4 text-xs text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">{benchError}</div>
          )}

          {/* Results table — also serves as range editor pre- and post-run */}
          {(() => {
          // After running, match the tornado's influence sort; pre-run use load order
          const tableRows: typeof includedBenches = benchSensRows
            ? benchSensRows.map(r => includedBenches.find(b => b.id === r.benchId)!).filter(Boolean)
            : includedBenches
          return (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm border-separate border-spacing-0">
              <thead>
                <tr>
                  <th className="text-left text-xs font-medium text-gray-500 pb-3 pr-4 border-b border-gray-100" style={{ minWidth: 160 }}>Reference Product</th>
                  <th className="text-right text-xs font-medium text-gray-500 pb-3 pr-4 border-b border-gray-100">Base Price</th>
                  <th className="text-center text-xs font-medium text-gray-500 pb-3 pr-4 border-b border-gray-100">±% Range</th>
                  {benchSensRows && targetProducts.map(t => (
                    <th key={t.id} colSpan={2} className="text-center text-xs font-medium text-gray-500 pb-1 px-2 border-b-0">
                      <div>{t.name}</div>
                      <div className="text-gray-400 font-normal">base: {formatCurrencyFull(targetBaselines[t.id] ?? 0)}</div>
                    </th>
                  ))}
                </tr>
                {benchSensRows && (
                  <tr>
                    <th className="pb-2 pr-4 border-b border-gray-100" />
                    <th className="pb-2 pr-4 border-b border-gray-100" />
                    <th className="pb-2 pr-4 border-b border-gray-100" />
                    {targetProducts.map(t => (
                      <Fragment key={t.id}>
                        <th className="text-right text-xs text-gray-400 pb-2 pr-2 border-b border-gray-100">Low</th>
                        <th className="text-right text-xs text-gray-400 pb-2 pr-4 border-b border-gray-100">High</th>
                      </Fragment>
                    ))}
                  </tr>
                )}
              </thead>
              <tbody>
                {tableRows.map((b, i) => {
                  const row = benchSensRows?.find(r => r.benchId === b.id)
                  return (
                    <tr key={b.id} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                      <td className="py-2 pr-4 text-gray-800 font-medium">{b.name}</td>
                      <td className="py-2 pr-4 text-right text-gray-600">{formatCurrencyFull(b.market_price)}</td>
                      {/* Editable range cell — shows % input + computed dollar range */}
                      <td className="py-2 pr-4">
                        <div className="flex flex-col items-center gap-0.5">
                          <div className="flex items-center justify-center gap-1 bg-blue-50 border border-blue-200 rounded px-2 py-1">
                            <span className="text-xs text-blue-500">±</span>
                            <input
                              type="number"
                              min={1} max={50}
                              value={benchRanges[b.id] ?? 10}
                              onChange={e => setBenchRanges(prev => ({ ...prev, [b.id]: Math.max(1, Math.min(50, Number(e.target.value))) }))}
                              className="w-10 bg-transparent text-xs text-center text-blue-700 font-medium focus:outline-none"
                            />
                            <span className="text-xs text-blue-500">%</span>
                          </div>
                          {(() => {
                            const pct = benchRanges[b.id] ?? 10
                            const lo = b.market_price * (1 - pct / 100)
                            const hi = b.market_price * (1 + pct / 100)
                            return (
                              <span className="text-xs text-gray-400 whitespace-nowrap">
                                {formatCurrencyFull(lo)} — {formatCurrencyFull(hi)}
                              </span>
                            )
                          })()}
                        </div>
                      </td>
                      {row && targetProducts.map((t, ti) => {
                        const low  = row.lowPrices[ti]  ?? 0
                        const high = row.highPrices[ti] ?? 0
                        return (
                          <Fragment key={t.id}>
                            <td className="py-2 pr-2 text-right text-gray-700 text-xs">{formatCurrencyFull(low)}</td>
                            <td className="py-2 pr-4 text-right text-gray-700 text-xs">{formatCurrencyFull(high)}</td>
                          </Fragment>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          )})()}

          {benchSensRows && benchSensRows.length > 0 && (
            <div className="mt-2">
              <TornadoChart rows={benchSensRows} targets={targetProducts} baselines={targetBaselines} />
              {/* Legend below tornado */}
              {targetProducts.length > 1 && (
                <div className="flex gap-4 mt-2 pl-1">
                  {targetProducts.map((t, ti) => (
                    <div key={t.id} className="flex items-center gap-1.5">
                      <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, backgroundColor: TARGET_COLORS[ti] ?? '#94a3b8', opacity: 0.85 }} />
                      <span className="text-xs text-gray-600">{t.name}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>

        {/* ── 2. Factor Sensitivity ───────────────────────────────────────── */}
        <section className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-start justify-between mb-1">
            <div>
              <div className="flex items-center gap-1.5">
                <h2 className="text-base font-semibold text-gray-900">Factor Sensitivity Analysis</h2>
                <HelpTip content="Removes each factor one at a time and re-runs the model to see what changes. A large price shift means your recommendation is heavily dependent on that factor — worth double-checking the performance scores and importance weight you assigned it. The Signal column flags factors where the market data tells a different story from your team's survey: if removing a factor improves model fit, the market may not price that dimension the way your team weighted it." width="w-96" />
              </div>
              <p className="text-xs text-gray-500 mt-0.5">
                Shows how the recommended price changes when each factor is removed from the model one at a time. A large price delta means the model is heavily dependent on that factor.
              </p>
            </div>
            <button
              onClick={runFactorSensitivity}
              disabled={factorRunning || includedBenches.length < 3}
              className="ml-4 flex-shrink-0 px-4 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-md hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1.5"
            >
              {factorRunning
                ? <><span className="inline-block w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" /> Running…</>
                : factorSens ? '↺ Re-run' : 'Run Analysis'}
            </button>
          </div>

          {factorError && (
            <div className="mt-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">{factorError}</div>
          )}

          {factorSens && factorSens.length > 0 && (
            <div className="overflow-x-auto mt-4">
              <table className="w-full text-sm border-separate border-spacing-0">
                <thead>
                  <tr>
                    <th className="text-left text-xs font-medium text-gray-500 pb-3 pr-4 border-b border-gray-100" style={{ minWidth: 140 }}>Factor</th>
                    <th className="text-right text-xs font-medium text-gray-500 pb-3 pr-4 border-b border-gray-100">Survey Weight</th>
                    <th className="text-right text-xs font-medium text-gray-500 pb-3 pr-4 border-b border-gray-100">R² (full)</th>
                    <th className="text-right text-xs font-medium text-gray-500 pb-3 pr-4 border-b border-gray-100">R² if excluded</th>
                    <th className="text-right text-xs font-medium text-gray-500 pb-3 pr-4 border-b border-gray-100">R² delta</th>
                    <th className="text-right text-xs font-medium text-gray-500 pb-3 pr-4 border-b border-gray-100">Price if excluded</th>
                    <th className="text-right text-xs font-medium text-gray-500 pb-3 pr-4 border-b border-gray-100">Price delta</th>
                    <th className="text-right text-xs font-medium text-gray-500 pb-3 pr-4 border-b border-gray-100">Delta %</th>
                    <th className="text-left text-xs font-medium text-gray-500 pb-3 border-b border-gray-100" style={{ minWidth: 180 }}>Signal</th>
                  </tr>
                </thead>
                <tbody>
                  {factorSens.map((row, i) => {
                    const factor = factors.find(f => f.id === row.excluded_attribute_id)
                    const weight = attributeWeights[row.excluded_attribute_id] ?? 0
                    const fullR2 = surveyR2Stored
                    const excR2  = row.r_squared_weighted
                    const r2Delta = excR2 != null ? excR2 - fullR2 : null
                    const firstBasePrice = targetBaselines[targetProducts[0]?.id ?? ''] ?? 0
                    const priceDeltaPct = row.delta_from_full_model != null && firstBasePrice
                      ? Math.abs(row.delta_from_full_model) / firstBasePrice : 0

                    const r2DeltaAbs    = Math.abs(r2Delta ?? 0)
                    const r2Improves    = r2Delta != null && r2Delta > 0.03
                    const r2Drops       = r2Delta != null && r2Delta < -0.05
                    const r2DropsLarge  = r2Delta != null && r2Delta < -0.08
                    const priceImpactLg = priceDeltaPct > 0.05
                    const priceImpactSm = priceDeltaPct < 0.015
                    const r2Stable      = r2DeltaAbs < 0.025

                    let signal = ''
                    let signalColor = '#374151'
                    if (r2Improves) {
                      signal = 'Worth reviewing — market may not price this factor as SMEs indicated'
                      signalColor = '#b45309'
                    } else if (r2DropsLarge || (r2Drops && priceImpactLg) || (priceImpactLg && r2Stable)) {
                      if (r2DropsLarge && priceImpactLg)       signal = 'Load-bearing — strongly influences both fit and recommendation'
                      else if (r2DropsLarge)                   signal = 'Load-bearing — removing significantly weakens model fit'
                      else if (priceImpactLg && r2Stable)      signal = 'Drives recommendation — high value influence with stable fit'
                      else                                     signal = 'Load-bearing — influences fit and recommendation'
                      signalColor = '#1d4ed8'
                    } else if (priceImpactSm && r2Stable) {
                      signal = 'Low influence — candidate for exclusion from this model run'
                      signalColor = '#9ca3af'
                    }

                    return (
                      <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                        <td className="py-2 pr-4 text-gray-800 font-medium">{factor?.name ?? row.excluded_attribute_id}</td>
                        <td className="py-2 pr-4 text-right text-gray-700">{(weight * 100).toFixed(1)}%</td>
                        <td className="py-2 pr-4 text-right text-gray-500">{(fullR2 * 100).toFixed(1)}%</td>
                        <td className="py-2 pr-4 text-right text-gray-700">{excR2 != null ? `${(excR2 * 100).toFixed(1)}%` : '—'}</td>
                        <td className="py-2 pr-4 text-right text-gray-700">
                          {r2Delta != null ? `${r2Delta > 0 ? '+' : ''}${(r2Delta * 100).toFixed(1)}pp` : '—'}
                        </td>
                        <td className="py-2 pr-4 text-right text-gray-700">
                          {row.point_estimate != null ? formatCurrencyFull(row.point_estimate) : '—'}
                        </td>
                        <td className="py-2 pr-4 text-right text-gray-700">
                          {row.delta_from_full_model != null
                            ? `${row.delta_from_full_model > 0 ? '+' : ''}${formatCurrencyFull(row.delta_from_full_model)}`
                            : '—'}
                        </td>
                        <td className="py-2 pr-4 text-right text-gray-700">
                          {row.delta_from_full_model != null && firstBasePrice
                            ? `${row.delta_from_full_model > 0 ? '+' : ''}${(row.delta_from_full_model / firstBasePrice * 100).toFixed(1)}%`
                            : '—'}
                        </td>
                        <td className="py-2 text-xs" style={{ color: signalColor }}>{signal}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* ── 3. Market-Implied Weight Analysis ──────────────────────────── */}
        {(() => {
          const K = includedBenches.length
          const N = factors.length
          const sufficient = K > N
          const marginal   = sufficient && K < N + 5
          return (
            <section className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <div className="flex items-start justify-between mb-1">
                <div>
                  <div className="flex items-center gap-1.5">
                    <h2 className="text-base font-semibold text-gray-900">Market-Implied Weight Analysis</h2>
                    <HelpTip content="Asks a different question: what factor weights would best explain the prices already in the market, ignoring your team's survey entirely? If the market-implied weights look very different from your survey weights, it means buyers may not value factors the same way your team does — or that the market prices don't fully reflect value differences on those dimensions. A large improvement in model fit when using market-implied weights is a signal worth investigating before finalizing your pricing." width="w-96" />
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Compares survey-derived Importance Scores against weights that best fit observed market prices — revealing where the market agrees or disagrees with your team's assessments.
                  </p>
                </div>
                <button
                  onClick={runMarketImplied}
                  disabled={impliedRunning || !sufficient}
                  title={!sufficient ? `Insufficient data: need at least ${N + 1} reference products for ${N} factors (have ${K})` : ''}
                  className="ml-4 flex-shrink-0 px-4 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-md hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1.5"
                >
                  {impliedRunning
                    ? <><span className="inline-block w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" /> Running…</>
                    : impliedResult ? '↺ Re-run' : 'Run Analysis'}
                </button>
              </div>

              {!sufficient && (
                <div className="mt-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                  ⚠ Requires at least {N + 1} reference products for {N} factors ({K} currently included).
                </div>
              )}
              {marginal && (
                <div className="mt-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                  ⚠ Marginal data ({K} products, {N} factors). Results are valid but interpret with caution.
                </div>
              )}
              {impliedError && (
                <div className="mt-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">{impliedError}</div>
              )}

              {impliedResult && (
                <div className="mt-4">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm border-separate border-spacing-0">
                      <thead>
                        <tr>
                          <th className="text-left text-xs font-medium text-gray-500 pb-3 pr-4 border-b border-gray-100" style={{ minWidth: 140 }}>Factor</th>
                          <th className="text-right text-xs font-medium text-gray-500 pb-3 pr-4 border-b border-gray-100">Survey Weight</th>
                          <th className="text-right text-xs font-medium text-gray-500 pb-3 pr-4 border-b border-gray-100">Market-Implied</th>
                          <th className="text-right text-xs font-medium text-gray-500 pb-3 pr-4 border-b border-gray-100">Gap</th>
                          <th className="text-left text-xs font-medium text-gray-500 pb-3 border-b border-gray-100">Interpretation</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(() => {
                          const eqShare = 100 / factors.length
                          const amberAt = 0.25 * eqShare
                          const redAt   = 0.65 * eqShare
                          return factors.map((f, i) => {
                            const surveyW  = attributeWeights[f.id] ?? 0
                            const impliedW = impliedResult.implied_weights[f.id] ?? 0
                            const gapPp    = (impliedW - surveyW) * 100
                            const absGap   = Math.abs(gapPp)
                            const gapColor =
                              absGap < amberAt ? '#374151' :
                              absGap < redAt   ? '#b45309' : '#b91c1c'
                            const interpretation =
                              absGap < amberAt ? '' :
                              gapPp > 0 ? 'Market prices this more than survey suggests'
                                        : 'Market prices this less than survey suggests'
                            return (
                              <tr key={f.id} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                                <td className="py-2 pr-4 text-gray-800 font-medium">{f.name}</td>
                                <td className="py-2 pr-4 text-right text-gray-700">{(surveyW * 100).toFixed(1)}%</td>
                                <td className="py-2 pr-4 text-right text-gray-700">{(impliedW * 100).toFixed(1)}%</td>
                                <td className="py-2 pr-4 text-right font-medium" style={{ color: gapColor }}>
                                  {gapPp > 0 ? '+' : ''}{gapPp.toFixed(1)}pp
                                </td>
                                <td className="py-2 text-xs" style={{ color: gapColor }}>{interpretation}</td>
                              </tr>
                            )
                          })
                        })()}
                      </tbody>
                    </table>
                  </div>
                  {impliedResult.r_squared_weighted != null && (() => {
                    const { data: regData } = { data: null } as any // footer computed during run
                    const surveyR2  = factorR2 || 0
                    const impliedR2 = impliedResult.r_squared_weighted as number
                    const gap       = impliedR2 - surveyR2
                    const material  = Math.abs(gap) > 0.03
                    return (
                      <div className="mt-3 flex flex-wrap gap-6 text-xs text-gray-500">
                        {material
                          ? <span className="text-amber-700">⚠ Market-implied fit is meaningfully better (+{(gap * 100).toFixed(1)}pp R²) — weight assumptions deserve review</span>
                          : <span className="text-green-700">✓ Survey weights produce fit comparable to market-implied</span>
                        }
                      </div>
                    )
                  })()}
                </div>
              )}
            </section>
          )
        })()}

        {/* ── 4. Respondent-Level Model Analysis ─────────────────────────── */}
        <section className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-start justify-between mb-1">
            <div>
              <div className="flex items-center gap-1.5">
                <h2 className="text-base font-semibold text-gray-900">Respondent-Level Model Analysis</h2>
                <HelpTip content="Runs the pricing model separately using each respondent's weights alone, then compares the results. If all respondents produce similar price recommendations, the consensus is robust. If one respondent produces a very different result (flagged as an outlier), their survey influenced the group aggregation significantly — you may want to revisit whether to include them. This doesn't change the model; it's a diagnostic to understand how much your result depends on any single voice." width="w-96" />
              </div>
              <p className="text-xs text-gray-500 mt-0.5">
                Runs the model independently for each respondent — shows how much the consensus is driven by agreement vs. one or two dominant voices.
              </p>
            </div>
            <button
              onClick={runRespondentAnalysis}
              disabled={respondentRunning}
              className="ml-4 flex-shrink-0 px-4 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-md hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1.5"
            >
              {respondentRunning
                ? <><span className="inline-block w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" /> Running…</>
                : respondentAnalysis ? '↺ Re-run' : 'Run Analysis'}
            </button>
          </div>

          {respondentError && (
            <div className="mt-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">{respondentError}</div>
          )}

          {respondentAnalysis && (() => {
            const consensusWeights = attributeWeights
            const consensusPrices  = targetProducts.map(t => targetBaselines[t.id] ?? 0)
            const prices = respondentAnalysis.map(r => r.target_prices[0] ?? 0)
            const mean = prices.reduce((a, b) => a + b, 0) / prices.length
            const std  = prices.length > 1
              ? Math.sqrt(prices.reduce((a, b) => a + (b - mean) ** 2, 0) / prices.length)
              : 0
            const cvPct = mean > 0 ? (std / mean) * 100 : 0
            const stabilityColor = cvPct < 5 ? '#15803d' : cvPct < 15 ? '#b45309' : '#b91c1c'
            const stabilityText =
              cvPct < 5  ? '✓ Consensus is stable — respondent prices are tightly clustered' :
              cvPct < 15 ? '⚠ Moderate variance — some divergence in preferences; consensus is defensible but inspect flagged respondents' :
                           '⚠ High variance — large spread suggests strongly divergent views; identify which respondents are driving the model'

            const wDevColor = (w: number, cw: number) => {
              const d = Math.abs(w - cw) * 100
              return d < 5 ? '#374151' : d < 15 ? '#b45309' : '#b91c1c'
            }
            const pDevColor = (p: number, cp: number) => {
              const d = cp > 0 ? Math.abs(p - cp) / cp * 100 : 0
              return d < 5 ? '#374151' : d < 15 ? '#b45309' : '#b91c1c'
            }

            return (
              <div className="mt-4">
                <div className="overflow-x-auto">
                  <table className="text-sm border-separate border-spacing-0" style={{ minWidth: '100%' }}>
                    <thead>
                      <tr>
                        <th className="text-left text-xs font-medium text-gray-500 pb-3 pr-4 border-b border-gray-100" style={{ minWidth: 130 }}>Respondent</th>
                        {factors.map(f => (
                          <th key={f.id} className="text-right text-xs font-medium text-gray-500 pb-3 pr-4 border-b border-gray-100" style={{ minWidth: 80 }}>{f.name}</th>
                        ))}
                        {targetProducts.map(t => (
                          <th key={t.id} className="text-right text-xs font-medium text-gray-500 pb-3 pr-4 border-b border-gray-100" style={{ minWidth: 100 }}>{t.name}</th>
                        ))}
                        <th className="text-right text-xs font-medium text-gray-500 pb-3 border-b border-gray-100" style={{ minWidth: 48 }}>R²</th>
                      </tr>
                    </thead>
                    <tbody>
                      {respondentAnalysis.map((r, i) => (
                        <tr key={r.respondent_id} className={r.is_outlier ? 'bg-amber-50' : i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                          <td className="py-2 pr-4 text-gray-800">
                            {r.name}
                            {r.is_outlier && <span className="ml-1.5 text-xs text-amber-700 font-medium">⚠ outlier</span>}
                          </td>
                          {factors.map(f => {
                            const w  = r.factor_weights[f.id] ?? 0
                            const cw = consensusWeights[f.id] ?? 0
                            const diff = (w - cw) * 100
                            return (
                              <td key={f.id} className="py-2 pr-4 text-right" style={{ color: wDevColor(w, cw) }}>
                                {(w * 100).toFixed(1)}%
                                {Math.abs(diff) >= 5 && <span className="text-xs ml-0.5">({diff > 0 ? '+' : ''}{diff.toFixed(0)}pp)</span>}
                              </td>
                            )
                          })}
                          {targetProducts.map((t, ti) => {
                            const p  = r.target_prices[ti] ?? 0
                            const cp = consensusPrices[ti]  ?? 0
                            const diffPct = cp > 0 ? ((p - cp) / cp) * 100 : 0
                            return (
                              <td key={t.id} className="py-2 pr-4 text-right" style={{ color: pDevColor(p, cp) }}>
                                {formatCurrencyFull(p)}
                                {Math.abs(diffPct) >= 5 && <span className="text-xs ml-0.5">({diffPct > 0 ? '+' : ''}{diffPct.toFixed(0)}%)</span>}
                              </td>
                            )
                          })}
                          <td className="py-2 text-right text-gray-500">{(r.r_squared * 100).toFixed(0)}%</td>
                        </tr>
                      ))}
                      <tr className="bg-blue-50 font-semibold border-t border-blue-100">
                        <td className="py-2 pr-4 text-blue-800">Consensus</td>
                        {factors.map(f => (
                          <td key={f.id} className="py-2 pr-4 text-right text-blue-800">
                            {((consensusWeights[f.id] ?? 0) * 100).toFixed(1)}%
                          </td>
                        ))}
                        {targetProducts.map((t, ti) => (
                          <td key={t.id} className="py-2 pr-4 text-right text-blue-800">
                            {formatCurrencyFull(consensusPrices[ti] ?? 0)}
                          </td>
                        ))}
                        <td className="py-2 text-right text-blue-800">—</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <div className="mt-3 flex flex-wrap gap-6 text-xs text-gray-500">
                  {targetProducts.length > 0 && (
                    <>
                      <span>Price range: {formatCurrencyFull(Math.min(...prices))} — {formatCurrencyFull(Math.max(...prices))}</span>
                      <span>Std dev: {formatCurrencyFull(Math.round(std))} ({cvPct.toFixed(1)}% of mean)</span>
                    </>
                  )}
                  <span style={{ color: stabilityColor }}>{stabilityText}</span>
                </div>
              </div>
            )
          })()}
        </section>

        {/* Nav buttons */}
        <div className="flex justify-between pb-8">
          <button
            onClick={() => router.push(`/dashboard/projects/${projectId}/phase-6`)}
            className="px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 hover:bg-gray-50"
          >
            ← Back to Analysis & Output
          </button>
          <div className="flex items-center gap-3">
            <button
              onClick={async () => {
                setPdfLoading(true)
                try {
                  // Map pre-computed state to PDF types
                  const benchSensitivity = benchSensRows?.map(r => ({
                    benchId:    r.benchId,
                    benchName:  r.benchName,
                    rangePct:   r.rangePct,
                    basePrice:  r.basePrice,
                    lowPrices:  r.lowPrices,
                    highPrices: r.highPrices,
                  }))
                  const factorSensitivity = factorSens?.map(r => ({
                    factorId:         r.excluded_attribute_id,
                    factorName:       factors.find(f => f.id === r.excluded_attribute_id)?.name ?? r.excluded_attribute_id,
                    weight:           attributeWeights[r.excluded_attribute_id] ?? 0,
                    pointEstimate:    r.point_estimate,
                    deltaFromFull:    r.delta_from_full_model,
                    rSquaredExcluded: r.r_squared_weighted,
                    flagged:          r.flagged,
                  }))
                  const res = await fetch(`/api/pdf/${projectId}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ benchSensitivity, factorSensitivity }),
                  })
                  if (!res.ok) {
                    const err = await res.json().catch(() => ({ error: 'PDF generation failed' }))
                    throw new Error(err.error)
                  }
                  const blob = await res.blob()
                  const url  = URL.createObjectURL(blob)
                  const a    = document.createElement('a')
                  a.href     = url
                  a.download = res.headers.get('Content-Disposition')?.match(/filename="(.+)"/)?.[1] ?? 'VPM_Report.pdf'
                  a.click()
                  URL.revokeObjectURL(url)
                } catch (err: any) {
                  alert(err.message ?? 'PDF generation failed')
                } finally {
                  setPdfLoading(false)
                }
              }}
              disabled={pdfLoading}
              className="flex items-center gap-2 px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-md hover:bg-gray-700 disabled:opacity-50"
            >
              {pdfLoading ? (
                <>
                  <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                  Generating…
                </>
              ) : (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />
                  </svg>
                  Export PDF
                </>
              )}
            </button>
            <button
              onClick={() => router.push('/dashboard')}
              className="px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 hover:bg-gray-50"
            >
              Return to Dashboard
            </button>
          </div>
        </div>

      </div>
    </div>
  )
}
