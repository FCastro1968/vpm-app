# Value Pricing Model™ (VPM) — Project Context

## What this is
A commercial SaaS web application that guides SME teams through a structured, repeatable methodology for new product pricing and price repositioning. The platform digitizes a proven manual process. All 7 phases are built and working end-to-end.

## Core methodology (INTERNAL ONLY — never use this language in UI)
- SMEs define factors and performance levels
- AHP pairwise comparison surveys (1–9 scale)
- Geometric mean aggregation across respondents
- GMM priority vector derivation (geometric mean across rows → normalize). NEVER use AMNC.
- Two-parameter Weighted Least Squares optimization finding Base Value (B) and Max Value (M)
- Minimizes weighted SSE with market share as observation weights
- 8 solver runs: 4 constraint regimes × 2 initialization strategies
- Up to 3 target products per model run
- **Value Index formula (Option 2):** `weight × (utility - minUtil) / (maxUtil - minUtil)` per factor. Min level → 0 contribution, max level → full factor weight. Base product = 0 and max product = 1 by construction. This is the canonical formula used in both solver.py and Phase 6 display — never revert to raw utility.

## UI terminology (ALWAYS use these — methodology obfuscation is non-negotiable)
| Internal term | UI label |
|---|---|
| Attribute / AHP | Factor |
| Level | Performance Level |
| Attribute weight | Importance Score |
| Level utility | Performance Score |
| Normalized value score | Value Index |
| Consistency Ratio | Coherence Score |
| Benchmark product | Reference Product |
| Competitive benchmark set | Market Reference Set |
| Regression / solver / WLS | Never surfaced — black box |
| B and M parameters | Never surfaced |
| Base/Max Product | Never surfaced |
| Weighted SSE | Never surfaced |
| Value Pricing Model | Value Pricing Model™ |

## Tech stack
- **Frontend:** Next.js 16.2.2 (App Router, TypeScript, Tailwind CSS)
- **Database:** Supabase (PostgreSQL + auth + RLS)
- **Solver:** Python 3.12 FastAPI microservice at `vpm-app/solver/`
- **AI:** Anthropic Claude API (claude-sonnet-4-20250514)
- **Project path:** `C:\Users\Fmcas\OneDrive\Dad Laptop 2020\Desktop\vpm-app`
- **Supabase URL:** https://xnhbvwbvxwodjtlejsew.supabase.co
- **Middleware:** `proxy.ts` (not middleware.ts), export named `proxy` — Next.js 16 quirk

## Dev environment startup
```
# Terminal 1 — solver
cd Desktop\vpm-app\solver
venv\Scripts\activate
python main.py        # port 8000

# Terminal 2 — Next.js
cd Desktop\vpm-app
npm run dev           # port 3000
```

## Deployment targets
- **Next.js → Vercel:** https://vpm-app.vercel.app (live, staging)
- **FastAPI solver → Railway:** https://vpm-app-production.up.railway.app (live, ~$5/mo)
- **Supabase** — already cloud-hosted, no change needed
- `SOLVER_URL` env var set in Vercel pointing to Railway URL
- Supabase Site URL: `https://vpm-app.vercel.app`; Redirect URLs: `http://localhost:3000/**` and `https://vpm-app.vercel.app/**`
- Three deployment stages: (1) staging — live now at vpm-app.vercel.app; (2) prospect-ready — demo project + tooltips + PDF lollipop rebuild; (3) commercial — Stripe billing + tier enforcement + onboarding tour

## Key DB conventions (never violate)
- **Delete-then-insert** pattern throughout (never upsert with null scenario_id)
- **scenario_id = null** = base run convention on all result tables
- **owner_id** is the user field on the project table (not user_id)
- **RLS enabled** on all tables — always include owner_id/project_id in inserts
- Cascade FKs: attribute→project, level→attribute, aggregated_matrix→attribute
- `pairwise_response.direction` is text type, check constraint dropped
- `pairwise_response.comparison_type` is stored as uppercase: 'ATTRIBUTE', 'LEVEL'
- `benchmark_level_assignment` has NO project_id column
- `attribute_weight`, `level_utility`, `aggregated_matrix` all have project_id
- `level_utility` does NOT use scenario_id — query with project_id only (no .is('scenario_id', null))

