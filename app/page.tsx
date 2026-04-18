import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'

export default async function HomePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (user) redirect('/dashboard')

  return (
    <div className="min-h-screen bg-white">

      {/* ── Nav ────────────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-50 bg-gray-950 border-b border-gray-800">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <span className="text-xl font-bold text-white tracking-tight">Value Pricing Model™</span>
          <div className="flex items-center gap-6">
            <a href="#how-it-works" className="hidden sm:block text-base text-gray-400 hover:text-white transition-colors">How it works</a>
            <a href="#outputs" className="hidden sm:block text-base text-gray-400 hover:text-white transition-colors">Outputs</a>
            <a href="#who" className="hidden sm:block text-base text-gray-400 hover:text-white transition-colors">Who it's for</a>
            <Link href="/login" className="text-base text-gray-400 hover:text-white transition-colors">Sign in</Link>
            <Link href="/request-access" className="px-4 py-2 bg-blue-600 text-white text-base font-semibold rounded-lg hover:bg-blue-500 transition-colors">
              Request Access
            </Link>
          </div>
        </div>
      </header>

      {/* ── Hero ───────────────────────────────────────────────────────────── */}
      <section className="max-w-6xl mx-auto px-6 pt-20 pb-16 text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-50 text-blue-700 text-xs font-semibold mb-6 tracking-wide uppercase">
          Stop Guessing. Start Pricing.
        </div>
        <h1 className="text-5xl sm:text-6xl font-bold text-gray-900 leading-tight tracking-tight mb-6">
          Price with Confidence.<br className="hidden sm:block" />
          Position with Precision.
        </h1>
        <p className="text-xl text-gray-500 max-w-2xl mx-auto mb-4 leading-relaxed">
          Value Pricing Model™ gives product teams and pricing professionals a structured,
          repeatable methodology for setting prices, repositioning existing products,
          and identifying gaps in your portfolio.
        </p>
        <p className="text-base text-gray-400 max-w-xl mx-auto mb-10">
          Backed by market data and expert input — not intuition. AI-assisted setup gets you from a blank slate to a full competitive framework in minutes.
        </p>
        <div className="flex items-center justify-center gap-4 mb-16">
          <Link href="/request-access" className="px-7 py-3.5 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 shadow-sm">
            Request Access
          </Link>
          <a href="#outputs" className="px-7 py-3.5 text-gray-700 text-sm font-medium rounded-lg border border-gray-200 hover:border-gray-300 hover:bg-gray-50">
            See the output →
          </a>
        </div>
        <div className="rounded-xl border border-gray-200 shadow-xl overflow-hidden mx-auto max-w-4xl">
          <img src="/screenshots/PriceRecommendations.png" alt="Price Recommendations" className="w-full" />
        </div>
      </section>

      {/* ── Problem ────────────────────────────────────────────────────────── */}
      <section className="bg-gray-950 py-20">
        <div className="max-w-4xl mx-auto px-6 text-center">
          <h2 className="text-3xl font-bold text-white mb-6 leading-tight">
            Most pricing decisions are made by gut feel,<br className="hidden sm:block" />
            expensive consultants, or not at all.
          </h2>
          <p className="text-gray-400 text-lg leading-relaxed max-w-2xl mx-auto mb-12">
            Bringing in a major consultancy means five-to-six figure invoices and months of lead time.
            Spreadsheets and intuition leave you exposed when a board or client asks "how did you get to that number?"
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 text-left">
            {[
              { stat: '6 phases', label: 'from competitive scoping to price recommendation' },
              { stat: '3 use cases', label: 'new product pricing, repositioning, and portfolio gap analysis' },
              { stat: 'Fully auditable', label: 'every recommendation traces back to market data and expert input' },
            ].map(({ stat, label }) => (
              <div key={stat} className="bg-gray-900 rounded-xl p-6 border border-gray-800">
                <p className="text-3xl font-bold text-white mb-1">{stat}</p>
                <p className="text-sm text-gray-400">{label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Outputs ────────────────────────────────────────────────────────── */}
      <section id="outputs" className="py-24">
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold text-gray-900 mb-3">Set the right price. Every time.</h2>
            <p className="text-gray-500 max-w-xl mx-auto">
              Every output is grounded in your market's actual data — not benchmarks from another industry or another decade.
            </p>
          </div>

          {/* Output 1 — Value Map */}
          <div className="flex flex-col lg:flex-row items-center gap-12 mb-24">
            <div className="lg:w-2/5 shrink-0">
              <div className="text-xs font-semibold text-blue-600 uppercase tracking-wider mb-3">Value Map</div>
              <h3 className="text-2xl font-bold text-gray-900 mb-4">See exactly where you stand in the market</h3>
              <p className="text-gray-500 leading-relaxed mb-4">
                The Value Map plots every product in your competitive set by model-implied price vs. actual market price.
                Products above the line are overpriced relative to their value. Products below are leaving money on the table.
              </p>
              <p className="text-gray-500 leading-relaxed">
                Your target product sits on the fair-value line at its recommended price — with full confidence ranges shown.
              </p>
            </div>
            <div className="lg:w-3/5 rounded-xl border border-gray-200 shadow-lg overflow-hidden">
              <img src="/screenshots/ValueMap.png" alt="Value Map" className="w-full" />
            </div>
          </div>

          {/* Output 2 — Factor Contributions */}
          <div className="flex flex-col lg:flex-row-reverse items-center gap-12 mb-24">
            <div className="lg:w-2/5 shrink-0">
              <div className="text-xs font-semibold text-blue-600 uppercase tracking-wider mb-3">Factor Contributions</div>
              <h3 className="text-2xl font-bold text-gray-900 mb-4">Understand what the market actually values</h3>
              <p className="text-gray-500 leading-relaxed mb-4">
                Factor Contributions breaks down each product's price into the individual features and attributes that
                drive it — in dollars. See which factors command a premium, which are table stakes, and where your
                product outperforms or underperforms the field.
              </p>
              <p className="text-gray-500 leading-relaxed">
                Click any product to re-sort by its differentiation. Instantly see what sets it apart.
              </p>
            </div>
            <div className="lg:w-3/5 rounded-xl border border-gray-200 shadow-lg overflow-hidden">
              <img src="/screenshots/FactorContributions.png" alt="Factor Contributions" className="w-full" />
            </div>
          </div>

          {/* Output 3 — Competitive Positioning */}
          <div className="flex flex-col lg:flex-row items-center gap-12 mb-24">
            <div className="lg:w-2/5 shrink-0">
              <div className="text-xs font-semibold text-blue-600 uppercase tracking-wider mb-3">Competitive Positioning</div>
              <h3 className="text-2xl font-bold text-gray-900 mb-4">A complete competitive picture in one table</h3>
              <p className="text-gray-500 leading-relaxed mb-4">
                The Competitive Positioning table ranks every product by Value Index — a normalized score of how much
                value it delivers relative to the market. Market price vs. model price vs. gap, all in one view.
              </p>
              <p className="text-gray-500 leading-relaxed">
                Factor importance scores show exactly which dimensions are driving the market's willingness to pay.
              </p>
            </div>
            <div className="lg:w-3/5 rounded-xl border border-gray-200 shadow-lg overflow-hidden">
              <img src="/screenshots/CompetitivePositioning.png" alt="Competitive Positioning" className="w-full" />
            </div>
          </div>

          {/* Output 4 — Diagnostics */}
          <div className="flex flex-col lg:flex-row-reverse items-center gap-12">
            <div className="lg:w-2/5 shrink-0">
              <div className="text-xs font-semibold text-blue-600 uppercase tracking-wider mb-3">Advanced Diagnostics</div>
              <h3 className="text-2xl font-bold text-gray-900 mb-4">Validate the model before you commit to the number</h3>
              <p className="text-gray-500 leading-relaxed mb-4">
                Advanced diagnostics — sensitivity analysis, market-implied weight comparison, and respondent-level
                model analysis — let you stress-test the recommendation before it goes to a client or a board.
              </p>
              <p className="text-gray-500 leading-relaxed">
                Know whether the consensus is driven by broad agreement or one or two dominant voices.
              </p>
            </div>
            <div className="lg:w-3/5 rounded-xl border border-gray-200 shadow-lg overflow-hidden">
              <img src="/screenshots/SensitivityAnalysis.png" alt="Sensitivity Analysis" className="w-full" />
            </div>
          </div>
        </div>
      </section>

      {/* ── How it works ───────────────────────────────────────────────────── */}
      <section id="how-it-works" className="bg-gray-50 border-y border-gray-100 py-24">
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold text-gray-900 mb-3">A six-phase methodology. Built for repeatability.</h2>
            <p className="text-gray-500 max-w-xl mx-auto">
              Every project follows the same rigorous process — so your team builds institutional pricing capability, not one-off analyses.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              { phase: '01', title: 'Scope Definition', body: 'Define your target product, geographic scope, price basis, and competitive reference set. AI suggests benchmarks and estimates market share.' },
              { phase: '02', title: 'Factor Framework', body: 'Identify the factors that drive purchase decisions and define performance levels. AI suggests factors, levels, and benchmark assignments — optional, always editable.' },
              { phase: '03', title: 'Preference Assessment', body: 'A structured survey captures expert judgment on factor importance and performance. Supports internal and distributed respondents.' },
              { phase: '04', title: 'Coherence Review', body: 'Automatic consistency scoring flags survey responses that may need review before they influence the model.' },
              { phase: '05', title: 'Value Pricing Model', body: 'Weighted optimization derives factor importance scores, performance scores, and a model-implied price — with full diagnostic transparency.' },
              { phase: '06', title: 'Analysis & Output', body: 'Value Map, Factor Contributions, Competitive Positioning, and Price Recommendations — ready for client delivery or internal review.' },
            ].map(({ phase, title, body }) => (
              <div key={phase} className="bg-white rounded-xl border border-gray-200 p-6">
                <div className="text-xs font-bold text-blue-600 mb-2 tracking-wider">PHASE {phase}</div>
                <h3 className="text-sm font-semibold text-gray-900 mb-2">{title}</h3>
                <p className="text-sm text-gray-500 leading-relaxed">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── AI Assist ──────────────────────────────────────────────────────── */}
      <section className="py-24">
        <div className="max-w-6xl mx-auto px-6">
          <div className="flex flex-col lg:flex-row items-center gap-12">
            <div className="lg:w-2/5 shrink-0">
              <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-purple-50 text-purple-700 text-xs font-semibold mb-4">
                ✦ Optional AI Assist
              </div>
              <h2 className="text-2xl font-bold text-gray-900 mb-4">From category description to full competitive framework in minutes</h2>
              <p className="text-gray-500 leading-relaxed mb-4">
                Describe your product category and let AI suggest your competitive benchmark set, factor framework,
                performance levels, and product assignments — complete with market share estimates and confidence ratings.
              </p>
              <p className="text-gray-500 leading-relaxed">
                Every AI suggestion is optional, editable, and auditable. You stay in full control of the methodology.
              </p>
            </div>
            <div className="lg:w-3/5 rounded-xl border border-gray-200 shadow-lg overflow-hidden">
              <img src="/screenshots/CategoryAnchor_AI.png" alt="AI-powered benchmark suggestions" className="w-full" />
            </div>
          </div>
        </div>
      </section>

      {/* ── Who it's for ───────────────────────────────────────────────────── */}
      <section id="who" className="bg-gray-50 border-t border-gray-100 py-24">
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-gray-900 mb-3">Built for pricing professionals</h2>
            <p className="text-gray-500 max-w-xl mx-auto">
              Whether you're an independent consultant or a corporate pricing function, VPM gives you the same rigor at the right scale.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            {[
              {
                role: 'Independent Consultants',
                description: 'Deliver the same rigor as a full consulting team — without one. VPM handles the analytical heavy lifting so you can focus on client relationships and interpretation. Run multiple engagements per month with a single license.',
                detail: 'More engagements. Higher margins. Fully defensible outputs.',
              },
              {
                role: 'Pricing & Strategy Teams',
                description: 'Stop paying five to six figures per engagement to outside firms for work your team can now own. Build a repeatable, auditable pricing process across every product launch, repositioning, and portfolio review.',
                detail: 'Bring the methodology in-house. Keep the rigor. Lose the five-to-six figure invoice.',
              },
              {
                role: 'Consultancies & Agencies',
                description: 'Scale pricing work across multiple client engagements simultaneously. Consistent methodology, faster delivery, defensible outputs your clients can present to their board — under your name.',
                detail: 'Consistent process. Faster delivery. Stronger client outcomes.',
              },
            ].map(({ role, description, detail }) => (
              <div key={role} className="bg-white rounded-xl border border-gray-200 p-6 flex flex-col">
                <h3 className="text-sm font-semibold text-gray-900 mb-3">{role}</h3>
                <p className="text-sm text-gray-500 leading-relaxed mb-4 flex-1">{description}</p>
                <p className="text-xs text-blue-600 font-medium">{detail}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ────────────────────────────────────────────────────────────── */}
      <section className="bg-gray-950 py-24">
        <div className="max-w-4xl mx-auto px-6 text-center">
          <h2 className="text-4xl font-bold text-white mb-4 leading-tight">
            Set the right price.<br />Every time.
          </h2>
          <p className="text-gray-400 text-lg mb-10 max-w-lg mx-auto leading-relaxed">
            Access is by invitation. Tell us about your use case and we'll be in touch within one business day.
          </p>
          <Link href="/request-access" className="inline-block px-8 py-4 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 shadow-sm">
            Request Access
          </Link>
          <p className="mt-4 text-xs text-gray-600">
            Already have an account?{' '}
            <Link href="/login" className="text-gray-400 hover:text-white underline">Sign in</Link>
          </p>
        </div>
      </section>

      {/* ── Footer ─────────────────────────────────────────────────────────── */}
      <footer className="border-t border-gray-100 py-8">
        <div className="max-w-6xl mx-auto px-6 flex items-center justify-between text-xs text-gray-400">
          <span className="font-medium text-gray-500">Value Pricing Model™</span>
          <span>© {new Date().getFullYear()} All rights reserved.</span>
        </div>
      </footer>

    </div>
  )
}
