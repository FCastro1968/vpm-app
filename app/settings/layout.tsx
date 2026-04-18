import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { UserMenu } from '@/app/components/UserMenu'
import { SettingsNav } from '@/app/components/SettingsNav'

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const displayName = user.user_metadata?.full_name ?? null

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between">
          <Link href="/dashboard" className="text-sm font-semibold text-gray-900 hover:text-blue-600">
            ← Value Pricing Model™
          </Link>
          <UserMenu email={user.email!} displayName={displayName} />
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-6 py-8 flex gap-8">
        <SettingsNav />
        <main className="flex-1 min-w-0">
          {children}
        </main>
      </div>
    </div>
  )
}
