import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { data: projects } = await supabase
    .from('project')
    .select('id, name, status, updated_at')
    .order('updated_at', { ascending: false })

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-5xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Value Pricing Model™</h1>
            <p className="text-sm text-gray-500 mt-1">Signed in as {user.email}</p>
          </div>
          <Link
            href="/dashboard/projects/new"
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700"
          >
            + New Project
          </Link>
        </div>

        <div className="bg-white rounded-lg shadow">
          {!projects || projects.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-gray-500 text-sm">No projects yet.</p>
              <p className="text-gray-400 text-xs mt-1">Create your first project to get started.</p>
            </div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {projects.map((project) => (
                <li key={project.id}>
                  <Link
                    href={`/dashboard/projects/${project.id}`}
                    className="flex items-center justify-between px-6 py-4 hover:bg-gray-50"
                  >
                    <div>
                      <p className="font-medium text-gray-900">{project.name}</p>
                      <p className="text-xs text-gray-400 mt-0.5">{project.status}</p>
                    </div>
                    <span className="text-xs text-gray-400">
                      {new Date(project.updated_at).toLocaleDateString()}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}