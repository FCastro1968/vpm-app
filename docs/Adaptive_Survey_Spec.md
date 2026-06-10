# Adaptive Survey with Sensitivity-Based Skipping — Design Spec

**Status:** Future enhancement, design phase
**Phase impacted:** Phase 3 (Preference Assessment) and supporting solver logic
**Goal:** Reduce survey length for larger factor/level frameworks without sacrificing priority vector accuracy or consistency measurement

---

## Background

The current Phase 3 survey is exhaustive — every factor is compared against every other factor, and every level within each factor is compared against every other level. For larger frameworks (e.g. 10 factors with 4 levels each → 105 questions) this creates respondent fatigue.

The adaptive survey replaces exhaustive pairwise comparisons with sensitivity-driven question selection. It skips comparisons where the answer would minimally affect the resulting priority vector, while preserving enough comparisons to maintain a meaningful Coherence Score.

**Important constraint:** This is intended as an alternative survey mode, NOT a replacement. The exhaustive survey remains the default. Adaptive mode is offered as an opt-in for testing and validation. After ample real-world testing across multiple projects, adaptive mode may become the default — but that's a future decision based on empirical results.

---

## When adaptive mode engages

Based on matrix size (number of items being compared):

| Matrix size | Pairs | Adaptive engages? |
|---|---|---|
| 3×3 | 3 | No — always exhaustive |
| 4×4 | 6 | No — always exhaustive |
| 5×5 | 10 | No — marginal benefit |
| 6×6 | 15 | Yes — modest benefit |
| 8×8 | 28 | Yes — strong benefit |
| 10×10 | 45 | Yes — significant benefit |
| 12×12 | 66 | Yes — major benefit |

**Threshold:** Adaptive logic engages when matrix size is 6×6 or larger. Smaller matrices ask all pairs.

This applies independently to:
- **Cross-factor matrix** — typically 6-12 factors, so adaptive engages for most projects
- **Per-factor level matrices** — typically 3-5 levels, so adaptive rarely engages here

Threshold should be a configurable parameter (e.g. `ADAPTIVE_MIN_MATRIX_SIZE = 6`) for empirical tuning.

---

## Methodology — sensitivity-based skipping

The core insight: a comparison is genuinely informative when answering it affects the priority vector meaningfully. A comparison is redundant when transitivity inference from existing answers already determines the outcome with high confidence.

### Phase 1 — Anchor round

Ask a spanning subset of comparisons sufficient to compute an initial priority vector.

**For n items, ask approximately 2 × (n-1) carefully chosen pairs.** Examples:
- 6 items: ~10 anchor pairs (out of 15 total)
- 8 items: ~14 anchor pairs (out of 28 total)
- 10 items: ~18 anchor pairs (out of 45 total)
- 12 items: ~22 anchor pairs (out of 66 total)

The 2×(n-1) size (versus a leaner 1.5×) is intentional: the anchor round provides the initial priority vector that drives all downstream sensitivity estimates. An underdetermined initial estimate propagates error through Phase 2 — the extra pairs are cheap insurance.

**Anchor pair selection:** Must cover all items (every item appears in at least one anchor pair) and form a connected graph. A good algorithm:
1. Start with a Hamiltonian path through all items (n-1 edges connecting all items in a chain)
2. Add ~(n-1) more edges as "cross-links" between non-adjacent items to enable triangulation
3. Bias cross-links toward items that are far apart in the chain (more triangulation power)

After Phase 1, compute initial priority vector via the **iterative imputation method** on the partial matrix (see below).

### Phase 2 — Sensitivity estimation

For each remaining unasked pair (i,j), compute the **sensitivity score**: how much would the priority vector change if this pair were answered at various plausible values?

**Slider position model.** Respondents answer on a discrete 17-position slider corresponding to AHP intensities `{1/9, 1/8, ..., 1/2, 1, 2, 3, ..., 8, 9}`. Sensitivity simulations must use valid slider positions — not continuous multiplicative perturbations — because the test is "what if the respondent gave a different *possible* answer," and continuous perturbations test answers a respondent literally cannot give.

