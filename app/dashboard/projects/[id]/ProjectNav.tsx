'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const PHASES = [
  { number: 1, label: 'Scope Definition' },
  { number: 2, label: 'Factor Framework' },
  { number: 3, label: 'Preference Assessment' },
  { number: 4, label: 'Coherence Review' },
  { number: 5, label: 'Value Pricing Model' },
  { number: 6, label: 'Analysis & Output' },
]

const STATUS_COLORS: Record<string, string> = {
  DRAFT: 'bg-gray-300',
  SCOPE_COMPLETE: 'bg-green-500',
  FRAMEWORK_COMPLETE: 'bg-green-500',
  SURVEY_OPEN: 'bg-blue-500',
  SURVEY_CLOSED: 'bg-blue-500',
  UTILITIES_DERIVED: 'bg-green-500',
  MODEL_RUN: 'bg-green-500',
  COMPLETE: 'bg-green-500',
}

function phaseStatus(phaseNumber: number, projectStatus: string): 'complete' | 'active' | 'locked' {
  const statusOrder = [
    'DRAFT',
    'SCOPE_COMPLETE',
    'FRAMEWORK_COMPLETE',
    'SURVEY_OPEN',
    'SURVEY_CLOSED',
    'UTILITIES_DERIVED',
    'MODEL_RUN',
    'COMPLETE',
  ]
  const currentIndex = statusOrder.indexOf(projectStatus)

  if (phaseNumber < currentIndex) return 'complete'
  if (phaseNumber === currentIndex) return 'active'
  return 'locked'
}

export default function ProjectNav({
  project,
}: {
  project: { id: string; name: string; status: string }
}) {
  const pathname = usePathname()

  return (
    <aside className="w-64 bg-white border-r border-gray-200 flex flex-col min-h-screen">
      {/* Project name */}
      <div className="p-4 border-b border-gray-200">
        <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Project</p>
        <h2 className="font-semibold text-gray-900 text-sm leading-tight">{project.name}</h2>
      </div>

      {/* Phase navigation */}
      <nav className="flex-1 p-4 space-y-1">
        {PHASES.map((phase) => {
          const href = `/dashboard/projects/${project.id}/phase-${phase.number}`
          const isActive = pathname.startsWith(href)
          const status = phaseStatus(phase.number, project.status)

          return (
            <Link
              key={phase.number}
              href={status === 'locked' ? '#' : href}
              className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${
                isActive
                  ? 'bg-blue-50 text-blue-700 font-medium'
                  : status === 'locked'
                  ? 'text-gray-400 cursor-not-allowed'
                  : 'text-gray-700 hover:bg-gray-50'
              }`}
            >
              {/* Status dot */}
              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                isActive ? 'bg-blue-500' :
                status === 'complete' ? 'bg-green-500' :
                status === 'locked' ? 'bg-gray-300' :
                'bg-gray-400'
              }`} />
              <span>
                <span className="text-xs text-gray-400 block">Phase {phase.number}</span>
                {phase.label}
              </span>
            </Link>
          )
        })}
      </nav>

      {/* Back to dashboard */}
      <div className="p-4 border-t border-gray-200">
        <Link
          href="/dashboard"
          className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700"
        >
          ← Dashboard
        </Link>
      </div>
    </aside>
  )
}