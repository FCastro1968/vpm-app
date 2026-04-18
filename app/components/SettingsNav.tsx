'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const NAV = [
  { href: '/settings/profile',       label: 'Profile' },
  { href: '/settings/billing',       label: 'Plan & Billing' },
  { href: '/settings/team',          label: 'Team' },
  { href: '/settings/notifications', label: 'Notifications' },
]

export function SettingsNav() {
  const pathname = usePathname()
  return (
    <nav className="w-44 shrink-0">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Settings</p>
      <ul className="space-y-0.5">
        {NAV.map(({ href, label }) => (
          <li key={href}>
            <Link
              href={href}
              className={`block px-3 py-2 rounded-md text-sm ${
                pathname === href
                  ? 'bg-blue-50 text-blue-700 font-medium'
                  : 'text-gray-700 hover:bg-gray-100 hover:text-gray-900'
              }`}
            >
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}
