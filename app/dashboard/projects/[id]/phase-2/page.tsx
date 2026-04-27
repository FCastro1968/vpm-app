'use client'

import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter, useParams } from 'next/navigation'
import { HelpTip } from '@/app/components/HelpTip'
import { StaleWarningModal } from '@/app/components/StaleWarningModal'

const STATUS_ORDER = ['DRAFT','SCOPE_COMPLETE','FRAMEWORK_COMPLETE','SURVEY_OPEN','SURVEY_CLOSED','UTILITIES_DERIVED','MODEL_RUN','COMPLETE']
function statusIndex(s: string) { return STATUS_ORDER.indexOf(s) }

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
  is_ordinal: boolean
  levels: Level[]
  aiSuggested?: boolean
  accepted?: boolean
  suggestingLevels?: boolean
}

interface Benchmark {
  id: string
  name: string
}

interface TargetProduct {
  id: string
  name: string
  use_case_type: string
}

type Assignments = Record<string, Record<string, number>>

const MIN_FACTORS = 2
const MAX_FACTORS = 20
const MIN_LEVELS = 2
const MAX_LEVELS = 6

function emptyFactor(display_order: number): Factor {
  return {
    name: '',
    description: '',
    display_order,
    is_ordinal: true,
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

function coverageScore(
  factors: Factor[],
  benchmarks: Benchmark[],
  assignments: Assignments
): number | null {
  const ordinalFactors = factors.filter(f => f.is_ordinal)
  if (ordinalFactors.length === 0 || benchmarks.length < 2) return null
  const n = ordinalFactors.length
  const scores = benchmarks.map(b => {
    let raw = 0
    for (const f of ordinalFactors) {
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

  const [factors,           setFactors]           = useState<Factor[]>([emptyFactor(1), emptyFactor(2)])
  const [frameworkDirty,    setFrameworkDirty]    = useState(false)
  const [benchmarks,        setBenchmarks]         = useState<Benchmark[]>([])
  const [assignments,       setAssignments]        = useState<Assignments>({})
  const [targetProducts,    setTargetProducts]     = useState<TargetProduct[]>([])
  const [targetAssignments, setTargetAssignments]  = useState<Assignments>({})
  const [saving,            setSaving]             = useState(false)
  const savingRef = useRef(false)
  const [error,             setError]              = useState('')
  const [loaded,            setLoaded]             = useState(false)
  const [categoryAnchor,    setCategoryAnchor]      = useState('')
  const [suggestingFactors,     setSuggestingFactors]     = useState(false)
  const [suggestingAssignments, setSuggestingAssignments] = useState(false)
  const [aiError,               setAiError]               = useState('')
  const [unrecognizedProducts,  setUnrecognizedProducts]  = useState<string[]>([])
  const [projectStatus,         setProjectStatus]         = useState('DRAFT')
  const [staleModal,            setStaleModal]            = useState<'structural' | 'assignment' | null>(null)
  const pendingSaveNavigate = useRef<boolean>(true)
  // Snapshots for stale detection — populated after load
  const loadedAssignSnap = useRef<Assignments>({})
  const loadedTargetAssignSnap = useRef<Assignments>({})

  useEffect(() => {
    async function load() {
      // Load project fields including status
      const { data: projectData } = await supabase
        .from('project')
        .select('category_anchor, status')
        .eq('id', projectId)
        .single()
      if (projectData?.category_anchor) setCategoryAnchor(projectData.category_anchor)
      if (projectData?.status) setProjectStatus(projectData.status)

      // Load benchmarks
      const { data: benchData } = await supabase
        .from('benchmark')
        .select('id, name')
        .eq('project_id', projectId)
        .order('name')
      if (benchData) setBenchmarks(benchData)

      // Load target products
      const { data: targetData } = await supabase
        .from('target_product')
        .select('id, name, use_case_type')
        .eq('project_id', projectId)
        .order('display_order')
      if (targetData) setTargetProducts(targetData)

      // Load factors + levels
      const { data: factorData } = await supabase
        .from('attribute')
        .select('id, name, description, display_order, is_ordinal')
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
            is_ordinal: f.is_ordinal ?? true,
            levels: (levelData ?? []).map(l => ({
              ...l,
              description: l.description ?? '',
            })),
          })
        }
        setFactors(factorsWithLevels)

        // Load benchmark assignments
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
          loadedAssignSnap.current = JSON.parse(JSON.stringify(newAssignments))
        }

        // Load target assignments from target_score.level_assignments_json
        if (targetData && targetData.length > 0) {
          const { data: targetScoreData } = await supabase
            .from('target_score')
            .select('target_product_id, level_assignments_json')
            .eq('project_id', projectId)
            .is('scenario_id', null)

          if (targetScoreData && targetScoreData.length > 0) {
            const newTargetAssignments: Assignments = {}
            for (const ts of targetScoreData) {
              const json = ts.level_assignments_json as Record<string, string> | null
              if (!json) continue
              // json is { attribute_id: level_id }
              // We need to convert level_id -> display_order for the UI
              const fKeyToOrder: Record<string, number> = {}
              for (const [attrId, levelId] of Object.entries(json)) {
                const factor = factorsWithLevels.find(f => f.id === attrId)
                const level = factor?.levels.find(l => l.id === levelId)
                if (level) fKeyToOrder[attrId] = level.display_order
              }
              newTargetAssignments[ts.target_product_id] = fKeyToOrder
            }
            setTargetAssignments(newTargetAssignments)
            loadedTargetAssignSnap.current = JSON.parse(JSON.stringify(newTargetAssignments))
          }
        }
      }

      setLoaded(true)
    }
    load()
  }, [projectId])

  function addFactor() {
    if (factors.length >= MAX_FACTORS) return
    setFrameworkDirty(true)
    setFactors([...factors, emptyFactor(factors.length + 1)])
  }

  function removeFactor(index: number) {
    if (factors.length <= MIN_FACTORS) return
    setFrameworkDirty(true)
    setFactors(
      factors
        .filter((_, i) => i !== index)
        .map((f, i) => ({ ...f, display_order: i + 1 }))
    )
  }

  function updateFactor(index: number, field: 'name' | 'description' | 'is_ordinal', value: string | boolean) {
    setFrameworkDirty(true)
    setFactors(factors.map((f, i) => {
      if (i !== index) return f
      const updated = { ...f, [field]: value }
      // Brand is always nominal — auto-set when name is typed
      if (field === 'name' && typeof value === 'string' && value.trim().toLowerCase() === 'brand') {
        updated.is_ordinal = false
      }
      return updated
    }))
  }

  function addLevel(factorIndex: number) {
    const factor = factors[factorIndex]
    if (factor.levels.length >= MAX_LEVELS) return
    setFrameworkDirty(true)
    const newLevel: Level = {
      name: '',
      description: '',
      display_order: factor.levels.length + 1,
    }
    setFactors(
      factors.map((f, i) =>
        i === factorIndex ? { ...f, levels: [...f.levels, newLevel] } : f
      )
    )
  }

  function removeLevel(factorIndex: number, levelIndex: number) {
    const factor = factors[factorIndex]
    if (factor.levels.length <= MIN_LEVELS) return
    setFrameworkDirty(true)

    const removedOrder = factor.levels[levelIndex].display_order
    const newLevels = factor.levels
      .filter((_, i) => i !== levelIndex)
      .map((l, i) => ({ ...l, display_order: i + 1 }))

    setFactors(
      factors.map((f, i) => (i === factorIndex ? { ...f, levels: newLevels } : f))
    )

    const fKey = factor.id ?? `temp_${factor.display_order}`

    // Benchmark assignments: { [fKey]: { [benchId]: order } }
    setAssignments(prev => {
      const factorAssignments = prev[fKey] ?? {}
      const updated: Record<string, number> = {}
      for (const [benchId, order] of Object.entries(factorAssignments)) {
        if (order === removedOrder) continue
        updated[benchId] = order > removedOrder ? order - 1 : order
      }
      return { ...prev, [fKey]: updated }
    })

    // Target assignments: { [targetId]: { [fKey]: order } }
    setTargetAssignments(prev => {
      const next = { ...prev }
      for (const targetId of Object.keys(next)) {
        const order = next[targetId][fKey]
        if (order === undefined) continue
        if (order === removedOrder) {
          const { [fKey]: _, ...rest } = next[targetId]
          next[targetId] = rest
        } else if (order > removedOrder) {
          next[targetId] = { ...next[targetId], [fKey]: order - 1 }
        }
      }
      return next
    })
  }

  function updateLevel(
    factorIndex: number,
    levelIndex: number,
    field: 'name' | 'description',
    value: string
  ) {
    setFrameworkDirty(true)
    setFactors(
      factors.map((f, i) =>
        i === factorIndex
          ? {
              ...f,
              levels: f.levels.map((l, j) =>
                j === levelIndex ? { ...l, [field]: value } : l
              ),
            }
          : f
      )
    )
  }

  function setAssignment(factorKey: string, benchmarkId: string, levelOrder: number) {
    setAssignments(prev => ({
      ...prev,
      [factorKey]: { ...(prev[factorKey] ?? {}), [benchmarkId]: levelOrder },
    }))
  }

  function setTargetAssignment(targetId: string, factorKey: string, levelOrder: number) {
    setTargetAssignments(prev => ({
      ...prev,
      [targetId]: { ...(prev[targetId] ?? {}), [factorKey]: levelOrder },
    }))
  }

  // ── AI helpers ───────────────────────────────────────────────────────────

  async function callAI(task: string, payload: object) {
    const res = await fetch('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task, payload }),
    })
    if (!res.ok) throw new Error(`AI request failed: ${res.status}`)
    return res.json()
  }

  async function handleSuggestFactors() {
    if (!categoryAnchor.trim()) { setAiError('No Category Anchor found. Please complete Phase 1 first.'); return }
    setSuggestingFactors(true)
    setAiError('')
    try {
      const { factors: suggestions } = await callAI('suggest_factors', {
        category_anchor: categoryAnchor,
        benchmark_names: benchmarks.map(b => b.name),
      })
      const existingFactors = factors.filter(f => f.name.trim() && (!f.aiSuggested || f.accepted))
      const newSuggestions: Factor[] = suggestions.map((s: any, i: number) => ({
        name: s.name,
        description: s.description ?? '',
        display_order: existingFactors.length + i + 1,
        is_ordinal: s.classification !== 'NOMINAL',
        levels: [
          { name: '', description: '', display_order: 1 },
          { name: '', description: '', display_order: 2 },
        ],
        aiSuggested: true,
        accepted: false,
      }))
      setFrameworkDirty(true)
      setFactors([...existingFactors, ...newSuggestions])
    } catch (err: any) {
      setAiError(err.message ?? 'Failed to suggest factors')
    } finally {
      setSuggestingFactors(false)
    }
  }

  async function handleSuggestLevels(factorIndex: number) {
    const factor = factors[factorIndex]
    if (!factor.name.trim()) return
    setFactors(prev => prev.map((f, i) => i === factorIndex ? { ...f, suggestingLevels: true } : f))
    try {
      const { levels: suggestions } = await callAI('suggest_levels', {
        factor_name: factor.name,
        factor_description: factor.description,
        classification: factor.is_ordinal ? 'ORDINAL' : 'NOMINAL',
        category_anchor: categoryAnchor,
        benchmark_names: benchmarks.map(b => b.name),
      })
      const newLevels = suggestions.map((s: any, i: number) => ({
        name: s.name,
        description: s.description ?? '',
        display_order: i + 1,
      }))
      setFactors(prev => prev.map((f, i) => i === factorIndex
        ? { ...f, suggestingLevels: false, levels: newLevels }
        : f
      ))
    } catch {
      setFactors(prev => prev.map((f, i) => i === factorIndex ? { ...f, suggestingLevels: false } : f))
    }
  }

  function acceptFactor(index: number) {
    setFrameworkDirty(true)
    setFactors(prev => prev.map((f, i) => i === index ? { ...f, accepted: true } : f))
  }

  function dismissFactor(index: number) {
    setFactors(prev => prev.filter((_, i) => i !== index)
      .map((f, i) => ({ ...f, display_order: i + 1 })))
  }

  function swapLevelNamesDescriptions(factorIndex: number) {
    setFactors(prev => prev.map((f, i) => {
      if (i !== factorIndex) return f
      return {
        ...f,
        levels: f.levels.map(l => ({
          ...l,
          name: l.description || l.name,
          description: l.name,
        }))
      }
    }))
  }

  async function handleSuggestAssignments() {
    const activeFactors = factors.filter(f => !f.aiSuggested || f.accepted)
    if (activeFactors.length === 0) { setAiError('Accept some factors first before auto-assigning.'); return }
    if (benchmarks.length === 0) { setAiError('No reference products found.'); return }

    setSuggestingAssignments(true)
    setAiError('')
    setUnrecognizedProducts([])
    try {
      const { assignments: results } = await callAI('suggest_assignments', {
        benchmark_names: benchmarks.map(b => b.name),
        factors: activeFactors.map(f => ({
          name: f.name,
          description: f.description,
          levels: f.levels.map(l => ({ name: l.name, description: l.description })),
        })),
        category_anchor: categoryAnchor,
      })

      // results is array of { product, assignments: { "factorIdx": levelIdx }, confidence, recognized }
      // Skip assignments for unrecognized or LOW confidence products — surface them as a warning
      const newAssignments: Assignments = { ...assignments }
      const unrecognized: string[] = []

      for (const result of results) {
        const benchIdx = benchmarks.findIndex(b =>
          b.name.toLowerCase().includes(result.product.toLowerCase()) ||
          result.product.toLowerCase().includes(b.name.toLowerCase())
        )
        if (benchIdx === -1) continue
        const bench = benchmarks[benchIdx]

        // Skip if AI flagged as unrecognized or LOW confidence
        if (result.recognized === false || result.confidence === 'LOW') {
          unrecognized.push(bench.name)
          continue
        }

        for (const [factorIdxStr, levelIdx] of Object.entries(result.assignments)) {
          const factorIdx = parseInt(factorIdxStr)
          const factor = activeFactors[factorIdx]
          if (!factor) continue
          const fKey = factor.id ?? `temp_${factor.display_order}`
          const level = factor.levels[levelIdx as number]
          if (!level) continue
          if (!newAssignments[fKey]) newAssignments[fKey] = {}
          newAssignments[fKey][bench.id] = level.display_order
        }
      }

      setAssignments(newAssignments)
      if (unrecognized.length > 0) setUnrecognizedProducts(unrecognized)
    } catch (err: any) {
      setAiError(err.message ?? 'Failed to suggest assignments')
    } finally {
      setSuggestingAssignments(false)
    }
  }

  function validate(): string | null {
    const activeFactors = factors.filter(f => !f.aiSuggested || f.accepted)
    if (activeFactors.length < MIN_FACTORS) return `At least ${MIN_FACTORS} factors are required`
    for (const f of activeFactors) {
      if (!f.name.trim()) return 'All factors must have a name'
      if (f.levels.length < MIN_LEVELS)
        return `Factor "${f.name}" needs at least ${MIN_LEVELS} performance levels`
      for (const l of f.levels) {
        if (!l.name.trim())
          return `All performance levels must have a name (factor: "${f.name}")`
      }
    }
    if (benchmarks.length > 0) {
      for (const f of activeFactors) {
        const fKey = f.id ?? `temp_${f.display_order}`
        for (const b of benchmarks) {
          if (!assignments[fKey]?.[b.id]) {
            return `Please assign a performance level for "${b.name}" on factor "${f.name}"`
          }
        }
      }
    }
    if (targetProducts.length > 0) {
      for (const t of targetProducts) {
        for (const f of activeFactors) {
          const fKey = f.id ?? `temp_${f.display_order}`
          if (!targetAssignments[t.id]?.[fKey]) {
            return `Please assign a performance level for target product "${t.name}" on factor "${f.name}"`
          }
        }
      }
    }
    return null
  }

  function assignmentsChanged(): boolean {
    return (
      JSON.stringify(assignments) !== JSON.stringify(loadedAssignSnap.current) ||
      JSON.stringify(targetAssignments) !== JSON.stringify(loadedTargetAssignSnap.current)
    )
  }

  function checkAndSave(navigate: boolean) {
    if (navigate) {
      const validationError = validate()
      if (validationError) { setError(validationError); return }
    }
    setError('')
    const curIdx = statusIndex(projectStatus)
    if (frameworkDirty && curIdx >= statusIndex('SURVEY_OPEN')) {
      pendingSaveNavigate.current = navigate
      setStaleModal('structural')
    } else if (!frameworkDirty && assignmentsChanged() && curIdx >= statusIndex('MODEL_RUN')) {
      pendingSaveNavigate.current = navigate
      setStaleModal('assignment')
    } else {
      handleSave(navigate)
    }
  }

  async function handleStaleConfirm() {
    const kind = staleModal
    setStaleModal(null)
    const navigate = pendingSaveNavigate.current

    if (kind === 'structural') {
      // Clear Phase 3+ data before the save runs (frameworkDirty path will handle attribute/level deletion)
      const { data: respondentRows } = await supabase
        .from('respondent').select('id').eq('project_id', projectId)
      const rIds = respondentRows?.map(r => r.id) ?? []
      if (rIds.length > 0) {
        await supabase.from('pairwise_response').delete().in('respondent_id', rIds)
      }
      await supabase.from('aggregated_matrix').delete().eq('project_id', projectId)
      await supabase.from('attribute_weight').delete().eq('project_id', projectId)
      await supabase.from('level_utility').delete().eq('project_id', projectId)
      await supabase.from('regression_result').delete().eq('project_id', projectId).is('scenario_id', null)
      await supabase.from('target_score')
        .update({ normalized_score: null, point_estimate: null, uncertainty_range_low: null, uncertainty_range_high: null })
        .eq('project_id', projectId).is('scenario_id', null)
    } else if (kind === 'assignment') {
      // Clear solver outputs only
      await supabase.from('regression_result').delete().eq('project_id', projectId).is('scenario_id', null)
      await supabase.from('target_score')
        .update({ normalized_score: null, point_estimate: null, uncertainty_range_low: null, uncertainty_range_high: null })
        .eq('project_id', projectId).is('scenario_id', null)
    }
    handleSave(navigate, kind === 'structural' ? 'FRAMEWORK_COMPLETE' : 'UTILITIES_DERIVED')
  }

  async function handleSave(navigate = true, forceStatusDowngrade?: 'FRAMEWORK_COMPLETE' | 'UTILITIES_DERIVED') {
    if (savingRef.current) return
    savingRef.current = true
    setSaving(true)
    setError('')

    try {
      // Only delete and reinsert factors/levels if the framework was modified
      // Skipping this preserves level IDs and all downstream data (responses, utilities)
      const newFactorIdByOldKey: Record<string, string> = {}
      const savedFactorIds: Record<number, string> = {}

      if (frameworkDirty) {
      // Delete all attributes for this project directly.
      // Levels and benchmark_level_assignments cascade via FK ON DELETE CASCADE.
      await supabase
        .from('attribute')
        .delete()
        .eq('project_id', projectId)

      for (const factor of factors) {
        const oldKey = factor.id ?? `temp_${factor.display_order}`

        const { data, error: err } = await supabase
          .from('attribute')
          .insert({
            project_id: projectId,
            name: factor.name.trim(),
            description: factor.description || null,
            display_order: factor.display_order,
            is_ordinal: factor.is_ordinal,
          })
          .select('id')
          .single()
        if (err) throw err

        const factorId: string = data.id
        newFactorIdByOldKey[oldKey] = factorId
        savedFactorIds[factor.display_order] = factorId

        for (const level of factor.levels) {
          const { error: levelErr } = await supabase.from('level').insert({
            attribute_id: factorId,
            name: level.name.trim(),
            description: level.description || null,
            display_order: level.display_order,
          })
          if (levelErr) throw levelErr
        }
      }

      // Re-save benchmark level assignments
      if (benchmarks.length > 0) {
        for (const factor of factors) {
          const oldKey = factor.id ?? `temp_${factor.display_order}`
          const factorId = newFactorIdByOldKey[oldKey]
          if (!factorId) continue

          const { data: levelData } = await supabase
            .from('level')
            .select('id, display_order')
            .eq('attribute_id', factorId)
          if (!levelData) continue

          for (const benchmark of benchmarks) {
            const assignedOrder = assignments[oldKey]?.[benchmark.id]
            if (!assignedOrder) continue
            const level = levelData.find(l => l.display_order === assignedOrder)
            if (!level) continue
            await supabase.from('benchmark_level_assignment').insert({
              benchmark_id: benchmark.id,
              attribute_id: factorId,
              level_id: level.id,
            })
          }
        }
      }
      } else {
        // Framework unchanged — populate ID maps from existing DB records
        for (const factor of factors) {
          if (!factor.id) continue
          const oldKey = factor.id
          newFactorIdByOldKey[oldKey] = factor.id
          savedFactorIds[factor.display_order] = factor.id
        }

        // Re-save benchmark level assignments even when framework is unchanged
        // (handles manual edits after AI auto-assign was skipped)
        if (benchmarks.length > 0) {
          for (const factor of factors) {
            if (!factor.id) continue
            const fKey = factor.id

            const { data: levelData } = await supabase
              .from('level')
              .select('id, display_order')
              .eq('attribute_id', fKey)
            if (!levelData) continue

            // Delete existing assignments for this factor's benchmarks, then reinsert
            await supabase
              .from('benchmark_level_assignment')
              .delete()
              .eq('attribute_id', fKey)
              .in('benchmark_id', benchmarks.map(b => b.id))

            for (const benchmark of benchmarks) {
              const assignedOrder = assignments[fKey]?.[benchmark.id]
              if (!assignedOrder) continue
              const level = levelData.find(l => l.display_order === assignedOrder)
              if (!level) continue
              await supabase.from('benchmark_level_assignment').insert({
                benchmark_id: benchmark.id,
                attribute_id: fKey,
                level_id: level.id,
              })
            }
          }
        }
      }

      // Save target product level assignments to target_score
      if (targetProducts.length > 0) {
        for (const target of targetProducts) {
          // Build level_assignments_json: { new_attribute_id: level_id }
          const levelAssignmentsJson: Record<string, string> = {}

          for (const factor of factors) {
            const oldKey = factor.id ?? `temp_${factor.display_order}`
            const newFactorId = newFactorIdByOldKey[oldKey]
            if (!newFactorId) continue

            const assignedOrder = targetAssignments[target.id]?.[oldKey]
            if (!assignedOrder) continue

            const { data: levelData } = await supabase
              .from('level')
              .select('id, display_order')
              .eq('attribute_id', newFactorId)
            if (!levelData) continue

            const level = levelData.find(l => l.display_order === assignedOrder)
            if (!level) continue

            levelAssignmentsJson[newFactorId] = level.id
          }

          // Delete existing base-run target_score then reinsert
          await supabase
            .from('target_score')
            .delete()
            .eq('target_product_id', target.id)
            .eq('project_id', projectId)
            .is('scenario_id', null)

          await supabase.from('target_score').insert({
            target_product_id:      target.id,
            project_id:             projectId,
            scenario_id:            null,
            level_assignments_json: levelAssignmentsJson,
          })
        }
      }

      // If stale clearing was triggered, use the explicit downgrade status.
      // Otherwise only advance to FRAMEWORK_COMPLETE, never downgrade.
      const newStatus = forceStatusDowngrade
        ?? (statusIndex(projectStatus) > statusIndex('FRAMEWORK_COMPLETE') ? projectStatus : 'FRAMEWORK_COMPLETE')
      await supabase
        .from('project')
        .update({ status: newStatus })
        .eq('id', projectId)

      if (navigate) router.push(`/dashboard/projects/${projectId}/phase-3`)
      else router.refresh()
    } catch (err: any) {
      setError(err.message ?? 'An error occurred while saving')
    } finally {
      setSaving(false)
      savingRef.current = false
      setFrameworkDirty(false)
    }
  }

  if (!loaded) return <div className="text-gray-400 text-sm">Loading...</div>

  const activeFactors = factors.filter(f => !f.aiSuggested || f.accepted)
  const questionCount = surveyQuestionCount(activeFactors)
  const coverage = coverageScore(factors, benchmarks, assignments)
  const allAssigned =
    benchmarks.length > 0 &&
    factors.every(f => {
      const fKey = f.id ?? `temp_${f.display_order}`
      return benchmarks.every(b => assignments[fKey]?.[b.id])
    })

  const allTargetsAssigned =
    targetProducts.length > 0 &&
    targetProducts.every(t =>
      factors.every(f => {
        const fKey = f.id ?? `temp_${f.display_order}`
        return !!targetAssignments[t.id]?.[fKey]
      })
    )

  // Compute unused levels — levels used by neither benchmarks nor target products
  const usedLevelOrders: Record<string, Set<number>> = {}
  // Add benchmark assignments
  for (const [fKey, benchMap] of Object.entries(assignments)) {
    if (!usedLevelOrders[fKey]) usedLevelOrders[fKey] = new Set()
    for (const order of Object.values(benchMap)) usedLevelOrders[fKey].add(order)
  }
  // Add target product assignments
  for (const targetMap of Object.values(targetAssignments)) {
    for (const [fKey, order] of Object.entries(targetMap)) {
      if (!usedLevelOrders[fKey]) usedLevelOrders[fKey] = new Set()
      usedLevelOrders[fKey].add(order)
    }
  }
  const unusedLevels: { factorIndex: number; levelIndex: number; factorName: string; levelName: string }[] = []
  if (allAssigned) {
    for (const [fi, factor] of factors.entries()) {
      const fKey = factor.id ?? `temp_${factor.display_order}`
      const used = usedLevelOrders[fKey] ?? new Set()
      for (const [li, level] of factor.levels.entries()) {
        if (!used.has(level.display_order)) {
          unusedLevels.push({ factorIndex: fi, levelIndex: li, factorName: factor.name, levelName: level.name })
        }
      }
    }
  }

  const uniformFactors =
    allAssigned
      ? factors.filter(f => {
          const fKey = f.id ?? `temp_${f.display_order}`
          const assignedOrders = benchmarks.map(b => assignments[fKey]?.[b.id])
          return assignedOrders.every(o => o === assignedOrders[0])
        })
      : []

  // Duplicate benchmark pairs — identical assignments across all factors
  const duplicateBenchmarkPairs: [string, string][] = []
  if (allAssigned) {
    for (let i = 0; i < benchmarks.length; i++) {
      for (let j = i + 1; j < benchmarks.length; j++) {
        const bA = benchmarks[i], bB = benchmarks[j]
        const identical = factors.every(f => {
          const fKey = f.id ?? `temp_${f.display_order}`
          return assignments[fKey]?.[bA.id] === assignments[fKey]?.[bB.id]
        })
        if (identical) duplicateBenchmarkPairs.push([bA.name, bB.name])
      }
    }
  }

  return (
    <div className="w-full max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Factor Framework</h1>
        <p className="text-gray-500 mt-1 text-sm">
          Define the factors that drive purchase decisions, their performance levels, and
          assign each reference product and target product to a level.
        </p>
      </div>

      <div className="space-y-8">

        {/* Survey scale indicator */}
        <div
          className={`rounded-lg px-4 py-3 text-sm flex items-center justify-between ${
            questionCount > 200
              ? 'bg-amber-50 border border-amber-200 text-amber-800'
              : questionCount > 100
              ? 'bg-blue-50 border border-blue-200 text-blue-700'
              : 'bg-green-50 border border-green-200 text-green-700'
          }`}
        >
          <span>
            Estimated survey length: <strong>{questionCount} questions</strong>
            {' '}({activeFactors.length} factors,{' '}
            {activeFactors.reduce((s, f) => s + f.levels.length, 0)} total levels)
          </span>
          {questionCount > 200 && (
            <span className="font-medium">⚠ Consider reducing factors or levels</span>
          )}
        </div>

        {/* Factors section */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="flex items-center gap-1.5">
                <h2 className="text-base font-semibold text-gray-900">Factors</h2>
                <HelpTip content="Factors are the dimensions buyers weigh when choosing between products — things like performance, reliability, support, or brand. Each factor gets importance-weighted through the preference survey and then drives the value score for every product. Good factors are observable, meaningful to buyers, and distinct from each other. Avoid factors that overlap heavily or that buyers can't actually evaluate." width="w-96" />
              </div>
              <p className="text-xs text-gray-500 mt-0.5">
                Define the purchase-decision dimensions. Recommended: 8–12 factors.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={handleSuggestFactors}
                disabled={suggestingFactors || !categoryAnchor}
                className="px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-md hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1.5"
                title={!categoryAnchor ? 'Complete Phase 1 with a Category Anchor first' : ''}
              >
                {suggestingFactors ? (
                  <><span className="inline-block w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" /> Suggesting...</>
                ) : '✦ Suggest Factors'}
              </button>
              {factors.length < MAX_FACTORS && (
                <button onClick={addFactor} className="text-sm text-blue-600 hover:text-blue-700 font-medium">
                  + Add factor
                </button>
              )}
            </div>
          </div>
          {aiError && <div className="mb-3 text-xs text-red-600">{aiError}</div>}
          {unrecognizedProducts.length > 0 && (
            <div className="mb-3 p-2 rounded text-xs" style={{ background: '#fef9c3', border: '1px solid #fde047', color: '#854d0e' }}>
              <strong>Auto-assign skipped {unrecognizedProducts.length} product{unrecognizedProducts.length > 1 ? 's' : ''} (low confidence or unrecognized):</strong>{' '}
              {unrecognizedProducts.join(', ')}. Please assign levels for these manually.
            </div>
          )}

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
              gap: '1rem',
            }}
          >
            {factors.map((factor, fi) => {
              const isPending = factor.aiSuggested && !factor.accepted
              return (
              <div key={fi} className={`relative rounded-lg p-5 ${isPending ? 'bg-blue-50 border-2 border-blue-300' : 'bg-white border-2 border-gray-200'}`}>

                {/* Ordinal / Nominal badge — top right corner */}
                {!isPending && (
                  <div className="absolute top-3 right-3 flex items-center gap-1">
                    <HelpTip
                      content="Ordinal factors have levels that rank from low to high (e.g. Warranty: 1yr → 3yr → 5yr). Nominal factors have levels that differ in kind, not degree (e.g. Brand). Only ordinal factors count toward the coverage diagnostic."
                      position="below"
                      width="w-80"
                    />
                    <button
                      type="button"
                      onClick={() => updateFactor(fi, 'is_ordinal', !factor.is_ordinal)}
                      className={`text-xs px-2 py-0.5 rounded font-medium border ${
                        factor.is_ordinal
                          ? 'bg-blue-50 text-blue-600 border-blue-200 hover:bg-blue-100'
                          : 'bg-purple-50 text-purple-600 border-purple-200 hover:bg-purple-100'
                      }`}
                    >
                      {factor.is_ordinal ? 'Ordinal' : 'Nominal'}
                    </button>
                  </div>
                )}

                {/* AI pending action bar */}
                {isPending && (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px', paddingBottom: '12px', borderBottom: '1px solid #bfdbfe' }}>
                    <span style={{ fontSize: '12px', color: '#2563eb', fontWeight: 500 }}>✦ AI suggested</span>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button
                        onClick={() => swapLevelNamesDescriptions(fi)}
                        style={{ fontSize: '12px', padding: '4px 12px', border: '1px solid #d1d5db', borderRadius: '6px', background: 'white', color: '#6b7280', cursor: 'pointer' }}
                        title="Swap level names and descriptions — useful when descriptions are more specific than names"
                      >⇄ Swap names & descriptions</button>
                      <button
                        onClick={() => dismissFactor(fi)}
                        style={{ fontSize: '12px', padding: '4px 12px', border: '1px solid #d1d5db', borderRadius: '6px', background: 'white', color: '#6b7280', cursor: 'pointer' }}
                      >Dismiss</button>
                      <button
                        onClick={() => acceptFactor(fi)}
                        style={{ fontSize: '12px', padding: '4px 12px', border: 'none', borderRadius: '6px', background: '#16a34a', color: 'white', cursor: 'pointer', fontWeight: 600 }}
                      >✓ Accept</button>
                    </div>
                  </div>
                )}

                <div className="flex items-start justify-between mb-4">
                  <div className="flex-1 grid grid-cols-2 gap-3 mr-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1 flex items-center gap-1">
                        Factor {fi + 1} name
                        <HelpTip content="A good factor is meaningful to buyers, measurable across competing products, and independent from other factors. A typical model has 8–12 factors — enough to fully differentiate between the reference products. Avoid factors that overlap or that buyers can't observe." />
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
                        Description{' '}
                        <span className="text-gray-400 font-normal">(optional)</span>
                      </label>
                      <input
                        type="text"
                        value={factor.description}
                        onChange={e => updateFactor(fi, 'description', e.target.value)}
                        placeholder="Brief definition for respondents"
                        className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                      />
                    </div>
                  </div>
                  {!isPending && factors.length > MIN_FACTORS && (
                    <button
                      onClick={() => removeFactor(fi)}
                      className="text-xs text-red-400 hover:text-red-600 mt-6 flex-shrink-0"
                    >
                      Remove
                    </button>
                  )}
                </div>

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium text-gray-600 uppercase tracking-wide flex items-center gap-1">
                      Performance Levels
                      <HelpTip content="Order levels from lowest to highest performance. The preference survey and coverage diagnostic both assume this ordering. You need at least 2 levels; 3–5 is typical." />
                    </span>
                    <div className="flex items-center gap-2">
                      {factor.name.trim() && categoryAnchor && (
                        <button
                          onClick={() => handleSuggestLevels(fi)}
                          disabled={factor.suggestingLevels}
                          className="text-xs text-blue-600 hover:text-blue-700 disabled:opacity-50"
                        >
                          {factor.suggestingLevels ? 'Suggesting...' : '✦ Suggest levels'}
                        </button>
                      )}
                      {factor.levels.length < MAX_LEVELS && (
                        <button
                          onClick={() => addLevel(fi)}
                          className="text-xs text-blue-600 hover:text-blue-700"
                        >
                          + Add level
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="space-y-2">
                    {factor.levels.map((level, li) => {
                      const fKey = factor.id ?? `temp_${factor.display_order}`
                      const isUnused = allAssigned && !(usedLevelOrders[fKey] ?? new Set()).has(level.display_order)
                      return (
                      <div key={li} className={`flex items-center gap-2 rounded-md ${isUnused ? 'bg-amber-50 px-1.5 py-0.5 -mx-1.5' : ''}`}>
                        {isUnused && <span title="No reference product is assigned to this level" style={{ fontSize: '11px', color: '#d97706', flexShrink: 0 }}>⚠</span>}
                        <input
                          type="text"
                          value={level.name}
                          onChange={e => updateLevel(fi, li, 'name', e.target.value)}
                          placeholder={`Level ${li + 1} name`}
                          className={`flex-1 px-3 py-1.5 border rounded-md text-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 ${isUnused ? 'border-amber-300' : 'border-gray-300'}`}
                        />
                        <input
                          type="text"
                          value={level.description}
                          onChange={e => updateLevel(fi, li, 'description', e.target.value)}
                          placeholder="Description (optional)"
                          className={`flex-1 px-3 py-1.5 border rounded-md text-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 ${isUnused ? 'border-amber-300' : 'border-gray-300'}`}
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
                      )
                    })}
                  </div>
                </div>
              </div>
              )
            })}
          </div>

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

        {/* Reference product assignment matrix */}
        {benchmarks.length > 0 && factors.some(f => f.name.trim()) && (
          <section className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="flex items-center gap-1.5">
                  <h2 className="text-base font-semibold text-gray-900">Reference Product Assignments</h2>
                  <HelpTip content="For each reference product, select the performance level that best describes where it sits on each factor. These assignments determine each product's value score — the model uses them to calibrate how much each factor level is worth in dollar terms. Every product needs a level for every factor before the model can run." width="w-96" />
                </div>
                <p className="text-xs text-gray-500 mt-0.5">
                  Assign each reference product to the appropriate performance level for each factor.
                </p>
              </div>
              <button
                onClick={handleSuggestAssignments}
                disabled={suggestingAssignments}
                style={{ fontSize: '12px', padding: '6px 12px', background: '#2563eb', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 500, opacity: suggestingAssignments ? 0.5 : 1, whiteSpace: 'nowrap' }}
              >
                {suggestingAssignments ? 'Assigning...' : '✦ Auto-assign'}
              </button>
            </div>

            <div className="overflow-x-auto relative">
              <table className="w-full text-sm border-separate border-spacing-0">
                <thead>
                  <tr>
                    <th className="text-left text-xs font-medium text-gray-500 pb-3 pr-6 w-44 sticky left-0 bg-white z-10 border-b border-gray-100">
                      Reference Product
                    </th>
                    {factors.filter(f => f.name.trim()).map((factor, fi) => (
                      <th key={fi} className="text-left text-xs font-medium text-gray-500 pb-3 px-2 min-w-36 border-b border-gray-100">
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

            {/* Uniform level flags */}
            {uniformFactors.length > 0 && (
              <div className="mt-4 space-y-2">
                {uniformFactors.map(f => (
                  <div
                    key={f.id ?? f.display_order}
                    className="rounded-md px-4 py-3 text-sm bg-amber-50 border border-amber-200 text-amber-800"
                  >
                    <span className="font-medium">⚠ {f.name}: </span>
                    All reference products are assigned the same performance level. This factor cannot contribute to price discrimination in the current competitive set.
                  </div>
                ))}
              </div>
            )}

            {/* Duplicate benchmark pairs */}
            {duplicateBenchmarkPairs.length > 0 && (
              <div className="mt-4 space-y-2">
                {duplicateBenchmarkPairs.map(([a, b], i) => (
                  <div key={i} className="rounded-md px-4 py-3 text-sm bg-red-50 border border-red-200 text-red-800">
                    <span className="font-medium">⚠ {a} and {b}: </span>
                    These reference products have identical level assignments across all factors. They are informationally redundant — one contributes no additional pricing signal to the model and should be differentiated or removed.
                  </div>
                ))}
              </div>
            )}

            {/* Unused levels warning */}
            {unusedLevels.length > 0 && (
              <div className="mt-4 rounded-md px-4 py-3 text-sm bg-amber-50 border border-amber-200 text-amber-800">
                <div className="font-medium mb-1">⚠ {unusedLevels.length} unused level{unusedLevels.length > 1 ? 's' : ''} — no reference product is assigned to {unusedLevels.length > 1 ? 'these levels' : 'this level'}:</div>
                <ul className="space-y-0.5 text-xs">
                  {unusedLevels.map((u, i) => (
                    <li key={i} className="text-amber-700">
                      <span className="font-medium">{u.factorName}</span> — {u.levelName}
                    </li>
                  ))}
                </ul>
                <div className="mt-1.5 text-xs text-amber-600">Consider removing or consolidating these levels, or adding a reference product that maps to them.</div>
              </div>
            )}

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
                  <div className="flex items-center gap-1.5">
                    <span className="font-medium">Value scale coverage: </span>
                    <span>{(coverage * 100).toFixed(0)}% spread</span>
                    <span className="text-xs ml-1 opacity-75">(equal-weight estimate)</span>
                    <HelpTip
                      content="Measures how well your reference products span the full range of performance levels. Green (≥50%) means good spread. Amber (30–50%) suggests clustering. Red (<30%) means most products sit at similar performance levels — the model will struggle to differentiate value."
                      position="above"
                      width="w-80"
                    />
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

        {/* Target product assignment matrix */}
        {targetProducts.length > 0 && factors.some(f => f.name.trim()) && (
          <section className="bg-white rounded-lg shadow p-6">
            <div className="mb-4">
              <div className="flex items-center gap-1.5">
                <h2 className="text-base font-semibold text-gray-900">Target Product Assignments</h2>
                <HelpTip content="Assign each target product to the performance level it will deliver (or currently delivers) on each factor. For a new product, use the intended specification. For a repositioning exercise, use the current spec to see where you stand today, or a future spec to model a planned change. The model uses these assignments to compute the target's value score and derive a price recommendation." width="w-96" />
              </div>
              <p className="text-xs text-gray-500 mt-0.5">
                Assign each target product to the appropriate performance level for each factor. For new products, assign the intended specification.
              </p>
            </div>

            <div className="overflow-x-auto relative">
              <table className="w-full text-sm border-separate border-spacing-0">
                <thead>
                  <tr>
                    <th className="text-left text-xs font-medium text-gray-500 pb-3 pr-6 w-44 sticky left-0 bg-white z-10 border-b border-gray-100">
                      Target Product
                    </th>
                    {factors.filter(f => f.name.trim()).map((factor, fi) => (
                      <th key={fi} className="text-left text-xs font-medium text-gray-500 pb-3 px-2 min-w-36 border-b border-gray-100">
                        {factor.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {targetProducts.map((target, ti) => (
                    <tr key={target.id} className={ti % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                      <td className={`py-2 pr-6 sticky left-0 z-10 ${ti % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}>
                        <div className="text-sm text-gray-900 font-medium">{target.name}</div>
                        <div className="text-xs text-gray-400">{target.use_case_type === 'NPI' ? 'New Product' : 'Repositioning'}</div>
                      </td>
                      {factors.filter(f => f.name.trim()).map((factor, fi) => {
                        const fKey = factor.id ?? `temp_${factor.display_order}`
                        const currentOrder = targetAssignments[target.id]?.[fKey] ?? ''
                        return (
                          <td key={fi} className="py-2 px-2">
                            <select
                              value={currentOrder}
                              onChange={e => setTargetAssignment(target.id, fKey, Number(e.target.value))}
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

            {allTargetsAssigned && (
              <div className="mt-3 text-xs text-green-700">
                ✓ All target product assignments complete
              </div>
            )}
          </section>
        )}

        {/* Error */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-md px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* Navigation */}
        <div className="flex justify-between pb-8">
          <button
            onClick={() => router.push(`/dashboard/projects/${projectId}/phase-1`)}
            className="px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 hover:bg-gray-50"
          >
            ← Back to Scope
          </button>
          <div className="flex gap-3">
            <button
              onClick={() => checkAndSave(false)}
              disabled={saving}
              className="px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
            <button
              onClick={() => checkAndSave(true)}
              disabled={saving}
              className="px-6 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save & Continue →'}
            </button>
          </div>
        </div>

      </div>

      <StaleWarningModal
        open={staleModal !== null}
        title={staleModal === 'structural'
          ? 'Saving will delete survey responses and all downstream results'
          : 'Saving will delete Value Pricing Model results'}
        description={staleModal === 'structural'
          ? 'Factor or level changes require new survey responses. All existing survey data, coherence review results, and Value Pricing Model outputs will be permanently deleted.'
          : 'Reference product or target product assignment changes require the Value Pricing Model to be re-run. Your current Phase 5 and 6 results will be permanently deleted.'}
        onConfirm={handleStaleConfirm}
        onCancel={() => setStaleModal(null)}
      />
    </div>
  )
}
