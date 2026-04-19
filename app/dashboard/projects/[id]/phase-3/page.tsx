'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter, useParams, useSearchParams } from 'next/navigation'
import { HelpTip } from '@/app/components/HelpTip'
import { StaleWarningModal } from '@/app/components/StaleWarningModal'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Level {
  id: string
  name: string
  description: string
  display_order: number
}

interface Factor {
  id: string
  name: string
  levels: Level[]
}

interface Question {
  index: number
  comparison_type: 'ATTRIBUTE' | 'LEVEL'
  item_a_id: string
  item_b_id: string
  item_a_label: string
  item_b_label: string
  item_a_desc?: string
  item_b_desc?: string
  factor_name?: string
  item_a_best?: string
  item_a_worst?: string
  item_b_best?: string
  item_b_worst?: string
}

interface SavedResponse {
  score: number
  direction: 'A' | 'B' | 'EQUAL'
  slider: number
}

// ─── AHP slider scale ─────────────────────────────────────────────────────────
//
// 17 positions (0–16), center = 8 = Equal.
// Left: A wins, whole numbers 9→2. Right: B wins, reciprocals 1/2→1/9.
// Axis displayed symmetrically: 9 7 5 3 1 3 5 7 9
//
// pos  score  direction   a[A][B]
//  0     9       A          9
//  1     8       A          8
//  2     7       A          7
//  3     6       A          6
//  4     5       A          5
//  5     4       A          4
//  6     3       A          3
//  7     2       A          2
//  8     1     EQUAL        1
//  9     2       B         1/2
// 10     3       B         1/3
// 11     4       B         1/4
// 12     5       B         1/5
// 13     6       B         1/6
// 14     7       B         1/7
// 15     8       B         1/8
// 16     9       B         1/9

const SLIDER_MIN = 0
const SLIDER_MAX = 16
const EQUAL_POS  = 8

const AXIS_LABELS = ['9', '7', '5', '3', '1', '3', '5', '7', '9']

function intensityLabel(pos: number): string {
  const dist = Math.abs(pos - EQUAL_POS)
  switch (dist) {
    case 0: return 'Equal'
    case 1: return 'Equal / Moderate'
    case 2: return 'Moderate'
    case 3: return 'Moderate / Strong'
    case 4: return 'Strong'
    case 5: return 'Strong / Very Strong'
    case 6: return 'Very Strong'
    case 7: return 'Very Strong / Extreme'
    case 8: return 'Extreme'
    default: return ''
  }
}

function posToResponse(pos: number): { score: number; direction: 'A' | 'B' | 'EQUAL' } {
  if (pos === EQUAL_POS) return { score: 1, direction: 'EQUAL' }
  if (pos < EQUAL_POS)   return { score: EQUAL_POS - pos + 1, direction: 'A' }
  return                        { score: pos - EQUAL_POS + 1, direction: 'B' }
}

function responseToPos(score: number, direction: 'A' | 'B' | 'EQUAL'): number {
  if (direction === 'EQUAL') return EQUAL_POS
  if (direction === 'A')     return EQUAL_POS - (score - 1)
  return                            EQUAL_POS + (score - 1)
}

// ─── Question generation ──────────────────────────────────────────────────────
// Level-first. Attribute questions receive best/worst after GMM computation.
// levelUtilities: factorId → { levelId → utility } (empty until computed)