## Architecture patterns
- Solver API: Next.js proxy route at `app/api/solver/route.ts` → FastAPI at port 8000 (localhost) or `SOLVER_URL` env var (production)
- AI assist routes: `app/api/ai/route.ts` — tasks: suggest_benchmarks, estimate_market_share, suggest_factors, suggest_levels, suggest_assignments, explain_diagnostics, explain_coherence, generate_narrative
- Web search only for: benchmark suggestions and market share estimation
- All Phase 4–5 computation in Python microservice (GMM, WLS, sensitivity)
- Auth callback: `app/auth/callback/route.ts` — handles Supabase PKCE redirect, passes `?code=` to `/login` for client-side exchange (keeps session in browser localStorage)
- `/auth` paths bypass middleware auth check (added to proxy.ts allowlist alongside `/login`, `/survey`)

## What's built (all working end-to-end)
- **Phase 1:** Scope definition, price basis, target products (up to 3), category anchor, AI benchmark suggestions, batched market share estimation, market share metadata (source, confidence, AI-assisted badge); Target Segment optional field; 3-column no-scroll layout
- **Phase 2:** Factor/level definition, AI suggestions, benchmark level assignments, target product level assignments, unused level detection, frameworkDirty flag (only deletes/reinserts levels if framework actually changed); assignment save always persists (both dirty and non-dirty paths); duplicate benchmark pair detection (identical level assignments across all factors = rank condition warning); AI auto-assign skips LOW confidence / unrecognized products and surfaces a yellow warning banner listing skipped products; ordinal/nominal classification per factor (`is_ordinal` boolean, default true) — clickable badge on each factor card, AI suggests classification, coverage diagnostic filters to ordinal factors only; "Brand" auto-set to nominal when typed; Save button does not run validation (only Save & Continue does)
- **Phase 3:** Full AHP survey, 17-position slider with scale labels (9/Extreme…1/Equal), level-first ordering, save per response, `?goto=<factorId|attribute>` deep-link param for review navigation; slider label alignment uses `calc(${pct}% + ${20*(0.5-pct/100)}px)` with uniform `translateX(-50%)` to compensate for 20px thumb width at track edges
- **Phase 4:** Per-respondent and aggregated CR computation, include/exclude toggle; "Review →" link in per-respondent expanded CR view (scoped to FACILITATED + current user email); collapsible External Respondents management panel (add/copy-link/unlock/remove distributed respondents); dedup check on add (email+project+mode query before insert — shows error if already present); submitted respondents show completion time inline (derived from `survey_started_at` and `submitted_at`); post-solve diagnostics banner; auto-heal: if status=SURVEY_OPEN but aggregated_matrix exists, restores to SURVEY_CLOSED and calls router.refresh(); AI coherence summary — "✦ AI Summary" button inline with description (right-aligned), card renders above flag banners, calls `explain_coherence` task in `/api/ai/route.ts`, 3–4 sentence plain-language interpretation of survey consistency; HelpTip tooltips on Respondents heading (include/exclude behavior) and Aggregated Coherence Scores heading (threshold guide + remediation)
- **Phase 5:** Loads weights/utilities/assignments, calls /solve, model fit display (RMSE + NRMSE), 8-run solver table with B/M/R²/target estimates, reference product positioning, price recommendations (statistical + market envelope ranges), auto-rehydration on return visit, solver run override (select any of 8 runs as active, saves to DB), post-solve diagnostics (value scale coverage, market share concentration, R² reliability, factor weight concentration — all at 2.5× equal-share threshold); AI diagnostic explanations — background call after solver run, plain-language interpretation displayed in "Model Interpretation" section; **autoRunSolver writes results back to DB** (updates `regression_result` B/M/SSE/R² and `target_score` normalized_score/point_estimate/ranges) — prevents Phase 6 showing $0 after Phase 2 re-save wipes target_score solver fields
- **Phase 6:** Value Map with 5-dot target strip, Factor Contributions lollipop + stacked bar, Competitive Positioning Table, Price Recommendations with gap analysis; HelpTip tooltips on Value Map, Factor Contributions, and Price Recommendations headings; footer links to Phase 7; AI Positioning Narrative — "Positioning Narrative" section above Value Map, "✦ Generate Narrative" button, copy-to-clipboard, regenerate action; calls `generate_narrative` task in `/api/ai/route.ts`, 4–6 sentence executive-level summary (no methodology jargon); PDF export button removed (moved to Phase 7)
- **Phase 7 — Sensitivity Analysis:** Four independent analysis sections each with their own Run button: (1) Reference Product Price Sensitivity — SVG tornado chart using WLS linearity insight (2 solver runs per benchmark); per-benchmark ±% range inputs; per-target color-coded bar segments; right-side low/high annotations; table sorted by influence post-run; (2) Factor Sensitivity Analysis — one-factor-at-a-time exclusion with price delta and Signal column; (3) Market-Implied Weight Analysis — Nelder-Mead solver finds market-implied weights, side-by-side comparison table, gap coloring scaled to equal-share weight, R²-based footer; (4) Respondent-Level Model Analysis — per-respondent priority vectors + individual solver runs, factor weight distributions, outlier detection at ±2 SD. Phase 7 unlocks at MODEL_RUN (index 6) and is non-gating (no status advancement). **Export PDF button** in Phase 7 footer — POSTs pre-computed sensitivity data to `/api/pdf/[id]` (POST), avoiding solver re-runs at PDF time; `PDFSensitivityRow` and `PDFFactorSensitivityRow` types defined in `lib/pdf/VPMReport.tsx`. HelpTip tooltips on all four section headings.
- **Dashboard:** Project list, clone project, delete project; header has initials avatar + dropdown (Settings, Sign out)
- **Settings:** `/settings` shell with sidebar nav (Profile, Plan & Billing, Team, Notifications); Profile tab — display name (Supabase user_metadata), read-only email, password change, initials avatar; Billing tab — managed-access model, project count, capabilities list, support email; Team + Notifications tabs stubbed; active tab highlight via `SettingsNav` client component
- **Marketing site:** Public landing page at `/` (hero, problem section, 4 output sections with screenshots, 6-phase methodology, AI Assist section, 3 persona cards, dark CTA); `/request-access` form captures name/email/company/role/volume/use-case and emails lead to admin via Resend; `proxy.ts` updated to allow `/`, `/request-access`, `/api/request-access`, `/screenshots` without auth; `.gitattributes` marks all PNG/JPG as binary
- **Survey invite emails:** `app/api/send-survey-invite/route.ts` sends branded HTML email via Resend; Phase 4 "External Respondents" panel has "+ Add & Invite" button (auto-sends on add) and per-row "Send invite" / "Resend" with inline sent/error feedback; uses `RESEND_API_KEY` + `RESEND_FROM_EMAIL` env vars
- **Distributed surveys:** Token-based external survey at `/survey/[token]` — no auth required; managed via Phase 4 External Respondents panel; respondents added with name+email, unique link copied to clipboard; dedup prevention (email+project+mode uniqueness check); facilitator can unlock (clear submitted_at) for revision; unsubmitted DISTRIBUTED respondents excluded from analysis automatically; `survey_started_at` set on first pairwise response save (Q1→Q2 transition) via resilient separate query in POST handler (never in validateToken select — avoids 404 if column not yet migrated)

