'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'next/navigation'

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
}

interface SavedResponse {
  score: number
  direction: 'A' | 'B' | 'EQUAL'
  slider: number
}

// ─── AHP slider scale (17 positions, identical to Phase 3) ───────────────────

const SLIDER_MIN = 0
const SLIDER_MAX = 16
const EQUAL_POS  = 8

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
  if (pos < EQUAL_POS)  return { score: EQUAL_POS - pos + 1, direction: 'A' }
  return { score: pos - EQUAL_POS + 1, direction: 'B' }
}

function responseToPos(score: number, direction: string): number {
  if (direction === 'EQUAL') return EQUAL_POS
  if (direction === 'A')     return EQUAL_POS - (score - 1)
  return EQUAL_POS + (score - 1)
}

function getSectionLabel(questions: Question[], index: number): string {
  const q = questions[index]
  if (!q) return ''
  if (q.comparison_type === 'LEVEL') return `Performance levels — ${q.factor_name}`
  return 'Factor importance'
}

// ─── Question generation (level-first, then attribute — same order as Phase 3) ─

function generateQuestions(factors: Factor[]): Question[] {
  const questions: Question[] = []
  let idx = 0

  for (const factor of factors) {
    const levels = factor.levels
    for (let i = 0; i < levels.length; i++) {
      for (let j = i + 1; j < levels.length; j++) {
        questions.push({
          index:            idx++,
          comparison_type:  'LEVEL',
          item_a_id:        levels[i].id,
          item_b_id:        levels[j].id,
          item_a_label:     levels[i].name,
          item_b_label:     levels[j].name,
          item_a_desc:      levels[i].description,
          item_b_desc:      levels[j].description,
          factor_name:      factor.name,
        })
      }
    }
  }

  for (let i = 0; i < factors.length; i++) {
    for (let j = i + 1; j < factors.length; j++) {
      questions.push({
        index:           idx++,
        comparison_type: 'ATTRIBUTE',
        item_a_id:       factors[i].id,
        item_b_id:       factors[j].id,
        item_a_label:    factors[i].name,
        item_b_label:    factors[j].name,
      })
    }
  }

  return questions
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ExternalSurveyPage() {
  const params = useParams()
  const token  = params.token as string

  const [respondentName, setRespondentName] = useState('')
  const [questions,      setQuestions]      = useState<Question[]>([])
  const [responses,      setResponses]      = useState<Record<number, SavedResponse>>({})
  const [currentIndex,   setCurrentIndex]   = useState(0)
  const [sliderPos,      setSliderPos]      = useState(EQUAL_POS)
  const [saving,         setSaving]         = useState(false)
  const [submitting,     setSubmitting]     = useState(false)
  const [submitted,      setSubmitted]      = useState(false)
  const [error,          setError]          = useState('')
  const [loaded,         setLoaded]         = useState(false)
  const [notFound,       setNotFound]       = useState(false)
  const [expired,        setExpired]        = useState(false)

  // ── Load ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    async function load() {
      const res = await fetch(`/api/survey/${token}`)
      if (res.status === 404) { setNotFound(true); setLoaded(true); return }
      if (res.status === 410) { setExpired(true);  setLoaded(true); return }
      if (!res.ok)            { setError('Failed to load survey.'); setLoaded(true); return }

      const data = await res.json()

      if (data.submitted) { setSubmitted(true); setRespondentName(data.respondentName); setLoaded(true); return }

      setRespondentName(data.respondentName)

      const qs = generateQuestions(data.factors)
      setQuestions(qs)

      const responseMap: Record<number, SavedResponse> = {}
      for (const r of (data.responses ?? [])) {
        const qIdx = qs.findIndex(
          q => q.comparison_type === r.comparison_type &&
               q.item_a_id       === r.item_a_id &&
               q.item_b_id       === r.item_b_id
        )
        if (qIdx === -1) continue
        responseMap[qIdx] = { score: r.score, direction: r.direction, slider: responseToPos(r.score, r.direction) }
      }
      setResponses(responseMap)

      const firstUnanswered = qs.findIndex((_, i) => !responseMap[i])
      const resumeAt = firstUnanswered === -1 ? 0 : firstUnanswered
      setCurrentIndex(resumeAt)
      setSliderPos(responseMap[resumeAt]?.slider ?? EQUAL_POS)
      setLoaded(true)
    }
    load()
  }, [token])

  useEffect(() => {
    setSliderPos(responses[currentIndex]?.slider ?? EQUAL_POS)
  }, [currentIndex])

  // ── Save and navigate ─────────────────────────────────────────────────────

  const saveAndGo = useCallback(async (targetIndex: number) => {
    if (questions.length === 0) return
    const q = questions[currentIndex]
    const { score, direction } = posToResponse(sliderPos)

    setSaving(true)
    setError('')
    try {
      const res = await fetch(`/api/survey/${token}`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ comparison_type: q.comparison_type, item_a_id: q.item_a_id, item_b_id: q.item_b_id, score, direction }),
      })
      if (!res.ok) throw new Error('Failed to save response')
      setResponses(prev => ({ ...prev, [currentIndex]: { score, direction, slider: sliderPos } }))
      const clamped = Math.max(0, Math.min(targetIndex, questions.length - 1))
      setCurrentIndex(clamped)
    } catch (err: any) {
      setError(err.message ?? 'Failed to save')
    } finally {
      setSaving(false)
    }
  }, [currentIndex, sliderPos, questions, token])

  // ── Submit ────────────────────────────────────────────────────────────────

  async function handleSubmit() {
    if (questions.length === 0) return
    setSubmitting(true)
    setError('')
    try {
      // Save current question first
      const q = questions[currentIndex]
      const { score, direction } = posToResponse(sliderPos)
      await fetch(`/api/survey/${token}`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ comparison_type: q.comparison_type, item_a_id: q.item_a_id, item_b_id: q.item_b_id, score, direction }),
      })

      const res = await fetch(`/api/survey/${token}`, { method: 'PATCH' })
      if (!res.ok) throw new Error('Failed to submit survey')
      setSubmitted(true)
    } catch (err: any) {
      setError(err.message ?? 'Failed to submit')
    } finally {
      setSubmitting(false)
    }
  }

  // ── Derived ───────────────────────────────────────────────────────────────

  const totalQuestions = questions.length
  const answeredCount  = Object.keys(responses).length
  const allAnswered    = answeredCount === totalQuestions && totalQuestions > 0
  const progressPct    = totalQuestions > 0 ? (answeredCount / totalQuestions) * 100 : 0
  const q              = questions[currentIndex]
  const isEqual        = sliderPos === EQUAL_POS
  const aWins          = sliderPos < EQUAL_POS
  const iLabel         = intensityLabel(sliderPos)
  const sectionLabel   = getSectionLabel(questions, currentIndex)

  // ── Guards ────────────────────────────────────────────────────────────────

  if (!loaded) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-gray-400 text-sm">Loading survey…</div>
      </div>
    )
  }

  if (notFound) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <p className="text-gray-700 font-medium mb-1">Survey not found</p>
          <p className="text-gray-400 text-sm">This link may be invalid or expired.</p>
        </div>
      </div>
    )
  }

  if (expired) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center max-w-sm">
          <p className="text-gray-700 font-medium mb-1">This survey has closed</p>
          <p className="text-gray-400 text-sm">The collection period for this assessment has ended. Please contact the facilitator if you believe this is an error.</p>
        </div>
      </div>
    )
  }

  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center max-w-sm px-4">
          <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <span className="text-green-600 text-xl">✓</span>
          </div>
          <h1 className="text-xl font-semibold text-gray-900 mb-2">Survey submitted</h1>
          <p className="text-gray-500 text-sm">
            Thank you{respondentName ? `, ${respondentName.split(' ')[0]}` : ''}. Your responses have been recorded successfully.
          </p>
        </div>
      </div>
    )
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-50">

      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <span className="text-sm font-semibold text-gray-700">Value Pricing Model™</span>
          {respondentName && (
            <span className="text-xs text-gray-400">{respondentName}</span>
          )}
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-8">

        {/* Progress */}
        <div className="mb-6">
          <div className="flex justify-between text-xs text-gray-400 mb-1.5">
            <span>{sectionLabel}</span>
            <span>{answeredCount} of {totalQuestions} answered</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-1.5">
            <div
              className="bg-blue-500 h-1.5 rounded-full transition-all duration-300"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>

        {/* Question card */}
        {q && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-5">
            <p className="text-xs text-gray-400 uppercase tracking-wide mb-4">
              Question {currentIndex + 1} of {totalQuestions}
            </p>

            <p className="text-sm font-medium text-gray-700 text-center mb-6">
              {q.comparison_type === 'ATTRIBUTE'
                ? 'Which factor is more important for determining product value?'
                : `For "${q.factor_name}", which performance level is preferable?`}
            </p>

            {/* Item cards */}
            <div className="grid grid-cols-2 gap-4 mb-6">
              <div className={`rounded-lg p-3 text-center border transition-colors ${
                aWins ? 'bg-blue-50 border-blue-200' : 'bg-gray-50 border-gray-200'
              }`}>
                <div className="text-sm font-semibold text-gray-800">{q.item_a_label}</div>
                {q.comparison_type === 'LEVEL' && q.item_a_desc && (
                  <div className="text-xs text-gray-400 mt-1">{q.item_a_desc}</div>
                )}
              </div>
              <div className={`rounded-lg p-3 text-center border transition-colors ${
                !aWins && !isEqual ? 'bg-blue-50 border-blue-200' : 'bg-gray-50 border-gray-200'
              }`}>
                <div className="text-sm font-semibold text-gray-800">{q.item_b_label}</div>
                {q.comparison_type === 'LEVEL' && q.item_b_desc && (
                  <div className="text-xs text-gray-400 mt-1">{q.item_b_desc}</div>
                )}
              </div>
            </div>

            {/* Intensity label */}
            <div className="text-center text-sm font-medium text-blue-700 mb-3 h-5">
              {isEqual ? 'Equal importance' : `${aWins ? q.item_a_label : q.item_b_label} — ${iLabel}`}
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

            <div style={{ padding: '0 10px' }}>
              <input
                type="range"
                className="ahp-slider"
                min={SLIDER_MIN}
                max={SLIDER_MAX}
                step={1}
                value={sliderPos}
                onChange={e => setSliderPos(Number(e.target.value))}
              />
            </div>

            {/* Scale labels */}
            <div style={{ position: 'relative', height: '32px', marginTop: '4px', padding: '0 10px' }}>
              {[
                { pos: 0,  num: '9', name: 'Extreme' },
                { pos: 2,  num: '7', name: 'Very Strong' },
                { pos: 4,  num: '5', name: 'Strong' },
                { pos: 6,  num: '3', name: 'Moderate' },
                { pos: 8,  num: '1', name: 'Equal' },
                { pos: 10, num: '3', name: 'Moderate' },
                { pos: 12, num: '5', name: 'Strong' },
                { pos: 14, num: '7', name: 'Very Strong' },
                { pos: 16, num: '9', name: 'Extreme' },
              ].map(({ pos, num, name }) => {
                const pct = (pos / 16) * 100
                const isCenter = pos === 8
                const isFirst  = pos === 0
                const isLast   = pos === 16
                const transform = isFirst ? 'none' : isLast ? 'translateX(-100%)' : 'translateX(-50%)'
                return (
                  <div
                    key={pos}
                    style={{ position: 'absolute', left: `${pct}%`, transform, textAlign: 'center', lineHeight: 1.2 }}
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
          <div className="mb-4 bg-red-50 border border-red-200 rounded-md px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* Navigation */}
        <div className="flex items-center justify-between">
          <button
            onClick={() => saveAndGo(currentIndex - 1)}
            disabled={currentIndex === 0 || saving || submitting}
            className="px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 hover:bg-gray-50 disabled:opacity-40"
          >
            ← Previous
          </button>

          <div className="flex items-center gap-3">
            {(allAnswered || currentIndex === totalQuestions - 1) && (
              <button
                onClick={handleSubmit}
                disabled={submitting || saving}
                className="px-5 py-2 bg-green-600 text-white text-sm font-medium rounded-md hover:bg-green-700 disabled:opacity-50"
              >
                {submitting ? 'Submitting…' : 'Submit Survey ✓'}
              </button>
            )}
            {currentIndex < totalQuestions - 1 && (
              <button
                onClick={() => saveAndGo(currentIndex + 1)}
                disabled={saving || submitting}
                className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 disabled:opacity-40"
              >
                {saving ? 'Saving…' : 'Next →'}
              </button>
            )}
          </div>
        </div>

      </div>
    </div>
  )
}
