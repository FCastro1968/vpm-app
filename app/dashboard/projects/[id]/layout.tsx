import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import ProjectNav from './ProjectNav'

export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: project } = await supabase
    .from('project')
    .select('id, name, status')
    .eq('id', id)
    .single()

  if (!project) redirect('/dashboard')

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* Left nav */}
      <ProjectNav project={project} />

      {/* Main content */}
      <main className="flex-1 p-8 overflow-y-auto">
        {children}
      </main>
    </div>
  )
}