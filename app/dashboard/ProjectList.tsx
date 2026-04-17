'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import CloneProjectModal from './CloneProjectModal'

interface Project {
  id: string
  name: string
  status: string
  updated_at: string
}

function statusLabel(status: string) {
  const map: Record<string, string> = {
    DRAFT:            'Draft',
    SCOPE_COMPLETE:   'Scope defined',
    FRAMEWORK_COMPLETE: 'Factor framework complete',
    SURVEY_OPEN:      'Survey open',
    SURVEY_CLOSED:    'Survey closed',
    COHERENCE_REVIEWED: 'Coherence reviewed',
    MODEL_RUN:        'Model run',
  }
  return map[status] ?? status
}

export default function ProjectList({ projects }: { projects: Project[] }) {
  const [cloneTarget, setCloneTarget]   = useState<Project | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null)
  const [deleting, setDeleting]         = useState(false)
  const router = useRouter()
  const supabase = createClient()

  async function handleDelete(p: Project) {
    setDeleting(true)
    try {
      const { error: delErr } = await supabase.from('project').delete().eq('id', p.id)
      if (delErr) {
        console.error('Delete failed:', delErr.message)
        setDeleting(false)
        return
      }
      setDeleteTarget(null)
      window.location.reload()
    } catch (err) {
      console.error('Delete failed:', err)
      setDeleting(false)
    }
  }

  if (!projects.length) {
    return (
      <div className="p-8 text-center">
        <p className="text-gray-500 text-sm">No projects yet.</p>
        <p className="text-gray-400 text-xs mt-1">Create your first project to get started.</p>
      </div>
    )
  }

  return (
    <>
      <ul className="divide-y divide-gray-100">
        {projects.map(project => (
          <li key={project.id} className="flex items-center justify-between px-6 py-4 hover:bg-gray-50 group">
            <Link href={`/dashboard/projects/${project.id}`} className="flex-1 min-w-0">
              <p className="font-medium text-gray-900">{project.name}</p>
              <p className="text-xs text-gray-400 mt-0.5">{statusLabel(project.status)}</p>
            </Link>
            <div className="flex items-center gap-4 ml-4 shrink-0">
              <span className="text-xs text-gray-400">
                {new Date(project.updated_at).toLocaleDateString()}
              </span>
              <button
                onClick={() => setCloneTarget(project)}
                className="text-xs text-gray-400 hover:text-blue-600 opacity-0 group-hover:opacity-100 transition-opacity px-2 py-1 rounded hover:bg-blue-50"
                title="Clone project"
              >
                ⎘ Clone
              </button>
              <button
                onClick={() => setDeleteTarget(project)}
                className="text-xs text-gray-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity px-2 py-1 rounded hover:bg-red-50"
                title="Delete project"
              >
                ✕ Delete
              </button>
            </div>
          </li>
        ))}
      </ul>

      {deleteTarget && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6">
            <h2 className="text-base font-semibold text-gray-900 mb-1">Delete Project</h2>
            <p className="text-sm text-gray-500 mb-4">
              Are you sure you want to delete <strong>"{deleteTarget.name}"</strong>? This cannot be undone.
            </p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setDeleteTarget(null)} disabled={deleting}
                className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50">
                Cancel
              </button>
              <button onClick={() => handleDelete(deleteTarget)} disabled={deleting}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700 disabled:opacity-50">
                {deleting ? 'Deleting…' : 'Delete Project'}
              </button>
            </div>
          </div>
        </div>
      )}

      {cloneTarget && (
        <CloneProjectModal
          project={cloneTarget}
          onClose={() => setCloneTarget(null)}
        />
      )}
    </>
  )
}