function generateQuestions(
  factors: Factor[],
  levelUtilities: Record<string, Record<string, number>> = {}
): Question[] {
  const questions: Question[] = []
  let idx = 0

  // 1. Within-factor level comparisons
  for (const factor of factors) {
    for (let i = 0; i < factor.levels.length; i++) {
      for (let j = i + 1; j < factor.levels.length; j++) {
        questions.push({
          index: idx++,
          comparison_type: 'LEVEL',
          item_a_id:    factor.levels[i].id,
          item_b_id:    factor.levels[j].id,
          item_a_label: factor.levels[i].name,
          item_b_label: factor.levels[j].name,
          item_a_desc:  factor.levels[i].description || undefined,
          item_b_desc:  factor.levels[j].description || undefined,
          factor_name:  factor.name,
        })
      }
    }
  }

  // 2. Cross-factor comparisons
  for (let i = 0; i < factors.length; i++) {
    for (let j = i + 1; j < factors.length; j++) {
      const fa = factors[i]
      const fb = factors[j]

      // Use GMM utilities if available, otherwise no context shown
      const utilitiesA = levelUtilities[fa.id]
      const utilitiesB = levelUtilities[fb.id]

      let item_a_best: string | undefined
      let item_a_worst: string | undefined
      let item_b_best: string | undefined
      let item_b_worst: string | undefined

      if (utilitiesA && Object.keys(utilitiesA).length > 0) {
        const sortedA = [...fa.levels].sort(
          (x, y) => (utilitiesA[x.id] ?? 0) - (utilitiesA[y.id] ?? 0)
        )
        item_a_worst = sortedA[0]?.name
        item_a_best  = sortedA[sortedA.length - 1]?.name
      }

      if (utilitiesB && Object.keys(utilitiesB).length > 0) {
        const sortedB = [...fb.levels].sort(
          (x, y) => (utilitiesB[x.id] ?? 0) - (utilitiesB[y.id] ?? 0)
        )
        item_b_worst = sortedB[0]?.name
        item_b_best  = sortedB[sortedB.length - 1]?.name
      }

      questions.push({
        index: idx++,
        comparison_type: 'ATTRIBUTE',
        item_a_id:    fa.id,
        item_b_id:    fb.id,
        item_a_label: fa.name,
        item_b_label: fb.name,
        item_a_best,
        item_a_worst,
        item_b_best,
        item_b_worst,
      })
    }
  }

  return questions
}

// Count total level questions (boundary between sections)
function countLevelQuestions(factors: Factor[]): number {
  return factors.reduce((sum, f) => {
    const k = f.levels.length
    return sum + (k * (k - 1)) / 2
  }, 0)
}

function getSectionLabel(questions: Question[], index: number): string {
  const q = questions[index]
  if (!q) return ''
  if (q.comparison_type === 'LEVEL') return `Performance levels — ${q.factor_name}`
  return 'Factor importance'
}

// ─── Background GMM computation ───────────────────────────────────────────────
// Builds each factor's pairwise matrix from saved responses and calls /priority-vector.
// Returns factorId → { levelId → utility }

