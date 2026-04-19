'use client'

import { useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import ProjectList from './ProjectList'

export interface Folder { id: string; name: string; parent_id: string | null }
export interface Project {
  id: string
  name: string
  status: string
  updated_at: string
  folder_id: string | null
  visibility: string
}

export default function DashboardClient({
  projects: initialProjects,
  folders: initialFolders,
  orgId,
}: {
  projects: Project[]
  folders: Folder[]
  orgId: string | null
}) {
  const [projects, setProjects]           = useState(initialProjects)
  const [folders, setFolders]             = useState(initialFolders)
  const [selected, setSelected]           = useState<string | null>(null)
  const [expanded, setExpanded]           = useState<Set<string>>(new Set())
  const [editingId, setEditingId]         = useState<string | null>(null)
  const [editName, setEditName]           = useState('')
  const [creatingTop, setCreatingTop]     = useState(false)
  const [newTopName, setNewTopName]       = useState('')
  const [creatingSub, setCreatingSub]     = useState<string | null>(null) // parent id
  const [newSubName, setNewSubName]       = useState('')
  const supabase = createClient()

  const topLevel  = folders.filter(f => !f.parent_id)
    .sort((a, b) => a.name.localeCompare(b.name))
  const childrenOf = (pid: string) =>
    folders.filter(f => f.parent_id === pid).sort((a, b) => a.name.localeCompare(b.name))

  // Projects directly in a folder or any of its children
  function folderProjects(folderId: string) {
    const childIds = folders.filter(f => f.parent_id === folderId).map(f => f.id)
    return projects.filter(p => p.folder_id === folderId || childIds.includes(p.folder_id ?? ''))
  }

  const filtered =
    selected === '__unfiled__' ? projects.filter(p => !p.folder_id) :
    selected ? (() => {
      const f = folders.find(f => f.id === selected)
      return f && !f.parent_id ? folderProjects(selected) : projects.filter(p => p.folder_id === selected)
    })() :
    projects

  function toggleExpand(id: string) {
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  async function createFolder(name: string, parentId: string | null) {
    if (!name.trim() || !orgId) return
    const { data, error } = await supabase
      .from('project_folder')
      .insert({ name: name.trim(), org_id: orgId, parent_id: parentId })
      .select('id, name, parent_id')
      .single()
    if (!error && data) {
      setFolders(prev => [...prev, data as Folder])
      if (parentId) setExpanded(prev => new Set([...prev, parentId]))
    }
  }

  async function renameFolder(id: string) {
    if (!editName.trim()) { setEditingId(null); return }
    const { error } = await supabase
      .from('project_folder').update({ name: editName.trim() }).eq('id', id)
    if (!error)
      setFolders(prev => prev.map(f => f.id === id ? { ...f, name: editName.trim() } : f))
    setEditingId(null)
  }

  async function deleteFolder(id: string) {
    // Unassign projects in this folder (and sub-folders cascade via FK SET NULL)
    await supabase.from('project').update({ folder_id: null }).eq('folder_id', id)
    const childIds = folders.filter(f => f.parent_id === id).map(f => f.id)
    for (const cid of childIds)
      await supabase.from('project').update({ folder_id: null }).eq('folder_id', cid)

    await supabase.from('project_folder').delete().eq('id', id)
    setFolders(prev => prev.filter(f => f.id !== id && f.parent_id !== id))
    setProjects(prev => prev.map(p =>
      p.folder_id === id || childIds.includes(p.folder_id ?? '') ? { ...p, folder_id: null } : p
    ))
    if (selected === id || childIds.includes(selected ?? '')) setSelected(null)
  }

  function handleProjectMoved(projectId: string, folderId: string | null) {
    setProjects(prev => prev.map(p => p.id === projectId ? { ...p, folder_id: folderId } : p))
  }

  function handleProjectDeleted(projectId: string) {
    setProjects(prev => prev.filter(p => p.id !== projectId))
  }

  function handleVisibilityChanged(projectId: string, visibility: string) {
    setProjects(prev => prev.map(p => p.id === projectId ? { ...p, visibility } : p))
  }

  const selectedLabel =
    selected === null         ? 'All Projects' :
    selected === '__unfiled__'? 'Unfiled' :
    folders.find(f => f.id === selected)?.name ?? ''

  return (
    <div className="flex gap-6 items-start">
      {/* Sidebar */}
      <aside className="w-80 shrink-0">
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Workspace</p>
          </div>

          <nav className="p-2 space-y-0.5">
            <SidebarBtn label="All Projects" count={projects.length} active={selected === null} onClick={() => setSelected(null)} />
            <SidebarBtn label="Unfiled" count={projects.filter(p => !p.folder_id).length} active={selected === '__unfiled__'} onClick={() => setSelected('__unfiled__')} muted />

            {topLevel.length > 0 && <div className="border-t border-gray-100 my-2" />}

            {topLevel.map(parent => {
              const children  = childrenOf(parent.id)
              const isOpen    = expanded.has(parent.id)
              const isActive  = selected === parent.id

              return (
                <div key={parent.id}>
                  {/* Parent folder row */}
                  <div className="group relative flex items-center">
                    {editingId === parent.id ? (
                      <form onSubmit={e => { e.preventDefault(); renameFolder(parent.id) }} className="flex-1 px-1 py-1">
                        <input autoFocus value={editName} onChange={e => setEditName(e.target.value)}
                          onBlur={() => renameFolder(parent.id)}
                          className="w-full px-2 py-1 text-sm border border-blue-400 rounded focus:outline-none" />
                      </form>
                    ) : (
                      <>
                        {/* Chevron */}
                        <button
                          onClick={() => toggleExpand(parent.id)}
                          className="p-1.5 text-gray-400 hover:text-gray-600 shrink-0"
                        >
                          <ChevronIcon className={`w-3 h-3 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                        </button>
                        {/* Folder name */}
                        <button
                          onClick={() => { setSelected(parent.id); if (!isOpen) toggleExpand(parent.id) }}
                          className={`flex-1 text-left py-1.5 pr-2 rounded-md text-sm flex items-center gap-1.5 min-w-0 ${
                            isActive ? 'text-blue-700 font-medium' : 'text-gray-700 hover:text-gray-900'
                          }`}
                        >
                          <FolderIcon className="w-3.5 h-3.5 shrink-0 text-gray-400" />
                          <span className="truncate">{parent.name}</span>
                          <span className="ml-auto text-xs text-gray-400 shrink-0">
                            {folderProjects(parent.id).length}
                          </span>
                        </button>
                        {/* Hover actions */}
                        <div className="hidden group-hover:flex items-center gap-0.5 shrink-0 pr-1">
                          <button onClick={() => { setCreatingSub(parent.id); setNewSubName(''); setExpanded(prev => new Set([...prev, parent.id])) }}
                            className="p-1 text-gray-300 hover:text-blue-500 rounded" title="Add sub-folder">
                            <PlusIcon className="w-3 h-3" />
                          </button>
                          <button onClick={() => { setEditingId(parent.id); setEditName(parent.name) }}
                            className="p-1 text-gray-300 hover:text-gray-600 rounded" title="Rename">
                            <PencilIcon className="w-3 h-3" />
                          </button>
                          <button onClick={() => deleteFolder(parent.id)}
                            className="p-1 text-gray-300 hover:text-red-500 rounded" title="Delete">
                            <TrashIcon className="w-3 h-3" />
                          </button>
                        </div>
                      </>
                    )}
                  </div>

                  {/* Children */}
                  {isOpen && (
                    <div className="ml-5 space-y-0.5">
                      {children.map(child => (
                        <div key={child.id} className="group relative flex items-center">
                          {editingId === child.id ? (
                            <form onSubmit={e => { e.preventDefault(); renameFolder(child.id) }} className="flex-1 px-1 py-1">
                              <input autoFocus value={editName} onChange={e => setEditName(e.target.value)}
                                onBlur={() => renameFolder(child.id)}
                                className="w-full px-2 py-1 text-sm border border-blue-400 rounded focus:outline-none" />
                            </form>
                          ) : (
                            <>
                              <button
                                onClick={() => setSelected(child.id)}
                                className={`flex-1 text-left px-3 py-1.5 rounded-md text-sm flex items-center gap-1.5 min-w-0 ${
                                  selected === child.id ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-600 hover:bg-gray-100'
                                }`}
                              >
                                <FolderIcon className="w-3 h-3 shrink-0 text-gray-300" />
                                <span className="truncate">{child.name}</span>
                                <span className="ml-auto text-xs text-gray-400 shrink-0">
                                  {projects.filter(p => p.folder_id === child.id).length}
                                </span>
                              </button>
                              <div className="hidden group-hover:flex items-center gap-0.5 shrink-0 pr-1">
                                <button onClick={() => { setEditingId(child.id); setEditName(child.name) }}
                                  className="p-1 text-gray-300 hover:text-gray-600 rounded" title="Rename">
                                  <PencilIcon className="w-3 h-3" />
                                </button>
                                <button onClick={() => deleteFolder(child.id)}
                                  className="p-1 text-gray-300 hover:text-red-500 rounded" title="Delete">
                                  <TrashIcon className="w-3 h-3" />
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                      ))}

                      {/* New sub-folder input */}
                      {creatingSub === parent.id && (
                        <form
                          onSubmit={e => { e.preventDefault(); createFolder(newSubName, parent.id); setCreatingSub(null); setNewSubName('') }}
                          className="px-2 py-1"
                        >
                          <input
                            autoFocus
                            value={newSubName}
                            onChange={e => setNewSubName(e.target.value)}
                            onKeyDown={e => e.key === 'Escape' && setCreatingSub(null)}
                            onBlur={() => { if (!newSubName.trim()) setCreatingSub(null) }}
                            placeholder="Sub-folder name"
                            className="w-full px-2 py-1 text-sm border border-blue-400 rounded focus:outline-none"
                          />
                        </form>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </nav>

          {/* New top-level folder */}
          <div className="border-t border-gray-100 p-2">
            {creatingTop ? (
              <form
                onSubmit={e => { e.preventDefault(); createFolder(newTopName, null); setCreatingTop(false); setNewTopName('') }}
                className="space-y-1.5"
              >
                <input
                  autoFocus
                  value={newTopName}
                  onChange={e => setNewTopName(e.target.value)}
                  onKeyDown={e => e.key === 'Escape' && setCreatingTop(false)}
                  onBlur={() => { if (!newTopName.trim()) setCreatingTop(false) }}
                  placeholder="Client or group name"
                  className="w-full px-2 py-1.5 text-sm border border-blue-400 rounded focus:outline-none"
                />
                <div className="flex gap-1.5">
                  <button type="submit" disabled={!newTopName.trim()}
                    className="flex-1 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">
                    Create
                  </button>
                  <button type="button" onClick={() => { setCreatingTop(false); setNewTopName('') }}
                    className="flex-1 py-1 text-xs border border-gray-300 text-gray-600 rounded hover:bg-gray-50">
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <button onClick={() => setCreatingTop(true)}
                className="w-full text-left px-2 py-1.5 text-xs text-gray-400 hover:text-gray-600 rounded hover:bg-gray-50 flex items-center gap-1.5">
                <PlusIcon className="w-3.5 h-3.5" /> New Client Folder
              </button>
            )}
          </div>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-4">
          <p className="text-sm text-gray-500">
            {selectedLabel}
            <span className="text-gray-400 ml-1.5">({filtered.length})</span>
          </p>
          <Link
            href={`/dashboard/projects/new${selected && selected !== '__unfiled__' ? `?folder=${selected}` : ''}`}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700">
            + New Project
          </Link>
        </div>
        <div className="bg-white rounded-lg shadow">
          <ProjectList
            projects={filtered}
            folders={folders}
            onProjectMoved={handleProjectMoved}
            onProjectDeleted={handleProjectDeleted}
            onVisibilityChanged={handleVisibilityChanged}
            alwaysShowActions={selected !== null}
          />
        </div>
      </div>
    </div>
  )
}

function SidebarBtn({ label, count, active, onClick, muted }: {
  label: string; count: number; active: boolean; onClick: () => void; muted?: boolean
}) {
  return (
    <button onClick={onClick}
      className={`w-full text-left px-3 py-2 rounded-md text-sm flex items-center justify-between ${
        active ? 'bg-blue-50 text-blue-700 font-medium' : muted ? 'text-gray-400 hover:bg-gray-100' : 'text-gray-700 hover:bg-gray-100'
      }`}>
      {label}
      <span className="text-xs text-gray-400">{count}</span>
    </button>
  )
}

function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
    </svg>
  )
}

function FolderIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 20 20">
      <path d="M2 6a2 2 0 012-2h4l2 2h4a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
    </svg>
  )
}

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
    </svg>
  )
}

function PencilIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536M9 13l6.586-6.586a2 2 0 112.828 2.828L11.828 15.828a4 4 0 01-2.829 1.172H7v-2a4 4 0 011.172-2.828L9 13z" />
    </svg>
  )
}

function TrashIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
    </svg>
  )
}