**Algorithm:**
1. For each unasked pair (i,j):
   - Compute the transitively-inferred value `inferred_ij = w_i / w_j` from current priority vector
   - Snap `inferred_ij` to its nearest slider position (call this position p)
   - Generate simulated alternative answers at positions `p−2, p−1, p+1, p+2` (clamped to the [1, 17] valid range; duplicates removed if at the edges)
   - For each simulated answer, compute the resulting updated priority vector via iterative imputation
   - Measure the **maximum L1 distance** between current and simulated priority vectors across the 4 (or fewer at edges) simulations
2. Pairs with maximum L1 distance below `SENSITIVITY_THRESHOLD` are candidates for skipping
3. Pairs with maximum L1 distance at or above the threshold MUST be asked

**Threshold:** `SENSITIVITY_THRESHOLD` is a configurable parameter. Initial value 0.02 (L1 distance on a sum-to-1 priority vector). Final value will be set empirically via trial and error against real surveys — there is no principled derivation linking this to downstream price-recommendation precision, so calibration is observational. Expose as a solver-side constant for easy tuning.

### Sensitivity recomputation strategy

Sensitivity scores are computed **once**, immediately after the Phase 1 anchor round, and the resulting ranking is used for the entire Phase 3 targeted questioning sequence. Sensitivities are **not** recomputed after each Phase 3 answer.

**Rationale:**
- Recomputing after every answer is expensive: for n=10 with 27 unasked pairs × 4 simulations × ~10 imputation iterations each, every answered question would trigger ~1000+ imputation iterations
- The marginal benefit of mid-Phase-3 recomputation is small if the anchor round produced a reasonable priority vector estimate (which 2×(n-1) anchor pairs should)
- Fixed-ranking simplifies the survey state machine and removes mid-survey loading states

Trade-off accepted: a pair flagged as "low sensitivity" after the anchor round might become higher-sensitivity after several targeted answers, but we don't go back to ask it. This is a known limitation, mitigated by the relatively generous anchor round size.

### Phase 3 — Targeted questioning

Ask all pairs whose Phase 2 sensitivity score met or exceeded `SENSITIVITY_THRESHOLD`, in descending order of sensitivity. Pairs below threshold are skipped **unless** they participate in a triangle inconsistency with already-answered pairs (see below).

**Triangle inconsistency check.** For any unasked pair (i, j) that would be skipped, check every intermediate item k where both (i, k) and (k, j) are answered. The triangle inconsistency for path k is:

```
T_k(i, j) = | log(a_{ik}) + log(a_{kj}) − log(w_i / w_j) |
```

where `w_i / w_j` is the priority-vector-implied value for the (i, j) pair. If `max_k T_k(i, j) > TRIANGLE_INCONSISTENCY_THRESHOLD`, the (i, j) pair is asked anyway, regardless of its sensitivity score, because the existing answers disagree about what its value should be.

**Threshold:** `TRIANGLE_INCONSISTENCY_THRESHOLD` is a configurable parameter, also tuned by trial and error. Initial value 0.5 (corresponds to roughly half a step on the log-scale AHP slider). Final value set empirically.

### Phase 4 — Consistency check

After all targeted questions are answered:
1. Compute Coherence Score on the completed matrix (known entries + imputed fill-ins)
2. If Coherence Score is elevated (yellow or red flag):
   - Identify the comparisons most likely contributing to inconsistency
   - For each such comparison, if the directly involved pair is known, present it for review
   - If the comparison involves a skipped pair, ask that pair now and recompute
3. Repeat until either Coherence Score is acceptable or no more useful questions to ask

---

## GMM on partial matrices — iterative imputation method

Standard GMM requires a complete n×n matrix. With skipped pairs, missing entries must be imputed before GMM is applied. The correct approach is the **Harker (1987) method for incomplete pairwise comparison matrices**, which is equivalent to minimizing the log-least-squares criterion over the known entries only.

