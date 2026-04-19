'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter, useParams } from 'next/navigation'
import { StaleWarningModal } from '@/app/components/StaleWarningModal'

const STATUS_ORDER = ['DRAFT','SCOPE_COMPLETE','FRAMEWORK_COMPLETE','SURVEY_OPEN','SURVEY_CLOSED','UTILITIES_DERIVED','MODEL_RUN','COMPLETE']

// ─── Types ────────────────────────────────────────────────────────────────────

interface Factor {
  id: string
  name: string
  levels: Level[]
}

interface Level {
  id: string
  name: string
  display_order: number
}

interface DistributedRespondent {
  id: string
  name: string
  email: string
  role: string | null
  token: string
  submitted_at: string | null
  survey_started_at: string | null
}

interface Respondent {
  id: string
  name: string
  email: string
  included: boolean
  exclusion_reason: string | null
  mode: string
  submitted_at: string | null
}

interface CRResult {
  label: string           // 'Factor Importance' or factor name
  comparison_type: 'ATTRIBUTE' | 'LEVEL'
  attribute_id: string | null
  cr: number
  cr_flag: 'OK' | 'MARGINAL' | 'INCONSISTENT'
}

interface RespondentCRs {
  respondent: Respondent
  crs: CRResult[]
}

interface AggregatedResult {
  label: string
  comparison_type: 'ATTRIBUTE' | 'LEVEL'
  attribute_id: string | null
  cr: number
  cr_flag: 'OK' | 'MARGINAL' | 'INCONSISTENT'
  weights: number[]       // GMM priority vector
  item_ids: string[]      // attribute or level IDs in matrix order
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function crColor(flag: string) {
  if (flag === 'OK')           return 'text-green-700 bg-green-50 border-green-200'
  if (flag === 'MARGINAL')     return 'text-amber-700 bg-amber-50 border-amber-200'
  return                              'text-red-700 bg-red-50 border-red-200'
}

function crDot(flag: string) {
  if (flag === 'OK')       return 'bg-green-500'
  if (flag === 'MARGINAL') return 'bg-amber-400'
  return                          'bg-red-500'
}

function crLabel(flag: string) {
  if (flag === 'OK')           return 'Acceptable'
  if (flag === 'MARGINAL')     return 'Marginal'
  return                              'Inconsistent'
}

async function callSolver(endpoint: string, payload: object): Promise<any> {
  const res = await fetch(`/api/solver?endpoint=${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error(`Solver error: ${res.status}`)
  return res.json()
}

// Build an n×n pairwise matrix from raw response rows for a given set of item IDs
function buildMatrix(
  itemIds: string[],
  responses: { item_a_id: string; item_b_id: string; score: number; direction: string }[]
): number[][] {
  const n = itemIds.length
  const matrix: number[][] = Array.from({ length: n }, () => Array(n).fill(1))

  for (const r of responses) {
    const i = itemIds.indexOf(r.item_a_id)
    const j = itemIds.indexOf(r.item_b_id)
    if (i === -1 || j === -1) continue

    if (r.direction === 'EQUAL') {
      matrix[i][j] = 1
      matrix[j][i] = 1
    } else if (r.direction === 'A') {
      matrix[i][j] = r.score
      matrix[j][i] = 1 / r.score
    } else {
      matrix[j][i] = r.score
      matrix[i][j] = 1 / r.score
    }
  }

  return matrix
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function Phase4Page() {
  const params    = useParams()
  const projectId = params.id as string
  const router    = useRouter()
  const supabase  = createClient()

  const [factors,           setFactors]           = useState<Factor[]>([])
  const [respondents,       setRespondents]        = useState<Respondent[]>([])
  const [respondentCRs,     setRespondentCRs]      = useState<RespondentCRs[]>([])
  const [aggregatedResults, setAggregatedResults]  = useState<AggregatedResult[]>([])
  const [currentUserEmail,  setCurrentUserEmail]   = useState<string | null>(null)
  const [running,           setRunning]            = useState(false)
  const [saving,            setSaving]             = useState(false)
  const [loaded,            setLoaded]             = useState(false)
  const [projectStatus,     setProjectStatus]      = useState('')
  const [error,             setError]              = useState('')
  const [expandedRespondent, setExpandedRespondent] = useState<string | null>(null)
  const [exclusionReasons,  setExclusionReasons]   = useState<Record<string, string>>({})
  const [analysisRan,       setAnalysisRan]        = useState(false)
  const [distRespondents,   setDistRespondents]    = useState<DistributedRespondent[]>([])
  const [showRoster,        setShowRoster]         = useState(false)
  const [newRespName,       setNewRespName]        = useState('')
  const [newRespEmail,      setNewRespEmail]       = useState('')
  const [newRespRole,       setNewRespRole]        = useState('')
  const [surveyExpiresAt,   setSurveyExpiresAt]    = useState<string>('')
  const [addingResp,        setAddingResp]         = useState(false)
  const [rosterError,       setRosterError]        = useState('')
  const [projectName,       setProjectName]        = useState('')
  const [sendingInvite,     setSendingInvite]      = useState<Set<string>>(new Set())
  const [inviteStatus,      setInviteStatus]       = useState<Record<string, 'sent' | 'error'>>({})
  const [staleWarningOpen,  setStaleWarningOpen]   = useState(false)
  const [pendingToggle,     setPendingToggle]      = useState<{ respondentId: string; included: boolean } | null>(null)

  // ── Load ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (user?.email) setCurrentUserEmail(user.email)

      // Load project status, name + survey deadline
      const { data: project } = await supabase
        .from('project')
        .select('status, survey_expires_at, name')
        .eq('id', projectId)
        .single()

      const status = project?.status ?? ''
      setProjectStatus(status)
      setProjectName(project?.name ?? '')
      if (project?.survey_expires_at) {
        // Convert to YYYY-MM-DD for the date input
        setSurveyExpiresAt(project.survey_expires_at.slice(0, 10))
      }

      // Auto-heal: if status was downgraded to SURVEY_OPEN but Phase 4 results
      // already exist, restore to SURVEY_CLOSED so Phases 5/6 remain accessible.
      if (status === 'SURVEY_OPEN') {
        const { data: existingAgg } = await supabase
          .from('aggregated_matrix')
          .select('id')
          .eq('project_id', projectId)
          .limit(1)
        if (existingAgg && existingAgg.length > 0) {
          await supabase.from('project').update({ status: 'SURVEY_CLOSED' }).eq('id', projectId)
          setProjectStatus('SURVEY_CLOSED')
          router.refresh()
        }
      }

      // Load factors + levels
      const { data: factorData } = await supabase
        .from('attribute')
        .select('id, name, display_order')
        .eq('project_id', projectId)
        .order('display_order')

      if (!factorData || factorData.length === 0) {
        setLoaded(true)
        return
      }

      const factorsWithLevels: Factor[] = []
      for (const f of factorData) {
        const { data: levelData } = await supabase
          .from('level')
          .select('id, name, display_order')
          .eq('attribute_id', f.id)
          .order('display_order')
        factorsWithLevels.push({ id: f.id, name: f.name, levels: levelData ?? [] })
      }
      setFactors(factorsWithLevels)

      // Load respondents
      const { data: respondentData } = await supabase
        .from('respondent')
        .select('id, name, email, included, exclusion_reason, mode, submitted_at')
        .eq('project_id', projectId)
        .order('created_at')

      if (respondentData) {
        setRespondents(respondentData)
        const reasons: Record<string, string> = {}
        for (const r of respondentData) {
          reasons[r.id] = r.exclusion_reason ?? ''
        }
        setExclusionReasons(reasons)
      }

      // Load distributed respondents for the management panel
      const { data: distData } = await supabase
        .from('respondent')
        .select('id, name, email, role, token, submitted_at, survey_started_at')
        .eq('project_id', projectId)
        .eq('mode', 'DISTRIBUTED')
        .order('created_at')
      if (distData) setDistRespondents(distData)

      // If already run, load saved aggregated results
      if (['UTILITIES_DERIVED', 'MODEL_RUN', 'COMPLETE'].includes(project?.status ?? '')) {
        const { data: aggData } = await supabase
          .from('aggregated_matrix')
          .select('comparison_type, attribute_id, cr_score')
          .eq('project_id', projectId)

        if (aggData && aggData.length > 0 && factorsWithLevels.length > 0) {
          // Reconstruct display results from saved data
          const displayResults: AggregatedResult[] = []
          for (const row of aggData) {
            let label = 'Factor Importance'
            if (row.comparison_type === 'LEVEL' && row.attribute_id) {
              const f = factorsWithLevels.find(f => f.id === row.attribute_id)
              label = f ? `${f.name}` : 'Unknown Factor'
            }
            const flag = row.cr_score < 0.10 ? 'OK'
              : row.cr_score <= 0.20 ? 'MARGINAL' : 'INCONSISTENT'
            displayResults.push({
              label,
              comparison_type: row.comparison_type,
              attribute_id: row.attribute_id,
              cr: row.cr_score,
              cr_flag: flag,
              weights: [],
              item_ids: [],
            })
          }
          setAggregatedResults(displayResults)
          setAnalysisRan(true)
        }
      }

      setLoaded(true)
    }
    load()
  }, [projectId])

  // ── Run analysis ──────────────────────────────────────────────────────────

  async function runAnalysis() {
    setRunning(true)
    setError('')

    try {
      // Exclude DISTRIBUTED respondents who haven't submitted — they have no responses
      const includedRespondents = respondents.filter(
        r => r.included && (r.mode !== 'DISTRIBUTED' || !!r.submitted_at)
      )
      if (includedRespondents.length === 0) {
        throw new Error('No included respondents. At least one respondent must be included.')
      }

      // Load all pairwise responses for included respondents
      const { data: allResponses } = await supabase
        .from('pairwise_response')
        .select('respondent_id, comparison_type, item_a_id, item_b_id, score, direction')
        .in('respondent_id', includedRespondents.map(r => r.id))

      if (!allResponses || allResponses.length === 0) {
        throw new Error('No survey responses found. Please complete Phase 3 first.')
      }

      // ── Per-respondent CR calculation ──────────────────────────────────

      const newRespondentCRs: RespondentCRs[] = []

      for (const respondent of includedRespondents) {
        const rResponses = allResponses.filter(r => r.respondent_id === respondent.id)
        const crs: CRResult[] = []

        // Cross-factor matrix
        const factorIds = factors.map(f => f.id)
        const attrResponses = rResponses.filter(r => r.comparison_type === 'ATTRIBUTE')
        if (factorIds.length >= 2 && attrResponses.length > 0) {
          const matrix = buildMatrix(factorIds, attrResponses)
          const result = await callSolver('priority-vector', { matrix })
          crs.push({
            label: 'Factor Importance',
            comparison_type: 'ATTRIBUTE',
            attribute_id: null,
            cr: result.consistency_ratio,
            cr_flag: result.cr_flag,
          })
        }

        // Per-factor level matrices
        for (const factor of factors) {
          const levelIds = factor.levels.map(l => l.id)
          if (levelIds.length < 2) continue
          const levelResponses = rResponses.filter(
            r => r.comparison_type === 'LEVEL' && levelIds.includes(r.item_a_id)
          )
          if (levelResponses.length === 0) continue
          const matrix = buildMatrix(levelIds, levelResponses)
          const result = await callSolver('priority-vector', { matrix })
          crs.push({
            label: factor.name,
            comparison_type: 'LEVEL',
            attribute_id: factor.id,
            cr: result.consistency_ratio,
            cr_flag: result.cr_flag,
          })
        }

        newRespondentCRs.push({ respondent, crs })
      }

      setRespondentCRs(newRespondentCRs)

      // ── Aggregated matrix computation ──────────────────────────────────

      const newAggregated: AggregatedResult[] = []

      // Cross-factor aggregation
      const factorIds = factors.map(f => f.id)
      const attrResponsesByRespondent = includedRespondents.map(r =>
        allResponses.filter(resp => resp.respondent_id === r.id && resp.comparison_type === 'ATTRIBUTE')
      )
      if (factorIds.length >= 2) {
        const matrices = attrResponsesByRespondent.map(rr => buildMatrix(factorIds, rr))
        const result = await callSolver('aggregate-matrix', { matrices })
        newAggregated.push({
          label: 'Factor Importance',
          comparison_type: 'ATTRIBUTE',
          attribute_id: null,
          cr: result.consistency_ratio,
          cr_flag: result.cr_flag,
          weights: result.weights,
          item_ids: factorIds,
        })
      }

      // Per-factor level aggregation
      for (const factor of factors) {
        const levelIds = factor.levels.map(l => l.id)
        if (levelIds.length < 2) continue

        const levelResponsesByRespondent = includedRespondents.map(r =>
          allResponses.filter(
            resp => resp.respondent_id === r.id &&
                    resp.comparison_type === 'LEVEL' &&
                    levelIds.includes(resp.item_a_id)
          )
        )

        const matrices = levelResponsesByRespondent.map(rr => buildMatrix(levelIds, rr))
        const result = await callSolver('aggregate-matrix', { matrices })
        newAggregated.push({
          label: factor.name,
          comparison_type: 'LEVEL',
          attribute_id: factor.id,
          cr: result.consistency_ratio,
          cr_flag: result.cr_flag,
          weights: result.weights,
          item_ids: levelIds,
        })
      }

      setAggregatedResults(newAggregated)

      // ── Save to database ───────────────────────────────────────────────

      // Save per-respondent CR scores
      for (const { respondent, crs } of newRespondentCRs) {
        for (const cr of crs) {
          await supabase.from('respondent_cr_score').upsert({
            respondent_id:   respondent.id,
            comparison_type: cr.comparison_type,
            attribute_id:    cr.attribute_id,
            cr_score:        cr.cr,
          }, { onConflict: 'respondent_id,comparison_type,attribute_id' })
        }
      }

      // Save aggregated matrices + CR scores
      for (const agg of newAggregated) {
        await supabase.from('aggregated_matrix').upsert({
          project_id:       projectId,
          comparison_type:  agg.comparison_type,
          attribute_id:     agg.attribute_id,
          matrix_json:      {},
          cr_score:         agg.cr,
          respondent_count: includedRespondents.length,
        }, { onConflict: 'project_id,comparison_type,attribute_id' })
      }

      // Save attribute weights
      const attrAgg = newAggregated.find(a => a.comparison_type === 'ATTRIBUTE')
      if (attrAgg) {
        for (let i = 0; i < attrAgg.item_ids.length; i++) {
          await supabase.from('attribute_weight').upsert({
            project_id:   projectId,
            attribute_id: attrAgg.item_ids[i],
            weight:       attrAgg.weights[i],
          }, { onConflict: 'project_id,attribute_id' })
        }
      }

      // Save level utilities
      for (const agg of newAggregated.filter(a => a.comparison_type === 'LEVEL')) {
        for (let i = 0; i < agg.item_ids.length; i++) {
          await supabase.from('level_utility').upsert({
            project_id: projectId,
            level_id:   agg.item_ids[i],
            utility:    agg.weights[i],
          }, { onConflict: 'project_id,level_id' })
        }
      }

      setAnalysisRan(true)

    } catch (err: any) {
      setError(err.message ?? 'Analysis failed')
    } finally {
      setRunning(false)
    }
  }

  // ── Toggle respondent inclusion ───────────────────────────────────────────

  function toggleRespondent(respondentId: string, included: boolean) {
    const staleStatuses = ['UTILITIES_DERIVED', 'MODEL_RUN', 'COMPLETE']
    if (staleStatuses.includes(projectStatus)) {
      setPendingToggle({ respondentId, included })
      setStaleWarningOpen(true)
      return
    }
    executeToggle(respondentId, included)
  }

  async function executeToggle(respondentId: string, included: boolean) {
    const reason = exclusionReasons[respondentId] ?? null
    await supabase.from('respondent').update({
      included,
      exclusion_reason: included ? null : (reason || null),
    }).eq('id', respondentId)

    setRespondents(prev =>
      prev.map(r => r.id === respondentId ? { ...r, included } : r)
    )

    // Analysis needs re-run after inclusion change
    setAnalysisRan(false)
    setAggregatedResults([])
    setRespondentCRs([])
  }

  async function handleStaleConfirm() {
    setStaleWarningOpen(false)
    if (!pendingToggle) return
    const { respondentId, included } = pendingToggle
    setPendingToggle(null)
    // Clear Phase 5 derived outputs
    await supabase.from('attribute_weight').delete().eq('project_id', projectId)
    await supabase.from('level_utility').delete().eq('project_id', projectId)
    await supabase.from('regression_result').delete().eq('project_id', projectId).is('scenario_id', null)
    await supabase.from('target_score')
      .update({ normalized_score: null, point_estimate: null, uncertainty_range_low: null, uncertainty_range_high: null })
      .eq('project_id', projectId).is('scenario_id', null)
    await supabase.from('project').update({ status: 'SURVEY_CLOSED' }).eq('id', projectId)
    setProjectStatus('SURVEY_CLOSED')
    router.refresh()
    executeToggle(respondentId, included)
  }

  // ── Distributed respondent helpers ───────────────────────────────────────

  async function addDistributedRespondent() {
    if (!newRespName.trim() || !newRespEmail.trim()) {
      setRosterError('Name and email are required.')
      return
    }
    setAddingResp(true)
    setRosterError('')
    try {
      // Dedup check — block if this email already has a DISTRIBUTED record for this project
      const { data: existing } = await supabase
        .from('respondent')
        .select('id')
        .eq('project_id', projectId)
        .eq('email', newRespEmail.trim())
        .eq('mode', 'DISTRIBUTED')
        .limit(1)
      if (existing && existing.length > 0) {
        setRosterError(`${newRespEmail.trim()} is already in the respondent list.`)
        setAddingResp(false)
        return
      }

      const { data, error } = await supabase
        .from('respondent')
        .insert({
          project_id: projectId,
          name:       newRespName.trim(),
          email:      newRespEmail.trim(),
          role:       newRespRole.trim() || null,
          mode:       'DISTRIBUTED',
          included:   true,
        })
        .select('id, name, email, role, token, submitted_at, survey_started_at')
        .single()
      if (error) throw error
      setDistRespondents(prev => [...prev, data])
      setNewRespName('')
      setNewRespEmail('')
      setNewRespRole('')
      // Auto-send invite
      sendInvite(data).catch(() => {})
    } catch (err: any) {
      setRosterError(err.message ?? 'Failed to add respondent')
    } finally {
      setAddingResp(false)
    }
  }

  async function saveDeadline(value: string) {
    setSurveyExpiresAt(value)
    await supabase
      .from('project')
      .update({ survey_expires_at: value ? new Date(value).toISOString() : null })
      .eq('id', projectId)
  }

  async function removeDistributedRespondent(id: string) {
    await supabase.from('respondent').delete().eq('id', id)
    setDistRespondents(prev => prev.filter(r => r.id !== id))
  }

  async function unlockRespondent(id: string) {
    await supabase.from('respondent').update({ submitted_at: null }).eq('id', id)
    setDistRespondents(prev => prev.map(r => r.id === id ? { ...r, submitted_at: null } : r))
  }

  function copyLink(token: string) {
    const url = `${window.location.origin}/survey/${token}`
    navigator.clipboard.writeText(url)
  }

  async function sendInvite(respondent: DistributedRespondent) {
    setSendingInvite(prev => new Set(prev).add(respondent.id))
    setInviteStatus(prev => { const n = { ...prev }; delete n[respondent.id]; return n })
    try {
      const surveyUrl = `${window.location.origin}/survey/${respondent.token}`
      const deadline  = surveyExpiresAt
        ? new Date(surveyExpiresAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
        : null
      const res = await fetch('/api/send-survey-invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          respondentName:  respondent.name,
          respondentEmail: respondent.email,
          surveyUrl,
          projectName,
          deadline,
        }),
      })
      setInviteStatus(prev => ({ ...prev, [respondent.id]: res.ok ? 'sent' : 'error' }))
    } catch {
      setInviteStatus(prev => ({ ...prev, [respondent.id]: 'error' }))
    } finally {
      setSendingInvite(prev => { const n = new Set(prev); n.delete(respondent.id); return n })
    }
  }

  // ── Navigate back to Phase 3 at a specific section ───────────────────────

  async function reviewInPhase3(section: string) {
    // Only downgrade to SURVEY_OPEN if Phase 5 hasn't been run yet.
    // If it has, navigate to Phase 3 without touching status — Phase 3's
    // own "Reopen Survey" button handles re-entry without locking Phase 5/6.
    const alreadyProgressed = ['UTILITIES_DERIVED', 'MODEL_RUN', 'COMPLETE'].includes(projectStatus)
    if (!alreadyProgressed) {
      await supabase.from('project').update({ status: 'SURVEY_OPEN' }).eq('id', projectId)
    }
    router.push(`/dashboard/projects/${projectId}/phase-3?goto=${section}`)
  }

  // ── Proceed to Phase 5 ────────────────────────────────────────────────────

  async function handleProceed() {
    setSaving(true)
    try {
      await supabase
        .from('project')
        .update({ status: 'UTILITIES_DERIVED' })
        .eq('id', projectId)
      router.refresh()
      router.push(`/dashboard/projects/${projectId}/phase-5`)
    } catch (err: any) {
      setError(err.message ?? 'Failed to proceed')
      setSaving(false)
    }
  }

  // ── Derived ───────────────────────────────────────────────────────────────

  const hasAnyFlag = aggregatedResults.some(r => r.cr_flag !== 'OK')
  const hasRedFlag = aggregatedResults.some(r => r.cr_flag === 'INCONSISTENT')
  const includedCount = respondents.filter(r => r.included).length

  // ── Guards ────────────────────────────────────────────────────────────────

  if (!loaded) return <div className="text-gray-400 text-sm">Loading...</div>

  if (factors.length === 0) {
    return (
      <div className="max-w-xl mx-auto mt-12 text-center">
        <p className="text-gray-500 text-sm">
          No factors found. Please complete Phase 2 before running Coherence Review.
        </p>
      </div>
    )
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="w-full max-w-4xl mx-auto">

      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Coherence Review</h1>
        <p className="text-gray-500 mt-1 text-sm">
          Review the consistency of survey responses before deriving importance scores and performance level scores.
        </p>
      </div>

      <div className="space-y-6">

        {/* ── External respondent management ────────────────────────────── */}
        {(() => {
          const submittedCount = distRespondents.filter(r => r.submitted_at).length
          const pendingCount   = distRespondents.length - submittedCount
          const summary        = distRespondents.length === 0
            ? 'No external respondents added'
            : pendingCount === 0
              ? `${submittedCount} of ${distRespondents.length} submitted ✓`
              : `${submittedCount} of ${distRespondents.length} submitted · ${pendingCount} pending`

          return (
            <div className="bg-white rounded-lg shadow-sm border border-gray-200">
              <button
                onClick={() => setShowRoster(r => !r)}
                className="w-full flex items-center justify-between px-6 py-4 text-left"
              >
                <span className="text-base font-semibold text-gray-900">External Respondents</span>
                <div className="flex items-center gap-3">
                  <span className={`text-xs ${pendingCount === 0 && distRespondents.length > 0 ? 'text-green-600' : 'text-gray-400'}`}>
                    {summary}
                  </span>
                  <span className="text-gray-400 text-xs">{showRoster ? '▲' : '▼'}</span>
                </div>
              </button>

              {showRoster && (
                <div className="border-t border-gray-100 px-6 pb-5">
                  {distRespondents.length > 0 && (
                    <div className="mt-4 space-y-2">
                      {distRespondents.map(r => (
                        <div key={r.id} className="flex items-center justify-between text-sm py-1.5 border-b border-gray-50">
                          <div>
                            <span className="font-medium text-gray-800">{r.name}</span>
                            <span className="ml-2 text-xs text-gray-400">{r.email}</span>
                            {r.role && <span className="ml-2 text-xs px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded">{r.role}</span>}
                          </div>
                          <div className="flex items-center gap-3">
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                              r.submitted_at ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'
                            }`}>
                              {r.submitted_at ? 'Submitted' : 'Awaiting'}
                            </span>
                            {r.submitted_at && r.survey_started_at && (() => {
                              const mins = Math.round((new Date(r.submitted_at).getTime() - new Date(r.survey_started_at).getTime()) / 60000)
                              const label = mins < 1 ? '< 1 min' : mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)}h ${mins % 60}m`
                              return <span className="text-xs text-gray-400">{label}</span>
                            })()}
                            {inviteStatus[r.id] === 'sent' && (
                              <span className="text-xs text-green-600">Invite sent ✓</span>
                            )}
                            {inviteStatus[r.id] === 'error' && (
                              <span className="text-xs text-red-500">Send failed</span>
                            )}
                            {!r.submitted_at && (
                              <button
                                onClick={() => sendInvite(r)}
                                disabled={sendingInvite.has(r.id)}
                                className="text-xs text-blue-600 hover:text-blue-700 disabled:opacity-40"
                                title="Send survey invite email"
                              >
                                {sendingInvite.has(r.id) ? '…' : inviteStatus[r.id] === 'sent' ? 'Resend' : 'Send invite'}
                              </button>
                            )}
                            <button
                              onClick={() => copyLink(r.token)}
                              className="text-xs text-gray-400 hover:text-blue-600"
                              title="Copy survey link to clipboard"
                            >
                              Copy link
                            </button>
                            {r.submitted_at ? (
                              <button
                                onClick={() => unlockRespondent(r.id)}
                                className="text-xs text-amber-600 hover:text-amber-700"
                                title="Allow respondent to revise and resubmit"
                              >
                                Unlock
                              </button>
                            ) : (
                              <button
                                onClick={() => removeDistributedRespondent(r.id)}
                                className="text-gray-300 hover:text-red-400 text-lg leading-none"
                                title="Remove respondent"
                              >
                                ×
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="mt-4 flex items-center gap-2">
                    <input
                      type="text"
                      value={newRespName}
                      onChange={e => setNewRespName(e.target.value)}
                      placeholder="Name"
                      className="flex-1 px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                    />
                    <input
                      type="email"
                      value={newRespEmail}
                      onChange={e => setNewRespEmail(e.target.value)}
                      placeholder="Email"
                      className="flex-1 px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                    />
                    <input
                      type="text"
                      value={newRespRole}
                      onChange={e => setNewRespRole(e.target.value)}
                      placeholder="Role (optional)"
                      className="w-36 px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                      onKeyDown={e => e.key === 'Enter' && addDistributedRespondent()}
                    />
                    <button
                      onClick={addDistributedRespondent}
                      disabled={addingResp || !newRespName.trim() || !newRespEmail.trim()}
                      className="px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 disabled:opacity-50"
                    >
                      {addingResp ? '…' : '+ Add & Invite'}
                    </button>
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    <label className="text-xs text-gray-500 whitespace-nowrap">Survey deadline</label>
                    <input
                      type="date"
                      value={surveyExpiresAt}
                      onChange={e => saveDeadline(e.target.value)}
                      className="px-2 py-1 border border-gray-300 rounded text-xs text-gray-700 focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                    />
                    {surveyExpiresAt && (
                      <button onClick={() => saveDeadline('')} className="text-xs text-gray-400 hover:text-red-400">Clear</button>
                    )}
                  </div>
                  {rosterError && <p className="mt-1.5 text-xs text-red-600">{rosterError}</p>}
                </div>
              )}
            </div>
          )
        })()}

        {/* ── Respondent roster ─────────────────────────────────────────── */}
        <section className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-base font-semibold text-gray-900 mb-1">Respondents</h2>
          <p className="text-xs text-gray-500 mb-4">
            Include or exclude respondents before running the analysis. Excluded respondents are kept in the record but not used in aggregation.
          </p>

          <div className="space-y-2">
            {respondents.map(r => (
              <div key={r.id} className="border border-gray-100 rounded-md">
                <div className="flex items-center justify-between px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                      r.included ? 'bg-green-500' : 'bg-gray-300'
                    }`} />
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-gray-800">{r.name}</span>
                        {r.mode === 'DISTRIBUTED' && (
                          <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">External</span>
                        )}
                        {r.mode === 'DISTRIBUTED' && (
                          <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${
                            r.submitted_at ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-600'
                          }`}>
                            {r.submitted_at ? 'Submitted' : 'Awaiting'}
                          </span>
                        )}
                      </div>
                      {!r.included && r.exclusion_reason && (
                        <span className="text-xs text-gray-400">— {r.exclusion_reason}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    {/* Per-respondent CRs */}
                    {respondentCRs.find(rc => rc.respondent.id === r.id) && (
                      <button
                        onClick={() => setExpandedRespondent(
                          expandedRespondent === r.id ? null : r.id
                        )}
                        className="text-xs text-blue-600 hover:text-blue-700"
                      >
                        {expandedRespondent === r.id ? 'Hide scores ▲' : 'View scores ▼'}
                      </button>
                    )}
                    {/* Toggle switch */}
                    {r.mode === 'DISTRIBUTED' && !r.submitted_at ? (
                      <span className="text-xs text-gray-400 italic">Awaiting submission</span>
                    ) : (
                      <div className="flex items-center gap-2">
                        <span className={`text-xs font-medium ${r.included ? 'text-green-700' : 'text-gray-400'}`}>
                          {r.included ? 'Included' : 'Excluded'}
                        </span>
                        <button
                          onClick={() => toggleRespondent(r.id, !r.included)}
                          style={{
                            width: '44px', height: '24px', borderRadius: '12px',
                            backgroundColor: r.included ? '#16a34a' : '#d1d5db',
                            border: 'none', cursor: 'pointer', position: 'relative',
                            transition: 'background-color 0.2s',
                            flexShrink: 0,
                          }}
                          title={r.included ? 'Click to exclude' : 'Click to include'}
                        >
                          <span style={{
                            position: 'absolute',
                            top: '2px',
                            left: r.included ? '22px' : '2px',
                            width: '20px', height: '20px', borderRadius: '50%',
                            backgroundColor: 'white',
                            transition: 'left 0.2s',
                            boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                          }} />
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Exclusion reason input */}
                {!r.included && (
                  <div className="px-4 pb-3">
                    <input
                      type="text"
                      value={exclusionReasons[r.id] ?? ''}
                      onChange={e => setExclusionReasons(prev => ({
                        ...prev, [r.id]: e.target.value
                      }))}
                      onBlur={async () => {
                        await supabase.from('respondent').update({
                          exclusion_reason: exclusionReasons[r.id] || null
                        }).eq('id', r.id)
                      }}
                      placeholder="Reason for exclusion (optional)"
                      className="w-full px-3 py-1.5 border border-gray-200 rounded-md text-xs text-gray-600 focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>
                )}

                {/* Expanded per-respondent CR scores */}
                {expandedRespondent === r.id && (() => {
                  const rc = respondentCRs.find(rc => rc.respondent.id === r.id)
                  if (!rc) return null
                  return (
                    <div className="border-t border-gray-100 px-4 py-3 bg-gray-50 rounded-b-md">
                      <p className="text-xs text-gray-500 mb-2 font-medium uppercase tracking-wide">
                        Coherence Scores
                      </p>
                      <div className="grid grid-cols-2 gap-2">
                        {rc.crs.map((cr, i) => (
                          <div key={i} className="flex items-center justify-between text-xs gap-2">
                            <span className="text-gray-600">{cr.label}</span>
                            <div className="flex items-center gap-2 flex-shrink-0">
                              {rc.respondent.mode === 'FACILITATED' && rc.respondent.email === currentUserEmail && cr.cr_flag !== 'OK' && (
                                <button
                                  onClick={() => reviewInPhase3(
                                    cr.comparison_type === 'ATTRIBUTE' ? 'attribute' : cr.attribute_id!
                                  )}
                                  className="text-blue-600 hover:text-blue-700 hover:underline"
                                >
                                  Review →
                                </button>
                              )}
                              <span className={`px-2 py-0.5 rounded border font-medium ${crColor(cr.cr_flag)}`}>
                                {cr.cr.toFixed(3)} — {crLabel(cr.cr_flag)}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })()}
              </div>
            ))}
          </div>
        </section>

        {/* ── Run analysis button ────────────────────────────────────────── */}
        <div className="flex items-center gap-4">
          <button
            onClick={runAnalysis}
            disabled={running || includedCount === 0}
            className="px-5 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 disabled:opacity-50"
          >
            {running ? 'Running analysis…' : analysisRan ? '↺ Re-run Analysis' : 'Run Analysis'}
          </button>
          {running && (
            <span className="text-xs text-gray-400">
              Computing coherence scores across {includedCount} respondent{includedCount !== 1 ? 's' : ''}…
            </span>
          )}
        </div>

        {/* ── Error ─────────────────────────────────────────────────────── */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-md px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* ── Aggregated coherence scores ────────────────────────────────── */}
        {aggregatedResults.length > 0 && (
          <section className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <h2 className="text-base font-semibold text-gray-900 mb-1">
              Aggregated Coherence Scores
            </h2>
            <p className="text-xs text-gray-500 mb-4">
              Scores are computed from the geometrically aggregated matrix across all included respondents.
              Scores below 0.10 are acceptable. Scores above 0.20 warrant review before proceeding.
            </p>

            {/* Summary flag banner */}
            {hasRedFlag && (
              <div className="mb-4 rounded-md px-4 py-3 text-sm bg-red-50 border border-red-200 text-red-700">
                One or more comparison sets show inconsistent responses. Review is strongly recommended before proceeding. You may proceed anyway.
              </div>
            )}

            {!hasAnyFlag && (
              <div className="mb-4 rounded-md px-4 py-3 text-sm bg-green-50 border border-green-200 text-green-700">
                ✓ All coherence scores are acceptable.
              </div>
            )}

            <div className="space-y-2">
              {aggregatedResults.map((r, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between px-4 py-3 rounded-md border border-gray-100 bg-gray-50"
                >
                  <div className="flex items-center gap-3">
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${crDot(r.cr_flag)}`} />
                    <div>
                      <span className="text-sm text-gray-800">{r.label}</span>
                      <span className="ml-2 text-xs text-gray-400">
                        {r.comparison_type === 'ATTRIBUTE' ? 'Cross-factor' : 'Performance levels'}
                      </span>
                    </div>
                  </div>
                  <span className={`px-3 py-1 rounded border text-xs font-medium ${crColor(r.cr_flag)}`}>
                    {r.cr.toFixed(3)} — {crLabel(r.cr_flag)}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ── Proceed ───────────────────────────────────────────────────── */}
        <div className="flex justify-between pb-8">
          <button
            onClick={() => router.push(`/dashboard/projects/${projectId}/phase-3`)}
            className="px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 hover:bg-gray-50"
          >
            ← Back to Preference Assessment
          </button>

          {analysisRan && (
            <button
              onClick={handleProceed}
              disabled={saving}
              className="px-6 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Accept & Continue →'}
            </button>
          )}
        </div>

      <StaleWarningModal
        open={staleWarningOpen}
        title="Saving will delete Value Pricing Model results"
        description="Changing which respondents are included requires re-running the coherence review aggregation and Value Pricing Model. Your current Phase 5 and 6 results will be permanently deleted."
        onConfirm={handleStaleConfirm}
        onCancel={() => { setStaleWarningOpen(false); setPendingToggle(null) }}
      />
      </div>
    </div>
  )
}
