'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter, useParams } from 'next/navigation'
import { HelpTip } from '@/app/components/HelpTip'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Factor {
  id: string
  name: string
}

interface Benchmark {
  id: string
  name: string
  market_price: number
  market_share_pct: number
  included_in_regression: boolean
  exclusion_reason: string | null
}

interface TargetProduct {
  id: string
  name: string
  use_case_type: string
}

interface TargetResult {
  target_id: string
  name: string
  value_index: number
  point_estimate: number
  range_low: number
  range_high: number
}

interface SolverResult {
  success: boolean
  error?: string
  b: number
  m: number
  weighted_sse: number
  r_squared_weighted: number
  rse: number
  constraint_regime: string
  init_strategy: string
  near_equivalent_flag: boolean
  suspicious_m_low: boolean
  suspicious_b_high: boolean
  benchmark_value_indices: number[]
  benchmark_residuals: number[]
  outlier_flags: boolean[]
  target_results: TargetResult[]
  sensitivity: SensitivityRow[]
  all_runs: any[]
}

interface SensitivityRow {
  excluded_attribute_id: string
  weighted_sse: number | null
  r_squared_weighted: number | null
  point_estimate: number | null
  delta_from_full_model: number | null
  flagged: boolean
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function r2Color(r2: number) {
  if (r2 >= 0.8) return 'text-green-700 bg-green-50 border-green-200'
  if (r2 >= 0.5) return 'text-amber-700 bg-amber-50 border-amber-200'
  return 'text-red-700 bg-red-50 border-red-200'
}

function r2Label(r2: number) {
  if (r2 >= 0.8) return 'Good fit'
  if (r2 >= 0.5) return 'Moderate fit'
  return 'Poor fit'
}

function formatCurrency(val: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', minimumFractionDigits: 2
  }).format(val)
}

function formatRmse(weightedSse: number, n: number) {
  if (n <= 0) return '—'
  const rmse = Math.sqrt(weightedSse / n)
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0
  }).format(rmse)
}

function formatNrmse(weightedSse: number, prices: number[]) {
  if (prices.length <= 0) return '—'
  const rmse = Math.sqrt(weightedSse / prices.length)
  const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length
  if (avgPrice <= 0) return '—'
  return (rmse / avgPrice * 100).toFixed(1) + '%'
}

