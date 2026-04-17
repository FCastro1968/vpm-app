'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

interface Project {
  id: string
  name: string
  status: string
  updated_at: string
}

interface Props {
  project: Project
  onClose: () => void
}

export default function CloneProjectModal({ project, onClose }: Props) {
  const supabase = createClient()
  const router = useRouter()

  const [newName, setNewName]               = useState(`${project.name} — Copy`)
  const [includeBenchmarks, setIncludeBenchmarks] = useState(true)
  const [includeRespondents, setIncludeRespondents] = useState(true)
  const [includeSurveyData, setIncludeSurveyData]   = useState(false)
  const [includeSolverData, setIncludeSolverData]   = useState(false)
  const [cloning, setCloning]               = useState(false)
  const [error, setError]                   = useState('')

  const allChecked = includeBenchmarks && includeRespondents && includeSurveyData && includeSolverData
  function toggleAll() {
    const next = !allChecked
    setIncludeBenchmarks(next)
    setIncludeRespondents(next)
    setIncludeSurveyData(next)
    setIncludeSolverData(next)
  }

  async function handleClone() {
    if (!newName.trim()) { setError('Project name is required.'); return }
    setCloning(true)
    setError('')

    try {
      const supabase = createClient()

      // ── 0. Get current user for RLS ──────────────────────────────────────
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not authenticated.')

      // ── 1. Fetch source project record ──────────────────────────────────
      const { data: srcProject } = await supabase
        .from('project')
        .select('*')
        .eq('id', project.id)
        .single()
      if (!srcProject) throw new Error('Source project not found.')

      // ── 2. Create new project ────────────────────────────────────────────
      const { data: newProject, error: projErr } = await supabase
        .from('project')
        .insert({
          name: newName.trim(),
          status: 'SCOPE_COMPLETE',
          owner_id: user.id,
          tenant_id: user.id,
          use_case_type: srcProject.use_case_type,
          category_anchor: srcProject.category_anchor,
          benchmark_price_basis: srcProject.benchmark_price_basis,
          benchmark_price_basis_custom_description: srcProject.benchmark_price_basis_custom_description,
          currency: srcProject.currency,
          geographic_scope: srcProject.geographic_scope,
          cloned_from_project_id: project.id,
        })
        .select()
        .single()
      if (projErr || !newProject) throw new Error(projErr?.message ?? 'Failed to create project.')
      const newId = newProject.id

      // ── 3. Copy factors ──────────────────────────────────────────────────
      const { data: srcFactors } = await supabase
        .from('attribute')
        .select('*')
        .eq('project_id', project.id)
        .order('display_order')

      const factorIdMap: Record<string, string> = {}
      if (srcFactors?.length) {
        for (const f of srcFactors) {
          const { data: newFactor, error: fErr } = await supabase
            .from('attribute')
            .insert({ project_id: newId, name: f.name, description: f.description, display_order: f.display_order })
            .select()
            .single()
          if (fErr) console.error('FACTOR INSERT ERROR:', fErr.message)
          if (newFactor) factorIdMap[f.id] = newFactor.id
        }
      }

      // ── 4. Copy levels ───────────────────────────────────────────────────
      const { data: srcLevels } = await supabase
        .from('level')
        .select('*')
        .in('attribute_id', Object.keys(factorIdMap))
        .order('display_order')

      const levelIdMap: Record<string, string> = {}
      if (srcLevels?.length) {
        for (const l of srcLevels) {
          const { data: newLevel, error: lErr } = await supabase
            .from('level')
            .insert({
              attribute_id: factorIdMap[l.attribute_id],
              name: l.name,
              description: l.description,
              display_order: l.display_order,
            })
            .select()
            .single()
          if (lErr) console.error('LEVEL INSERT ERROR:', lErr.message)
          if (newLevel) levelIdMap[l.id] = newLevel.id
        }
      }
      // Verify: fetch actual levels in new project and compare
      const { data: verifyLevels } = await supabase.from('level').select('id, attribute_id').in('attribute_id', Object.values(factorIdMap))

      // ── 5. Copy benchmarks (optional) ────────────────────────────────────
      const benchmarkIdMap: Record<string, string> = {}
      if (includeBenchmarks) {
        const { data: srcBenchmarks } = await supabase
          .from('benchmark')
          .select('*')
          .eq('project_id', project.id)
          .order('name')

        if (srcBenchmarks?.length) {
          for (const b of srcBenchmarks) {
            const { data: newBench } = await supabase
              .from('benchmark')
              .insert({
                project_id: newId,
                name: b.name,
                market_price: b.market_price,
                market_share_pct: b.market_share_pct,
                market_share_source: b.market_share_source,
                market_share_confidence: b.market_share_confidence,
                market_share_ai_assisted: b.market_share_ai_assisted,
                included_in_regression: true,
                exclusion_reason: null,
              })
              .select()
              .single()
            if (newBench) benchmarkIdMap[b.id] = newBench.id
          }

          // Copy benchmark level assignments — fetch by source benchmark IDs
          const srcBenchIds = Object.keys(benchmarkIdMap)
          const { data: srcAssignments } = await supabase
            .from('benchmark_level_assignment')
            .select('*')
            .in('benchmark_id', srcBenchIds)

          if (srcAssignments?.length) {
            const newAssignments = srcAssignments
              .filter(a => benchmarkIdMap[a.benchmark_id] && factorIdMap[a.attribute_id] && levelIdMap[a.level_id])
              .map(a => ({
                benchmark_id: benchmarkIdMap[a.benchmark_id],
                attribute_id: factorIdMap[a.attribute_id],
                level_id:     levelIdMap[a.level_id],
              }))
            if (newAssignments.length) {
              await supabase.from('benchmark_level_assignment').insert(newAssignments)
            }
          }
        }
      }

      // ── 6. Copy respondents (optional) ───────────────────────────────────
      const respondentIdMap: Record<string, string> = {}
      if (includeRespondents) {
        const { data: srcRespondents } = await supabase
          .from('respondent')
          .select('*')
          .eq('project_id', project.id)
          .eq('included', true)         // only copy included respondents
          .order('created_at', { ascending: true })

        // Deduplicate by email — keep first (oldest) per email
        const seenEmails = new Set<string>()
        const uniqueRespondents = (srcRespondents ?? []).filter(r => {
          if (seenEmails.has(r.email)) return false
          seenEmails.add(r.email)
          return true
        })

        if (uniqueRespondents.length) {
          for (const r of uniqueRespondents) {
            const { data: newResp } = await supabase
              .from('respondent')
              .insert({
                project_id: newId,
                name: r.name,
                email: r.email,
                mode: r.mode,
                included: true,
                exclusion_reason: null,
              })
              .select()
              .single()
            if (newResp) respondentIdMap[r.id] = newResp.id
          }
        }
      }

      // ── 7. Copy target products & level assignments ───────────────────────
      const { data: srcTargets } = await supabase
        .from('target_product')
        .select('*')
        .eq('project_id', project.id)
        .order('display_order')

      if (srcTargets?.length) {
        for (const t of srcTargets) {
          const { data: newTarget } = await supabase
            .from('target_product')
            .insert({
              project_id: newId,
              name: t.name,
              use_case_type: t.use_case_type,
              current_price: t.current_price,
              display_order: t.display_order,
            })
            .select()
            .single()
          if (!newTarget) continue

          // Copy target level assignments (target_score level_assignments_json)
          const { data: srcScore, error: tsErr } = await supabase
            .from('target_score')
            .select('level_assignments_json')
            .eq('target_product_id', t.id)
            .eq('project_id', project.id)
            .is('scenario_id', null)
            .maybeSingle()

          if (srcScore?.level_assignments_json) {
            // Remap level IDs in assignments
            const oldAssignments = srcScore.level_assignments_json as Record<string, string>
            const newAssignments: Record<string, string> = {}
            for (const [oldAttrId, oldLevelId] of Object.entries(oldAssignments)) {
              const newAttrId  = factorIdMap[oldAttrId]
              const newLevelId = levelIdMap[oldLevelId]
              if (newAttrId && newLevelId) newAssignments[newAttrId] = newLevelId
            }
            await supabase.from('target_score').insert({
              project_id:             newId,
              target_product_id:      newTarget.id,
              scenario_id:            null,
              level_assignments_json: newAssignments,
            })
          }
        }
      }

      // ── 8. Copy survey responses & derived data (optional) ───────────────
      if (includeSurveyData) {
        // Ensure we have respondents copied — fetch source respondents directly
        // even if includeRespondents checkbox was off, survey data requires them
        if (!Object.keys(respondentIdMap).length) {
          const { data: fallbackRespondents } = await supabase
            .from('respondent')
            .select('*')
            .eq('project_id', project.id)
            .eq('included', true)
            .order('created_at', { ascending: true })
          const seenFallback = new Set<string>()
          const uniqueFallback = (fallbackRespondents ?? []).filter(r => {
            if (seenFallback.has(r.email)) return false
            seenFallback.add(r.email)
            return true
          })
          for (const r of uniqueFallback) {
            const { data: newResp } = await supabase
              .from('respondent')
              .insert({ project_id: newId, name: r.name, email: r.email, mode: r.mode, included: true, exclusion_reason: null })
              .select().single()
            if (newResp) respondentIdMap[r.id] = newResp.id
          }
        }

        // Fetch responses using source respondent IDs
        const srcRespondentIds = Object.keys(respondentIdMap)
        const { data: srcResponses, error: respErr } = await supabase
          .from('pairwise_response')
          .select('*')
          .in('respondent_id', srcRespondentIds)
        if (srcResponses?.length) console.log('first src response item_a_id:', srcResponses[0].item_a_id, '-> maps to:', levelIdMap[srcResponses[0].item_a_id] ?? factorIdMap[srcResponses[0].item_a_id] ?? 'NOT FOUND')

        // Delete any stale responses already under the new respondent IDs before inserting
        const newRespondentIds = Object.values(respondentIdMap)
        if (newRespondentIds.length) {
          await supabase.from('pairwise_response').delete().in('respondent_id', newRespondentIds)
        }

        if (srcResponses?.length) {
          const newResponses = srcResponses
            .filter(r => respondentIdMap[r.respondent_id]) // skip orphaned respondents
            .map(r => ({
              respondent_id:   respondentIdMap[r.respondent_id],
              comparison_type: r.comparison_type,
              item_a_id:       r.comparison_type.toLowerCase() === 'attribute'
                                 ? factorIdMap[r.item_a_id]
                                 : levelIdMap[r.item_a_id],
              item_b_id:       r.comparison_type.toLowerCase() === 'attribute'
                                 ? factorIdMap[r.item_b_id]
                                 : levelIdMap[r.item_b_id],
              score:     r.score,
              direction: r.direction,
            })).filter(r => r.item_a_id && r.item_b_id)
          if (newResponses.length) {
            // Insert in chunks of 50 to avoid Supabase batch size limits
            const chunkSize = 50
            for (let i = 0; i < newResponses.length; i += chunkSize) {
              const chunk = newResponses.slice(i, i + chunkSize)
              const { error: prErr } = await supabase.from('pairwise_response').insert(chunk)
              if (prErr) {
                console.error('PAIRWISE INSERT ERROR chunk', i, ':', prErr.message, JSON.stringify(chunk[0]))
                break
              }
            }
          }
        }

        // Copy aggregated matrices
        const { data: srcMatrices } = await supabase
          .from('aggregated_matrix')
          .select('*')
          .eq('project_id', project.id)

        if (srcMatrices?.length) {
          for (const mx of srcMatrices) {
            const { error: mxErr } = await supabase.from('aggregated_matrix').insert({
              project_id:      newId,
              comparison_type: mx.comparison_type,
              attribute_id:    mx.attribute_id ? factorIdMap[mx.attribute_id] : null,
              matrix_json:     mx.matrix_json,
              cr_score:        mx.cr_score,
            })
            if (mxErr) { console.error('MATRIX INSERT ERROR:', mxErr.message); break }
          }
        }

        // Copy attribute weights
        const { data: srcWeights } = await supabase
          .from('attribute_weight')
          .select('*')
          .eq('project_id', project.id)

        if (srcWeights?.length) {
          const { error: wErr } = await supabase.from('attribute_weight').insert(
            srcWeights.map(w => ({
              project_id:   newId,
              attribute_id: factorIdMap[w.attribute_id],
              weight:       w.weight,
            })).filter(w => w.attribute_id)
          )
          if (wErr) console.error('WEIGHT INSERT ERROR:', wErr.message)
        }

        // Copy level utilities
        const { data: srcUtilities } = await supabase
          .from('level_utility')
          .select('*')
          .eq('project_id', project.id)

        if (srcUtilities?.length) {
          const { error: uErr } = await supabase.from('level_utility').insert(
            srcUtilities.map(u => ({
              project_id: newId,
              level_id:   levelIdMap[u.level_id],
              utility:    u.utility,
            })).filter(u => u.level_id)
          )
          if (uErr) console.error('UTILITY INSERT ERROR:', uErr.message)
        }
      }

      // Status will be updated when user navigates through phases in the cloned project

      // ── 9. Copy solver results (optional) ────────────────────────────────
      if (includeSolverData) {
        const { data: srcReg } = await supabase
          .from('regression_result')
          .select('*')
          .eq('project_id', project.id)
          .is('scenario_id', null)
          .maybeSingle()

        if (srcReg) {
          await supabase.from('regression_result').insert({
            project_id:           newId,
            scenario_id:          null,
            b_value:              srcReg.b_value,
            m_value:              srcReg.m_value,
            weighted_sse:         srcReg.weighted_sse,
            r_squared_weighted:   srcReg.r_squared_weighted,
            near_equivalent_flag: srcReg.near_equivalent_flag,
          })
        }

        // Copy target score results
        const { data: srcTargetScores } = await supabase
          .from('target_score')
          .select('*')
          .eq('project_id', project.id)
          .is('scenario_id', null)

        if (srcTargetScores?.length) {
          for (const ts of srcTargetScores) {
            await supabase
              .from('target_score')
              .update({
                normalized_score:       ts.normalized_score,
                point_estimate:         ts.point_estimate,
                uncertainty_range_low:  ts.uncertainty_range_low,
                uncertainty_range_high: ts.uncertainty_range_high,
              })
              .eq('project_id', newId)
              .is('scenario_id', null)
          }
        }

        // Status reflects solver complete
        await supabase
          .from('project')
          .update({ status: 'MODEL_RUN' })
          .eq('id', newId)
      }

      router.push(`/dashboard/projects/${newId}`)
      router.refresh()
      onClose()

    } catch (err: any) {
      setError(err.message ?? 'Clone failed.')
      setCloning(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
        <div className="px-6 py-5 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">Clone Project</h2>
          <p className="text-xs text-gray-500 mt-0.5">"{project.name}"</p>
        </div>

        <div className="px-6 py-5 space-y-5">
          {/* New name */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">New project name</label>
            <input
              type="text"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Always included */}
          <div>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Always included</p>
            <div className="space-y-1 text-xs text-gray-500 pl-1">
              <p>✓ Factor framework (factors & levels)</p>
              <p>✓ Target product level assignments</p>
            </div>
          </div>

          {/* Included by default */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Include</p>
              <button onClick={toggleAll} className="text-xs text-blue-600 hover:text-blue-700 font-medium">
                {allChecked ? 'Deselect all' : 'Select all'}
              </button>
            </div>
            <div className="space-y-2">
              <label className="flex items-start gap-3 cursor-pointer">
                <input type="checkbox" checked={includeBenchmarks} onChange={e => setIncludeBenchmarks(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-600" />
                <div>
                  <p className="text-sm text-gray-800">Benchmark list with prices & market shares</p>
                  <p className="text-xs text-gray-400">All reference products, prices, and share estimates</p>
                </div>
              </label>
              <label className="flex items-start gap-3 cursor-pointer">
                <input type="checkbox" checked={includeRespondents} onChange={e => setIncludeRespondents(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-600" />
                <div>
                  <p className="text-sm text-gray-800">Respondent roster</p>
                  <p className="text-xs text-gray-400">Survey participant list (responses not included unless selected below)</p>
                </div>
              </label>
              <label className="flex items-start gap-3 cursor-pointer">
                <input type="checkbox" checked={includeSurveyData} onChange={e => setIncludeSurveyData(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-600" />
                <div>
                  <p className="text-sm text-gray-800">Survey responses & derived outputs</p>
                  <p className="text-xs text-gray-400">Pairwise responses, aggregated matrices, importance scores, performance scores</p>
                </div>
              </label>
              <label className="flex items-start gap-3 cursor-pointer">
                <input type="checkbox" checked={includeSolverData} onChange={e => setIncludeSolverData(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-600" />
                <div>
                  <p className="text-sm text-gray-800">Solver results & model outputs</p>
                  <p className="text-xs text-gray-400">Price recommendations, model fit, sensitivity analysis</p>
                </div>
              </label>
            </div>
          </div>

          {error && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</p>
          )}
        </div>

        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
          <button onClick={onClose} disabled={cloning}
            className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50">
            Cancel
          </button>
          <button onClick={handleClone} disabled={cloning}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50">
            {cloning ? 'Cloning…' : 'Clone Project'}
          </button>
        </div>
      </div>
    </div>
  )
}