## Price range methodology (Phase 5 & 6)
Two range types shown:
1. **Statistical range:** `point_estimate ± std_dev(benchmark_residuals)`
2. **Market envelope:** `point_estimate + max(residuals)` ceiling, `point_estimate + min(residuals)` floor

Value Map 5-dot target strip at X = target model-implied price:
- Large solid center dot = point estimate
- Medium solid dots = statistical floor/ceiling
- Small hollow dots = envelope floor/ceiling
- Single whisker line through all 5, hover tooltip shows all 5 labeled values
- Target colors: amber family per target index — `#f59e0b`, `#b45309`, `#fcd34d`
- Value map legend: single 5-dot concept entry (not per-target)

## Phase 6 — Factor Contributions chart
Custom canvas lollipop chart (`FactorLollipop` component) with Recharts stacked bar toggle.

**Lollipop features:**
- Range bar (gray) showing min-max spread per factor
- Average tick (short vertical mark) on each range bar
- Filled dots = target products, hollow dots = reference products
- Target colors: amber family `['#f59e0b', '#b45309', '#fcd34d']`
- Reference colors: cool palette starting with blue/teal/purple
- `getColor(prod, pi)` helper — targets index into TARGET_COLORS by target-only index, refs by ref-only index
- Default sort: factors by max contribution descending
- Click product legend → sort by that product's deviation from average (descending)
- Reset link appears when custom sort active
- Total row at bottom with own scale and divider line

