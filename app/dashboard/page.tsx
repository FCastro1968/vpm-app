import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { UserMenu } from '@/app/components/UserMenu'
import DashboardClient from './DashboardClient'

async function ensurePersonalOrg(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  userEmail: string,
) {
  // Accept any pending invites for this email first
  const { data: pending } = await supabase
    .from('org_member')
    .select('id')
    .is('user_id', null)
    .eq('invited_email', userEmail)
  if (pending?.length) {
    await supabase
      .from('org_member')
      .update({ user_id: userId, joined_at: new Date().toISOString() })
      .is('user_id', null)
      .eq('invited_email', userEmail)
  }

  // Return first org this user owns or belongs to
  const { data: membership } = await supabase
    .from('org_member')
    .select('org_id')
    .eq('user_id', userId)
    .limit(1)
    .maybeSingle()

  if (membership) return membership.org_id as string

  // No org yet — create personal workspace
  const { data: org, error } = await supabase
    .from('org')
    .insert({ name: 'My Workspace', created_by: userId })
    .select('id')
    .single()

  if (error || !org) return null

  await supabase.from('org_member').insert({
    org_id: org.id,
    user_id: userId,
    role: 'owner',
    invited_email: userEmail,
    joined_at: new Date().toISOString(),
  })

  return org.id as string
}

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const displayName = user.user_metadata?.full_name ?? null
  const orgId = await ensurePersonalOrg(supabase, user.id, user.email!)

  // Backfill org_id for projects created before workspace feature
  if (orgId) {
    await supabase
      .from('project')
      .update({ org_id: orgId })
      .eq('owner_id', user.id)
      .is('org_id', null)
  }

  const [{ data: projects }, { data: folders }] = await Promise.all([
    supabase
      .from('project')
      .select('id, name, status, updated_at, folder_id, visibility')
      .order('updated_at', { ascending: false }),
    orgId
      ? supabase
          .from('project_folder')
          .select('id, name, parent_id')
          .eq('org_id', orgId)
          .order('name')
      : Promise.resolve({ data: [] as { id: string; name: string; parent_id: string | null }[] }),
  ])

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-6xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Value Pricing Model™</h1>
          <UserMenu email={user.email!} displayName={displayName} />
        </div>
        <DashboardClient
          projects={projects ?? []}
          folders={folders ?? []}
          orgId={orgId}
        />
      </div>
    </div>
  )
}
