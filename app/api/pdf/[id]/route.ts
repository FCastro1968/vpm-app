import { NextRequest, NextResponse } from 'next/server'
import { renderToBuffer } from '@react-pdf/renderer'
import React from 'react'
import { createServiceClient } from '@/lib/supabase/service'
import { VPMReport, PDFReportData, PDFFactor, PDFBenchmark, PDFTarget, PDFSensitivityRow } from '@/lib/pdf/VPMReport'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await params
  const supabase  = createServiceClient()

  try {
    // ── Project ──────────────────────────────────────────────────────────────
    const { data: project, error: projErr } = await supabase
      .from('project')
      .select('name, benchmark_price_basis, benchmark_price_basis_custom_description, category_anchor, currency, geographic_scope, target_segment')
      .eq('id', projectId)
      .single()

    if (projErr || !project) {
      console.error('PDF project lookup failed:', projErr, 'id:', projectId)
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    // ── Model params ─────────────────────────────────────────────────────────
    const { data: regRows } = await supabase
      .from('regression_result')
      .select('b_value, m_value, r_squared_weighted, benchmark_value_indices')
      .eq('project_id', projectId)
      .is('scenario_id', null)
      .order('created_at', { ascending: false })
      .limit(1)
    const reg = regRows?.[0] ?? null

    if (!reg) return NextResponse.json({ error: 'No model results found. Please complete Phase 5 first.' }, { status: 400 })

    const b = reg.b_value as number
    const m = reg.m_value as number
    const storedBenchmarkVIs = (reg.benchmark_value_indices ?? {}) as Record<string, number>

    // ── Factors + weights ────────────────────────────────────────────────────
    const { data: attrData } = await supabase
      .from('attribute')
      .select('id, name, display_order')
      .eq('project_id', projectId)
      .order('display_order')

    const { data: weightData } = await supabase
      .from('attribute_weight')
      .select('attribute_id, weight')
      .eq('project_id', projectId)

    const weightMap: Record<string, number> = {}
    for (const w of weightData ?? []) weightMap[w.attribute_id] = w.weight

    const factors: PDFFactor[] = (attrData ?? []).map(a => ({
      id:     a.id,
      name:   a.name,
      weight: weightMap[a.id] ?? 0,
    }))

    // ── Level utilities (needed for factor contributions only) ────────────────
    const { data: levelData } = await supabase
      .from('level')
      .select('id, attribute_id, name')
      .in('attribute_id', factors.map(f => f.id))

    const { data: utilityData } = await supabase
      .from('level_utility')
      .select('level_id, utility')
      .eq('project_id', projectId)

    const utilityMap: Record<string, number> = {}
    for (const u of utilityData ?? []) utilityMap[u.level_id] = u.utility

    // Option 2 VI — fallback when stored solver VIs not yet populated
    function computeVIOption2(assignments: Record<string, string>): number {
      return factors.reduce((sum, f) => {
        const levelId  = assignments[f.id]
        const utility  = utilityMap[levelId] ?? 0
        const attrLevels = (levelData ?? []).filter(l => l.attribute_id === f.id)
        const utils    = attrLevels.map(l => utilityMap[l.id] ?? 0)
        const minU     = utils.length ? Math.min(...utils) : 0
        const maxU     = utils.length ? Math.max(...utils) : 1
        const range    = maxU - minU
        const scaled   = range > 0 ? (utility - minU) / range : 0
        return sum + f.weight * scaled
      }, 0)
    }

    // Factor contributions: Option 2 per-factor visualization breakdown
    function computeFactorContributions(assignments: Record<string, string>) {
      return factors.map(f => {
        const levelId  = assignments[f.id]
        const utility  = utilityMap[levelId] ?? 0
        const attrLevels = (levelData ?? []).filter(l => l.attribute_id === f.id)
        const utils    = attrLevels.map(l => utilityMap[l.id] ?? 0)
        const minU     = utils.length ? Math.min(...utils) : 0
        const maxU     = utils.length ? Math.max(...utils) : 0
        const range    = maxU - minU
        const scaled   = range > 0 ? (utility - minU) / range : 0
        return { factor_id: f.id, name: f.name, contribution: f.weight * scaled }
      })
    }

    // ── Benchmarks ────────────────────────────────────────────────────────────
    const { data: benchData } = await supabase
      .from('benchmark')
      .select('id, name, market_price, market_share_pct, included_in_regression')
      .eq('project_id', projectId)
      .eq('included_in_regression', true)
      .order('name')

    const { data: benchAssignData } = await supabase
      .from('benchmark_level_assignment')
      .select('benchmark_id, attribute_id, level_id')
      .in('benchmark_id', (benchData ?? []).map(b => b.id))

    const benchAssignmentsArray: Record<string, string>[] = []
    const benchmarks: PDFBenchmark[] = (benchData ?? []).map(bm => {
      const assignments: Record<string, string> = {}
      for (const a of benchAssignData ?? []) {
        if (a.benchmark_id === bm.id) assignments[a.attribute_id] = a.level_id
      }
      benchAssignmentsArray.push(assignments)
      // Prefer stored solver VI; fall back to Option 2 until Phase 5 is re-run
      const vi         = bm.id in storedBenchmarkVIs
        ? storedBenchmarkVIs[bm.id]
        : computeVIOption2(assignments)
      const modelPrice = b + vi * (m - b)
      const residual   = bm.market_price - modelPrice
      return {
        id:                   bm.id,
        name:                 bm.name,
        market_price:         bm.market_price,
        market_share_pct:     bm.market_share_pct ?? 0,
        value_index:          vi,
        model_price:          modelPrice,
        residual,
        factor_contributions: computeFactorContributions(assignments),
      }
    })

    const benchmarkResiduals = benchmarks.map(bm => bm.residual)

    // ── Targets ───────────────────────────────────────────────────────────────
    const { data: targetData } = await supabase
      .from('target_product')
      .select('id, name, use_case_type')
      .eq('project_id', projectId)
      .order('display_order')

    const { data: targetScoreData } = await supabase
      .from('target_score')
      .select('target_product_id, normalized_score, point_estimate, uncertainty_range_low, uncertainty_range_high, level_assignments_json')
      .eq('project_id', projectId)
      .is('scenario_id', null)
      .in('target_product_id', (targetData ?? []).map(t => t.id))

    const targets: PDFTarget[] = (targetData ?? []).map(t => {
      const ts          = targetScoreData?.find(ts => ts.target_product_id === t.id)
      const assignments = (ts?.level_assignments_json as Record<string, string>) ?? {}
      return {
        id:                   t.id,
        name:                 t.name,
        value_index:          ts?.normalized_score ?? 0,
        point_estimate:       ts?.point_estimate ?? 0,
        range_low:            ts?.uncertainty_range_low ?? 0,
        range_high:           ts?.uncertainty_range_high ?? 0,
        factor_contributions: computeFactorContributions(assignments),
      }
    }).filter(t => t.point_estimate > 0)

    // ── Benchmark price sensitivity (tornado) ────────────────────────────────
    let sensitivity: PDFSensitivityRow[] | undefined
    try {
      const solverUrl = process.env.SOLVER_URL || 'http://localhost:8000'
      const RANGE_PCT = 10

      // attribute_levels: all level IDs per attribute (for solver VI computation)
      const attributeLevelsMap: Record<string, string[]> = {}
      for (const l of levelData ?? []) {
        if (!attributeLevelsMap[l.attribute_id]) attributeLevelsMap[l.attribute_id] = []
        attributeLevelsMap[l.attribute_id].push(l.id)
      }

      // target assignments from stored level_assignments_json
      const targetAssignmentsArray = (targetData ?? []).map(t => {
        const ts = targetScoreData?.find(ts => ts.target_product_id === t.id)
        return (ts?.level_assignments_json as Record<string, string>) ?? {}
      })

      const basePrices       = (benchData ?? []).map(bm => bm.market_price as number)
      const marketShareWeights = (benchData ?? []).map(bm => bm.market_share_pct ?? 1)

      const basePayload = {
        attribute_ids:        factors.map(f => f.id),
        attribute_weights:    weightMap,
        level_utilities:      utilityMap,
        attribute_levels:     attributeLevelsMap,
        benchmark_ids:        (benchData ?? []).map(bm => bm.id),
        benchmark_assignments: benchAssignmentsArray,
        market_prices:        basePrices,
        market_share_weights: marketShareWeights,
        target_ids:           (targetData ?? []).map(t => t.id),
        target_assignments:   targetAssignmentsArray,
        run_sensitivity:      false,
      }

      const sensRows: PDFSensitivityRow[] = []
      for (const bm of benchData ?? []) {
        const bmIdx = (benchData ?? []).indexOf(bm)
        const lowPricesArr  = basePrices.map((p, i) => i === bmIdx ? p * (1 - RANGE_PCT / 100) : p)
        const highPricesArr = basePrices.map((p, i) => i === bmIdx ? p * (1 + RANGE_PCT / 100) : p)

        const [lowRes, highRes] = await Promise.all([
          fetch(`${solverUrl}/solve`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...basePayload, market_prices: lowPricesArr }),
          }).then(r => r.json()),
          fetch(`${solverUrl}/solve`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...basePayload, market_prices: highPricesArr }),
          }).then(r => r.json()),
        ])

        if (lowRes.success && highRes.success) {
          sensRows.push({
            benchId:    bm.id,
            benchName:  bm.name,
            rangePct:   RANGE_PCT,
            basePrice:  bm.market_price,
            lowPrices:  (lowRes.target_results  ?? []).map((tr: any) => tr.point_estimate as number),
            highPrices: (highRes.target_results ?? []).map((tr: any) => tr.point_estimate as number),
          })
        }
      }
      if (sensRows.length) sensitivity = sensRows
    } catch (sensErr) {
      console.warn('Sensitivity computation skipped:', sensErr)
    }

    // ── Assemble report data ──────────────────────────────────────────────────
    const basis = project.benchmark_price_basis
    const priceBasisLabel =
      basis === 'LIST_PRICE'          ? 'List Price' :
      basis === 'AVERAGE_MARKET_PRICE' ? 'Avg Market Price' :
      basis === 'CUSTOM' && project.benchmark_price_basis_custom_description
        ? project.benchmark_price_basis_custom_description
        : 'Market Price'

    const reportData: PDFReportData = {
      projectName:       project.name,
      priceBasis:        priceBasisLabel,
      currency:          project.currency ?? 'USD',
      geographicScope:   project.geographic_scope ?? '',
      targetSegment:     project.target_segment ?? '',
      categoryAnchor:    project.category_anchor ?? '',
      generatedAt:       new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
      modelParams:       { b, m, r_squared: reg.r_squared_weighted ?? 0 },
      factors,
      benchmarks,
      targets,
      benchmarkResiduals,
      sensitivity,
    }

    // ── Render PDF ────────────────────────────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const buffer = await renderToBuffer(React.createElement(VPMReport, { data: reportData }) as any)

    const filename = `${project.name.replace(/[^a-z0-9]/gi, '_')}_VPM_Report.pdf`

    return new NextResponse(buffer as unknown as BodyInit, {
      status: 200,
      headers: {
        'Content-Type':        'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length':      buffer.byteLength.toString(),
      },
    })
  } catch (err: any) {
    console.error('PDF generation error:', err)
    return NextResponse.json({ error: err.message ?? 'PDF generation failed' }, { status: 500 })
  }
}