function formatRse(rse: number) {
  return (rse * 100).toFixed(1) + '%'
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function Phase5Page() {
  const params    = useParams()
  const projectId = params.id as string
  const router    = useRouter()
  const supabase  = createClient()

  const [factors,          setFactors]         = useState<Factor[]>([])
  const [benchmarks,       setBenchmarks]       = useState<Benchmark[]>([])
  const [targetProducts,   setTargetProducts]   = useState<TargetProduct[]>([])
  const [solverResult,     setSolverResult]     = useState<SolverResult | null>(null)
  const [running,          setRunning]          = useState(false)
  const [attributeWeights, setAttributeWeights] = useState<Record<string, number>>({})
  const [proceeding,       setProceeding]       = useState(false)
  const [loaded,           setLoaded]           = useState(false)
  const [error,            setError]            = useState('')
  const [showAllRuns,      setShowAllRuns]      = useState(false)
  const [exclusionReasons, setExclusionReasons] = useState<Record<string, string>>({})
  const [selectedRunIndex, setSelectedRunIndex] = useState<number | null>(null)
  const [aiInterpretation, setAiInterpretation] = useState('')
  const [aiInterpLoading,  setAiInterpLoading]  = useState(false)
  const [categoryAnchor,   setCategoryAnchor]   = useState('')

  // ── Load ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    async function load() {
      const { data: projectData } = await supabase
        .from('project')
        .select('category_anchor')
        .eq('id', projectId)
        .single()
      if (projectData?.category_anchor) setCategoryAnchor(projectData.category_anchor)

      const { data: factorData } = await supabase
        .from('attribute')
        .select('id, name')
        .eq('project_id', projectId)
        .order('display_order')
      if (factorData) setFactors(factorData)

      const { data: benchData } = await supabase
        .from('benchmark')
        .select('id, name, market_price, market_share_pct, included_in_regression, exclusion_reason')
        .eq('project_id', projectId)
        .order('name')
      if (benchData) {
        setBenchmarks(benchData)
        const reasons: Record<string, string> = {}
        for (const b of benchData) reasons[b.id] = b.exclusion_reason ?? ''
        setExclusionReasons(reasons)
      }

      const { data: targetData } = await supabase
        .from('target_product')
        .select('id, name, use_case_type')
        .eq('project_id', projectId)
        .order('display_order')
      if (targetData) setTargetProducts(targetData)

      // ── Rehydrate solver result if a previous run exists ──────────────────
      const { data: existingReg } = await supabase
        .from('regression_result')
        .select('id')
        .eq('project_id', projectId)
        .is('scenario_id', null)
        .maybeSingle()

      if (existingReg && factorData?.length && benchData?.length && targetData?.length) {
        await autoRunSolver(factorData, benchData, targetData)
      }

      setLoaded(true)
      router.refresh()
    }
    load()
  }, [projectId])

  // ── Auto-rehydrate solver result on return visit ──────────────────────────

  async function autoRunSolver(
    factorData: Factor[],
    benchData: Benchmark[],
    targetData: TargetProduct[]
  ) {
    try {
      const includedBenches = benchData.filter(b => b.included_in_regression)
      if (includedBenches.length < 3) return

      const { data: weightData } = await supabase
        .from('attribute_weight').select('attribute_id, weight').eq('project_id', projectId)
      if (!weightData?.length) return
      const attributeWeights: Record<string, number> = {}
      for (const w of weightData) attributeWeights[w.attribute_id] = w.weight
      setAttributeWeights(attributeWeights)

      const { data: utilityData } = await supabase
        .from('level_utility').select('level_id, utility').eq('project_id', projectId)
      if (!utilityData?.length) return
      const levelUtilities: Record<string, number> = {}
      for (const u of utilityData) levelUtilities[u.level_id] = u.utility

      const { data: levelData } = await supabase
        .from('level').select('id, attribute_id').in('attribute_id', factorData.map(f => f.id))
      if (!levelData?.length) return
      const attributeLevels: Record<string, string[]> = {}
      for (const l of levelData) {
        if (!attributeLevels[l.attribute_id]) attributeLevels[l.attribute_id] = []
        attributeLevels[l.attribute_id].push(l.id)
      }

      const { data: benchAssignData } = await supabase
        .from('benchmark_level_assignment').select('benchmark_id, attribute_id, level_id')
        .in('benchmark_id', includedBenches.map(b => b.id))
      if (!benchAssignData?.length) return
      const benchmarkAssignments: Record<string, string>[] = includedBenches.map(b => {
        const assigns: Record<string, string> = {}
        for (const a of benchAssignData) {
          if (a.benchmark_id === b.id) assigns[a.attribute_id] = a.level_id
        }
        return assigns
      })

      const { data: targetScoreData } = await supabase
        .from('target_score').select('target_product_id, level_assignments_json')
        .eq('project_id', projectId).is('scenario_id', null)
        .in('target_product_id', targetData.map(t => t.id))
      if (!targetScoreData?.length) return
      const targetAssignments: Record<string, string>[] = targetData.map(t => {
        const ts = targetScoreData.find(ts => ts.target_product_id === t.id)
        return (ts?.level_assignments_json as Record<string, string>) ?? {}
      })

      const totalShare = includedBenches.reduce((s, b) => s + (b.market_share_pct ?? 0), 0)
      const marketShareWeights = includedBenches.map(b =>
        totalShare > 0 ? (b.market_share_pct ?? 0) / totalShare : 1 / includedBenches.length
      )

      const res = await fetch('/api/solver?endpoint=solve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          attribute_ids:         factorData.map(f => f.id),
          attribute_weights:     attributeWeights,
          level_utilities:       levelUtilities,
          attribute_levels:      attributeLevels,
          benchmark_ids:         includedBenches.map(b => b.id),
          benchmark_assignments: benchmarkAssignments,
          market_prices:         includedBenches.map(b => b.market_price),
          market_share_weights:  marketShareWeights,
          target_ids:            targetData.map(t => t.id),
          target_assignments:    targetAssignments,
          run_sensitivity:       true,
        }),
      })
      if (!res.ok) return
      const data = await res.json()
      if (!data.success) return

      const targetResultsWithNames: TargetResult[] = (data.target_results ?? []).map((tr: any) => ({
        ...tr,
        name: targetData.find(t => t.id === tr.target_id)?.name ?? tr.target_id,
      }))
      setSolverResult({ ...data, target_results: targetResultsWithNames })

      // Write solver results back to DB so Phase 6 always has current data.
      // Phase 2 wipes point_estimate/normalized_score when saving assignments,
      // so autoRunSolver must restore them on every Phase 5 load.
      const benchmarkValueIndices: Record<string, number> = {}
      for (let i = 0; i < includedBenches.length; i++) {
        benchmarkValueIndices[includedBenches[i].id] = data.benchmark_value_indices?.[i] ?? 0
      }
      await supabase.from('regression_result').update({
        b_value:                 data.b,
        m_value:                 data.m,
        weighted_sse:            data.weighted_sse,
        r_squared_weighted:      data.r_squared_weighted,
        benchmark_value_indices: benchmarkValueIndices,
      }).eq('project_id', projectId).is('scenario_id', null)

      for (const tr of targetResultsWithNames) {
        await supabase.from('target_score').update({
          normalized_score:       tr.value_index,
          point_estimate:         tr.point_estimate,
          uncertainty_range_low:  tr.range_low,
          uncertainty_range_high: tr.range_high,
        })
          .eq('target_product_id', tr.target_id)
          .eq('project_id', projectId)
          .is('scenario_id', null)
      }
    } catch {
      // Silent failure — user can re-run manually
    }
  }

  // ── Toggle benchmark inclusion ────────────────────────────────────────────

  async function toggleBenchmark(benchmarkId: string, included: boolean) {
    await supabase.from('benchmark').update({
      included_in_regression: included,
      exclusion_reason: included ? null : (exclusionReasons[benchmarkId] || null),
    }).eq('id', benchmarkId)
    setBenchmarks(prev =>
      prev.map(b => b.id === benchmarkId ? { ...b, included_in_regression: included } : b)
    )
    setSolverResult(null)
    setAiInterpretation('')
  }

  // ── Run solver ────────────────────────────────────────────────────────────

  async function runSolver(benchmarkOverride?: Benchmark[]) {
    setRunning(true)
    setError('')

    try {
      const includedBenchmarks = benchmarkOverride ?? benchmarks.filter(b => b.included_in_regression)
      if (includedBenchmarks.length < 3) {
        throw new Error('At least 3 reference products must be included.')
      }

      // Attribute weights
      const { data: weightData } = await supabase
        .from('attribute_weight')
        .select('attribute_id, weight')
        .eq('project_id', projectId)
      if (!weightData?.length) throw new Error('No attribute weights found. Please complete Phase 4 first.')
      const attributeWeights: Record<string, number> = {}
      for (const w of weightData) attributeWeights[w.attribute_id] = w.weight
      setAttributeWeights(attributeWeights)

      // Level utilities
      const { data: utilityData } = await supabase
        .from('level_utility')
        .select('level_id, utility')
        .eq('project_id', projectId)
      if (!utilityData?.length) throw new Error('No level utilities found. Please complete Phase 4 first.')
      const levelUtilities: Record<string, number> = {}
      for (const u of utilityData) levelUtilities[u.level_id] = u.utility

      // Levels per attribute
      const { data: levelData } = await supabase
        .from('level')
        .select('id, attribute_id')
        .in('attribute_id', factors.map(f => f.id))
      if (!levelData?.length) throw new Error('No levels found.')
      const attributeLevels: Record<string, string[]> = {}
      for (const l of levelData) {
        if (!attributeLevels[l.attribute_id]) attributeLevels[l.attribute_id] = []
        attributeLevels[l.attribute_id].push(l.id)
      }

      // Benchmark level assignments
      const { data: benchAssignData } = await supabase
        .from('benchmark_level_assignment')
        .select('benchmark_id, attribute_id, level_id')
        .in('benchmark_id', includedBenchmarks.map(b => b.id))
      if (!benchAssignData?.length) throw new Error('No reference product assignments found. Please complete Phase 2 first.')

      const benchmarkAssignments: Record<string, string>[] = includedBenchmarks.map(b => {
        const assigns: Record<string, string> = {}
        for (const a of benchAssignData) {
          if (a.benchmark_id === b.id) assigns[a.attribute_id] = a.level_id
        }
        return assigns
      })

      // Target product assignments
      const { data: targetScoreData } = await supabase
        .from('target_score')
        .select('target_product_id, level_assignments_json')
        .eq('project_id', projectId)
        .is('scenario_id', null)
        .in('target_product_id', targetProducts.map(t => t.id))
      if (!targetScoreData?.length) throw new Error('No target product assignments found. Please complete Phase 2 first.')

      const targetAssignments: Record<string, string>[] = targetProducts.map(t => {
        const ts = targetScoreData.find(ts => ts.target_product_id === t.id)
        return (ts?.level_assignments_json as Record<string, string>) ?? {}
      })

      // Normalize market share weights
      const totalShare = includedBenchmarks.reduce((s, b) => s + (b.market_share_pct ?? 0), 0)
      const marketShareWeights = includedBenchmarks.map(b =>
        totalShare > 0 ? (b.market_share_pct ?? 0) / totalShare : 1 / includedBenchmarks.length
      )

      // Call solver
      const res = await fetch('/api/solver?endpoint=solve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          attribute_ids:         factors.map(f => f.id),
          attribute_weights:     attributeWeights,
          level_utilities:       levelUtilities,
          attribute_levels:      attributeLevels,
          benchmark_ids:         includedBenchmarks.map(b => b.id),
          benchmark_assignments: benchmarkAssignments,
          market_prices:         includedBenchmarks.map(b => b.market_price),
          market_share_weights:  marketShareWeights,
          target_ids:            targetProducts.map(t => t.id),
          target_assignments:    targetAssignments,
          run_sensitivity:       true,
        }),
      })

      if (!res.ok) throw new Error(`Solver request failed: ${res.status}`)
      const data = await res.json()
      if (!data.success) throw new Error(data.error ?? 'Solver returned no result.')

      // Attach target names
      const targetResultsWithNames: TargetResult[] = (data.target_results ?? []).map((tr: any) => ({
        ...tr,
        name: targetProducts.find(t => t.id === tr.target_id)?.name ?? tr.target_id,
      }))

      setSelectedRunIndex(null)
      setSolverResult({ ...data, target_results: targetResultsWithNames })
      setAiInterpretation('')

      // Fire AI interpretation in background — non-blocking
      setAiInterpLoading(true)
      const aiAvgPrice = includedBenchmarks.reduce((s, b) => s + b.market_price, 0) / includedBenchmarks.length
      const nrmse = aiAvgPrice > 0 ? (Math.sqrt(data.weighted_sse / includedBenchmarks.length) / aiAvgPrice * 100) : 0
      const aiTotalShare = includedBenchmarks.reduce((s, b) => s + (b.market_share_pct ?? 0), 0)
      const topBench = aiTotalShare > 0
        ? includedBenchmarks.reduce((best, b) => (b.market_share_pct ?? 0) > (best.market_share_pct ?? 0) ? b : best, includedBenchmarks[0])
        : null
      const vis: number[] = data.benchmark_value_indices ?? []
      const viSpread = vis.length >= 2 ? Math.max(...vis) - Math.min(...vis) : 0
      fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          task: 'explain_diagnostics',
          payload: {
            category_anchor: categoryAnchor,
            r_squared: data.r_squared_weighted,
            nrmse_pct: nrmse,
            n_benchmarks: includedBenchmarks.length,
            factors: factors.map(f => ({
              name: f.name,
              weight_pct: (attributeWeights[f.id] ?? 0) * 100,
            })),
            targets: targetResultsWithNames.map((tr: any) => ({
              name: tr.name,
              point_estimate: tr.point_estimate,
              range_low: tr.range_low,
              range_high: tr.range_high,
            })),
            outlier_names: (data.outlier_flags ?? [])
              .map((f: boolean, i: number) => f ? includedBenchmarks[i]?.name : null)
              .filter(Boolean),
            sensitivity_signals: (data.sensitivity ?? []).map((row: any) => {
              const f = factors.find(f => f.id === row.excluded_attribute_id)
              const fullR2 = data.r_squared_weighted
              const excR2 = row.r_squared_weighted
              const r2Delta = excR2 != null ? excR2 - fullR2 : null
              const priceImpact = row.delta_from_full_model != null ? Math.abs(row.delta_from_full_model) : 0
              const avgPriceForSens = includedBenchmarks.reduce((s: number, b: any) => s + b.market_price, 0) / includedBenchmarks.length
              const priceImpactPct = avgPriceForSens > 0 ? priceImpact / avgPriceForSens * 100 : 0
              const r2Improves = r2Delta != null && r2Delta > 0.02
              const r2DropsLarge = r2Delta != null && r2Delta < -0.05
              const priceImpactLarge = priceImpactPct > 5
              const priceImpactSmall = priceImpactPct < 2
              const r2Stable = r2Delta != null && Math.abs(r2Delta) < 0.02
              let signal: 'amber' | 'blue' | 'gray' | null = null
              if (r2Improves) signal = 'amber'
              else if (r2DropsLarge || priceImpactLarge) signal = 'blue'
              else if (priceImpactSmall && r2Stable) signal = 'gray'
              return signal ? { factor: f?.name ?? row.excluded_attribute_id, signal } : null
            }).filter(Boolean),
            value_scale_spread: viSpread,
            top_benchmark_share_pct: topBench && aiTotalShare > 0
              ? (topBench.market_share_pct ?? 0) / aiTotalShare * 100
              : null,
            top_benchmark_name: topBench?.name ?? null,
            equal_share_pct: 100 / includedBenchmarks.length,
          },
        }),
      })
        .then(r => r.json())
        .then(d => { if (d.interpretation) setAiInterpretation(d.interpretation) })
        .catch(() => {/* silent — interpretation is non-critical */})
        .finally(() => setAiInterpLoading(false))

      // Save to regression_result — delete-then-insert to avoid null scenario_id upsert issue
      await supabase
        .from('regression_result')
        .delete()
        .eq('project_id', projectId)
        .is('scenario_id', null)

      // Build benchmark VI map — {benchmark_id: value_index} — indexed to includedBenchmarks order
      const benchmarkValueIndices: Record<string, number> = {}
      for (let i = 0; i < includedBenchmarks.length; i++) {
        benchmarkValueIndices[includedBenchmarks[i].id] = data.benchmark_value_indices?.[i] ?? 0
      }

      const { error: regErr } = await supabase.from('regression_result').insert({
        project_id:               projectId,
        scenario_id:              null,
        b_value:                  data.b,
        m_value:                  data.m,
        weighted_sse:             data.weighted_sse,
        r_squared_weighted:       data.r_squared_weighted,
        near_equivalent_flag:     data.near_equivalent_flag,
        benchmark_value_indices:  benchmarkValueIndices,
      })
      if (regErr) console.error('REGRESSION INSERT ERROR:', JSON.stringify(regErr))

      // Save target_score — delete-then-insert to guarantee correct data even if Phase 2 was re-saved
      for (let i = 0; i < targetResultsWithNames.length; i++) {
        const tr = targetResultsWithNames[i]
        const levelAssignmentsJson = targetAssignments[targetProducts.findIndex(t => t.id === tr.target_id)] ?? {}

        const { error: tsDelErr } = await supabase.from('target_score')
          .delete()
          .eq('target_product_id', tr.target_id)
          .eq('project_id', projectId)
          .is('scenario_id', null)
        if (tsDelErr) console.error('TARGET_SCORE DELETE ERROR:', JSON.stringify(tsDelErr))

        const { error: tsInsErr } = await supabase.from('target_score').insert({
          target_product_id:       tr.target_id,
          project_id:              projectId,
          scenario_id:             null,
          level_assignments_json:  levelAssignmentsJson,
          normalized_score:        tr.value_index,
          point_estimate:          tr.point_estimate,
          uncertainty_range_low:   tr.range_low,
          uncertainty_range_high:  tr.range_high,
        })
        if (tsInsErr) console.error('TARGET_SCORE INSERT ERROR:', JSON.stringify(tsInsErr))
      }

    } catch (err: any) {
      setError(err.message ?? 'Solver failed')
    } finally {
      setRunning(false)
    }
  }

  // ── Select solver run override ───────────────────────────────────────────

  function recomputeResiduals(b: number, m: number, vis: number[], prices: number[]) {
    const residuals = vis.map((vi, i) => prices[i] - (b + vi * (m - b)))
    const sorted = [...residuals].sort((a, c) => a - c)
    const q1 = sorted[Math.floor(sorted.length * 0.25)]
    const q3 = sorted[Math.floor(sorted.length * 0.75)]
    const iqr = q3 - q1
    return {
      residuals,
      outlierFlags: residuals.map(r => Math.abs(r) > 1.5 * iqr),
    }
  }

  async function selectRun(run: any, index: number) {
    if (!solverResult) return
    const benchPrices = includedBenchmarks.map(b => b.market_price)
    const isAlreadySelected = selectedRunIndex === index
    if (isAlreadySelected) {
      // Reset to auto-winner
      setSelectedRunIndex(null)
      // Find the original auto-winner (lowest SSE among converged runs)
      const autoWinner = solverResult.all_runs.reduce((best: any, r: any) =>
        r.converged && !r.degenerate && (best === null || r.weighted_sse < best.weighted_sse) ? r : best
      , null)
      if (!autoWinner) return
      const { residuals, outlierFlags } = recomputeResiduals(
        autoWinner.b, autoWinner.m, solverResult.benchmark_value_indices, benchPrices
      )
      setSolverResult(prev => prev ? {
        ...prev,
        b: autoWinner.b,
        m: autoWinner.m,
        weighted_sse: autoWinner.weighted_sse,
        r_squared_weighted: autoWinner.r_squared,
        rse: autoWinner.rse ?? prev.rse,
        constraint_regime: autoWinner.constraint_regime,
        init_strategy: autoWinner.init_strategy,
        benchmark_residuals: residuals,
        outlier_flags: outlierFlags,
        target_results: prev.target_results.map((tr, i) => ({
          ...tr,
          point_estimate: autoWinner.target_point_estimates?.[i] ?? tr.point_estimate,
        })),
      } : null)
      await supabase.from('regression_result').update({
        b_value: autoWinner.b,
        m_value: autoWinner.m,
        weighted_sse: autoWinner.weighted_sse,
        r_squared_weighted: autoWinner.r_squared,
      }).eq('project_id', projectId).is('scenario_id', null)
      // Persist new point estimates to target_score
      for (let i = 0; i < solverResult.target_results.length; i++) {
        const newPE = autoWinner.target_point_estimates?.[i]
        if (newPE != null) {
          await supabase.from('target_score').update({ point_estimate: newPE })
            .eq('target_product_id', solverResult.target_results[i].target_id)
            .eq('project_id', projectId)
            .is('scenario_id', null)
        }
      }
    } else {
      setSelectedRunIndex(index)
      const { residuals, outlierFlags } = recomputeResiduals(
        run.b, run.m, solverResult.benchmark_value_indices, benchPrices
      )
      setSolverResult(prev => prev ? {
        ...prev,
        b: run.b,
        m: run.m,
        weighted_sse: run.weighted_sse,
        r_squared_weighted: run.r_squared,
        rse: run.rse ?? prev?.rse,
        constraint_regime: run.constraint_regime,
        init_strategy: run.init_strategy,
        benchmark_residuals: residuals,
        outlier_flags: outlierFlags,
        target_results: prev.target_results.map((tr, i) => ({
          ...tr,
          point_estimate: run.target_point_estimates?.[i] ?? tr.point_estimate,
        })),
      } : null)
      await supabase.from('regression_result').update({
        b_value: run.b,
        m_value: run.m,
        weighted_sse: run.weighted_sse,
        r_squared_weighted: run.r_squared,
      }).eq('project_id', projectId).is('scenario_id', null)
      // Persist new point estimates to target_score
      for (let i = 0; i < solverResult.target_results.length; i++) {
        const newPE = run.target_point_estimates?.[i]
        if (newPE != null) {
          await supabase.from('target_score').update({ point_estimate: newPE })
            .eq('target_product_id', solverResult.target_results[i].target_id)
            .eq('project_id', projectId)
            .is('scenario_id', null)
        }
      }
    }
  }

  // ── Exclude outlier and immediately re-run ────────────────────────────────

  async function excludeAndRerun(benchmarkId: string) {
    await supabase.from('benchmark').update({
      included_in_regression: false,
      exclusion_reason: 'Statistical outlier',
    }).eq('id', benchmarkId)

    const newBenchmarks = benchmarks.map(b =>
      b.id === benchmarkId
        ? { ...b, included_in_regression: false, exclusion_reason: 'Statistical outlier' }
        : b
    )
    setBenchmarks(newBenchmarks)
    setSolverResult(null)
    setAiInterpretation('')

    await runSolver(newBenchmarks.filter(b => b.included_in_regression))
  }

  // ── Proceed ───────────────────────────────────────────────────────────────

  async function handleProceed() {
    setProceeding(true)
    try {
      await supabase.from('project').update({ status: 'MODEL_RUN' }).eq('id', projectId)
      router.refresh()
      router.push(`/dashboard/projects/${projectId}/phase-6`)
    } catch (err: any) {
      setError(err.message ?? 'Failed to proceed')
      setProceeding(false)
    }
  }


  // ── Guards ────────────────────────────────────────────────────────────────

  if (!loaded) return <div className="text-gray-400 text-sm">Loading...</div>

  const includedBenchmarks = benchmarks.filter(b => b.included_in_regression)

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="w-full max-w-5xl mx-auto">

      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Value Pricing Model</h1>
        <p className="text-gray-500 mt-1 text-sm">
          Score reference products against the market and generate price recommendations.
        </p>
      </div>

      <div className="space-y-6">

        {/* Reference products */}
        <section className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
          <h2 className="text-base font-semibold text-gray-900 mb-1">Reference Products</h2>
          <p className="text-xs text-gray-500 mb-3">
            Exclude any reference products that should not contribute to the model fit.
          </p>
          <div className="space-y-1">
            {benchmarks.map(b => (
              <div key={b.id} className="border border-gray-100 rounded-md">
                <div className="flex items-center justify-between px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${b.included_in_regression ? 'bg-green-500' : 'bg-gray-300'}`} />
                    <div>
                      <span className="text-sm font-medium text-gray-800">{b.name}</span>
                      <span className="ml-2 text-xs text-gray-400">
                        {formatCurrency(b.market_price)} · {b.market_share_pct}% share
                      </span>
                      {!b.included_in_regression && b.exclusion_reason && (
                        <span className="ml-2 text-xs text-gray-400">— {b.exclusion_reason}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-medium ${b.included_in_regression ? 'text-green-700' : 'text-gray-400'}`}>
                      {b.included_in_regression ? 'Included' : 'Excluded'}
                    </span>
                    <button
                      onClick={() => toggleBenchmark(b.id, !b.included_in_regression)}
                      style={{
                        width: '44px', height: '24px', borderRadius: '12px',
                        backgroundColor: b.included_in_regression ? '#16a34a' : '#d1d5db',
                        border: 'none', cursor: 'pointer', position: 'relative',
                        transition: 'background-color 0.2s',
                        flexShrink: 0,
                      }}
                      title={b.included_in_regression ? 'Click to exclude' : 'Click to include'}
                    >
                      <span style={{
                        position: 'absolute',
                        top: '2px',
                        left: b.included_in_regression ? '22px' : '2px',
                        width: '20px', height: '20px', borderRadius: '50%',
                        backgroundColor: 'white',
                        transition: 'left 0.2s',
                        boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                      }} />
                    </button>
                  </div>
                </div>
                {!b.included_in_regression && (
                  <div className="px-3 pb-2">
                    <input
                      type="text"
                      value={exclusionReasons[b.id] ?? ''}
                      onChange={e => setExclusionReasons(prev => ({ ...prev, [b.id]: e.target.value }))}
                      onBlur={async () => {
                        await supabase.from('benchmark').update({
                          exclusion_reason: exclusionReasons[b.id] || null
                        }).eq('id', b.id)
                      }}
                      placeholder="Reason for exclusion (optional)"
                      className="w-full px-3 py-1.5 border border-gray-200 rounded-md text-xs text-gray-600 focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
          <p className="text-xs text-gray-400 mt-3">
            {includedBenchmarks.length} of {benchmarks.length} reference products included
          </p>
        </section>

        {/* Run button */}
        <div className="flex items-center gap-4">
          <button
            onClick={() => runSolver()}
            disabled={running || includedBenchmarks.length < 3}
            className="px-5 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 disabled:opacity-50"
          >
            {running ? 'Running model…' : solverResult ? '↺ Re-run Model' : 'Run Model'}
          </button>
          {running && <span className="text-xs text-gray-400">Running 8 solver instances…</span>}
        </div>

        {/* Error */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-md px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* Results */}
        {solverResult && (
          <>
            {/* Model fit */}
            <section className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <h2 className="text-base font-semibold text-gray-900 mb-4">Model Fit</h2>
              <div className="grid grid-cols-4 gap-4 mb-4">
                <div className="bg-gray-50 rounded-md p-3">
                  <div className="text-xs text-gray-500 mb-1 flex items-center gap-1">Weighted R²
                    <HelpTip width="w-80" content="R² measures how well the model explains price differences across reference products. Above 0.85 is strong; 0.70–0.85 is acceptable; below 0.70 suggests the value framework may not fully capture what drives market pricing. NRMSE shows average prediction error as a % of mean price — below 10% is good." />
                  </div>
                  <div className={`inline-flex items-center gap-2 px-2 py-1 rounded border text-sm font-medium ${r2Color(solverResult.r_squared_weighted)}`}>
                    {(solverResult.r_squared_weighted * 100).toFixed(1)}% — {r2Label(solverResult.r_squared_weighted)}
                  </div>
                </div>
                <div className="bg-gray-50 rounded-md p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <div className="text-xs text-gray-500">Active Solution</div>
                    {selectedRunIndex !== null && (
                      <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">manually selected</span>
                    )}
                  </div>
                  <div className="text-sm font-medium text-gray-800">{solverResult.constraint_regime.replace(/_/g, ' ')}</div>
                  <div className="text-xs text-gray-400">{solverResult.init_strategy === 'inside_out' ? 'Centered start' : solverResult.init_strategy === 'outside_in' ? 'Wide start' : solverResult.init_strategy.replace(/_/g, ' ')}</div>
                </div>
                <div className="bg-gray-50 rounded-md p-3">
                  <div className="text-xs text-gray-500 mb-1">Avg. Fit Error</div>
                  <div className="text-sm font-medium text-gray-800">{formatRmse(solverResult.weighted_sse, solverResult.benchmark_value_indices.length)}</div>
                  <div className="text-xs text-gray-400">{formatNrmse(solverResult.weighted_sse, includedBenchmarks.map(b => b.market_price))} of avg. price</div>
                </div>
                <div className="bg-gray-50 rounded-md p-3">
                  <div className="text-xs text-gray-500 mb-1 flex items-center gap-1">RSE
                    <HelpTip width="w-72" content="Relative Squared Error — weighted sum of squared residuals divided by weighted sum of squared prices. Unlike NRMSE which scales by average price, RSE directly measures error relative to the price magnitudes being modeled. Below 5% is strong; above 15% suggests the model is missing significant drivers of price variation." />
                  </div>
                  <div className="text-sm font-medium text-gray-800">{formatRse(solverResult.rse)}</div>
                </div>
              </div>

              {solverResult.near_equivalent_flag && (
                <div className="mb-2 rounded-md px-4 py-3 text-sm bg-amber-50 border border-amber-200 text-amber-700">
                  ⚠ Multiple solver solutions produce similar fit with different parameter values. Review all solutions before proceeding.
                </div>
              )}
              {solverResult.suspicious_m_low && (
                <div className="mb-2 rounded-md px-4 py-3 text-sm bg-amber-50 border border-amber-200 text-amber-700">
                  ⚠ Model implies the best possible product is cheaper than the cheapest reference product.
                </div>
              )}
              {solverResult.suspicious_b_high && (
                <div className="mb-2 rounded-md px-4 py-3 text-sm bg-amber-50 border border-amber-200 text-amber-700">
                  ⚠ Model implies the worst possible product is more expensive than the most expensive reference product.
                </div>
              )}

              <button
                onClick={() => setShowAllRuns(!showAllRuns)}
                className="text-xs text-blue-600 hover:text-blue-700 mt-2"
              >
                {showAllRuns ? '▲ Hide all solver runs' : '▼ Show all 8 solver runs'}
              </button>

              {showAllRuns && (
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full text-xs border-separate border-spacing-0">
                    <thead>
                      <tr>
                        <th className="text-left text-gray-500 pb-2 pr-4 border-b border-gray-100">Regime</th>
                        <th className="text-left text-gray-500 pb-2 pr-4 border-b border-gray-100">Init</th>
                        <th className="text-right text-gray-500 pb-2 pr-4 border-b border-gray-100">B (base)</th>
                        <th className="text-right text-gray-500 pb-2 pr-4 border-b border-gray-100">M (max)</th>
                        {solverResult.target_results.map(tr => (
                          <th key={tr.target_id} className="text-right text-gray-500 pb-2 pr-4 border-b border-gray-100">{tr.name} est.</th>
                        ))}
                        <th className="text-right text-gray-500 pb-2 pr-4 border-b border-gray-100">R²</th>
                        <th className="text-right text-gray-500 pb-2 pr-4 border-b border-gray-100">NRMSE</th>
                        <th className="text-right text-gray-500 pb-2 pr-4 border-b border-gray-100">RSE</th>
                        <th className="text-right text-gray-500 pb-2 pr-4 border-b border-gray-100">Converged</th>
                        <th className="text-left text-gray-500 pb-2 border-b border-gray-100">Notes</th>
                        <th className="pb-2 border-b border-gray-100"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {solverResult.all_runs.map((run, i) => {
                        const initLabel = run.init_strategy === 'inside_out' ? 'Centered' : run.init_strategy === 'outside_in' ? 'Wide' : run.init_strategy?.replace(/_/g, ' ')
                        const autoWinnerMatch = run.constraint_regime === solverResult.constraint_regime && run.init_strategy === solverResult.init_strategy
                        const isSelected = selectedRunIndex === i || (selectedRunIndex === null && autoWinnerMatch)
                        const isSelectable = run.converged && !run.degenerate
                        return (
                          <tr key={i} className={`${i % 2 === 0 ? 'bg-white' : 'bg-gray-50'} ${isSelected ? 'font-semibold' : ''}`}>
                            <td className="py-1.5 pr-4 text-gray-700">
                              {run.constraint_regime?.replace(/_/g, ' ')}
                              {isSelected && <span className="ml-1 text-blue-600">★</span>}
                            </td>
                            <td className="py-1.5 pr-4 text-gray-700">{initLabel}</td>
                            <td className="py-1.5 pr-4 text-right text-gray-700">{run.b != null ? formatCurrency(run.b) : '—'}</td>
                            <td className="py-1.5 pr-4 text-right text-gray-700">{run.m != null ? formatCurrency(run.m) : '—'}</td>
                            {run.target_point_estimates
                              ? run.target_point_estimates.map((est: number, ti: number) => (
                                  <td key={ti} className={`py-1.5 pr-4 text-right font-medium ${isSelected ? 'text-amber-700' : 'text-gray-600'}`}>
                                    {formatCurrency(est)}
                                  </td>
                                ))
                              : solverResult.target_results.map((_: any, ti: number) => (
                                  <td key={ti} className="py-1.5 pr-4 text-right text-gray-400">—</td>
                                ))
                            }
                            <td className="py-1.5 pr-4 text-right text-gray-700">{run.r_squared != null ? `${(run.r_squared * 100).toFixed(1)}%` : '—'}</td>
                            <td className="py-1.5 pr-4 text-right text-gray-700">{run.weighted_sse != null ? formatNrmse(run.weighted_sse, includedBenchmarks.map(b => b.market_price)) : '—'}</td>
                            <td className="py-1.5 pr-4 text-right text-gray-700">{run.rse != null ? formatRse(run.rse) : '—'}</td>
                            <td className="py-1.5 pr-4 text-right text-gray-700">{run.converged ? '✓' : '✗'}</td>
                            <td className="py-1.5 text-gray-500">{!run.converged ? 'Did not converge' : run.degenerate ? 'Degenerate' : ''}</td>
                            <td className="py-1.5 pl-2">
                              {isSelectable && (
                                <button
                                  onClick={() => selectRun(run, i)}
                                  className={`px-2 py-0.5 rounded text-xs font-medium transition-colors ${
                                    isSelected
                                      ? 'bg-blue-100 text-blue-700 hover:bg-blue-200'
                                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                  }`}
                                >
                                  {isSelected ? 'Active' : 'Use'}
                                </button>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* Post-solve diagnostics */}
            {(() => {
              const diags: { level: 'warn' | 'info'; text: string }[] = []

              // 1. Value scale coverage
              const vis = solverResult.benchmark_value_indices
              if (vis.length >= 2) {
                const spread = Math.max(...vis) - Math.min(...vis)
                if (spread < 0.25) {
                  diags.push({
                    level: 'warn',
                    text: `Value scale coverage is narrow — reference products span only ${(spread * 100).toFixed(0)} of 100 points. The model has limited range to differentiate value levels. Consider adding reference products at the high or low end of the market.`,
                  })
                }
              }

              // 2. Market share concentration (adaptive: flag if any benchmark > 2.5× equal share)
              const totalShare = includedBenchmarks.reduce((s, b) => s + (b.market_share_pct ?? 0), 0)
              if (totalShare > 0) {
                const topBench = includedBenchmarks.reduce((best, b) =>
                  (b.market_share_pct ?? 0) > (best.market_share_pct ?? 0) ? b : best
                , includedBenchmarks[0])
                const topPct = (topBench.market_share_pct ?? 0) / totalShare * 100
                const equalSharePct = 100 / includedBenchmarks.length
                if (topPct > 2.5 * equalSharePct) {
                  diags.push({
                    level: 'warn',
                    text: `${topBench.name} accounts for ${topPct.toFixed(0)}% of market share weight — more than 2.5× the ${equalSharePct.toFixed(0)}% equal share. This product dominates the model fit; results may be less reliable if its price deviates from the broader market.`,
                  })
                }
              }

              // 4. Factor weight concentration (adaptive: flag if any factor > 2.5× equal weight)
              const k = factors.length
              if (k > 0 && Object.keys(attributeWeights).length > 0) {
                const topFactorId = Object.keys(attributeWeights).reduce((best, id) =>
                  (attributeWeights[id] ?? 0) > (attributeWeights[best] ?? 0) ? id : best
                , Object.keys(attributeWeights)[0])
                const topWeight = (attributeWeights[topFactorId] ?? 0) * 100
                const equalWeightPct = 100 / k
                if (topWeight > 2.5 * equalWeightPct) {
                  const topFactor = factors.find(f => f.id === topFactorId)
                  diags.push({
                    level: 'info',
                    text: `${topFactor?.name ?? 'A factor'} carries ${topWeight.toFixed(0)}% of the importance weight — more than 2.5× the ${equalWeightPct.toFixed(0)}% equal share. The price recommendation is heavily influenced by a single factor. This may be intentional but is worth confirming with the team.`,
                  })
                }
              }

              // 3. R² reliability at small counts
              const n = includedBenchmarks.length
              if (n < 5) {
                diags.push({
                  level: 'info',
                  text: `Model uses ${n} reference product${n === 1 ? '' : 's'}. With few data points, R² can appear high even with a weak underlying fit. Interpret results with caution and consider adding more reference products.`,
                })
              }

              if (diags.length === 0) return null

              return (
                <section className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                  <div className="flex items-center gap-1.5 mb-3">
                    <h2 className="text-base font-semibold text-gray-900">Model Diagnostics</h2>
                    <HelpTip content="Automated checks on model quality. Warnings don't prevent you from proceeding — they flag conditions that could make the recommendation less reliable. Common issues: reference products bunched together on the value scale (low coverage), one product dominating market share weighting, or an R² too low to trust the price extrapolation. Address warnings before using the output for a real pricing decision." width="w-96" />
                  </div>
                  <div className="space-y-2">
                    {diags.map((d, i) => (
                      <div key={i} className={`rounded-md px-4 py-3 text-sm ${
                        d.level === 'warn'
                          ? 'bg-amber-50 border border-amber-200 text-amber-700'
                          : 'bg-blue-50 border border-blue-200 text-blue-700'
                      }`}>
                        {d.level === 'warn' ? '⚠ ' : 'ⓘ '}{d.text}
                      </div>
                    ))}
                  </div>
                </section>
              )
            })()}

            {/* AI Model Interpretation */}
            {(aiInterpLoading || aiInterpretation) && (
              <section className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                <div className="flex items-center gap-2 mb-3">
                  <h2 className="text-base font-semibold text-gray-900">Model Interpretation</h2>
                  <span className="text-xs text-gray-400">AI-generated</span>
                </div>
                {aiInterpLoading ? (
                  <div className="flex items-center gap-2 text-sm text-gray-400">
                    <span className="inline-block w-3 h-3 border-2 border-gray-300 border-t-gray-500 rounded-full animate-spin" />
                    Interpreting results…
                  </div>
                ) : (
                  <p className="text-sm text-gray-700 leading-relaxed">{aiInterpretation}</p>
                )}
              </section>
            )}

            {/* Benchmark Outlier Review */}
            {(() => {
              const outlierIndices = solverResult.outlier_flags
                .map((f, i) => (f ? i : -1))
                .filter(i => i >= 0)
              const poorFit = solverResult.r_squared_weighted < 0.6
              if (outlierIndices.length === 0 && !poorFit) return null

              const priceRange = includedBenchmarks.length >= 2
                ? Math.max(...includedBenchmarks.map(b => b.market_price)) - Math.min(...includedBenchmarks.map(b => b.market_price))
                : 0

              return (
                <section className="bg-white rounded-lg shadow-sm border border-amber-200 p-6">
                  <div className="flex items-center gap-2 mb-2">
                    <h2 className="text-base font-semibold text-gray-900 flex items-center gap-1.5">Benchmark Outlier Review
                    <HelpTip width="w-80" content="Reference products whose market price is much higher or lower than the model predicts given their value score. Consider excluding a product if its price reflects factors outside your framework (e.g. a clearance promotion, a supply contract, or a channel-specific discount) rather than a genuine model fit problem." />
                  </h2>
                    {outlierIndices.length > 0 && (
                      <span className="text-xs font-medium bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">
                        {outlierIndices.length} flagged
                      </span>
                    )}
                  </div>

                  {outlierIndices.length > 0 ? (
                    <>
                      <p className="text-xs text-gray-500 mb-4">
                        These reference products have unusually large fit errors (more than 1.5× the interquartile range).
                        They may be pulling the model toward their price points and distorting recommendations.
                        Excluding them and re-running can improve reliability — you can always re-include them from the Reference Products section above.
                      </p>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm border-separate border-spacing-0">
                          <thead>
                            <tr>
                              <th className="text-left text-xs font-medium text-gray-500 pb-2 pr-4 border-b border-gray-100">Product</th>
                              <th className="text-right text-xs font-medium text-gray-500 pb-2 pr-4 border-b border-gray-100">Market Price</th>
                              <th className="text-right text-xs font-medium text-gray-500 pb-2 pr-4 border-b border-gray-100">Model Price</th>
                              <th className="text-right text-xs font-medium text-gray-500 pb-2 pr-4 border-b border-gray-100">Fit Error</th>
                              {priceRange > 0 && (
                                <th className="text-right text-xs font-medium text-gray-500 pb-2 pr-4 border-b border-gray-100">% of Range</th>
                              )}
                              <th className="pb-2 border-b border-gray-100" />
                            </tr>
                          </thead>
                          <tbody>
                            {outlierIndices.map((i, row) => {
                              const b = includedBenchmarks[i]
                              const residual = solverResult.benchmark_residuals[i]
                              const modelPrice = b.market_price - residual
                              const pctOfRange = priceRange > 0 ? Math.abs(residual) / priceRange * 100 : null
                              return (
                                <tr key={b.id} className={row % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                                  <td className="py-2 pr-4 font-medium text-gray-800">{b.name}</td>
                                  <td className="py-2 pr-4 text-right text-gray-700">{formatCurrency(b.market_price)}</td>
                                  <td className="py-2 pr-4 text-right text-gray-700">{formatCurrency(modelPrice)}</td>
                                  <td className={`py-2 pr-4 text-right font-medium ${residual > 0 ? 'text-blue-600' : 'text-red-500'}`}>
                                    {residual > 0 ? '+' : ''}{formatCurrency(residual)}
                                  </td>
                                  {priceRange > 0 && (
                                    <td className="py-2 pr-4 text-right text-gray-500 text-xs">
                                      {pctOfRange != null ? `${pctOfRange.toFixed(0)}%` : '—'}
                                    </td>
                                  )}
                                  <td className="py-2">
                                    <button
                                      onClick={() => excludeAndRerun(b.id)}
                                      disabled={running}
                                      className="px-3 py-1 text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200 rounded hover:bg-amber-100 disabled:opacity-50"
                                    >
                                      {running ? 'Running…' : 'Exclude & Re-run'}
                                    </button>
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    </>
                  ) : (
                    <p className="text-sm text-gray-600">
                      No single reference product was flagged by the outlier rule, but overall model fit is
                      poor (R² = {(solverResult.r_squared_weighted * 100).toFixed(1)}%). Review the fit errors
                      in the Reference Product Positioning table below — look for products with the largest
                      absolute errors and consider excluding them to see if fit improves.
                    </p>
                  )}
                </section>
              )
            })()}

            {/* Reference product positioning */}
            <section className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <div className="flex items-center gap-1.5 mb-4">
                <h2 className="text-base font-semibold text-gray-900">Reference Product Positioning</h2>
                <HelpTip content="Shows how each reference product's market price compares to what the model predicts given its value score. The residual is the gap — positive means the market charges more than the model expects (pricing power or brand premium), negative means it charges less (underpriced or compensating for something the framework doesn't capture). Large residuals on multiple products are a signal to review the factor framework." width="w-96" />
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-separate border-spacing-0">
                  <thead>
                    <tr>
                      <th className="text-left text-xs font-medium text-gray-500 pb-3 pr-4 border-b border-gray-100">Product</th>
                      <th className="text-right text-xs font-medium text-gray-500 pb-3 pr-4 border-b border-gray-100">Value Index</th>
                      <th className="text-right text-xs font-medium text-gray-500 pb-3 pr-4 border-b border-gray-100">Market Price</th>
                      <th className="text-right text-xs font-medium text-gray-500 pb-3 pr-4 border-b border-gray-100">Model Price</th>
                      <th className="text-right text-xs font-medium text-gray-500 pb-3 border-b border-gray-100">Residual</th>
                    </tr>
                  </thead>
                  <tbody>
                    {includedBenchmarks.map((b, i) => {
                      const vi = solverResult.benchmark_value_indices[i]
                      const residual = solverResult.benchmark_residuals[i]
                      const modelPrice = b.market_price - residual
                      const isOutlier = solverResult.outlier_flags[i]
                      return (
                        <tr key={b.id} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                          <td className="py-2 pr-4 font-medium text-gray-800">
                            {b.name}
                            {isOutlier && <span className="ml-2 text-xs text-amber-600">⚠ outlier</span>}
                          </td>
                          <td className="py-2 pr-4 text-right text-gray-700">{(vi * 100).toFixed(1)}</td>
                          <td className="py-2 pr-4 text-right text-gray-700">{formatCurrency(b.market_price)}</td>
                          <td className="py-2 pr-4 text-right text-gray-700">{formatCurrency(modelPrice)}</td>
                          <td className={`py-2 text-right font-medium ${residual > 0 ? 'text-blue-600' : 'text-red-500'}`}>
                            {residual > 0 ? '+' : ''}{formatCurrency(residual)}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-gray-400 mt-2">
                Residual = Market Price − Model Price. Positive = priced above model value. Value Index: 0–100 scale.
              </p>
            </section>

            {/* Price recommendations */}
            <section className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <div className="flex items-center gap-1.5 mb-4">
                <h2 className="text-base font-semibold text-gray-900">Price Recommendations</h2>
                <HelpTip content="Three price outputs for each target product. Point Estimate is the model's best single number — where the target sits on the value-to-price line fitted to reference products. Statistical Range adds ±1 standard deviation of benchmark residuals — it captures how much scatter there is around the model line. Market Envelope uses the actual min and max residuals — it shows the full range of prices observed in the market for a given value level. Use the point estimate as your anchor; use the ranges to understand pricing latitude." width="w-96" />
              </div>
              <div className="space-y-4">
                {solverResult.target_results.map(tr => (
                  <div key={tr.target_id} className="border border-gray-100 rounded-lg p-4 bg-gray-50">
                    <div className="mb-3">
                      <h3 className="text-sm font-semibold text-gray-900">{tr.name}</h3>
                      <p className="text-xs text-gray-400 mt-0.5">
                        Value Index: {(tr.value_index * 100).toFixed(1)}
                      </p>
                    </div>
                    <div className="flex items-end gap-8">
                      <div>
                        <div className="text-xs text-gray-500 mb-1">Point Estimate</div>
                        <div className="text-2xl font-bold text-gray-900">{formatCurrency(tr.point_estimate)}</div>
                      </div>
                      <div>
                        <div className="text-xs text-gray-500 mb-1">Statistical Range <span className="text-gray-400">(±1 std dev)</span></div>
                        <div className="text-base font-medium text-gray-700">
                          {formatCurrency(tr.range_low)} — {formatCurrency(tr.range_high)}
                        </div>
                      </div>
                      {solverResult.benchmark_residuals?.length > 0 && (() => {
                        const maxRes = Math.max(...solverResult.benchmark_residuals)
                        const minRes = Math.min(...solverResult.benchmark_residuals)
                        const envCeiling = tr.point_estimate + maxRes
                        const envFloor   = tr.point_estimate + minRes
                        return (
                          <div>
                            <div className="text-xs text-gray-500 mb-1">Market Envelope <span className="text-gray-400">(observed min/max)</span></div>
                            <div className="text-base font-medium text-gray-700">
                              {formatCurrency(envFloor)} — {formatCurrency(envCeiling)}
                            </div>
                          </div>
                        )
                      })()}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* ── Sensitivity Analysis moved to Phase 7 ── */}

            <div className="flex justify-between pb-8">
              <button
                onClick={() => router.push(`/dashboard/projects/${projectId}/phase-4`)}
                className="px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 hover:bg-gray-50"
              >
                ← Back to Coherence Review
              </button>
              <button
                onClick={handleProceed}
                disabled={proceeding}
                className="px-6 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 disabled:opacity-50"
              >
                {proceeding ? 'Saving…' : 'Accept & Continue →'}
              </button>
            </div>
          </>
        )}

        {!solverResult && (
          <div className="flex justify-between pb-8">
            <button
              onClick={() => router.push(`/dashboard/projects/${projectId}/phase-4`)}
              className="px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 hover:bg-gray-50"
            >
              ← Back to Coherence Review
            </button>
          </div>
        )}

      </div>
    </div>
  )
}
