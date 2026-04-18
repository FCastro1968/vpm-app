import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import ProjectList from './ProjectList'
import { UserMenu } from '@/app/components/UserMenu'

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const displayName = user.user_metadata?.full_name ?? null

  const { data: projects } = await supabase
    .from('project')
    .select('id, name, status, updated_at')
    .order('updated_at', { ascending: false })

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-5xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-2xl font-bold text-gray-900">Value Pricing Model™</h1>
          <div className="flex items-center gap-3">
            <Link
              href="/dashboard/projects/new"
              className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700"
            >
              + New Project
            </Link>
            <UserMenu email={user.email!} displayName={displayName} />
          </div>
        </div>

        <div className="bg-white rounded-lg shadow">
          <ProjectList projects={projects ?? []} />
        </div>
      </div>
    </div>
  )
}
