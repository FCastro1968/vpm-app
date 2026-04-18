# VPM — Enhancement Queue
**Price Positioning Platform | Internal Working Document**

Priority tiers:
- 🔴 **P1** — Pre-commercial: Required before showing to a real prospect or running a real engagement
- 🟡 **P2** — Early commercial: Important for customer retention and Professional/Enterprise tier value
- 🟢 **P3** — Full spec: Completes the original spec; not blocking early sales
- ⚪ **P4** — Future / Enterprise: Primarily Enterprise tier or post-launch roadmap

---

## Onboarding & First-Use

| Pri | Item | Notes |
|-----|------|-------|
| 🔴 | Demo / sample project | Pre-loaded read-only project for new accounts (e.g., a CO2 incubator or similar). Lets a prospect experience the full output — Value Map, lollipop, PDF — before building anything. Critical for self-serve sales. |
| 🔴 | ✓ Contextual help tooltips | DONE — HelpTip component (click-to-open popover, outside-click-to-close). Phase 2: factor name, performance levels ordering, ordinal/nominal badge, coverage score. Phase 3: context-aware comparison prompt (attribute vs level). Phase 5: Weighted R², Benchmark Outlier Review, Sensitivity Analysis. Phase 6: Value Map 5-dot strip, Factor Contributions lollipop, Price Recommendations ranges. |
| 🟡 | In-app guided tour | First-time-user walkthrough (coach marks) covering Phase 1 → 2 → 3 → 5 → 6. Dismissible, re-triggerable from Help menu. |

---

## Phase 1 — Scope Definition