async function computeLevelUtilitiesFromResponses(
  factors: Factor[],
  responses: Record<number, SavedResponse>,
  questions: Question[]
): Promise<Record<string, Record<string, number>>> {
  const result: Record<string, Record<string, number>> = {}

  for (const factor of factors) {
    const k = factor.levels.length
    if (k < 2) continue

    // Build k×k matrix, default to 1 (equal) for any missing pair
    const matrix: number[][] = Array.from({ length: k }, () => Array(k).fill(1))

    // Find level questions for this factor
    const levelQs = questions.filter(
      q => q.comparison_type === 'LEVEL' && q.factor_name === factor.name
    )

    for (const lq of levelQs) {
      const resp = responses[lq.index]
      if (!resp) continue

      const iIdx = factor.levels.findIndex(l => l.id === lq.item_a_id)
      const jIdx = factor.levels.findIndex(l => l.id === lq.item_b_id)
      if (iIdx === -1 || jIdx === -1) continue

      const { score, direction } = resp
      if (direction === 'EQUAL') {
        matrix[iIdx][jIdx] = 1
        matrix[jIdx][iIdx] = 1
      } else if (direction === 'A') {
        matrix[iIdx][jIdx] = score
        matrix[jIdx][iIdx] = 1 / score
      } else {
        matrix[jIdx][iIdx] = score
        matrix[iIdx][jIdx] = 1 / score
      }
    }

    try {
      const res = await fetch('/api/solver?endpoint=priority-vector', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ matrix }),
      })
      if (!res.ok) continue
      const data = await res.json()
      const weights: number[] = data.weights ?? []

      // Map level IDs to their utility values
      const utilMap: Record<string, number> = {}
      factor.levels.forEach((l, i) => {
        utilMap[l.id] = weights[i] ?? 0
      })
      result[factor.id] = utilMap
    } catch {
      // Silent failure — context just won't show for this factor
    }
  }

  return result
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function Phase3Page() {
  const params       = useParams()
  const projectId    = params.id as string
  const router       = useRouter()
  const searchParams = useSearchParams()
  const gotoParam    = searchParams.get('goto')
  const supabase     = createClient()

  const [factors,        setFactors]        = useState<Factor[]>([])
  const [questions,      setQuestions]      = useState<Question[]>([])
  const [respondentId,   setRespondentId]   = useState<string | null>(null)
  const [responses,      setResponses]      = useState<Record<number, SavedResponse>>({})
  const [currentIndex,   setCurrentIndex]   = useState(0)
  const [sliderPos,      setSliderPos]      = useState(EQUAL_POS)
  const [saving,         setSaving]         = useState(false)
  const [closing,        setClosing]        = useState(false)
  const [loaded,         setLoaded]         = useState(false)
  const [error,          setError]          = useState('')
  const [surveyStatus,   setSurveyStatus]   = useState<'open' | 'closed'>('open')
  // levelUtilities populated by background GMM before attribute section starts
  const [levelUtilities, setLevelUtilities] = useState<Record<string, Record<string, number>>>({})
  const [staleWarningOpen, setStaleWarningOpen] = useState(false)
  const staleConfirmedRef = useRef(false)
  const pendingStaleAction = useRef<(() => void) | null>(null)

  // ── Load ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    async function load() {
      const { data: project } = await supabase
        .from('project')
        .select('status')
        .eq('id', projectId)
        .single()

      if (['SURVEY_CLOSED', 'UTILITIES_DERIVED', 'MODEL_RUN', 'COMPLETE']
            .includes(project?.status ?? '')) {
        setSurveyStatus('closed')
      }

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
          .select('id, name, description, display_order')
          .eq('attribute_id', f.id)
          .order('display_order')
        factorsWithLevels.push({ id: f.id, name: f.name, levels: levelData ?? [] })
      }
      setFactors(factorsWithLevels)

      const qs = generateQuestions(factorsWithLevels)
      setQuestions(qs)
      // Debug: log first level question to verify descriptions are loading
      const firstLevelQ = qs.find(q => q.comparison_type === 'LEVEL')
      if (firstLevelQ) console.log('LEVEL Q sample:', firstLevelQ.item_a_label, '| desc:', firstLevelQ.item_a_desc, '| b:', firstLevelQ.item_b_label, '| b_desc:', firstLevelQ.item_b_desc)

      // Get or create facilitated respondent
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      // Use .limit(1) instead of .maybeSingle() to safely handle any duplicate
      // records without throwing — takes the first match if multiple exist.
      const { data: existingRows } = await supabase
        .from('respondent')
        .select('id')
        .eq('project_id', projectId)
        .eq('email', user.email)
        .eq('mode', 'FACILITATED')
        .order('created_at', { ascending: true })
        .limit(1)

      const existing = existingRows?.[0] ?? null

      let rId: string
      if (existing) {
        rId = existing.id
      } else {
        const { data: created, error: rErr } = await supabase
          .from('respondent')
          .insert({
            project_id: projectId,
            name:       user.email,
            email:      user.email,
            mode:       'FACILITATED',
            included:   true,
          })
          .select('id')
          .single()
        if (rErr) { setError(rErr.message); setLoaded(true); return }
        rId = created.id
      }
      setRespondentId(rId)

      // Load saved responses
      const { data: saved } = await supabase
        .from('pairwise_response')
        .select('comparison_type, item_a_id, item_b_id, score, direction')
        .eq('respondent_id', rId)

      let responseMap: Record<number, SavedResponse> = {}
      if (saved && saved.length > 0) {
        for (const r of saved) {
          const qIdx = qs.findIndex(
            q => q.comparison_type === r.comparison_type &&
                 q.item_a_id       === r.item_a_id &&
                 q.item_b_id       === r.item_b_id
          )
          if (qIdx === -1) continue
          responseMap[qIdx] = {
            score:     r.score,
            direction: r.direction,
            slider:    responseToPos(r.score, r.direction),
          }
        }
        setResponses(responseMap)
        const firstUnanswered = qs.findIndex((_, i) => !responseMap[i])
        const resumeAt = firstUnanswered === -1 ? qs.length - 1 : firstUnanswered
        setCurrentIndex(resumeAt)
        setSliderPos(responseMap[resumeAt]?.slider ?? EQUAL_POS)
      }

      // If resuming into the attribute section, compute utilities now
      const levelQCount = countLevelQuestions(factorsWithLevels)
      const resumeAt = (() => {
        const firstUnanswered = qs.findIndex((_, i) => !responseMap[i])
        return firstUnanswered === -1 ? qs.length - 1 : firstUnanswered
      })()

      if (resumeAt >= levelQCount && Object.keys(responseMap).length >= levelQCount) {
        computeLevelUtilitiesFromResponses(factorsWithLevels, responseMap, qs)
          .then(utils => {
            setLevelUtilities(utils)
            setQuestions(generateQuestions(factorsWithLevels, utils))
          })
      }

      if (project?.status === 'FRAMEWORK_COMPLETE') {
        await supabase
          .from('project')
          .update({ status: 'SURVEY_OPEN' })
          .eq('id', projectId)
      }

      // If arriving from Phase 4 coherence review with a ?goto= param, jump to that section
      if (gotoParam && qs.length > 0) {
        let targetIndex: number
        if (gotoParam === 'attribute') {
          targetIndex = qs.findIndex(q => q.comparison_type === 'ATTRIBUTE')
        } else {
          // gotoParam is a factor ID — find first LEVEL question for that factor
          const factor = factorsWithLevels.find(f => f.id === gotoParam)
          targetIndex = factor
            ? qs.findIndex(q => q.comparison_type === 'LEVEL' && q.factor_name === factor.name)
            : -1
        }
        if (targetIndex !== -1) {
          setCurrentIndex(targetIndex)
          setSliderPos(responseMap[targetIndex]?.slider ?? EQUAL_POS)
        }
      }

      setLoaded(true)
    }
    load()
  }, [projectId])

  useEffect(() => {
    setSliderPos(responses[currentIndex]?.slider ?? EQUAL_POS)
  }, [currentIndex])

  // ── Save and navigate ─────────────────────────────────────────────────────

  const saveAndGo = useCallback(async (targetIndex: number) => {
    if (!respondentId || questions.length === 0) return

    // If survey was already closed, warn on the first edit (once per session)
    if (surveyStatus === 'closed' && !staleConfirmedRef.current) {
      pendingStaleAction.current = () => saveAndGo(targetIndex)
      setStaleWarningOpen(true)
      return
    }

    const q = questions[currentIndex]
    const { score, direction } = posToResponse(sliderPos)

    setSaving(true)
    setError('')
    try {
      // Delete existing response for this pair if it exists, then insert fresh
      await supabase
        .from('pairwise_response')
        .delete()
        .eq('respondent_id', respondentId)
        .eq('comparison_type', q.comparison_type)
        .eq('item_a_id', q.item_a_id)
        .eq('item_b_id', q.item_b_id)

      const { error: insertErr } = await supabase.from('pairwise_response').insert({
        respondent_id:   respondentId,
        comparison_type: q.comparison_type,
        item_a_id:       q.item_a_id,
        item_b_id:       q.item_b_id,
        score,
        direction,
      })
      if (insertErr) console.error('INSERT ERROR:', JSON.stringify(insertErr), 'direction:', direction, 'score:', score)

      const newResponses = {
        ...responses,
        [currentIndex]: { score, direction, slider: sliderPos },
      }
      setResponses(newResponses)

      // ── Background GMM trigger ──────────────────────────────────────────
      // Fire when crossing from the last level question to the first attribute
      // question. At this moment all level responses are saved in newResponses.
      const levelQCount = countLevelQuestions(factors)
      const crossingIntoAttributes =
        currentIndex === levelQCount - 1 && targetIndex === levelQCount

      if (crossingIntoAttributes) {
        computeLevelUtilitiesFromResponses(factors, newResponses, questions)
          .then(utils => {
            setLevelUtilities(utils)
            const newQs = generateQuestions(factors, utils)
            const sampleAttr = newQs.find(q => q.comparison_type === 'ATTRIBUTE')
            setQuestions(newQs)
          })
      }

      setCurrentIndex(targetIndex)
    } catch (err: any) {
      setError(err.message ?? 'Failed to save response')
    } finally {
      setSaving(false)
    }
  }, [respondentId, questions, factors, responses, currentIndex, sliderPos, levelUtilities, surveyStatus])

  async function handleStaleConfirm() {
    setStaleWarningOpen(false)
    // Clear Phase 4+ downstream data, drop status to SURVEY_OPEN
    await supabase.from('aggregated_matrix').delete().eq('project_id', projectId)
    await supabase.from('attribute_weight').delete().eq('project_id', projectId)
    await supabase.from('level_utility').delete().eq('project_id', projectId)
    await supabase.from('regression_result').delete().eq('project_id', projectId).is('scenario_id', null)
    await supabase.from('target_score')
      .update({ normalized_score: null, point_estimate: null, uncertainty_range_low: null, uncertainty_range_high: null })
      .eq('project_id', projectId).is('scenario_id', null)
    await supabase.from('project').update({ status: 'SURVEY_OPEN' }).eq('id', projectId)
    // Allow all future saves in this session without re-warning
    staleConfirmedRef.current = true
    setSurveyStatus('open')
    router.refresh()
    // Execute the queued save
    pendingStaleAction.current?.()
    pendingStaleAction.current = null
  }

  async function handleCloseSurvey() {
    setClosing(true)
    try {
      await supabase
        .from('project')
        .update({ status: 'SURVEY_CLOSED' })
        .eq('id', projectId)
      router.push(`/dashboard/projects/${projectId}/phase-4`)
    } catch (err: any) {
      setError(err.message ?? 'Failed to close survey')
      setClosing(false)
    }
  }

  // ── Derived ───────────────────────────────────────────────────────────────

  const totalQuestions = questions.length
  const answeredCount  = Object.keys(responses).length
  const allAnswered    = answeredCount === totalQuestions && totalQuestions > 0
  const q              = questions[currentIndex]
  const progressPct    = totalQuestions > 0 ? (answeredCount / totalQuestions) * 100 : 0
  const isEqual        = sliderPos === EQUAL_POS
  const aWins          = sliderPos < EQUAL_POS
  const bWins          = sliderPos > EQUAL_POS
  const iLabel         = intensityLabel(sliderPos)
  const levelQCount    = countLevelQuestions(factors)
  const utilitiesReady = Object.keys(levelUtilities).length > 0

  // ── Guards ────────────────────────────────────────────────────────────────

  if (!loaded) return <div className="text-gray-400 text-sm">Loading...</div>

  if (factors.length === 0) {
    return (
      <div className="max-w-xl mx-auto mt-12 text-center">
        <p className="text-gray-500 text-sm">
          No factors found. Please complete Phase 2 before starting the assessment.
        </p>
        <button
          onClick={() => router.push(`/dashboard/projects/${projectId}/phase-2`)}
          className="mt-4 px-4 py-2 border border-gray-300 text-sm rounded-md text-gray-700 hover:bg-gray-50"
        >
          ← Back to Factor Framework
        </button>
      </div>
    )
  }

  if (surveyStatus === 'closed') {
    return (
      <div className="w-full max-w-2xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Preference Assessment</h1>
          <p className="text-gray-500 mt-1 text-sm">
            Survey responses have been collected and the survey is closed.
          </p>
        </div>
        <div className="bg-green-50 border border-green-200 rounded-lg px-5 py-4 text-sm text-green-800 mb-4">
          ✓ Survey closed — {answeredCount} of {totalQuestions} questions answered.
        </div>
        <div className="bg-blue-50 border border-blue-200 rounded-lg px-5 py-4 text-sm text-blue-800 mb-6">
          To revise any responses, reopen the survey below. You can navigate to any question and change your answer, then close the survey again.
        </div>
        <div className="flex justify-between">
          <button
            onClick={async () => {
              await supabase.from('project').update({ status: 'SURVEY_OPEN' }).eq('id', projectId)
              setSurveyStatus('open')
            }}
            className="px-4 py-2 border border-blue-300 text-sm font-medium rounded-md text-blue-700 hover:bg-blue-50"
          >
            ↩ Reopen Survey to Revise Responses
          </button>
          <button
            onClick={() => router.push(`/dashboard/projects/${projectId}/phase-4`)}
            className="px-6 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700"
          >
            Continue to Coherence Review →
          </button>
        </div>
      </div>
    )
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="w-full max-w-2xl mx-auto pb-16" style={{ overflowX: "hidden" }}>

      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Preference Assessment</h1>
        <p className="text-gray-500 mt-1 text-sm">
          For each pair, indicate which is more important and by how much.
        </p>
      </div>

      {/* Close survey — top of page */}
      {allAnswered && (
        <button
          onClick={handleCloseSurvey}
          disabled={closing}
          style={{ width: '100%', backgroundColor: '#15803d', color: '#ffffff', padding: '12px', borderRadius: '6px', fontSize: '14px', fontWeight: 600, marginBottom: '16px', border: 'none', cursor: 'pointer' }}
        >
          {closing ? 'Closing...' : '✓ All questions answered — Close Survey & Continue to Coherence Review →'}
        </button>
      )}

      {/* Progress */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs text-gray-500">
            {getSectionLabel(questions, currentIndex)}
          </span>
          <span className="text-xs text-gray-500">
            {answeredCount} of {totalQuestions} answered
          </span>
        </div>
        <div className="w-full bg-gray-100 rounded-full h-1.5">
          <div
            className="bg-blue-600 h-1.5 rounded-full transition-all duration-300"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      {/* Question card */}
      {q && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8 mb-4 overflow-hidden">

          {/* Prompt */}
          <div style={{ fontSize: "12px", color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em", textAlign: "center", marginBottom: "24px" }} className="flex items-center justify-center gap-2">
            {q.comparison_type === 'ATTRIBUTE'
              ? 'Which factor is more important in driving purchase decisions?'
              : `Within ${q.factor_name} — which performance level delivers more value?`}
            <HelpTip
              width="w-80"
              content={q.comparison_type === 'ATTRIBUTE'
                ? "Drag toward the factor that matters more to buyers when choosing between products — all else being equal. Equal means both matter the same. Extreme (9×) means one factor is overwhelmingly more decisive. The direction you drag determines which factor gets the higher importance score."
                : "Drag toward the performance level that delivers more value to the buyer. Equal means both levels are worth the same. Extreme means one level is far more valuable than the other."}
            />
          </div>

          {/* Item cards */}
          <div className="flex items-stretch gap-4 mb-6">

            {/* Item A */}
            <div className={`flex-1 rounded-lg border-2 px-4 py-4 transition-colors ${
              aWins ? 'border-blue-500 bg-blue-50' : 'border-gray-200 bg-gray-50'
            }`}>
              <div className={`text-center ${
                aWins ? 'text-blue-800' : 'text-gray-900'
              }`} style={{ fontSize: '20px', fontWeight: 600 }}>
                {q.item_a_label}
              </div>

              {/* Level description sub-label */}
              {q.comparison_type === 'LEVEL' && q.item_a_desc && (
                <div style={{ marginTop: '6px', fontSize: '13px', color: '#6b7280', textAlign: 'center', fontStyle: 'italic' }}>
                  {q.item_a_desc}
                </div>
              )}

              {/* Best/worst context — only for attribute questions, only when utilities ready */}
              {q.comparison_type === 'ATTRIBUTE' && (
                <div style={{ marginTop: "6px", fontSize: "12px", color: "#9ca3af", textAlign: "center", minHeight: "18px" }}>
                  {q.item_a_best && q.item_a_worst
                    ? <>{q.item_a_best} <span className="opacity-50">↕</span> {q.item_a_worst}</>
                    : utilitiesReady ? null : null
                  }
                </div>
              )}

              {/* Fixed height intensity slot */}
              <div className="h-4 mt-2 flex items-center justify-center">
                {aWins && (
                  <span style={{ fontSize: "14px", color: "#1d4ed8", fontWeight: 600 }}>{iLabel}</span>
                )}
              </div>
            </div>

            <div className="flex items-center text-xs text-gray-400 font-medium flex-shrink-0">
              vs
            </div>

            {/* Item B */}
            <div className={`flex-1 rounded-lg border-2 px-4 py-4 transition-colors ${
              bWins ? 'border-blue-500 bg-blue-50' : 'border-gray-200 bg-gray-50'
            }`}>
              <div className={`text-center ${
                bWins ? 'text-blue-800' : 'text-gray-900'
              }`} style={{ fontSize: '20px', fontWeight: 600 }}>
                {q.item_b_label}
              </div>

              {/* Level description sub-label */}
              {q.comparison_type === 'LEVEL' && q.item_b_desc && (
                <div style={{ marginTop: '6px', fontSize: '13px', color: '#6b7280', textAlign: 'center', fontStyle: 'italic' }}>
                  {q.item_b_desc}
                </div>
              )}

              {q.comparison_type === 'ATTRIBUTE' && (
                <div style={{ marginTop: "6px", fontSize: "12px", color: "#9ca3af", textAlign: "center", minHeight: "18px" }}>
                  {q.item_b_best && q.item_b_worst
                    ? <>{q.item_b_best} <span className="opacity-50">↕</span> {q.item_b_worst}</>
                    : null
                  }
                </div>
              )}

              <div className="h-4 mt-2 flex items-center justify-center">
                {bWins && (
                  <span style={{ fontSize: "14px", color: "#1d4ed8", fontWeight: 600 }}>{iLabel}</span>
                )}
              </div>
            </div>

          </div>

          {/* Equal hint */}
          <div className="h-5 flex items-center justify-center mb-4">
            {isEqual && (
              <span style={{ fontSize: "13px", color: "#9ca3af" }}>
                Equal importance — drag to indicate a preference
              </span>
            )}
          </div>

          {/* Slider */}
          <style>{`
            .ahp-slider {
              -webkit-appearance: none;
              appearance: none;
              width: 100%;
              height: 4px;
              border-radius: 2px;
              background: #e5e7eb;
              outline: none;
              cursor: pointer;
            }
            .ahp-slider::-webkit-slider-thumb {
              -webkit-appearance: none;
              width: 20px; height: 20px;
              border-radius: 50%;
              background: #2563eb;
              border: 2px solid #fff;
              box-shadow: 0 1px 3px rgba(0,0,0,0.2);
              cursor: pointer;
            }
            .ahp-slider::-moz-range-thumb {
              width: 20px; height: 20px;
              border-radius: 50%;
              background: #2563eb;
              border: 2px solid #fff;
              box-shadow: 0 1px 3px rgba(0,0,0,0.2);
              cursor: pointer;
            }
            .ahp-slider::-moz-range-track {
              background: #e5e7eb;
              height: 4px;
              border-radius: 2px;
            }
          `}</style>

          <input
            type="range"
            className="ahp-slider"
            min={SLIDER_MIN}
            max={SLIDER_MAX}
            step={1}
            value={sliderPos}
            onChange={e => setSliderPos(Number(e.target.value))}
          />

          {/* Scale labels — calc() offsets the thumb radius (10px) so labels track
              the actual thumb center across the full travel range */}
          <div style={{ position: 'relative', height: '32px', marginTop: '4px' }}>
            {[
              { pos: 0,  num: '9',  name: 'Extreme' },
              { pos: 2,  num: '7',  name: 'Very Strong' },
              { pos: 4,  num: '5',  name: 'Strong' },
              { pos: 6,  num: '3',  name: 'Moderate' },
              { pos: 8,  num: '1',  name: 'Equal' },
              { pos: 10, num: '3',  name: 'Moderate' },
              { pos: 12, num: '5',  name: 'Strong' },
              { pos: 14, num: '7',  name: 'Very Strong' },
              { pos: 16, num: '9',  name: 'Extreme' },
            ].map(({ pos, num, name }) => {
              const pct = (pos / 16) * 100
              // Thumb is 20px wide; its center is 10px inset from each track edge.
              // Offset = 10px - pct% * 20px/100 = 20 * (0.5 - pct/100) px
              const offset = 20 * (0.5 - pct / 100)
              const isCenter = pos === 8
              return (
                <div
                  key={pos}
                  style={{
                    position: 'absolute',
                    left: `calc(${pct}% + ${offset}px)`,
                    transform: 'translateX(-50%)',
                    textAlign: 'center',
                    lineHeight: 1.2,
                  }}
                >
                  <div style={{ fontSize: '13px', color: isCenter ? '#111827' : '#6b7280', fontWeight: isCenter ? 600 : 400 }}>{num}</div>
                  <div style={{ fontSize: '12px', color: isCenter ? '#111827' : '#6b7280', fontWeight: isCenter ? 600 : 400, whiteSpace: 'nowrap' }}>{name}</div>
                </div>
              )
            })}
          </div>

          {/* Ownership labels */}
          <div className="flex justify-between mt-2">
            <span style={{ fontSize: '13px', color: '#6b7280', fontStyle: 'italic' }}>
              ← {q.item_a_label} {q.comparison_type === 'ATTRIBUTE' ? 'more important' : 'preferred'}
            </span>
            <span style={{ fontSize: '13px', color: '#6b7280', fontStyle: 'italic' }}>
              {q.item_b_label} {q.comparison_type === 'ATTRIBUTE' ? 'more important' : 'preferred'} →
            </span>
          </div>

        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-md px-4 py-3 text-sm text-red-700 mb-4">
          {error}
        </div>
      )}

      {/* Navigation */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => {
            if (currentIndex === 0) {
              router.push(`/dashboard/projects/${projectId}/phase-2`)
            } else {
              saveAndGo(currentIndex - 1)
            }
          }}
          disabled={saving}
          className="px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          ← {currentIndex === 0 ? 'Back to Factor Framework' : 'Previous'}
        </button>

        <span className="text-xs text-gray-400">
          Question {currentIndex + 1} of {totalQuestions}
        </span>

        {currentIndex < totalQuestions - 1 ? (
          <button
            onClick={() => saveAndGo(currentIndex + 1)}
            disabled={saving}
            className="px-6 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Next →'}
          </button>
        ) : (
          <button
            onClick={() => saveAndGo(currentIndex)}
            disabled={saving}
            className="px-6 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save Answer'}
          </button>
        )}
      </div>





      <StaleWarningModal
        open={staleWarningOpen}
        title="Editing will delete coherence review and Value Pricing Model results"
        description="This survey has already been completed. Changing any response will require re-running the coherence review analysis and Value Pricing Model. All existing results will be permanently deleted."
        confirmLabel="Delete Results & Edit"
        onConfirm={handleStaleConfirm}
        onCancel={() => { setStaleWarningOpen(false); pendingStaleAction.current = null }}
      />
    </div>
  )
}