**Algorithm:**

1. Initialize: set `w_i = 1/n` for all i (uniform prior)
2. Fill every missing entry: `â_{ij} = w_i / w_j` (and `â_{ji} = w_j / w_i`)
3. Recompute priority vector via standard GMM on the now-complete matrix:
   `w_i = (∏_j â_{ij})^(1/n)` for all j = 1…n (using `1/n` uniformly — not `1/k`)
4. Normalize: `w_i = w_i / Σ_j w_j`
5. Check convergence: if `max_i |w_i^new − w_i^old| < 1e-6`, return `w`. Otherwise return to step 2.

**Convergence cap and fallback.** Maximum 50 iterations. If not converged at iteration 50, return the last iterate without raising an error and log a warning (`adaptive.imputation.no_converge` with project_id and matrix dimensions). In practice, AHP iterative methods converge in 5–10 iterations; non-convergence would indicate a pathologically inconsistent matrix where the priority vector itself is poorly defined, so the last iterate is no worse than any other estimate. If oscillation is observed empirically, add a damping factor (`w^new ← 0.5 · w^old + 0.5 · w^computed`) — not included by default to avoid slowing convergence in the common case.

**Why not use `1/k` where k = known entries per row?** Using variable exponents makes row geometric means incommensurable — row i's mean is over comparison partners {2, 3, 5} while row j's is over {1, 4, 6}. The resulting weights cannot be meaningfully compared. Uniform imputation followed by uniform `1/n` ensures every row is evaluated on the same basis.

This iterative imputation step is used in:
- Phase 1: computing the initial priority vector from anchor pairs
- Phase 2: computing updated priority vectors for each sensitivity simulation
- Phase 3: updating the priority vector as targeted pairs are answered
- Phase 4: final priority vector for coherence computation and downstream phases

The solver's partial-matrix GMM must implement this loop, not a simple single-pass GMM. It is the inner loop that all other adaptive logic depends on.

---

## Preserving consistency measurement

**Computation:** Coherence Score uses the standard formula `CR = (λ_max − n) / ((n − 1) · RI)` applied to the **fully-imputed matrix** (known entries + iterative-imputation fill-ins). No special formula is invented for partial matrices.

**Optimism caveat (explicit):** Because the imputed entries are by construction perfectly consistent with the priority vector, they contribute zero inconsistency to the eigenvalue calculation. As more pairs are skipped, more of the matrix is "consistent by construction," and the CR drops toward zero artifactually. Adaptive-mode CR values are therefore systematically lower (better-looking) than exhaustive-mode CR values for the same respondent. This is methodologically defensible (the only judgments the respondent actually made are the asked ones) but it does mean CR thresholds may need adjustment for adaptive mode if we want comparable interpretation.

**Display note to user:** "Coherence Score computed from N answered comparisons (M skipped via adaptive logic). Scores from adaptive surveys are typically lower than standard-survey scores for the same respondent and are not directly comparable."

**Practical implication for the Phase 4 remediation loop:** the "ask a skipped pair to resolve inconsistency" step in the methodology only makes sense for skipped pairs that are *implicated by a triangle inconsistency with the asked pairs*. Asking arbitrary skipped pairs cannot reduce CR because their imputed values are already perfectly consistent. Phase 4 remediation must identify the asked-pair triangles producing the inconsistency, then ask any skipped pairs that share an item with those triangles.

---

## Why we kept redundancy in the adaptive design

Earlier brainstorm considered a purely transitive-skip approach (skip every pair whose value is implied by transitivity). That was rejected because:

1. **Consistency measurement requires redundancy.** Without overdetermined comparisons, there's nothing to be consistent or inconsistent about.
2. **Low-weight factor pairs can still be highly differentiating** for products that cluster on high-weight factors. Skipping them based on weight alone would introduce bias.
3. **The sensitivity criterion is more honest** than the weight criterion — it asks "does this answer change the conclusion?" which is the real question.

