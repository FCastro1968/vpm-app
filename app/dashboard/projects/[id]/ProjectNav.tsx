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
  { number: 7, label: 'Sensitivity Analysis' },
]

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

  if (currentIndex >= phaseNumber) return 'complete'
  if (currentIndex >= phaseNumber - 1) return 'active'
  return 'locked'
}

export default function ProjectNav({
  project,
}: {
  project: { id: string; name: string; status: string }
}) {
  const pathname = usePathname()

  return (
    <header className="sticky top-0 z-30 bg-white shadow-sm" style={{ borderBottom: '1px solid #e5e7eb' }}>

      {/* Accent bar — solid navy strip, rendered as its own div to guarantee visibility */}
      <div style={{ height: '3px', backgroundColor: '#1e3a5f', width: '100%' }} />

      <div className="flex items-stretch overflow-hidden" style={{ height: '52px' }}>

        {/* Brand + dashboard link */}
        <div
          className="flex flex-col justify-center flex-shrink-0"
          style={{ padding: '0 20px', minWidth: '130px', borderRight: '1px solid #e5e7eb' }}
        >
          <span style={{ fontSize: '15px', fontWeight: 600, color: '#1e3a5f', letterSpacing: '-0.02em', lineHeight: 1.2 }}>
            VPM
          </span>
          <Link
            href="/dashboard"
            style={{ fontSize: '11px', color: '#9ca3af', textDecoration: 'none', marginTop: '2px', lineHeight: 1.2 }}
            className="hover:text-gray-600 transition-colors"
          >
            ← Dashboard
          </Link>
        </div>

        {/* Phase tabs */}
        <nav className="flex items-stretch flex-1 overflow-x-auto" style={{ padding: '0 8px' }}>
          {PHASES.map((phase) => {
            const href = `/dashboard/projects/${project.id}/phase-${phase.number}`
            const isActive = pathname.startsWith(href)
            const status = phaseStatus(phase.number, project.status)
            const isLocked = status === 'locked'
            const isComplete = status === 'complete'

            // Dot color: green for complete, blue for active, gray-300 for available, gray-200 for locked
            const dotColor =
              isActive    ? '#1e3a5f' :
              isComplete  ? '#22c55e' :
              isLocked    ? '#e5e7eb' :
                            '#d1d5db'

            // Text color
            const textColor =
              isActive  ? '#1e3a5f' :
              isLocked  ? '#d1d5db' :
                          '#6b7280'

            return (
              <Link
                key={phase.number}
                href={isLocked ? '#' : href}
                className="flex flex-col items-center justify-center flex-shrink-0 select-none transition-colors"
                style={{
                  padding: '0 16px',
                  cursor: isLocked ? 'not-allowed' : 'pointer',
                  color: textColor,
                  position: 'relative',
                  // Bottom border as active indicator — using boxShadow inset avoids
                  // the flex layout issues that cause border-b-2 to sometimes not render
                  boxShadow: isActive ? 'inset 0 -3px 0 #1e3a5f' : 'none',
                  textDecoration: 'none',
                }}
              >
                {/* Number + dot */}
                <span className="flex items-center" style={{ gap: '5px', marginBottom: '3px' }}>
                  <span
                    style={{
                      width: '7px',
                      height: '7px',
                      borderRadius: '50%',
                      backgroundColor: dotColor,
                      flexShrink: 0,
                      display: 'inline-block',
                    }}
                  />
                  <span style={{ fontSize: '10px', opacity: 0.65, lineHeight: 1 }}>
                    {phase.number}
                  </span>
                </span>
                {/* Label */}
                <span style={{
                  fontSize: '11px',
                  fontWeight: isActive ? 500 : 400,
                  lineHeight: 1.2,
                  whiteSpace: 'nowrap',
                }}>
                  {phase.label}
                </span>
              </Link>
            )
          })}
        </nav>

        {/* Project name — anchored right */}
        <div
          className="flex flex-col justify-center items-end flex-shrink-0"
          style={{ padding: '0 20px', minWidth: '140px', maxWidth: '200px', borderLeft: '1px solid #e5e7eb' }}
        >
          <span style={{ fontSize: '10px', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em', lineHeight: 1.2 }}>
            Project
          </span>
          <span style={{ fontSize: '13px', fontWeight: 500, color: '#1f2937', lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', width: '100%', textAlign: 'right' }}>
            {project.name}
          </span>
        </div>

      </div>
    </header>
  )
}
