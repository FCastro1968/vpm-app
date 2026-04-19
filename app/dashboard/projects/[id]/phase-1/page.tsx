'use client'

import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter, useParams } from 'next/navigation'
import { StaleWarningModal } from '@/app/components/StaleWarningModal'

const STATUS_ORDER = ['DRAFT','SCOPE_COMPLETE','FRAMEWORK_COMPLETE','SURVEY_OPEN','SURVEY_CLOSED','UTILITIES_DERIVED','MODEL_RUN','COMPLETE']
function statusIndex(s: string) { return STATUS_ORDER.indexOf(s) }

type UseCaseType = 'NPI' | 'REPOSITION'
type BenchmarkPriceBasis = 'LIST_PRICE' | 'AVERAGE_MARKET_PRICE' | 'CUSTOM'

interface TargetProduct {
  id?: string
  name: string
  use_case_type: UseCaseType
  current_price: string
  display_order: number
}

interface Benchmark {
  id?: string
  name: string
  market_price: string
  market_share_pct: string
  aiSuggested?: boolean
  accepted?: boolean
}

const BASIS_LABELS: Record<BenchmarkPriceBasis, string> = {
  LIST_PRICE: 'List Price',
  AVERAGE_MARKET_PRICE: 'Average Market Price',
  CUSTOM: 'Custom',
}

async function callAI(task: string, payload: object) {
  const res = await fetch('/api/ai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ task, payload }),
  })
  if (!res.ok) throw new Error(`AI request failed: ${res.status}`)
  return res.json()
}