The sensitivity-based approach naturally retains comparisons that matter while skipping only genuinely redundant ones.

---

## Multi-respondent behavior

### Distributed mode

Each distributed respondent gets an **independent adaptive flow**. The respondent's own answers drive their own anchor → sensitivity → targeted → check sequence. This matches the current distributed survey architecture (each respondent has their own pairwise responses on their own token).

**Survey state is held by the solver, not the client.** Each `/api/survey/[token]` POST that records an answer triggers (or is followed by) a solver call to determine the next question. The solver recomputes the partial-matrix priority vector from the respondent's stored answers each time — no persistent state on the solver side. This adds latency to each question transition but keeps the solver stateless and the survey resumable across sessions.

### Facilitated mode

In facilitated mode (multiple SMEs answering in a single in-app session), the **room collectively skips questions as if it were a single respondent**. Sensitivity is computed against the aggregated running matrix — i.e., the geometric-mean aggregation of all answers given so far in the room — and skip decisions apply to all SMEs in the session simultaneously. There is no per-SME adaptive flow within a facilitated session; the room is one logical respondent for adaptive purposes.

This matches how facilitated mode already works (the room is treated as a single answering entity in the existing flow) and avoids the awkward case where different SMEs in the same room would be asked different questions.

### Mid-survey abandonment in distributed mode

In adaptive mode, a distributed respondent's contribution is **all-or-nothing**: either the respondent reaches Phase 4 completion (all targeted questions answered, coherence check passed), or their entire contribution is discarded.

**Rationale:** A partial adaptive survey produces a partial set of asked pairs whose composition depends on the respondent's specific answer sequence. Aggregating partial adaptive responses across respondents (each with a different asked-pair subset) is methodologically messy and not worth the complexity. Standard-mode partial responses remain usable as today; adaptive-mode partial responses do not.

UX implication: the survey landing page for distributed respondents in adaptive mode should make this clear ("please complete the survey in one or more sessions — partial responses are not retained when the survey closes"). The `submitted_at` field remains the marker of completion; un-submitted adaptive respondents are excluded from analysis as today.

---

## UI / UX considerations

### Survey mode selection (Phase 3 entry)

Add a survey mode toggle:
- **Standard survey (default)** — exhaustive pairwise comparisons
- **Adaptive survey (testing)** — sensitivity-driven question selection, shorter for larger frameworks

Display estimated question count for each mode based on current framework size.

### During the adaptive survey

- Progress indicator should not show "Question X of Y" with a fixed Y — that breaks once adaptive skipping happens
- Better: progress bar based on estimated completion (continually updated); avoid showing a numeric "N more" count since the estimate shifts as sensitivity scores evolve
- No indication to the user that any pairs are being skipped — the experience should feel like a normal survey, just shorter
- The order of presented pairs should feel natural — anchor pairs first (possibly grouped by item), then sensitivity-targeted pairs interleaved

### After the adaptive survey

- Coherence Review screen should note that adaptive mode was used
- Include the count of answered vs. skipped pairs in the diagnostic info (advisory only)
- All other downstream phases (4, 5, 6) work identically — they don't care how the priority vector was derived

---

## Implementation phases

### Phase A — Solver-side adaptive engine

Build the core sensitivity computation and adaptive pair selection in the Python solver:

1. New endpoint or extended `/solve` capability that accepts a partial pairwise matrix and returns:
   - Current best estimate of the priority vector (iterative imputation GMM on known entries)
   - Sensitivity scores for each unasked pair
   - Recommended next pair to ask (or "complete" signal if all remaining pairs are low-sensitivity)

2. Anchor selection algorithm — given n items, return the list of 2×(n-1) anchor pairs

3. Consistency computation on partial matrices (using imputed fill-ins)

### Phase B — Survey flow refactor

Phase 3 currently generates all pairs upfront and presents them. Refactor to support adaptive flow:

