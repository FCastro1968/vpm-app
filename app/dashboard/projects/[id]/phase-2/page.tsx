'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter, useParams } from 'next/navigation'

interface Level {
  id?: string
  name: string
  description: string
  display_order: number
}

interface Factor {
  id?: string
  name: string
  description: string
  display_order: number
  levels: Level[]
}

interface Benchmark {
  id: string
  name: string
}

type Assignments = Record<string, Record<string, number>>

const MIN_FACTORS = 2
const MAX_FACTORS = 20
const MIN_LEVELS = 2
const MAX_LEVELS = 6

function emptyFactor(display_order: number): Factor {
  return {
    name: '', description: '', display_order,
    levels: [
      { name: '', description: '', display_order: 1 },
      { name: '', description: '', display_order: 2 },
    ],
  }
}

function surveyQuestionCount(factors: Factor[]): number {
  const n = factors.length
  const attrPairs = (n * (n - 1)) / 2
  const levelPairs = factors.reduce((sum, f) => {
    const k = f.levels.length
    return sum + (k * (k - 1)) / 2
  }, 0)
  return attrPairs + levelPairs
}

function coverageScore(factors: Factor[], benchmarks: Benchmark[], assignments: Assignments): number | null {
  if (factors.length === 0 || benchmarks.length < 2) return null
  const n = factors.length
  const scores = benchmarks.map(b => {
    let raw = 0
    for (const f of factors) {
      const fKey = f.id ?? `temp_${f.display_order}`
      const assignedOrder = assignments[fKey]?.[b.id] ?? 1
      const maxOrder = Math.max(...f.levels.map(l => l.display_order))
      const levelScore = maxOrder > 1 ? (assignedOrder - 1) / (maxOrder - 1) : 0
      raw += (1 / n) * levelScore
    }
    return raw
  })
  const min = Math.min(...scores)
  const max = Math.max(...scores)
  return max - min
}

