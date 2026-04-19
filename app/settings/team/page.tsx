import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import TeamClient from './TeamClient'

export default async function TeamPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Load user's primary org
  const { data: membership } = await supabase
    .from('org_member')
    .select('org_id, role')
    .eq('user_id', user.id)
    .limit(1)
    .maybeSingle()

  if (!membership) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold text-gray-900">Team</h1>
        <p className="text-sm text-gray-500">No workspace found. Visit the dashboard to set one up.</p>
      </div>
    )
  }

  const { data: members } = await supabase
    .from('org_member')
    .select('id, user_id, role, invited_email, joined_at, created_at')
    .eq('org_id', membership.org_id)
    .order('created_at')

  return (
    <TeamClient
      orgId={membership.org_id}
      currentUserId={user.id}
      currentRole={membership.role}
      members={members ?? []}
    />
  )
}
