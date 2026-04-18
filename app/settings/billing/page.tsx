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
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-sm font-semibold text-gray-900 mb-1">Current Plan</h2>
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-700">
              Starter
            </span>
          </div>
          <button
            disabled
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md opacity-50 cursor-not-allowed"
            title="Upgrade coming soon"
          >
            Upgrade to Professional
          </button>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-4 max-w-sm">
          <div className="bg-gray-50 rounded-lg p-4">
            <p className="text-xs text-gray-500 mb-1">Projects</p>
            <p className="text-2xl font-bold text-gray-900">{projectCount}</p>
            <p className="text-xs text-gray-400 mt-0.5">of 3 included</p>
          </div>
          <div className="bg-gray-50 rounded-lg p-4">
            <p className="text-xs text-gray-500 mb-1">Seats</p>
            <p className="text-2xl font-bold text-gray-900">1</p>
            <p className="text-xs text-gray-400 mt-0.5">of 1 included</p>
          </div>
        </div>
      </section>

      {/* Plan comparison */}
      <section className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-sm font-semibold text-gray-900 mb-4">Plan Comparison</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100">
              <th className="text-left py-2 text-xs font-medium text-gray-500 w-1/2">Feature</th>
              <th className="text-center py-2 text-xs font-medium text-gray-500">Starter</th>
              <th className="text-center py-2 text-xs font-medium text-blue-600">Professional</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {[
              ['Projects',         '3',         'Unlimited'],
              ['Seats',            '1',         '5'],
              ['PDF export',       '✓',         '✓'],
              ['AI assist',        '—',         '✓'],
              ['All exports',      '—',         '✓'],
              ['Survey invites',   '—',         '✓'],
              ['Priority support', '—',         '✓'],
            ].map(([feature, starter, pro]) => (
              <tr key={feature}>
                <td className="py-2.5 text-gray-700">{feature}</td>
                <td className="py-2.5 text-center text-gray-500">{starter}</td>
                <td className="py-2.5 text-center text-blue-600 font-medium">{pro}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-4 text-xs text-gray-400">Stripe billing coming soon. Reach out to <a href="mailto:support@valuepricing.org" className="underline">support@valuepricing.org</a> to discuss Professional access.</p>
      </section>
    </div>
  )
}
