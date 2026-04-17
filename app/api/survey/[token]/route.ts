import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'

type Params = Promise<{ token: string }>

// ── Validate token helper ─────────────────────────────────────────────────────
// Returns the respondent row or null. Checks mode=DISTRIBUTED only.

async function validateToken(token: string) {
  const supabase = createServiceClient()
  const { data: respondent } = await supabase
    .from('respondent')
    .select('id, name, project_id, submitted_at, survey_started_at, mode')
    .eq('token', token)
    .eq('mode', 'DISTRIBUTED')
    .maybeSingle()
  if (!respondent) return null

  // Check project-level survey deadline
  const { data: project } = await supabase
    .from('project')
    .select('survey_expires_at')
    .eq('id', respondent.project_id)
    .single()

  const expires = project?.survey_expires_at
  if (expires && new Date(expires) < new Date()) {
    return { ...respondent, expired: true }
  }

  return { ...respondent, expired: false }
}

// ── GET — load survey data ────────────────────────────────────────────────────

export async function GET(request: NextRequest, { params }: { params: Params }) {
  const { token } = await params
  const supabase = createServiceClient()

  const respondent = await validateToken(token)
  if (!respondent) {
    return NextResponse.json({ error: 'Survey not found' }, { status: 404 })
  }
  if (respondent.expired) {
    return NextResponse.json({ error: 'Survey has closed' }, { status: 410 })
  }

  const projectId = respondent.project_id

  // Load factors + levels
  const { data: factorData } = await supabase
    .from('attribute')
    .select('id, name, display_order')
    .eq('project_id', projectId)
    .order('display_order')

  const factors = []
  for (const f of (factorData ?? [])) {
    const { data: levelData } = await supabase
      .from('level')
      .select('id, name, description, display_order')
      .eq('attribute_id', f.id)
      .order('display_order')
    factors.push({ ...f, levels: levelData ?? [] })
  }

  // Load existing responses for this respondent
  const { data: responses } = await supabase
    .from('pairwise_response')
    .select('comparison_type, item_a_id, item_b_id, score, direction')
    .eq('respondent_id', respondent.id)

  return NextResponse.json({
    respondentId: respondent.id,
    respondentName: respondent.name,
    submitted: !!respondent.submitted_at,
    factors,
    responses: responses ?? [],
  })
}

// ── POST — save a single pairwise response ────────────────────────────────────

export async function POST(request: NextRequest, { params }: { params: Params }) {
  const { token } = await params
  const supabase = createServiceClient()

  const respondent = await validateToken(token)
  if (!respondent) {
    return NextResponse.json({ error: 'Survey not found' }, { status: 404 })
  }
  if (respondent.expired) {
    return NextResponse.json({ error: 'Survey has closed' }, { status: 410 })
  }
  if (respondent.submitted_at) {
    return NextResponse.json({ error: 'Survey already submitted' }, { status: 403 })
  }

  const { comparison_type, item_a_id, item_b_id, score, direction } = await request.json()

  // Start the clock on first response save (Q1 → Q2 transition)
  if (!respondent.survey_started_at) {
    await supabase
      .from('respondent')
      .update({ survey_started_at: new Date().toISOString() })
      .eq('id', respondent.id)
  }

  // Delete-then-insert pattern (consistent with rest of app)
  await supabase
    .from('pairwise_response')
    .delete()
    .eq('respondent_id', respondent.id)
    .eq('comparison_type', comparison_type)
    .eq('item_a_id', item_a_id)
    .eq('item_b_id', item_b_id)

  const { error } = await supabase.from('pairwise_response').insert({
    respondent_id:   respondent.id,
    comparison_type,
    item_a_id,
    item_b_id,
    score,
    direction,
  })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

// ── PATCH — submit survey ─────────────────────────────────────────────────────

export async function PATCH(request: NextRequest, { params }: { params: Params }) {
  const { token } = await params
  const supabase = createServiceClient()

  const respondent = await validateToken(token)
  if (!respondent) {
    return NextResponse.json({ error: 'Survey not found' }, { status: 404 })
  }
  if (respondent.expired) {
    return NextResponse.json({ error: 'Survey has closed' }, { status: 410 })
  }
  if (respondent.submitted_at) {
    return NextResponse.json({ error: 'Already submitted' }, { status: 409 })
  }

  const { error } = await supabase
    .from('respondent')
    .update({ submitted_at: new Date().toISOString() })
    .eq('id', respondent.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