| Pri | Item | Notes |
|-----|------|-------|
| 🟡 | ✓ Validation gates | DONE — hard block Save & Continue when fewer than 3 reference products are included. (Currency is project-level so mixed currency can't occur; segment note dropped as too vague.) |
| 🟡 | ✓ Market share metadata | DONE — surface market_share_source, market_share_confidence, and market_share_ai_assisted in UI. |
| 🟡 | CSV benchmark import | Paste or upload a spreadsheet with product name, price, and optional market share. Maps columns interactively. Eliminates manual entry friction for large competitive sets. |
| 🟡 | Benchmark price bulk-edit table | Edit all benchmark prices in a single inline table without opening each row individually. Needed for price refresh cycles. |
| 🟢 | ✓ Target Segment field | DONE — optional "Target Segment" field added alongside Geographic Scope. Stored in project.target_segment, surfaced in PDF cover page. |

---

## Phase 2 — Factor Framework

| Pri | Item | Notes |
|-----|------|-------|
| 🟡 | ✓ Save button (no navigate) | DONE — Save persists without validation; Save & Continue enforces full validation before navigating. |
| 🟡 | ✓ Assignment save bug fix | DONE — non-dirty path (assignment-only changes, no factor/level edits) was silently skipping DB writes. Fixed: non-dirty save now does delete-then-insert for benchmark_level_assignment. |
| 🟡 | ✓ Duplicate benchmark pair detection | DONE — red warning banner when two reference products have identical level assignments across all factors (rank condition violation). |
| 🟡 | ✓ AI auto-assign confabulation guard | DONE — skip assignments where recognized=false or confidence=LOW; yellow warning banner lists skipped products for manual assignment. AI prompt now explicitly requests "recognized" boolean field. |
| 🟡 | ✓ AI factor classification (ordinal/nominal) | DONE — AI suggest_factors returns classification field; stored as is_ordinal boolean on attribute table; clickable Ordinal/Nominal badge on each factor row; coverageScore filters to ordinal factors only. |
| 🟢 | ✓ Pre-survey structural coverage diagnostic | DONE — equal-weight coverage score shown in Phase 2 once all benchmarks assigned; green/amber/red thresholds at 50%/30%. |
| 🟢 | Framework templates | Save a factor framework (factors + levels, no assignments) as a named reusable template. Apply a template to a new project to skip Phase 2 setup. Templates owned per-user or per-org. AI factor suggestions make category-specific starter templates less critical, but user-saved templates are valuable for repeat engagements. |

---

## Phase 3 — Preference Assessment

| Pri | Item | Notes |
|-----|------|-------|
| 🔴 | ✓ Equal rating end-to-end verification | DONE — confirmed correct: all-Equal survey produces equal weights (1/N per factor), equal level utilities, CR ≈ 0. |
| 🟡 | ✓ Jump to section navigation | DONE — `?goto=` param from Phase 4 review links navigates to specific factor in Phase 3. |
| 🟡 | ✓ Survey deadline / expiration | DONE — project-level `survey_expires_at` date field in Phase 4 External Respondents panel. API returns 410 when past deadline; survey page shows friendly "This survey has closed" message. |
| 🟡 | ✓ Respondent role / expertise tagging | DONE — optional Role field when adding a distributed respondent; stored in `respondent.role`; shown as a blue badge in the respondent list. Feeds respondent-level model analysis when built. |
| 🟡 | ✓ Duplicate respondent prevention | DONE — email+project+mode uniqueness check before insert; shows inline error if already present. |
| 🟡 | ✓ Survey completion timing | DONE — `survey_started_at` set on first pairwise response (Q1→Q2 transition) via resilient separate query in POST handler; Phase 4 panel shows elapsed time next to Submitted badge. Requires DB migration: `ALTER TABLE respondent ADD COLUMN IF NOT EXISTS survey_started_at timestamptz;` |
| 🟢 | ✓ Distributed survey mode | DONE — token-based external survey at `/survey/[token]`; managed from Phase 4 External Respondents panel; unsubmitted respondents auto-excluded from analysis. |
| 🟢 | ✓ Facilitator unlock for re-submission | DONE — unlock button in Phase 4 panel clears submitted_at; respondent resubmits via original link. |

---

## Phase 4 — Coherence Review

| Pri | Item | Notes |
|-----|------|-------|
| 🟡 | AI coherence guidance | Plain-language explanation of Coherence Score + suggest which comparisons to review. |
| 🟡 | Survey reminder email | Send a nudge to distributed respondents who haven't submitted. Triggered manually by facilitator or auto-triggered N days before deadline. Requires email infrastructure (see invite email options below). |
| 🟡 | Survey invite email — Option A (mailto prefill) | Replace "Copy link" with "Send invite" button using `mailto:` — opens facilitator's email client with recipient, subject, and body pre-populated. Zero new infrastructure. |
| 🟡 | Survey invite email — Option B (transactional, e.g. Resend) | Server-side API route sends invite directly from app. Requires Resend account + API key + verified sending domain. Better respondent UX. Supersedes Option A if implemented. |

---

## Phase 5 — Value Pricing Model

| Pri | Item | Notes |
|-----|------|-------|
| 🔴 | ✓ Weighted SSE normalization | DONE — RMSE in $ + NRMSE as % of avg price. Both shown in winning solution card and 8-run table. |
| 🟡 | ✓ Manual factor exclusion from model run | DONE — include/exclude toggle per benchmark with optional reason field; excluded benchmarks removed from solver run. |
| 🟡 | ✓ Post-solve diagnostics | DONE — value scale coverage, market share concentration, R² reliability note, factor weight concentration. |
| 🟡 | ✓ Benchmark Outlier Review (Advanced Diagnostics Tool 2) | DONE — flags large-residual benchmarks post-solve; "Exclude & Re-run" button; auto-shown on poor fit (R² < 0.6) or flagged outliers. |
| 🟡 | ✓ User override of winning solver solution | DONE — select any of 8 runs as active, saves to DB, amber badge shown when overridden. |
| 🟡 | ✓ Price Delta % in sensitivity analysis | DONE — signed % column added to sensitivity table showing model price change when each factor is excluded. |
| 🟢 | ✓ Market-Implied Weight Analysis (Advanced Diagnostics Tool 3) | DONE — Nelder-Mead solver finds market-implied weights via `/api/solver?endpoint=market-implied-weights`; side-by-side comparison table; gap thresholds scale to equal-share weight (neutral <25%, amber 25–65%, red >65% of 100/N pp); R²-based footer conclusion (material if gap >3pp); rank condition check gates the run button. |
| 🟢 | Multi-segment / Multi-geography model | 🏗 Run the same framework against multiple market segments or geographies as separate model instances. Each instance has its own benchmark set and market prices. Phase 6 shows side-by-side price recommendations and value map overlay across segments. Useful when the same product positions differently by region or customer type. |
| 🟢 | ✓ Respondent-level model analysis (Advanced Diagnostics Tool 4) | DONE — per-respondent priority vectors + individual solver runs (all parallel via Promise.all); factor weight distribution table with consensus row; outlier detection at ±2 SD from mean target price (highlighted in amber); stability footer summarizing spread and flagging outliers. |
| 🟢 | ✓ AI diagnostic explanations | DONE — after solver run, fires background AI call with R², NRMSE, factor weights, sensitivity signals, outliers, and target recommendations; plain-language interpretation displayed in "Model Interpretation" section beneath diagnostics. Uses `explain_diagnostics` task in `/api/ai/route.ts`. |
| 🟢 | ✓ autoRunSolver DB write-back | DONE — `autoRunSolver` now persists results back to `regression_result` (B, M, SSE, R²) and `target_score` (normalized_score, point_estimate, ranges) after each run. Prevents Phase 6 showing $0 target values after Phase 2 delete-then-insert wipes solver-derived fields from `target_score`. |

---

## Phase 6 — Analysis & Output

| Pri | Item | Notes |
|-----|------|-------|
| 🔴 | Executive summary PDF export | Value Map, Factor Contributions, Positioning Table, Price Recommendation, optional AI narrative. PDF route generating end-to-end; cover page (incl. Target Segment), price recs, and positioning table are solid. Factor Contributions chart and dollar-scale header in place but chart itself still needs lollipop rebuild. |
| 🔴 | PDF Factor Contributions chart — rebuild to match Phase 6 | Current PDF renders a basic horizontal bar chart. Need faithful SVG/react-pdf recreation using `<Svg>` primitives: gray range bar per factor, avg tick, dot per product (hollow=ref, solid=target, amber/blue palette), split-dot for collisions, total row with divider and model-implied price scale. Dollar-scale tick header is already implemented. |
| 🟡 | AI narrative summary | AI-drafted plain-language positioning narrative. User reviews and approves. Feeds into exports. |
| 🟡 | XLSX raw data export | Pairwise matrices, weights, utilities, benchmark scores, solver results, sensitivity. |
| 🟡 | ✓ Value Map interpretation tools | DONE — quadrant shading (soft red = overpriced above diagonal, soft blue = underpriced below), toggleable product name labels ("Labels" button) with connector lines for displaced labels. |
| 🟡 | PPTX export | Executive summary deck: Value Map + Factor Contributions + Positioning Table + Recommendation. |
| 🟡 | Shareable read-only project link | Time-limited token-based link to a live Phase 6 view — no login required. Lets a consultant share interactive output with a client before the PDF is finalized. Configurable expiry (7 / 30 / 90 days). |
| 🟢 | Scenario analysis UI | 🏗 Named what-if scenarios. Up to 10 per project. Scenario-aware Phase 5. Side-by-side comparison. |
| ⚪ | Client portal | 🏗 Persistent branded read-only project view for the client being priced. Separate from shareable link — lives at a stable URL, supports comments from client stakeholders, no VPM account required. Enterprise tier. |

---

## Cross-phase Flow Controls

| Pri | Item | Notes |
|-----|------|-------|
| 🟡 | Backward navigation with dependency awareness | Three tiers of downstream impact. Base run locked at MODEL_RUN. User warned before invalidating downstream phases. |
| 🟡 | Save without continue — all phases | Phase 2 has this. Phases 1, 3, 4, 5 need it. Critical for Phase 1 price edits post-model. |

---

## General / Cross-phase Architecture

| Pri | Item | Notes |
|-----|------|-------|
| 🟡 | ✓ Project clone | DONE — selective carry-over dialog. Copies factors, levels, assignments, benchmarks+prices, respondents. Survey responses and solver results not cloned. |
| 🟡 | Project folders / organization | Flat folder structure on dashboard. Per-user or per-org. "Unfiled" as first-class view. Alternative: lightweight tags/labels with filter row (20% effort, 80% of value). |
| 🟡 | Project archiving | Archive completed projects to a separate view. Archived projects excluded from active counts and default dashboard view. Restoreable. |
| 🟡 | Project templates | Save a complete project configuration (framework + benchmarks + scope, no survey responses or solver results) as a named template. Useful for repeat engagements in the same category. |
| 🟡 | Comments / annotations | Inline comments on model outputs (Value Map, Factor Contributions, Positioning Table). Threaded, per-user, resolvable. Supports team review before client delivery. |
| 🟢 | Cross-project summary | Read-only side-by-side price recommendations across projects. Flags inconsistent price basis. |
| 🟢 | Audit trail visibility | Excluded respondents, benchmarks, factors, solver overrides — stored in DB but not surfaced in UI. |

---

## AI Assist Layer

**Built:**
- Phase 1: Category Anchor → benchmark suggestions (web search, batched)
- Phase 1: Market share estimation (web search, batched, confidence tiers)
- Phase 2: Factor suggestions from category anchor
- Phase 2: Performance level suggestions per factor
- Phase 2: Auto-assignment of reference products to levels
- Phase 2: Brand factor — levels derived from benchmark names

**Built:**
- Phase 5: AI diagnostic explanations — plain-language interpretation of R², NRMSE, factor weights, sensitivity signals, outliers, target recommendations. Fires in background after solver run; displayed in "Model Interpretation" section.

**Not yet built:**

| Pri | Item | Notes |
|-----|------|-------|
| 🟡 | Phase 4: Coherence guidance | Explain score + suggest which comparisons to review. |
| 🟡 | Phase 6: Narrative summary | Draft positioning narrative for export. |

---

## User Profile & Account Settings

| Pri | Item | Notes |
|-----|------|-------|
| 🟡 | Settings page — shell | `/settings` route with sidebar nav: Profile, Plan & Billing, Team, Notifications. Accessible from dashboard header/avatar menu. |
| 🟡 | Profile tab | Display name, email (read-only, managed by Supabase auth), password change, avatar/initials. |
| 🟡 | Plan & Billing tab | Current plan badge (Starter / Professional / Enterprise), usage counters (projects used / seat limit), upgrade CTA. Billing portal link (Stripe customer portal) when on paid plan. |
| 🟡 | Team tab | Invite team members by email, assign seat, remove member. Visible on Professional+ only. Shows pending invites. |
| 🟢 | Notifications tab | Email preferences: survey submitted, model ready, export complete. Toggle per event type. |
| 🟢 | API key management | Generate / revoke personal API tokens. Enterprise only. Feeds future API access feature. |

---

## Platform & Infrastructure

| Pri | Item | Notes |
|-----|------|-------|
| 🟡 | Product tier enforcement | Starter: 3 projects, 1 seat, PDF only, no AI assist. Professional: unlimited, 5 seats, all exports, full AI. No enforcement currently. |
| 🟡 | Dashboard enhancements | Recent activity feed, team member project visibility for org accounts. |
| ⚪ | White-label / tenant configuration | 🏗 Per-tenant branding at runtime. Custom domain, logo, email sender, export templates. DNS/TLS per tenant. Enterprise only. |
| ⚪ | SSO/SAML | Enterprise auth integration. |
| ⚪ | API access | Programmatic access to project data and model results. Enterprise only. |

---

## Deployment Roadmap

| Stage | Gate | Key remaining work |
|-------|------|--------------------|
| **Staging** | ✓ DONE | Solver on Railway (`https://vpm-app-production.up.railway.app`), Next.js on Vercel (`https://vpm-app.vercel.app`), `SOLVER_URL` env var set, Supabase redirect URLs configured, forgot-password + PKCE auth callback working |
| **Prospect-ready** | Before any external demo | ~~Contextual tooltips~~ ✓ — remaining: demo/sample project, PDF Factor Contributions lollipop rebuild |
| | | *Also resolved this session:* ~~Duplicate respondent prevention~~ ✓, ~~Survey completion timing~~ ✓, ~~Respondent-level analysis (Tool 4)~~ ✓, ~~autoRunSolver write-back (Phase 6 $0 fix)~~ ✓ |
| **Commercial launch** | Before taking payment | Stripe billing, product tier enforcement, settings/profile, onboarding tour, survey invite emails |

---

## Notes
- 🏗 = significant multi-session feature
- ✓ = completed
- Distributed survey mode, scenario management, and white-label are the three largest remaining architectural pieces (project clone is now done).
- PDF export is the highest single-item commercial priority — a consultant cannot go to a client without a deliverable.
- P1 items should be resolved before any prospect demo.
- White-label is gating for first Enterprise customer onboarding but not for early sales conversations.
- Enhancement queue is now maintained as this .md file — the original .docx is superseded.
