import { createClient } from '@/lib/supabase/server'

export default async function BillingPage() {
  const supabase = await createClient()
  const { count } = await supabase
    .from('project')
    .select('*', { count: 'exact', head: true })

  const projectCount = count ?? 0

  return (
    <div className="space-y-8">
      <h1 className="text-xl font-semibold text-gray-900">Plan & Billing</h1>

      {/* Current plan */}
      <section className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-sm font-semibold text-gray-900 mb-4">Your Account</h2>
        <div className="flex items-center gap-3 mb-5">
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-50 text-blue-700">
            Active
          </span>
          <span className="text-sm text-gray-500">Managed access — your plan is configured by your account administrator.</span>
        </div>
        <div className="grid grid-cols-2 gap-4 max-w-sm">
          <div className="bg-gray-50 rounded-lg p-4">
            <p className="text-xs text-gray-500 mb-1">Projects</p>
            <p className="text-2xl font-bold text-gray-900">{projectCount}</p>
            <p className="text-xs text-gray-400 mt-0.5">active projects</p>
          </div>
        </div>
      </section>

      {/* Capabilities */}
      <section className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-sm font-semibold text-gray-900 mb-4">Platform Capabilities</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {[
            'Six-phase pricing methodology',
            'Unlimited reference products',
            'Up to 3 target products per project',
            'Distributed surveys with invite emails',
            'Advanced diagnostics (Tools 2, 3, 4)',
            'PDF export',
            'AI assist (benchmark & factor suggestions)',
            'AI diagnostic explanations',
            'Coherence scoring & review',
            'Value Map & Factor Contributions',
            'Price recommendations with ranges',
            'Sensitivity analysis',
          ].map(item => (
            <div key={item} className="flex items-center gap-2 text-sm text-gray-700">
              <svg className="w-4 h-4 text-green-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              {item}
            </div>
          ))}
        </div>
      </section>

      {/* Contact */}
      <section className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-sm font-semibold text-gray-900 mb-1">Questions or changes?</h2>
        <p className="text-sm text-gray-500">
          Contact us at{' '}
          <a href="mailto:support@valuepricing.org" className="text-blue-600 hover:underline">
            support@valuepricing.org
          </a>{' '}
          for billing inquiries, seat changes, or plan upgrades.
        </p>
      </section>
    </div>
  )
}
