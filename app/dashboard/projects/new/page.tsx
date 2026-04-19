'use client'

import { useState, useEffect, Suspense } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter, useSearchParams } from 'next/navigation'

interface Folder { id: string; name: string; parent_id: string | null }

function NewProjectForm() {
  const [name,       setName]       = useState('')
  const [folderId,   setFolderId]   = useState<string>('')
  const [folders,    setFolders]    = useState<Folder[]>([])
  const [orgId,      setOrgId]      = useState<string | null>(null)
  const [loading,    setLoading]    = useState(false)
  const [error,      setError]      = useState('')
  const router       = useRouter()
  const searchParams = useSearchParams()
  const supabase     = createClient()

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { data: membership } = await supabase
        .from('org_member')
        .select('org_id')
        .eq('user_id', user.id)
        .limit(1)
        .maybeSingle()

      if (!membership) return
      setOrgId(membership.org_id)

      const { data: folderData } = await supabase
        .from('project_folder')
        .select('id, name, parent_id')
        .eq('org_id', membership.org_id)
        .order('name')

      const list = folderData ?? []
      setFolders(list)

      const preselect = searchParams.get('folder')
      if (preselect && list.find(f => f.id === preselect)) {
        setFolderId(preselect)
      }
    }
    load()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }

    const { data: project, error: err } = await supabase
      .from('project')
      .insert({
        name,
        tenant_id:  user.id,
        owner_id:   user.id,
        status:     'DRAFT',
        org_id:     orgId ?? null,
        folder_id:  folderId || null,
        visibility: 'private',
      })
      .select('id')
      .single()

    if (err) {
      setError(err.message)
      setLoading(false)
      return
    }

    router.push(`/dashboard/projects/${project.id}/phase-1`)
  }

  const topLevel   = folders.filter(f => !f.parent_id)
  const childrenOf = (pid: string) => folders.filter(f => f.parent_id === pid)

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="bg-white rounded-lg shadow p-8 w-full max-w-md">
        <h1 className="text-xl font-bold text-gray-900 mb-1">New Project</h1>
        <p className="text-sm text-gray-500 mb-6">Give your pricing project a name to get started.</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Project name</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Q3 Product Launch Pricing"
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Folder <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <select
              value={folderId}
              onChange={e => setFolderId(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 bg-white"
            >
              <option value="">No folder</option>
              {topLevel.map(parent => {
                const children = childrenOf(parent.id)
                return (
                  <optgroup key={parent.id} label={parent.name}>
                    <option value={parent.id}>{parent.name} (top level)</option>
                    {children.map(child => (
                      <option key={child.id} value={child.id}>↳ {child.name}</option>
                    ))}
                  </optgroup>
                )
              })}
            </select>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={() => router.back()}
              className="flex-1 px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !name.trim()}
              className="flex-1 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? 'Creating…' : 'Create Project'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function NewProjectPage() {
  return (
    <Suspense>
      <NewProjectForm />
    </Suspense>
  )
}
