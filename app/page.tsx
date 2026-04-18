import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'

export default async function HomePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (user) redirect('/dashboard')

  return (
    <div className="min-h-screen bg-white">

      {/* Nav */}
      <header className="border-b border-gray-100">
        <div className="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between">
          <span className="text-base font-semibold text-gray-900">Value Pricing Model™</span>
          <Link href="/login" className="text-sm text-gray-500 hover:text-gray-900">Sign in</Link>
        </div>
      </header>

      {/* Hero */}
      <section className="max-w-5xl mx-auto px-6 pt-20 pb-16 text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-50 text-blue-700 text-xs font-medium mb-6">
          Institutional-grade pricing methodology
        </div>
        <h1 className="text-4xl sm:text-5xl font-bold text-gray-900 leading-tight tracking-tight mb-6">
          Defensible price recommendations.<br className="hidden sm:block" />
          Built on rigorous analysis.
        </h1>
        <p className="text-lg text-gray-500 max-w-2xl mx-auto mb-10 leading-relaxed">
          Value Pricing Model™ guides your team through a structured, repeatable methodology
          for new product pricing and price repositioning — delivering the rigor of a $50K
          consulting engagement at a fraction of the cost.
        </p>
        <div className="flex items-center justify-center gap-4">
          <Link
            href="/request-access"
            className="px-6 py-3 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 shadow-sm"
          >
            Request Access
          </Link>
          <Link
            href="/login"
            className="px-6 py-3 text-gray-700 text-sm font-medium rounded-lg border border-gray-200 hover:border-gray-300 hover:bg-gray-50"
          >
            Sign in
          </Link>
        </div>
      </section>

      {/* Value props */}
      <section className="bg-gray-50 border-y border-gray-100 py-16">
        <div className="max-w-5xl mx-auto px-6">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-8">
            {[
              {
                title: 'Structured Methodology',
                body: 'Six-phase workflow from competitive scoping to price recommendation. Every decision is documented and defensible.',
              },
              {
                title: 'Quantified Factor Analysis',
                body: 'Importance scores and performance ratings derived from expert input, not intuition. See exactly what drives value in your market.',
              },
              {
                title: 'Repeatable & Scalable',
                body: 'Run the same framework across product lines, geographies, or segments. Build institutional pricing capability — not one-off projects.',
              },
            ].map(({ title, body }) => (
              <div key={title}>
                <h3 className="text-sm font-semibold text-gray-900 mb-2">{title}</h3>
                <p className="text-sm text-gray-500 leading-relaxed">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Who it's for */}
      <section className="max-w-5xl mx-auto px-6 py-16">
        <h2 className="text-xl font-bold text-gray-900 mb-8 text-center">Built for pricing professionals</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
          {[
            {
              role: 'Independent Consultants',
              description: 'Deliver institutional-quality pricing analysis to clients without a full research team. Increase margin on every engagement.',
            },
            {
              role: 'Pricing & Strategy Teams',
              description: 'Standardize how your team approaches pricing decisions. Build a repeatable process across every product launch.',
            },
            {
              role: 'Consultancies & Agencies',
              description: 'Scale pricing work across multiple client engagements simultaneously. Consistent methodology, faster delivery.',
            },
          ].map(({ role, description }) => (
            <div key={role} className="bg-white rounded-xl border border-gray-200 p-6">
              <h3 className="text-sm font-semibold text-gray-900 mb-2">{role}</h3>
              <p className="text-sm text-gray-500 leading-relaxed">{description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="bg-blue-600 py-16">
        <div className="max-w-5xl mx-auto px-6 text-center">
          <h2 className="text-2xl font-bold text-white mb-3">Ready to see it in action?</h2>
          <p className="text-blue-200 text-sm mb-8 max-w-lg mx-auto">
            Access is by request. Tell us about your use case and we'll be in touch within one business day.
          </p>
          <Link
            href="/request-access"
            className="inline-block px-6 py-3 bg-white text-blue-700 text-sm font-semibold rounded-lg hover:bg-blue-50 shadow-sm"
          >
            Request Access
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-100 py-8">
        <div className="max-w-5xl mx-auto px-6 flex items-center justify-between text-xs text-gray-400">
          <span>Value Pricing Model™</span>
          <span>© {new Date().getFullYear()} All rights reserved.</span>
        </div>
      </footer>

    </div>
  )
}