1. State machine: anchor → targeted → coherence check → complete
2. Each transition queries the solver for the next pair
3. Survey responses are stored as-they-happen (already the case for the standard survey)
4. Skipped pairs are recorded with a `skipped` flag and their inferred value, for later analysis

### Phase C — Mode selection UI

1. Toggle at Phase 3 entry
2. Estimated question counts shown for each mode
3. Adaptive mode flagged as "testing" or "preview" until enough projects have validated it

### Phase D — Validation tooling

Validation is **observational, not experimental**. There is no formal A/B design (same-respondent re-runs are confounded by memory; different-respondent assignment confounds mode with respondent). Validation comes from the mode toggle itself: running adaptive on real projects and comparing priority vectors, model fit, and price recommendations against what an equivalent standard-mode run would have produced.

What gets persisted to enable this comparison:

- The `survey_run` table records mode, anchor/asked/skipped counts, final coherence score, and downstream R²
- Per-project, the user can flip the mode toggle and re-run Phase 3 fresh (clearing prior responses) to compare side-by-side at the cost of re-surveying
- Across projects, aggregate metrics on `survey_run` allow rough comparison of adaptive vs. standard outcomes

**Build alongside Phase A/B**, not after — the `survey_run` table needs to exist from the first adaptive run so data accumulates from day one.

---

## DB schema changes

`pairwise_response` table:
- Add `skipped` boolean — true if the pair was inferred rather than answered
- Add `inferred_intensity` numeric — the value used when skipped (null if answered)
- Add `survey_mode` text — 'standard' or 'adaptive'

New `survey_run` table to track:
- `project_id`, `scenario_id` (null for base)
- `mode` ('standard' or 'adaptive')
- `started_at`, `completed_at`
- `anchor_pair_count`, `asked_pair_count`, `skipped_pair_count`
- `final_coherence_score`
- `model_fit_r_squared` — allows cross-project correlation of survey mode with downstream model quality

---

## Open questions

These remain genuinely open and may be deferred to empirical observation after the initial build.

1. **Anchor pair selection algorithm:** the Hamiltonian path + cross-links approach is intuitive but other graph spanning approaches may be better. Implement the Hamiltonian + cross-links variant for v1; revisit if results look weak.

2. **Sensitivity threshold (`SENSITIVITY_THRESHOLD`):** initial 0.02, tuned by trial and error against real surveys.

3. **Triangle inconsistency threshold (`TRIANGLE_INCONSISTENCY_THRESHOLD`):** initial 0.5 (log-scale), tuned by trial and error.

4. **Order randomization in targeted phase:** sensitivity-descending is the default for v1. Whether to add a randomized order option for obfuscation is a v2 decision.

5. **Early exit:** if all remaining pairs fall below `SENSITIVITY_THRESHOLD` after the anchor round, the targeted phase asks nothing and the survey jumps straight to the coherence check. No minimum-pair floor is enforced; the anchor round itself (2×(n-1) pairs) is the de facto minimum.

---

## Methodology rules that must be preserved

- GMM priority vector derivation throughout (no AMNC) — the iterative imputation method is GMM-based and fully consistent with this constraint
- Coherence Score computation logic must remain consistent with current implementation for asked pairs
- Adaptive logic must NEVER affect the math of the solver itself — Phase 4 onwards work identically on adaptive vs. standard surveys
- The exhaustive standard survey remains available indefinitely and is the default
- UI obfuscation: nothing in the user-facing survey should reveal that adaptive/transitive logic is happening. The survey should feel like a normal (shorter) survey

---

## Strategic context

This is partly a usability enhancement (shorter surveys for larger frameworks) and partly a methodology differentiation play. The adaptive algorithm itself is a piece of proprietary IP. Combined with other obfuscation strategies (terminology, visual reframing, survey-flow variation), it strengthens the wall against methodology reverse-engineering by competitors.

The strategic value depends on empirical validation showing that adaptive mode produces equivalent priority vectors and model fits with materially fewer questions. That validation work is part of the rollout plan (Phase D), not a separate concern.
