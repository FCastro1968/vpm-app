'use client'

import { useState, useRef, useEffect } from 'react'

interface HelpTipProps {
  content: React.ReactNode
  width?: string  // tailwind width class e.g. 'w-64', 'w-80'
  position?: 'below' | 'above'
}

export function HelpTip({ content, width = 'w-72', position = 'below' }: HelpTipProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <div ref={ref} className="relative inline-flex items-center">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-4 h-4 rounded-full bg-gray-200 text-gray-500 text-xs font-bold hover:bg-gray-300 flex items-center justify-center flex-shrink-0 leading-none"
        aria-label="Help"
      >
        ?
      </button>
      {open && (
        <div
          className={`absolute z-50 ${width} p-3 bg-white border border-gray-200 rounded-lg shadow-lg text-xs text-gray-600 leading-relaxed`}
          style={{
            left: '50%',
            transform: 'translateX(-50%)',
            ...(position === 'below' ? { top: '1.5rem' } : { bottom: '1.5rem' }),
          }}
        >
          {content}
        </div>
      )}
    </div>
  )
}
