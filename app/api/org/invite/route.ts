import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { NextResponse } from 'next/server'

export async function POST(req: Request) {
  const { email, role, orgId } = await req.json()
  if (!email || !orgId) return NextResponse.json({ error: 'Missing fields' }, { status: 400 })

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = createServiceClient()

  // Verify caller is owner/admin of this org
  const { data: membership } = await service
    .from('org_member')
    .select('role')
    .eq('org_id', orgId)
    .eq('user_id', user.id)
    .in('role', ['owner', 'admin'])
    .maybeSingle()

  if (!membership) return NextResponse.json({ error: 'Not authorized for this workspace' }, { status: 403 })

  // Check for duplicate
  const { data: existing } = await service
    .from('org_member')
    .select('id')
    .eq('org_id', orgId)
    .ilike('invited_email', email.trim())
    .maybeSingle()

  if (existing) return NextResponse.json({ error: 'This email already has a pending invite or is already a member.' }, { status: 409 })

  const { data, error } = await service
    .from('org_member')
    .insert({ org_id: orgId, user_id: null, role, invited_email: email.trim().toLowerCase() })
    .select('id, user_id, role, invited_email, joined_at, created_at')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ member: data })
}

export async function DELETE(req: Request) {
  const { memberId, orgId } = await req.json()
  if (!memberId || !orgId) return NextResponse.json({ error: 'Missing fields' }, { status: 400 })

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = createServiceClient()

  const { data: membership } = await service
    .from('org_member')
    .select('role')
    .eq('org_id', orgId)
    .eq('user_id', user.id)
    .in('role', ['owner', 'admin'])
    .maybeSingle()

  if (!membership) return NextResponse.json({ error: 'Not authorized' }, { status: 403 })

  const { error } = await service.from('org_member').delete().eq('id', memberId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function PATCH(req: Request) {
  const { memberId, orgId, role } = await req.json()
  if (!memberId || !orgId || !role) return NextResponse.json({ error: 'Missing fields' }, { status: 400 })

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = createServiceClient()

  const { data: membership } = await service
    .from('org_member')
    .select('role')
    .eq('org_id', orgId)
    .eq('user_id', user.id)
    .in('role', ['owner', 'admin'])
    .maybeSingle()

  if (!membership) return NextResponse.json({ error: 'Not authorized' }, { status: 403 })

  const { error } = await service.from('org_member').update({ role }).eq('id', memberId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