**Aggregate dot logic (when multiple products share same factor level value):**
- Single product → normal dot
- Multiple products → `drawSplitDot()`: 1 color=solid, 2=left/right halves, 3=vertical thirds via canvas clip
- **Color priority:** 1) sort product if in group → 2) target product(s) → 3) hollow gray
- Reference-only aggregates → hollow gray with gray count badge
- Aggregate tooltip: shared value + dev vs avg + rank on separate lines + each product with % of differentiated value

**Tooltip includes:** dollar value, ±delta vs avg, rank, % of differentiated value

**Model price / Differentiated value toggle:**
- Affects: stacked bar (include/exclude base segment) and lollipop total row scale
- Factor rows in lollipop always show differentiated value only (unaffected by toggle)
- Stacked bar: base value stored as 0 in data (not conditionally rendered) to prevent Recharts reordering bug

**Stacked bar:**
- Axis starts at 0, includes Base Value as gray first segment (value=0 in diff mode)
- Products sorted descending by Value Index
- Factor order: syncs to lollipop sort when product sort active; otherwise by total contribution descending

## Value Index formula (Option 2) — canonical implementation
In `solver.py`: `compute_scaled_score()` replaces old `compute_raw_score()`
```python
scaled = (utility - min_u) / util_range if util_range > 0 else 0.0
total += weight * scaled
```
In Phase 6 `load()`: same formula for both benchmark and target contributions
```typescript
const scaledUtil = utilRange > 0 ? ((level?.utility ?? 0) - minUtil) / utilRange : 0
contribution = f.weight * scaledUtil
```
These must stay in sync. Never use `weight × utility` directly.

## Clone project (`app/dashboard/CloneProjectModal.tsx`)
Always copies: factors, levels, target product level assignments, benchmark level assignments
Default on: benchmarks with prices & market shares, respondents (deduplicated by email, included=true only)
Default off: survey responses & derived outputs, solver results
Key fix: comparison_type is uppercase in DB — use `.toLowerCase()` when comparing
Key fix: benchmark_level_assignment has no project_id column — filter by benchmark_id

## Solver (`vpm-app/solver/solver.py`)
- `gmm_priority_vector()` — geometric mean across rows, normalize
- `compute_scaled_score()` — Option 2 formula: weight × (utility-min)/(max-min) per factor
- `build_value_index_scores()` — base=0, max=1 by construction; no normalization step needed
- `run_solver()` — 8 runs, returns all_runs array with r_squared and target_point_estimates per run
- `price_recommendation()` — point_estimate ± std_dev of residuals
- `run_sensitivity_analysis()` — excludes one factor at a time, re-normalizes weights, uses compute_scaled_score

## Current test project
- Project ID: `49415e0b-3370-4ca4-9572-8f6a3ccbfa7d` (CO2 incubator)

## Distributed survey architecture
- Respondent modes: `FACILITATED` (internal, takes Phase 3 survey in-app) and `DISTRIBUTED` (external, token link)
- Token is a UUID auto-generated by DB default on the `respondent` table
- External survey route: `app/survey/[token]/page.tsx` — public, bypasses auth middleware
- API route: `app/api/survey/[token]/route.ts` — uses service role client, validates token + mode=DISTRIBUTED
- Middleware bypass: `proxy.ts` skips auth for `/survey` and `/api/survey` paths
- DISTRIBUTED respondents excluded from Phase 4 analysis if `submitted_at` is null
- Phase 4 "External Respondents" panel: always visible (top of page), collapsible, shows submitted/awaiting status per respondent; submitted respondents show completion time (derived from survey_started_at − submitted_at)
- Facilitator unlock: sets `submitted_at = null` so respondent can resubmit via original link
- Dedup: adding a respondent with an email already present in the project (mode=DISTRIBUTED) shows an inline error and aborts the insert
- `survey_started_at` column on `respondent` table: set to current timestamp on first POST to `/api/survey/[token]` (first question answered); uses a separate `.select('survey_started_at')` query so a missing column never breaks the survey flow
- **Pending DB migration:** `ALTER TABLE respondent ADD COLUMN IF NOT EXISTS survey_started_at timestamptz;` — run in Supabase SQL editor alongside the is_ordinal migration

