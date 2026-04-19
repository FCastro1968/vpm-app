'use client'

import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import CloneProjectModal from './CloneProjectModal'
import type { Folder, Project } from './DashboardClient'

function statusLabel(status: string) {
  const map: Record<string, string> = {
    DRAFT:               'Draft',
    SCOPE_COMPLETE:      'Scope defined',
    FRAMEWORK_COMPLETE:  'Factor framework complete',
    SURVEY_OPEN:         'Survey open',
    SURVEY_CLOSED:       'Survey closed',
    COHERENCE_REVIEWED:  'Coherence reviewed',
    UTILITIES_DERIVED:   'Utilities derived',
    MODEL_RUN:           'Model run',
    COMPLETE:            'Complete',
  }
  return map[status] ?? status
}

export default function ProjectList({
  projects,
  folders,
  onProjectMoved,
  onProjectDeleted,
  onVisibilityChanged,
  alwaysShowActions = false,
}: {
  projects: Project[]
  folders: Folder[]
  onProjectMoved: (projectId: string, folderId: string | null) => void
  onProjectDeleted: (projectId: string) => void
  onVisibilityChanged: (projectId: string, visibility: string) => void
  alwaysShowActions?: boolean
}) {
  const [cloneTarget,  setCloneTarget]  = useState<Project | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null)
  const [deleting,     setDeleting]     = useState(false)
  const [movingId,     setMovingId]     = useState<string | null>(null)
  const supabase = createClient()

  async function handleDelete(p: Project) {
    setDeleting(true)
    try {
      const { error } = await supabase.from('project').delete().eq('id', p.id)
      if (!error) {
        setDeleteTarget(null)
        onProjectDeleted(p.id)
      }
    } finally {
      setDeleting(false)
    }
  }

  async function moveToFolder(projectId: string, folderId: string | null) {
    const { error } = await supabase
      .from('project')
      .update({ folder_id: folderId })
      .eq('id', projectId)
    if (!error) onProjectMoved(projectId, folderId)
    setMovingId(null)
  }

  async function cycleVisibility(project: Project) {
    const next = project.visibility === 'private' ? 'team' : project.visibility === 'team' ? 'shared' : 'private'
    const { error } = await supabase.from('project').update({ visibility: next }).eq('id', project.id)
    if (!error) onVisibilityChanged(project.id, next)
  }

  if (!projects.length) {
    return (
      <div className="p-8 text-center">
        <p className="text-gray-500 text-sm">No projects here.</p>
        <p className="text-gray-400 text-xs mt-1">Create a project or move one into this folder.</p>
      </div>
    )
  }

  return (
    <>
      <ul className="divide-y divide-gray-100">
        {projects.map(project => {
          const folderName = folders.find(f => f.id === project.folder_id)?.name
          return (
            <li key={project.id} className="flex items-center justify-between px-6 py-4 hover:bg-gray-50 group relative">
              <Link href={`/dashboard/projects/${project.id}`} className="flex-1 min-w-0">
                <p className="font-medium text-gray-900">{project.name}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <p className="text-xs text-gray-400">{statusLabel(project.status)}</p>
                  {folderName && (
                    <span className="inline-flex items-center gap-1 text-xs text-gray-400">
                      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M2 6a2 2 0 012-2h4l2 2h4a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
                      </svg>
                      {folderName}
                    </span>
                  )}
                </div>
              </Link>

              <div className="flex items-center gap-3 ml-4 shrink-0">
                <button
                  onClick={e => { e.preventDefault(); cycleVisibility(project) }}
                  title={`Visibility: ${project.visibility}. Click to change.`}
                  className={alwaysShowActions ? '' : 'opacity-0 group-hover:opacity-100 transition-opacity'}
                >
                  <VisibilityBadge visibility={project.visibility} />
                </button>
                <span className="text-xs text-gray-400">
                  {new Date(project.updated_at).toLocaleDateString()}
                </span>

                {/* Move to folder */}
                <div className={`relative ${alwaysShowActions ? '' : 'opacity-0 group-hover:opacity-100 transition-opacity'}`}>
                  <button
                    onClick={() => setMovingId(movingId === project.id ? null : project.id)}
                    className="text-xs text-gray-400 hover:text-blue-600 px-2 py-1 rounded hover:bg-blue-50 flex items-center gap-1"
                    title="Move to folder"
                  >
                    <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M2 6a2 2 0 012-2h4l2 2h4a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
                    </svg>
                    Move
                  </button>
                  {movingId === project.id && (
                    <FolderDropdown
                      folders={folders}
                      currentFolderId={project.folder_id}
                      onSelect={folderId => moveToFolder(project.id, folderId)}
                      onClose={() => setMovingId(null)}
                    />
                  )}
                </div>

                <button
                  onClick={() => setCloneTarget(project)}
                  className={`text-xs text-gray-400 hover:text-blue-600 px-2 py-1 rounded hover:bg-blue-50 ${alwaysShowActions ? '' : 'opacity-0 group-hover:opacity-100 transition-opacity'}`}
                  title="Clone project"
                >
                  ⎘ Clone
                </button>
                <button
                  onClick={() => setDeleteTarget(project)}
                  className={`text-xs text-gray-400 hover:text-red-600 px-2 py-1 rounded hover:bg-red-50 ${alwaysShowActions ? '' : 'opacity-0 group-hover:opacity-100 transition-opacity'}`}
                  title="Delete project"
                >
                  ✕ Delete
                </button>
              </div>
            </li>
          )
        })}
      </ul>

      {deleteTarget && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6">
            <h2 className="text-base font-semibold text-gray-900 mb-1">Delete Project</h2>
            <p className="text-sm text-gray-500 mb-4">
              Are you sure you want to delete <strong>"{deleteTarget.name}"</strong>? This cannot be undone.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
                className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(deleteTarget)}
                disabled={deleting}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700 disabled:opacity-50"
              >
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

function FolderDropdown({
  folders,
  currentFolderId,
  onSelect,
  onClose,
}: {
  folders: Folder[]
  currentFolderId: string | null
  onSelect: (folderId: string | null) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  const topLevel   = folders.filter(f => !f.parent_id).sort((a, b) => a.name.localeCompare(b.name))
  const childrenOf = (pid: string) => folders.filter(f => f.parent_id === pid).sort((a, b) => a.name.localeCompare(b.name))

  return (
    <div
      ref={ref}
      className="absolute right-0 top-full mt-1 z-30 bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-[200px] max-h-72 overflow-y-auto"
    >
      <p className="px-3 py-1.5 text-xs font-semibold text-gray-400 uppercase tracking-wider border-b border-gray-100">
        Move to folder
      </p>
      {currentFolderId && (
        <button
          onClick={() => onSelect(null)}
          className="w-full text-left px-3 py-2 text-sm text-gray-500 hover:bg-gray-50 italic"
        >
          Remove from folder
        </button>
      )}
      {folders.length === 0 && (
        <p className="px-3 py-2 text-sm text-gray-400">No folders yet</p>
      )}
      {topLevel.map(parent => {
        const children = childrenOf(parent.id)
        return (
          <div key={parent.id}>
            <button
              onClick={() => onSelect(parent.id)}
              className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-50 flex items-center gap-2 ${
                parent.id === currentFolderId ? 'text-blue-600 font-medium' : 'text-gray-700'
              }`}
            >
              <FolderSvg className="w-3.5 h-3.5 text-gray-400 shrink-0" />
              {parent.name}
              {parent.id === currentFolderId && <span className="ml-auto text-xs">✓</span>}
            </button>
            {children.map(child => (
              <button
                key={child.id}
                onClick={() => onSelect(child.id)}
                className={`w-full text-left pl-8 pr-3 py-2 text-sm hover:bg-gray-50 flex items-center gap-2 ${
                  child.id === currentFolderId ? 'text-blue-600 font-medium' : 'text-gray-600'
                }`}
              >
                <FolderSvg className="w-3 h-3 text-gray-300 shrink-0" />
                {child.name}
                {child.id === currentFolderId && <span className="ml-auto text-xs">✓</span>}
              </button>
            ))}
          </div>
        )
      })}
    </div>
  )
}

function VisibilityBadge({ visibility }: { visibility: string }) {
  if (visibility === 'team') return (
    <span className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded bg-blue-50 text-blue-600">
      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a4 4 0 00-5-3.87M9 20H4v-2a4 4 0 015-3.87m6-4a4 4 0 11-8 0 4 4 0 018 0zm6 4a2 2 0 100-4 2 2 0 000 4zM3 20a2 2 0 100-4 2 2 0 000 4z" />
      </svg>
      Team
    </span>
  )
  if (visibility === 'shared') return (
    <span className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded bg-green-50 text-green-600">
      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
      </svg>
      Shared
    </span>
  )
  return (
    <span className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded bg-gray-50 text-gray-400">
      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
      </svg>
      Private
    </span>
  )
}

function FolderSvg({ className }: { className?: string }) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 20 20">
      <path d="M2 6a2 2 0 012-2h4l2 2h4a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
    </svg>
  )
}