export default function Phase1Page() {
  const params = useParams()
  const projectId = params.id as string
  const router = useRouter()
  const supabase = createClient()

  const [projectName,          setProjectName]          = useState('')
  const [currency,             setCurrency]             = useState('USD')
  const [geoScope,             setGeoScope]             = useState('')
  const [targetSegment,        setTargetSegment]        = useState('')
  const [priceBasis,           setPriceBasis]           = useState<BenchmarkPriceBasis | ''>('')
  const [priceBasisCustomDesc, setPriceBasisCustomDesc] = useState('')
  const [targets,              setTargets]              = useState<TargetProduct[]>([
    { name: '', use_case_type: 'NPI', current_price: '', display_order: 1 },
  ])
  const [benchmarks,           setBenchmarks]           = useState<Benchmark[]>([
    { name: '', market_price: '', market_share_pct: '' },
    { name: '', market_price: '', market_share_pct: '' },
  ])
  const [categoryAnchor,       setCategoryAnchor]       = useState('')
  const [generatingBenchmarks, setGeneratingBenchmarks] = useState(false)
  const [saving,               setSaving]               = useState(false)
  const [error,                setError]                = useState('')
  const [aiError,              setAiError]              = useState('')
  const [loaded,               setLoaded]               = useState(false)
  const [projectStatus,        setProjectStatus]        = useState('DRAFT')
  const [staleWarningOpen,     setStaleWarningOpen]     = useState(false)
  const pendingSaveRef = useRef<(() => Promise<void>) | null>(null)
  // Snapshot of benchmark prices/shares as loaded from DB — used for stale detection
  const loadedBenchSnap = useRef<Map<string, { price: string; share: string }>>(new Map())

  // ── Load ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    async function load() {
      const { data: project } = await supabase
        .from('project')
        .select('name, currency, geographic_scope, target_segment, benchmark_price_basis, benchmark_price_basis_custom_description, category_anchor, status')
        .eq('id', projectId)
        .single()

      if (project) {
        setProjectName(project.name ?? '')
        setCurrency(project.currency ?? 'USD')
        setGeoScope(project.geographic_scope ?? '')
        setTargetSegment(project.target_segment ?? '')
        setPriceBasis(project.benchmark_price_basis ?? '')
        setPriceBasisCustomDesc(project.benchmark_price_basis_custom_description ?? '')
        setCategoryAnchor(project.category_anchor ?? '')
        setProjectStatus(project.status ?? 'DRAFT')
      }

      const { data: existingTargets } = await supabase
        .from('target_product')
        .select('id, name, use_case_type, current_price, display_order')
        .eq('project_id', projectId)
        .order('display_order')

      if (existingTargets && existingTargets.length > 0) {
        setTargets(existingTargets.map(t => ({
          ...t,
          current_price: t.current_price?.toString() ?? '',
        })))
      }

      const { data: existingBenchmarks } = await supabase
        .from('benchmark')
        .select('id, name, market_price, market_share_pct')
        .eq('project_id', projectId)
        .order('name')

      if (existingBenchmarks && existingBenchmarks.length > 0) {
        const mapped = existingBenchmarks.map(b => ({
          ...b,
          market_price: b.market_price?.toString() ?? '',
          market_share_pct: b.market_share_pct?.toString() ?? '',
        }))
        setBenchmarks(mapped)
        // Snapshot for stale detection
        const snap = new Map<string, { price: string; share: string }>()
        for (const b of mapped) {
          if (b.id) snap.set(b.id, { price: b.market_price, share: b.market_share_pct })
        }
        loadedBenchSnap.current = snap
      }

      setLoaded(true)
    }
    load()
  }, [projectId])

  // ── Target helpers ────────────────────────────────────────────────────────

  function addTarget() {
    if (targets.length >= 3) return
    setTargets([...targets, { name: '', use_case_type: 'NPI', current_price: '', display_order: targets.length + 1 }])
  }

  function removeTarget(index: number) {
    if (targets.length <= 1) return
    setTargets(targets.filter((_, i) => i !== index).map((t, i) => ({ ...t, display_order: i + 1 })))
  }

  function updateTarget(index: number, field: keyof TargetProduct, value: string) {
    setTargets(targets.map((t, i) => i === index ? { ...t, [field]: value } : t))
  }

  // ── Benchmark helpers ─────────────────────────────────────────────────────

  function addBenchmark() {
    setBenchmarks([...benchmarks, { name: '', market_price: '', market_share_pct: '' }])
  }

  function removeBenchmark(index: number) {
    if (benchmarks.filter(b => !b.aiSuggested || b.accepted).length <= 2 && !benchmarks[index].aiSuggested) return
    setBenchmarks(benchmarks.filter((_, i) => i !== index))
  }

  function updateBenchmark(index: number, field: keyof Benchmark, value: string) {
    setBenchmarks(benchmarks.map((b, i) => i === index ? { ...b, [field]: value } : b))
  }

  function acceptSuggestion(index: number) {
    setBenchmarks(benchmarks.map((b, i) => i === index ? { ...b, accepted: true } : b))
  }

  function dismissSuggestion(index: number) {
    setBenchmarks(benchmarks.filter((_, i) => i !== index))
  }

  // ── AI: Generate benchmark suggestions ───────────────────────────────────

  async function handleGenerateBenchmarks() {
    if (!categoryAnchor.trim()) {
      setAiError('Please enter a Category Anchor description first.')
      return
    }
    setGeneratingBenchmarks(true)
    setAiError('')

    try {
      const { benchmarks: suggestions } = await callAI('suggest_benchmarks', {
        category_anchor: categoryAnchor,
        geography: geoScope || 'Global',
      })

      // Remove empty placeholder rows, add suggestions as pending
      const existing = benchmarks.filter(b => b.name.trim() && !b.aiSuggested)
      const newSuggestions: Benchmark[] = suggestions.map((s: any) => ({
        name: s.name,
        market_price: '',
        market_share_pct: '',
        aiSuggested: true,
        accepted: false,
      }))

      setBenchmarks([...existing, ...newSuggestions])

    } catch (err: any) {
      setAiError(err.message ?? 'Failed to generate suggestions')
    } finally {
      setGeneratingBenchmarks(false)
    }
  }

  // ── AI: Estimate market shares ────────────────────────────────────────────

  // ── Validation + Save ─────────────────────────────────────────────────────

  function validate(): string | null {
    if (!projectName.trim()) return 'Project name is required'
    if (!priceBasis) return 'Benchmark Price Basis must be declared before entering prices'
    if (priceBasis === 'CUSTOM' && !priceBasisCustomDesc.trim()) return 'Custom basis requires a description'
    if (targets.some(t => !t.name.trim())) return 'All target products must have a name'
    const acceptedBenchmarks = benchmarks.filter(b => b.name.trim() && (!b.aiSuggested || b.accepted))
    if (acceptedBenchmarks.some(b => !b.market_price || isNaN(Number(b.market_price)))) return 'All reference products must have a valid price'
    if (acceptedBenchmarks.length < 3) return 'At least 3 reference products are required for a valid model'
    return null
  }

  function hasSolverInputChanged(): boolean {
    const accepted = benchmarks.filter(b => b.name.trim() && (!b.aiSuggested || b.accepted))
    for (const b of accepted) {
      if (!b.id) return true  // new benchmark added
      const snap = loadedBenchSnap.current.get(b.id)
      if (!snap) return true  // new benchmark (id assigned elsewhere)
      if (b.market_price !== snap.price || b.market_share_pct !== snap.share) return true
    }
    // Check for removed benchmarks
    for (const id of loadedBenchSnap.current.keys()) {
      const still = accepted.find(b => b.id === id)
      if (!still) return true
    }
    return false
  }

  async function executeSave() {
    setSaving(true)
    setError('')
    const solverInputChanged = hasSolverInputChanged()
    const curIdx = statusIndex(projectStatus)

    try {
      // Determine new status — never downgrade unless we're clearing stale data
      let newStatus: string
      if (curIdx < statusIndex('SCOPE_COMPLETE')) {
        newStatus = 'SCOPE_COMPLETE'
      } else if (solverInputChanged && curIdx >= statusIndex('MODEL_RUN')) {
        // Clear solver outputs and drop to UTILITIES_DERIVED
        await supabase.from('regression_result')
          .delete().eq('project_id', projectId).is('scenario_id', null)
        await supabase.from('target_score')
          .update({ normalized_score: null, point_estimate: null, uncertainty_range_low: null, uncertainty_range_high: null })
          .eq('project_id', projectId).is('scenario_id', null)
        newStatus = 'UTILITIES_DERIVED'
      } else {
        newStatus = projectStatus  // no change
      }

      const { error: projectError } = await supabase
        .from('project')
        .update({
          name: projectName.trim(),
          currency,
          geographic_scope: geoScope,
          target_segment: targetSegment || null,
          benchmark_price_basis: priceBasis,
          benchmark_price_basis_custom_description: priceBasisCustomDesc || null,
          category_anchor: categoryAnchor || null,
          status: newStatus,
        })
        .eq('id', projectId)
      if (projectError) throw projectError

      for (const target of targets) {
        if (!target.name.trim()) continue
        const payload = {
          project_id: projectId,
          name: target.name.trim(),
          use_case_type: target.use_case_type,
          current_price: target.use_case_type === 'REPOSITION' && target.current_price
            ? Number(target.current_price) : null,
          display_order: target.display_order,
        }
        if (target.id) {
          await supabase.from('target_product').update(payload).eq('id', target.id)
        } else {
          await supabase.from('target_product').insert({ ...payload })
        }
      }

      // Only save accepted benchmarks (or manually entered ones)
      const benchmarksToSave = benchmarks.filter(b => b.name.trim() && (!b.aiSuggested || b.accepted))
      for (const bench of benchmarksToSave) {
        const payload = {
          project_id: projectId,
          name: bench.name.trim(),
          market_price: Number(bench.market_price),
          market_share_pct: bench.market_share_pct ? Number(bench.market_share_pct) : null,
          included_in_regression: true,
        }
        if (bench.id) {
          await supabase.from('benchmark').update(payload).eq('id', bench.id)
        } else {
          await supabase.from('benchmark').insert({ ...payload })
        }
      }

      router.refresh()
      router.push(`/dashboard/projects/${projectId}/phase-2`)

    } catch (err: any) {
      setError(err.message ?? 'An error occurred while saving')
    } finally {
      setSaving(false)
    }
  }

  function handleSave() {
    const validationError = validate()
    if (validationError) { setError(validationError); return }
    setError('')

    const curIdx = statusIndex(projectStatus)
    if (hasSolverInputChanged() && curIdx >= statusIndex('MODEL_RUN')) {
      pendingSaveRef.current = executeSave
      setStaleWarningOpen(true)
    } else {
      executeSave()
    }
  }

  function handleStaleConfirm() {
    setStaleWarningOpen(false)
    pendingSaveRef.current?.()
    pendingSaveRef.current = null
  }

  function handleStaleCancel() {
    setStaleWarningOpen(false)
    pendingSaveRef.current = null
  }

  if (!loaded) return <div className="text-gray-400 text-sm">Loading...</div>

  const totalShares = benchmarks
    .filter(b => !b.aiSuggested || b.accepted)
    .reduce((sum, b) => sum + (b.market_share_pct ? Number(b.market_share_pct) : 0), 0)

  const hasPendingSuggestions = benchmarks.some(b => b.aiSuggested && !b.accepted)

  return (
    <div className="w-full">
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-gray-900">Scope Definition</h1>
        <p className="text-gray-500 mt-0.5 text-sm">Define the project context, target products, and market reference set.</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '300px 360px 1fr', gap: '16px', alignItems: 'start' }}>

        {/* ── COL 1: Project Details + Price Basis ─────────────── */}
        <div className="space-y-4">

        {/* Project Details */}
        <section className="bg-white rounded-lg shadow border border-gray-300 p-4">
          <h2 className="text-sm font-semibold text-gray-900 mb-3">Project Details</h2>
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Project name</label>
              <input
                type="text"
                value={projectName}
                onChange={e => setProjectName(e.target.value)}
                className="w-full px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            <div className="grid gap-3" style={{ gridTemplateColumns: '80px 1fr' }}>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Currency</label>
                <input
                  type="text"
                  value={currency}
                  onChange={e => setCurrency(e.target.value.toUpperCase())}
                  placeholder="USD"
                  maxLength={3}
                  className="w-full px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Geography</label>
                <input
                  type="text"
                  value={geoScope}
                  onChange={e => setGeoScope(e.target.value)}
                  placeholder="e.g. North America"
                  className="w-full px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Target Segment
                <span className="ml-1 font-normal text-gray-400">optional</span>
              </label>
              <input
                type="text"
                value={targetSegment}
                onChange={e => setTargetSegment(e.target.value)}
                placeholder="e.g. Hospital labs, SMB teams"
                className="w-full px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
          </div>
        </section>

        {/* Benchmark Price Basis */}
        <section className="bg-white rounded-lg shadow border border-gray-300 p-4">
          <h2 className="text-sm font-semibold text-gray-900 mb-0.5">Benchmark Price Basis</h2>
          <p className="text-xs text-gray-500 mb-3">
            Declare the price type before entering prices. Must be consistent across all reference products.
          </p>
          <div className="space-y-1.5">
            {(['LIST_PRICE', 'AVERAGE_MARKET_PRICE', 'CUSTOM'] as BenchmarkPriceBasis[]).map(basis => (
              <label key={basis} className="flex items-start gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="priceBasis"
                  value={basis}
                  checked={priceBasis === basis}
                  onChange={() => setPriceBasis(basis)}
                  className="mt-0.5 flex-shrink-0"
                />
                <div>
                  <span className="text-xs font-medium text-gray-900">{BASIS_LABELS[basis]}</span>
                  <p className="text-xs text-gray-400 leading-tight">
                    {basis === 'LIST_PRICE' && 'Published/catalog price before discounting'}
                    {basis === 'AVERAGE_MARKET_PRICE' && 'Typical price paid across channels (street price)'}
                    {basis === 'CUSTOM' && 'User-defined — ensure consistency across all benchmarks'}
                  </p>
                </div>
              </label>
            ))}
          </div>
          {priceBasis === 'CUSTOM' && (
            <div className="mt-3">
              <label className="block text-xs font-medium text-gray-700 mb-1">Custom basis description</label>
              <input
                type="text"
                value={priceBasisCustomDesc}
                onChange={e => setPriceBasisCustomDesc(e.target.value)}
                placeholder="Describe the price basis used"
                className="w-full px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
          )}
        </section>

        </div>{/* end col 1 */}

        {/* ── COL 2: Target Products ────────────────────────────── */}
        <div>
        <section className="bg-white rounded-lg shadow border border-gray-300 p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="text-sm font-semibold text-gray-900">Target Products</h2>
              <p className="text-xs text-gray-500 mt-0.5">Up to 3 products per model run.</p>
            </div>
            {targets.length < 3 && (
              <button onClick={addTarget} className="text-xs text-blue-600 hover:text-blue-700 font-medium">
                + Add
              </button>
            )}
          </div>
          <div className="space-y-3">
            {targets.map((target, i) => (
              <div key={i} className="border border-gray-200 rounded-md p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Target {i + 1}</span>
                  {targets.length > 1 && (
                    <button onClick={() => removeTarget(i)} className="text-xs text-red-400 hover:text-red-600">
                      Remove
                    </button>
                  )}
                </div>
                <div className="space-y-2">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Product name</label>
                    <input
                      type="text"
                      value={target.name}
                      onChange={e => updateTarget(i, 'name', e.target.value)}
                      className="w-full px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>
                  <div className="flex gap-2">
                    <div className="flex-1">
                      <label className="block text-xs font-medium text-gray-700 mb-1">Use case</label>
                      <select
                        value={target.use_case_type}
                        onChange={e => updateTarget(i, 'use_case_type', e.target.value)}
                        className="w-full px-2 py-1.5 border border-gray-300 rounded-md text-xs focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                      >
                        <option value="NPI">New Product Introduction</option>
                        <option value="REPOSITION">Price Repositioning</option>
                      </select>
                    </div>
                    {target.use_case_type === 'REPOSITION' && (
                      <div className="w-24">
                        <label className="block text-xs font-medium text-gray-700 mb-1">Current price</label>
                        <input
                          type="number"
                          value={target.current_price}
                          onChange={e => updateTarget(i, 'current_price', e.target.value)}
                          placeholder="0.00"
                          className="w-full px-2 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                        />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
        </div>{/* end col 2 */}

        {/* ── COL 3: Category Anchor + Market Reference Set ─────── */}
        <div className="space-y-4">

        {/* Category Anchor + AI Assist */}
        <section className="bg-white rounded-lg shadow border border-gray-300 p-4">
          <h2 className="text-sm font-semibold text-gray-900 mb-0.5">Category Anchor</h2>
          <p className="text-xs text-gray-500 mb-3">
            Describe a representative product in your category. Used to generate a suggested market reference set.
            {targets[0]?.name && targets[0].use_case_type === 'REPOSITION' && (
              <span className="text-blue-600"> For repositioning, your target product naturally serves as the anchor.</span>
            )}
          </p>
          <textarea
            value={categoryAnchor}
            onChange={e => setCategoryAnchor(e.target.value)}
            placeholder='e.g. "A mid-range consumer laptop targeting home users and students, priced between $600-$1,200, running Windows 11, competing with major brands like Dell, HP, and Lenovo"'
            rows={2}
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 resize-none"
          />
          <div className="mt-2 flex items-center gap-3 flex-wrap">
            <button
              onClick={handleGenerateBenchmarks}
              disabled={generatingBenchmarks || !categoryAnchor.trim()}
              className="px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-md hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
            >
              {generatingBenchmarks ? (
                <>
                  <span className="inline-block w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Generating...
                </>
              ) : (
                '✦ Generate Market Reference Set'
              )}
            </button>
            <span className="text-xs text-gray-400">AI-suggested products will appear below for review</span>
          </div>
          {aiError && <div className="mt-2 text-xs text-red-600">{aiError}</div>}
        </section>

        {/* Market Reference Set */}
        <section className="bg-white rounded-lg shadow border border-gray-300 p-4">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-sm font-semibold text-gray-900">Market Reference Set</h2>
            <button onClick={addBenchmark} className="text-xs text-blue-600 hover:text-blue-700 font-medium">
              + Add manually
            </button>
          </div>
          <p className="text-xs text-gray-500 mb-3">
            {priceBasis
              ? `Prices as ${BASIS_LABELS[priceBasis as BenchmarkPriceBasis]}.`
              : 'Declare a Benchmark Price Basis first.'}
            {' '}Market share figures are SME estimates — no need to sum to 100%.
          </p>

          {hasPendingSuggestions && (
            <div className="mb-2 px-3 py-2 bg-blue-50 border border-blue-200 rounded-md text-xs text-blue-700">
              ✦ Review AI-suggested products below. Enter a price and click Accept to add to your reference set.
            </div>
          )}

          {/* Table header */}
          <div className="grid gap-2 mb-1.5 px-1" style={{ gridTemplateColumns: '1fr 76px 66px 24px' }}>
            <div className="text-xs font-medium text-gray-500">Product name</div>
            <div className="text-xs font-medium text-gray-500">Price ({currency || 'USD'})</div>
            <div className="text-xs font-medium text-gray-500">Mkt share %</div>
            <div />
          </div>

          <div className="space-y-1.5">
            {benchmarks.map((bench, i) => {
              const isPending = bench.aiSuggested && !bench.accepted
              return (
                <div
                  key={i}
                  className={`rounded-md border p-1.5 ${isPending ? 'border-blue-200 bg-blue-50' : 'border-transparent'}`}
                >
                  <div className="grid gap-2 items-center" style={{ gridTemplateColumns: '1fr 76px 66px 24px' }}>
                    {/* Name */}
                    <div className="flex items-center gap-1.5 min-w-0">
                      {isPending && <span className="text-xs text-blue-500 font-medium flex-shrink-0">✦</span>}
                      <input
                        type="text"
                        value={bench.name}
                        onChange={e => updateBenchmark(i, 'name', e.target.value)}
                        placeholder={`Reference product ${i + 1}`}
                        className={`w-full px-2 py-1.5 border rounded-md text-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 ${
                          isPending ? 'border-blue-300 bg-white' : 'border-gray-300'
                        }`}
                      />
                    </div>
                    {/* Price */}
                    <div>
                      <input
                        type="number"
                        value={bench.market_price}
                        onChange={e => updateBenchmark(i, 'market_price', e.target.value)}
                        placeholder="0.00"
                        disabled={!priceBasis}
                        className="w-full px-2 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-50 disabled:text-gray-400"
                      />
                    </div>
                    {/* Share input */}
                    <div>
                      <input
                        type="number"
                        value={bench.market_share_pct}
                        onChange={e => updateBenchmark(i, 'market_share_pct', e.target.value)}
                        placeholder="0.0"
                        min="0"
                        max="100"
                        className="w-full px-2 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                      />
                    </div>
                    <div className="flex items-center justify-end">
                      {!isPending && (
                        <button onClick={() => removeBenchmark(i)} className="text-gray-300 hover:text-red-400 text-lg leading-none">
                          ×
                        </button>
                      )}
                    </div>
                  </div>
                  {/* Accept/Dismiss bar */}
                  {isPending && (
                    <div className="flex items-center justify-end gap-2 mt-1.5 pt-1.5 border-t border-blue-200">
                      <span className="text-xs text-blue-500 mr-auto">AI suggested — review and accept or dismiss</span>
                      <button onClick={() => dismissSuggestion(i)} className="text-xs px-2.5 py-1 border border-gray-300 text-gray-500 rounded-md hover:bg-gray-50">
                        Dismiss
                      </button>
                      <button onClick={() => acceptSuggestion(i)} className="text-xs px-2.5 py-1 bg-green-600 text-white rounded-md hover:bg-green-700 font-medium">
                        ✓ Accept
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {totalShares > 0 && (
            <div className={`mt-2 text-xs text-right ${Math.abs(totalShares - 100) < 0.1 ? 'text-green-600' : 'text-gray-400'}`}>
              Total market share: {totalShares.toFixed(1)}%
              {Math.abs(totalShares - 100) < 0.1 && ' ✓'}
            </div>
          )}
        </section>

        </div>{/* end col 3 */}

      </div>{/* end grid */}

      {/* Error + Save — full width below grid */}
      <div className="mt-4 space-y-3 pb-6">
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-md px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}
        <div className="flex justify-end">
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-6 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save & Continue →'}
          </button>
        </div>
      </div>

      <StaleWarningModal
        open={staleWarningOpen}
        title="Saving will delete downstream results"
        description="Reference product price or market share changes require the Value Pricing Model to be re-run. Your current Phase 5 and 6 results will be permanently deleted."
        onConfirm={handleStaleConfirm}
        onCancel={handleStaleCancel}
      />
    </div>
  )
}