## Phase nav status / lock logic
- Nav unlocking is status-based: `DRAFT`(0) → `SCOPE_COMPLETE`(1) → `FRAMEWORK_COMPLETE`(2) → `SURVEY_OPEN`(3) → `SURVEY_CLOSED`(4) → `UTILITIES_DERIVED`(5) → `MODEL_RUN`(6) → `COMPLETE`(7)
- Phase N is accessible when statusIndex ≥ N-1; Phase 7 unlocks at MODEL_RUN (index 6)
- **Never downgrade status when navigating backward** — "← Back" buttons navigate without touching status
- `reviewInPhase3()` only sets `SURVEY_OPEN` if status ≤ `SURVEY_CLOSED`; if Phase 5 was already run, navigates without downgrading
- Phase 4 auto-heal on load: if status=`SURVEY_OPEN` but `aggregated_matrix` rows exist → restore to `SURVEY_CLOSED` + `router.refresh()`
- Call `router.refresh()` after any status advancement or downgrade so the server-component layout re-fetches

## Stale results / dependency awareness system
`app/components/StaleWarningModal.tsx` — shared confirmation modal with "clone this project first" guidance.

Three-tier dependency model. Status **only** downgrades on actual data changes, never on navigation alone:

| Trigger | Clears | Status drop |
|---|---|---|
| Phase 1: benchmark price or share changed (status ≥ MODEL_RUN) | `regression_result`, `target_score` solver fields | `UTILITIES_DERIVED` |
| Phase 2: factor or level added/removed (status ≥ SURVEY_OPEN) | pairwise responses, aggregated matrices, weights, utilities, solver outputs | `FRAMEWORK_COMPLETE` |
| Phase 2: assignment-only change, no structural edit (status ≥ MODEL_RUN) | `regression_result`, `target_score` solver fields | `UTILITIES_DERIVED` |
| Phase 3: first response edit on a completed survey (surveyStatus=closed) | aggregated matrices, weights, utilities, solver outputs | `SURVEY_OPEN` |
| Phase 4: respondent include/exclude toggle (status ≥ UTILITIES_DERIVED) | `attribute_weight`, `level_utility`, solver outputs | `SURVEY_CLOSED` |

- Phase 1 and Phase 2 save: never downgrade status on a no-change re-save (status kept if already higher than phase's natural advancement target)
- Phase 2 uses `forceStatusDowngrade` param on `handleSave()` so stale confirm path explicitly sets the right target status
- Phase 3 warns on first edit only per session (`staleConfirmedRef`); subsequent edits proceed without re-warning
- Each confirm handler calls `router.refresh()` so ProjectNav dot colors and phase lock states update immediately

## PDF export architecture (`app/api/pdf/[id]/route.ts`)
- GET handler: builds PDF from DB only (no pre-computed data)
- POST handler: accepts `{ benchSensitivity, factorSensitivity }` body — uses pre-computed data from Phase 7 state, falls back to solver recompute if omitted
- PDF includes: cover, model params, benchmarks table, targets table, factor contributions (lollipop-style SVG — split-dots + count badges + white halos + z-order sort), Reference Product Price Sensitivity tornado page, Factor Sensitivity page with Signal column
- `PDFSensitivityRow` / `PDFFactorSensitivityRow` types in `lib/pdf/VPMReport.tsx`
- Factor contributions SVG: groups dots by X position → `SvgSplitDot` for collisions; white halo (r+1.5) before every dot; z-sort: refs-only first, then by count asc, target groups last; `BAR_W = W - BAR_X - 24` prevents right-edge label cutoff
- Signal column logic mirrors Phase 7 exactly: r2Improves→amber, r2DropsLarge/priceImpactLg→blue, priceImpactSm+r2Stable→gray

## Known loose ends (minor)
- `scenario_id` filter was erroneously added to `level_utility` query — already removed; don't re-add it
- PDF Factor Contributions chart: split-dot + count badge + white halo done; still missing range bars, avg tick, and hollow/solid dot distinction (all dots rendered as filled) — full lollipop rebuild still needed
- Stale detection in Phases 1–4 needs stress testing across edge cases (e.g., concurrent edits, partial benchmark changes, back-to-back stale confirms)
- **Pending DB migrations (run both in Supabase SQL editor):**
  - `ALTER TABLE attribute ADD COLUMN IF NOT EXISTS is_ordinal boolean NOT NULL DEFAULT true;` — Phase 2 ordinal/nominal classification
  - `ALTER TABLE respondent ADD COLUMN IF NOT EXISTS survey_started_at timestamptz;` — distributed survey completion timing

## IP / legal
- Trade secret + trademark strategy (not patent)
- "Value Pricing Model™" filed for USPTO Class 42
- Methodology obfuscation is non-negotiable in all user-facing surfaces
- No AHP/pairwise/regression/WLS/GMM terminology anywhere in UI