export default function Phase2Page() {
  const params = useParams()
  const projectId = params.id as string
  const router = useRouter()
  const supabase = createClient()

  const [factors, setFactors] = useState<Factor[]>([emptyFactor(1), emptyFactor(2)])
  const [benchmarks, setBenchmarks] = useState<Benchmark[]>([])
  const [assignments, setAssignments] = useState<Assignments>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    async function load() {
      const { data: benchData } = await supabase
        .from('benchmark')
        .select('id, name')
        .eq('project_id', projectId)
        .order('name')
      if (benchData) setBenchmarks(benchData)

      const { data: factorData } = await supabase
        .from('attribute')
        .select('id, name, description, display_order')
        .eq('project_id', projectId)
        .order('display_order')

      if (factorData && factorData.length > 0) {
        const factorsWithLevels: Factor[] = []
        for (const f of factorData) {
          const { data: levelData } = await supabase
            .from('level')
            .select('id, name, description, display_order')
            .eq('attribute_id', f.id)
            .order('display_order')
          factorsWithLevels.push({
  ...f,
  description: f.description ?? '',
  levels: (levelData ?? []).map(l => ({
    ...l,
    description: l.description ?? '',
  }))
})







        }
        setFactors(factorsWithLevels)

        const { data: assignData } = await supabase
          .from('benchmark_level_assignment')
          .select('benchmark_id, attribute_id, level_id, level(display_order)')
          .in('attribute_id', factorData.map(f => f.id))

        if (assignData) {
          const newAssignments: Assignments = {}
          for (const a of assignData) {
            const fKey = a.attribute_id
            if (!newAssignments[fKey]) newAssignments[fKey] = {}
            newAssignments[fKey][a.benchmark_id] = (a.level as any).display_order
          }
          setAssignments(newAssignments)
        }
      }

      setLoaded(true)
    }
    load()
  }, [projectId])

  function addFactor() {
    if (factors.length >= MAX_FACTORS) return
    setFactors([...factors, emptyFactor(factors.length + 1)])
  }

  function removeFactor(index: number) {
    if (factors.length <= MIN_FACTORS) return
    setFactors(factors.filter((_, i) => i !== index)
      .map((f, i) => ({ ...f, display_order: i + 1 })))
  }

  function updateFactor(index: number, field: 'name' | 'description', value: string) {
    setFactors(factors.map((f, i) => i === index ? { ...f, [field]: value } : f))
  }

  function addLevel(factorIndex: number) {
    const factor = factors[factorIndex]
    if (factor.levels.length >= MAX_LEVELS) return
    const newLevel: Level = { name: '', description: '', display_order: factor.levels.length + 1 }
    setFactors(factors.map((f, i) =>
      i === factorIndex ? { ...f, levels: [...f.levels, newLevel] } : f
    ))
  }

  function removeLevel(factorIndex: number, levelIndex: number) {
    const factor = factors[factorIndex]
    if (factor.levels.length <= MIN_LEVELS) return
    const newLevels = factor.levels
      .filter((_, i) => i !== levelIndex)
      .map((l, i) => ({ ...l, display_order: i + 1 }))
    setFactors(factors.map((f, i) =>
      i === factorIndex ? { ...f, levels: newLevels } : f
    ))
  }

  function updateLevel(factorIndex: number, levelIndex: number, field: 'name' | 'description', value: string) {
    setFactors(factors.map((f, i) =>
      i === factorIndex
        ? { ...f, levels: f.levels.map((l, j) => j === levelIndex ? { ...l, [field]: value } : l) }
        : f
    ))
  }

  function setAssignment(factorKey: string, benchmarkId: string, levelOrder: number) {
    setAssignments(prev => ({
      ...prev,
      [factorKey]: { ...(prev[factorKey] ?? {}), [benchmarkId]: levelOrder },
    }))
  }

  function validate(): string | null {
    if (factors.length < MIN_FACTORS) return `At least ${MIN_FACTORS} factors are required`
    for (const f of factors) {
      if (!f.name.trim()) return 'All factors must have a name'
      if (f.levels.length < MIN_LEVELS) return `Factor "${f.name}" needs at least ${MIN_LEVELS} performance levels`
      for (const l of f.levels) {
        if (!l.name.trim()) return `All performance levels must have a name (factor: "${f.name}")`
      }
    }
    if (benchmarks.length > 0) {
      for (const f of factors) {
        const fKey = f.id ?? `temp_${f.display_order}`
        for (const b of benchmarks) {
          if (!assignments[fKey]?.[b.id]) {
            return `Please assign a performance level for "${b.name}" on factor "${f.name}"`
          }
        }
      }
    }
    return null
  }

  async function handleSave() {
    const validationError = validate()
    if (validationError) { setError(validationError); return }

    setSaving(true)
    setError('')

    try {
      const savedFactorIds: Record<number, string> = {}

      for (const factor of factors) {
        let factorId = factor.id

        if (factorId) {
          await supabase.from('attribute').update({
            name: factor.name.trim(),
            description: factor.description || null,
            display_order: factor.display_order,
          }).eq('id', factorId)
        } else {
          const { data, error: err } = await supabase.from('attribute').insert({
            project_id: projectId,
            name: factor.name.trim(),
            description: factor.description || null,
            display_order: factor.display_order,
          }).select('id').single()
          if (err) throw err
          factorId = data.id
        }

        savedFactorIds[factor.display_order] = factorId!

        for (const level of factor.levels) {
          if (level.id) {
            await supabase.from('level').update({
              name: level.name.trim(),
              description: level.description || null,
              display_order: level.display_order,
            }).eq('id', level.id)
          } else {
            await supabase.from('level').insert({
              attribute_id: factorId,
              name: level.name.trim(),
              description: level.description || null,
              display_order: level.display_order,
            })
          }
        }
      }

      if (benchmarks.length > 0) {
        for (const factor of factors) {
          const factorId = factor.id ?? savedFactorIds[factor.display_order]
          const fKey = factor.id ?? `temp_${factor.display_order}`

          const { data: levelData } = await supabase
            .from('level')
            .select('id, display_order')
            .eq('attribute_id', factorId)

          if (!levelData) continue

          for (const benchmark of benchmarks) {
            const assignedOrder = assignments[fKey]?.[benchmark.id]
            if (!assignedOrder) continue

            const level = levelData.find(l => l.display_order === assignedOrder)
            if (!level) continue

            await supabase.from('benchmark_level_assignment').upsert({
              benchmark_id: benchmark.id,
              attribute_id: factorId,
              level_id: level.id,
            }, { onConflict: 'benchmark_id,attribute_id' })
          }
        }
      }

      await supabase.from('project')
        .update({ status: 'FRAMEWORK_COMPLETE' })
        .eq('id', projectId)

      router.push(`/dashboard/projects/${projectId}/phase-3`)

    } catch (err: any) {
      setError(err.message ?? 'An error occurred while saving')
    } finally {
      setSaving(false)
    }
  }

  if (!loaded) return <div className="text-gray-400 text-sm">Loading...</div>

  const questionCount = surveyQuestionCount(factors)
  const coverage = coverageScore(factors, benchmarks, assignments)
  const allAssigned = benchmarks.length > 0 && factors.every(f => {
    const fKey = f.id ?? `temp_${f.display_order}`
    return benchmarks.every(b => assignments[fKey]?.[b.id])
  })

  return (
    <div className="w-full">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Factor Framework</h1>
        <p className="text-gray-500 mt-1 text-sm">
          Define the factors that drive purchase decisions, their performance levels, and assign each reference product to a level.
        </p>
      </div>

      <div className="space-y-8">

        {/* Survey scale indicator */}
        <div className={`rounded-lg px-4 py-3 text-sm flex items-center justify-between ${
          questionCount > 200
            ? 'bg-amber-50 border border-amber-200 text-amber-800'
            : questionCount > 100
            ? 'bg-blue-50 border border-blue-200 text-blue-700'
            : 'bg-green-50 border border-green-200 text-green-700'
        }`}>
          <span>
            Estimated survey length: <strong>{questionCount} questions</strong>
            {' '}({factors.length} factors, {factors.reduce((s, f) => s + f.levels.length, 0)} total levels)
          </span>
          {questionCount > 200 && (
            <span className="font-medium">⚠ Consider reducing factors or levels</span>
          )}
        </div>

        {/* Factors */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-base font-semibold text-gray-900">Factors</h2>
              <p className="text-xs text-gray-500 mt-0.5">
                Define the purchase-decision dimensions. Recommended: 6–12 factors.
              </p>
            </div>
            {factors.length < MAX_FACTORS && (
              <button onClick={addFactor} className="text-sm text-blue-600 hover:text-blue-700 font-medium">
                + Add factor
              </button>
            )}
          </div>

          <div className="space-y-4">
            {factors.map((factor, fi) => (
              <div key={fi} className="bg-white rounded-lg shadow p-5">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex-1 grid grid-cols-2 gap-3 mr-4">
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">
                        Factor {fi + 1} name
                      </label>
                      <input
                        type="text"
                        value={factor.name}
                        onChange={e => updateFactor(fi, 'name', e.target.value)}
                        placeholder="e.g. Integration Capability"
                        className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">
                        Description <span className="text-gray-400 font-normal">(optional)</span>
                      </label>
                      <input
                        type="text"
                        value={factor.description}
                        onChange={e => updateFactor(fi, 'description', e.target.value)}
                        placeholder="Brief definition for survey respondents"
                        className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                      />
                    </div>
                  </div>
                  {factors.length > MIN_FACTORS && (
                    <button
                      onClick={() => removeFactor(fi)}
                      className="text-xs text-red-400 hover:text-red-600 mt-6"
                    >
                      Remove
                    </button>
                  )}
                </div>

                {/* Performance levels */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium text-gray-600 uppercase tracking-wide">
                      Performance Levels
                    </span>
                    {factor.levels.length < MAX_LEVELS && (
                      <button
                        onClick={() => addLevel(fi)}
                        className="text-xs text-blue-600 hover:text-blue-700"
                      >
                        + Add level
                      </button>
                    )}
                  </div>

                  <div className="space-y-2">
                    {factor.levels.map((level, li) => (
                      <div key={li} className="flex items-center gap-2">
                        <input
                          type="text"
                          value={level.name}
                          onChange={e => updateLevel(fi, li, 'name', e.target.value)}
                          placeholder={`Level ${li + 1} name`}
                          className="flex-1 px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                        />
                        <input
                          type="text"
                          value={level.description}
                          onChange={e => updateLevel(fi, li, 'description', e.target.value)}
                          placeholder="Description (optional)"
                          className="flex-1 px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                        />
                        {factor.levels.length > MIN_LEVELS && (
                          <button
                            onClick={() => removeLevel(fi, li)}
                            className="text-gray-300 hover:text-red-400 text-lg leading-none flex-shrink-0"
                          >
                            ×
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Bottom add factor button */}
          {factors.length < MAX_FACTORS && (
            <div className="flex justify-center mt-4">
              <button
                onClick={addFactor}
                className="px-4 py-2 border border-dashed border-blue-300 text-sm text-blue-600 hover:border-blue-500 hover:bg-blue-50 rounded-md font-medium"
              >
                + Add another factor
              </button>
            </div>
          )}
        </section>

        {/* Benchmark level assignments */}
        {benchmarks.length > 0 && factors.some(f => f.name.trim()) && (
          <section className="bg-white rounded-lg shadow p-6">
            <div className="mb-4">
              <h2 className="text-base font-semibold text-gray-900">Reference Product Assignments</h2>
              <p className="text-xs text-gray-500 mt-0.5">
                Assign each reference product to the appropriate performance level for each factor.
              </p>
            </div>

            <div className="overflow-x-auto relative">
              <table className="w-full text-sm border-separate border-spacing-0">
                <thead>
                  <tr>
                    <th className="text-left text-xs font-medium text-gray-500 pb-3 pr-6 w-44 sticky left-0 bg-white z-10 border-b border-gray-100">
                      Reference Product
                    </th>
                    {factors.filter(f => f.name.trim()).map((factor, fi) => (
                      <th key={fi} className="text-left text-xs font-medium text-gray-500 pb-3 px-2 min-w-40 border-b border-gray-100">
                        {factor.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {benchmarks.map((benchmark, bi) => (
                    <tr key={benchmark.id} className={bi % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                      <td className={`py-2 pr-6 text-sm text-gray-900 font-medium sticky left-0 z-10 ${bi % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}>
                        {benchmark.name}
                      </td>
                      {factors.filter(f => f.name.trim()).map((factor, fi) => {
                        const fKey = factor.id ?? `temp_${factor.display_order}`
                        const currentOrder = assignments[fKey]?.[benchmark.id] ?? ''
                        return (
                          <td key={fi} className="py-2 px-2">
                            <select
                              value={currentOrder}
                              onChange={e => setAssignment(fKey, benchmark.id, Number(e.target.value))}
                              className={`w-full px-2 py-1.5 border rounded-md text-xs focus:outline-none focus:ring-blue-500 focus:border-blue-500 ${
                                !currentOrder ? 'border-amber-300 bg-amber-50' : 'border-gray-300'
                              }`}
                            >
                              <option value="">— assign —</option>
                              {factor.levels.map((level, li) => (
                                <option key={li} value={level.display_order}>
                                  {level.name || `Level ${level.display_order}`}
                                </option>
                              ))}
                            </select>
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Coverage diagnostic */}
            {allAssigned && coverage !== null && (
              <div className={`mt-4 rounded-md px-4 py-3 text-sm ${
                coverage >= 0.5
                  ? 'bg-green-50 border border-green-200 text-green-800'
                  : coverage >= 0.3
                  ? 'bg-amber-50 border border-amber-200 text-amber-800'
                  : 'bg-red-50 border border-red-200 text-red-800'
              }`}>
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-medium">Value scale coverage: </span>
                    <span>{(coverage * 100).toFixed(0)}% spread</span>
                    <span className="text-xs ml-2 opacity-75">(equal-weight estimate)</span>
                  </div>
                  <span>
                    {coverage >= 0.5 ? '✓ Good coverage' :
                     coverage >= 0.3 ? '⚠ Moderate coverage' :
                     '⚠ Poor coverage — consider adding products at higher or lower performance levels'}
                  </span>
                </div>
              </div>
            )}
          </section>
        )}

        {/* Error + Save */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-md px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="flex justify-between pb-8">
          <button
            onClick={() => router.push(`/dashboard/projects/${projectId}/phase-1`)}
            className="px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 hover:bg-gray-50"
          >
            ← Back to Scope
          </button>
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