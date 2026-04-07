'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter, useParams } from 'next/navigation'

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
}

const BASIS_LABELS: Record<BenchmarkPriceBasis, string> = {
  LIST_PRICE: 'List Price',
  AVERAGE_MARKET_PRICE: 'Average Market Price',
  CUSTOM: 'Custom',
}

export default function Phase1Page() {
  const params = useParams()
  const projectId = params.id as string
  const router = useRouter()
  const supabase = createClient()

  // Project-level fields
  const [projectName, setProjectName] = useState('')
  const [currency, setCurrency] = useState('USD')
  const [geoScope, setGeoScope] = useState('')
  const [priceBasis, setPriceBasis] = useState<BenchmarkPriceBasis | ''>('')
  const [priceBasisCustomDesc, setPriceBasisCustomDesc] = useState('')

  // Target products (up to 3)
  const [targets, setTargets] = useState<TargetProduct[]>([
    { name: '', use_case_type: 'NPI', current_price: '', display_order: 1 },
  ])

  // Benchmarks
  const [benchmarks, setBenchmarks] = useState<Benchmark[]>([
    { name: '', market_price: '', market_share_pct: '' },
    { name: '', market_price: '', market_share_pct: '' },
  ])

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [loaded, setLoaded] = useState(false)

  // Load existing data
  useEffect(() => {
    async function load() {
      const { data: project } = await supabase
        .from('project')
        .select('name, currency, geographic_scope, benchmark_price_basis, benchmark_price_basis_custom_description')
        .eq('id', projectId)
        .single()

      if (project) {
        setProjectName(project.name ?? '')
        setCurrency(project.currency ?? 'USD')
        setGeoScope(project.geographic_scope ?? '')
        setPriceBasis(project.benchmark_price_basis ?? '')
        setPriceBasisCustomDesc(project.benchmark_price_basis_custom_description ?? '')
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
        setBenchmarks(existingBenchmarks.map(b => ({
          ...b,
          market_price: b.market_price?.toString() ?? '',
          market_share_pct: b.market_share_pct?.toString() ?? '',
        })))
      }

      setLoaded(true)
    }
    load()
  }, [projectId])

  // Target product helpers
  function addTarget() {
    if (targets.length >= 3) return
    setTargets([...targets, {
      name: '', use_case_type: 'NPI', current_price: '',
      display_order: targets.length + 1
    }])
  }

  function removeTarget(index: number) {
    if (targets.length <= 1) return
    setTargets(targets.filter((_, i) => i !== index)
      .map((t, i) => ({ ...t, display_order: i + 1 })))
  }

  function updateTarget(index: number, field: keyof TargetProduct, value: string) {
    setTargets(targets.map((t, i) => i === index ? { ...t, [field]: value } : t))
  }

  // Benchmark helpers
  function addBenchmark() {
    setBenchmarks([...benchmarks, { name: '', market_price: '', market_share_pct: '' }])
  }

  function removeBenchmark(index: number) {
    if (benchmarks.length <= 2) return
    setBenchmarks(benchmarks.filter((_, i) => i !== index))
  }

  function updateBenchmark(index: number, field: keyof Benchmark, value: string) {
    setBenchmarks(benchmarks.map((b, i) => i === index ? { ...b, [field]: value } : b))
  }

  // Validation
  function validate(): string | null {
    if (!projectName.trim()) return 'Project name is required'
    if (!priceBasis) return 'Benchmark Price Basis must be declared before entering prices'
    if (priceBasis === 'CUSTOM' && !priceBasisCustomDesc.trim()) return 'Custom basis requires a description'
    if (targets.some(t => !t.name.trim())) return 'All target products must have a name'
    if (benchmarks.some(b => !b.name.trim())) return 'All reference products must have a name'
    if (benchmarks.some(b => !b.market_price || isNaN(Number(b.market_price)))) return 'All reference products must have a valid price'
    if (benchmarks.filter(b => b.name.trim()).length < 2) return 'At least 2 reference products are required'
    return null
  }

  async function handleSave() {
    const validationError = validate()
    if (validationError) { setError(validationError); return }

    setSaving(true)
    setError('')

    try {
      // Update project
      const { error: projectError } = await supabase
        .from('project')
        .update({
          name: projectName.trim(),
          currency,
          geographic_scope: geoScope,
          benchmark_price_basis: priceBasis,
          benchmark_price_basis_custom_description: priceBasisCustomDesc || null,
          status: 'SCOPE_COMPLETE',
        })
        .eq('id', projectId)

      if (projectError) throw projectError

      // Upsert target products
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

      // Upsert benchmarks
      for (const bench of benchmarks) {
        if (!bench.name.trim()) continue
        const payload = {
          project_id: projectId,
          name: bench.name.trim(),
          market_price: Number(bench.market_price),
          market_share_pct: bench.market_share_pct ? Number(bench.market_share_pct) : null,
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

  if (!loaded) {
    return <div className="text-gray-400 text-sm">Loading...</div>
  }

  const totalShares = benchmarks.reduce((sum, b) =>
    sum + (b.market_share_pct ? Number(b.market_share_pct) : 0), 0)

  return (
    <div className="max-w-3xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Scope Definition</h1>
        <p className="text-gray-500 mt-1 text-sm">
          Define the project context, target products, and market reference set.
        </p>
      </div>

      <div className="space-y-8">

        {/* ── Project Details ── */}
        <section className="bg-white rounded-lg shadow p-6">
          <h2 className="text-base font-semibold text-gray-900 mb-4">Project Details</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Project name</label>
              <input
                type="text"
                value={projectName}
                onChange={e => setProjectName(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Currency</label>
                <input
                  type="text"
                  value={currency}
                  onChange={e => setCurrency(e.target.value.toUpperCase())}
                  placeholder="USD"
                  maxLength={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Geographic scope</label>
                <input
                  type="text"
                  value={geoScope}
                  onChange={e => setGeoScope(e.target.value)}
                  placeholder="e.g. North America, Global"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
            </div>
          </div>
        </section>

        {/* ── Benchmark Price Basis ── */}
        <section className="bg-white rounded-lg shadow p-6">
          <h2 className="text-base font-semibold text-gray-900 mb-1">Benchmark Price Basis</h2>
          <p className="text-xs text-gray-500 mb-4">
            Declare the price type before entering any benchmark prices. This must be consistent across all reference products.
          </p>
          <div className="space-y-2">
            {(['LIST_PRICE', 'AVERAGE_MARKET_PRICE', 'CUSTOM'] as BenchmarkPriceBasis[]).map(basis => (
              <label key={basis} className="flex items-start gap-3 cursor-pointer">
                <input
                  type="radio"
                  name="priceBasis"
                  value={basis}
                  checked={priceBasis === basis}
                  onChange={() => setPriceBasis(basis)}
                  className="mt-0.5"
                />
                <div>
                  <span className="text-sm font-medium text-gray-900">{BASIS_LABELS[basis]}</span>
                  <p className="text-xs text-gray-400">
                    {basis === 'LIST_PRICE' && 'Published or catalog price before any discounting'}
                    {basis === 'AVERAGE_MARKET_PRICE' && 'Typical price paid by buyers across channels (street price)'}
                    {basis === 'CUSTOM' && 'User-defined basis — you are responsible for consistency across all benchmarks'}
                  </p>
                </div>
              </label>
            ))}
          </div>
          {priceBasis === 'CUSTOM' && (
            <div className="mt-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">Custom basis description</label>
              <input
                type="text"
                value={priceBasisCustomDesc}
                onChange={e => setPriceBasisCustomDesc(e.target.value)}
                placeholder="Describe the price basis used"
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
          )}
        </section>

        {/* ── Target Products ── */}
        <section className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-base font-semibold text-gray-900">Target Products</h2>
              <p className="text-xs text-gray-500 mt-0.5">Up to 3 products can be priced in a single model run.</p>
            </div>
            {targets.length < 3 && (
              <button
                onClick={addTarget}
                className="text-sm text-blue-600 hover:text-blue-700 font-medium"
              >
                + Add product
              </button>
            )}
          </div>
          <div className="space-y-4">
            {targets.map((target, i) => (
              <div key={i} className="border border-gray-200 rounded-md p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                    Target {i + 1}
                  </span>
                  {targets.length > 1 && (
                    <button
                      onClick={() => removeTarget(i)}
                      className="text-xs text-red-400 hover:text-red-600"
                    >
                      Remove
                    </button>
                  )}
                </div>
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Product name</label>
                    <input
                      type="text"
                      value={target.name}
                      onChange={e => updateTarget(i, 'name', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>
                  <div className="flex gap-4">
                    <div className="flex-1">
                      <label className="block text-xs font-medium text-gray-700 mb-1">Use case</label>
                      <select
                        value={target.use_case_type}
                        onChange={e => updateTarget(i, 'use_case_type', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                      >
                        <option value="NPI">New Product Introduction</option>
                        <option value="REPOSITION">Price Repositioning</option>
                      </select>
                    </div>
                    {target.use_case_type === 'REPOSITION' && (
                      <div className="flex-1">
                        <label className="block text-xs font-medium text-gray-700 mb-1">Current price</label>
                        <input
                          type="number"
                          value={target.current_price}
                          onChange={e => updateTarget(i, 'current_price', e.target.value)}
                          placeholder="0.00"
                          className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                        />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── Market Reference Set ── */}
        <section className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-base font-semibold text-gray-900">Market Reference Set</h2>
            <button
              onClick={addBenchmark}
              className="text-sm text-blue-600 hover:text-blue-700 font-medium"
            >
              + Add product
            </button>
          </div>
          <p className="text-xs text-gray-500 mb-4">
            {priceBasis
              ? `Prices should be entered as ${BASIS_LABELS[priceBasis as BenchmarkPriceBasis]}.`
              : 'Declare a Benchmark Price Basis above before entering prices.'}
            {' '}Market share figures are SME best estimates and do not need to sum to exactly 100%.
          </p>

          {/* Table header */}
          <div className="grid grid-cols-12 gap-2 mb-2 px-1">
            <div className="col-span-5 text-xs font-medium text-gray-500">Product name</div>
            <div className="col-span-3 text-xs font-medium text-gray-500">
              Price ({currency || 'USD'})
            </div>
            <div className="col-span-3 text-xs font-medium text-gray-500">Market share %</div>
            <div className="col-span-1" />
          </div>

          <div className="space-y-2">
            {benchmarks.map((bench, i) => (
              <div key={i} className="grid grid-cols-12 gap-2 items-center">
                <div className="col-span-5">
                  <input
                    type="text"
                    value={bench.name}
                    onChange={e => updateBenchmark(i, 'name', e.target.value)}
                    placeholder={`Reference product ${i + 1}`}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div className="col-span-3">
                  <input
                    type="number"
                    value={bench.market_price}
                    onChange={e => updateBenchmark(i, 'market_price', e.target.value)}
                    placeholder="0.00"
                    disabled={!priceBasis}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-50 disabled:text-gray-400"
                  />
                </div>
                <div className="col-span-3">
                  <input
                    type="number"
                    value={bench.market_share_pct}
                    onChange={e => updateBenchmark(i, 'market_share_pct', e.target.value)}
                    placeholder="0.0"
                    min="0"
                    max="100"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div className="col-span-1 flex justify-center">
                  {benchmarks.length > 2 && (
                    <button
                      onClick={() => removeBenchmark(i)}
                      className="text-gray-300 hover:text-red-400 text-lg leading-none"
                    >
                      ×
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Share total */}
          {totalShares > 0 && (
            <div className={`mt-3 text-xs text-right ${
              Math.abs(totalShares - 100) < 0.1 ? 'text-green-600' : 'text-gray-400'
            }`}>
              Total market share: {totalShares.toFixed(1)}%
              {Math.abs(totalShares - 100) < 0.1 && ' ✓'}
            </div>
          )}
        </section>

        {/* ── Error + Save ── */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-md px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="flex justify-end pb-8">
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-6 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save & Continue →'}
          </button>
        </div>

      </div>
    </div>
  )
}
