# Solver Golden-File Regression Test Suite

Frozen-input regression tests for the VPM solver. These tests are the **source
of truth for solver behavior** — run them after ANY change to `solver.py` or
`main.py`:

```
cd solver
venv\Scripts\activate
python -m pytest tests -q
```

## What is protected

| Guard | Failing test |
|---|---|
| Option 2 Value Index formula revert (to raw `weight × utility`) | `test_option2_not_option1` |
| GMM → AMNC slip | `test_attribute_weights_match_golden` (inconsistent-matrix fixtures) |
| WLS → OLS slip (market-share weights dropped) | `test_wls_not_ols` |
| Display-order (instead of utility-driven) min/max anchors | `test_anchors_are_utility_driven_not_display_order` |
| Base=0 / Max=1 construction | `test_base_max_construction` |
| Convexity regression (init strategies finding different optima) | `test_dual_init_agreement` |
| Regime nesting (SSE(UNIVERSAL_ONLY) ≤ all anchored) | `test_regime_nesting` |
| Winner selection + least-constrained tie-break | `test_winner_selection` |
| Equal-rating behavior (1/N weights, CR=0, zero contributions) | `test_equal_ratings_end_to_end` |
| Any numeric drift in weights/utilities/CR/solutions/sensitivity | golden comparisons |

## Layout

- `fixtures/*.json` — frozen inputs (4 projects: minimal, standard, concentrated, degenerate)
- `fixtures/author_fixtures.py` — the script that wrote them (deterministic; do not re-run casually)
- `goldens/*.golden.json` — frozen expected outputs, stamped with `solver_version` + `generated_at`
- `generate_goldens.py` — regenerates goldens (see policy below)
- `pipeline.py` — shared fixture-to-solve chain mirroring `main.py /solve`; used by both tests and the generator so they cannot drift apart

## Regeneration policy

**Never regenerate goldens to make failing tests pass.** A golden test failure
means solver behavior changed — that is the suite doing its job. Regenerate
only when behavior is changed deliberately:

1. Make the solver change and bump `SOLVER_VERSION` in `solver.py`
   (`test_solver_version_matches_golden` fails until goldens are regenerated,
   forcing this decision to be explicit).
2. Run `python tests\generate_goldens.py` from `solver/`.
3. Commit goldens together with the solver change; the commit message must
   state what behavioral change justified regeneration.

## Fixture provenance

All fixtures are synthesized deterministically (`author_fixtures.py`) — no
randomness anywhere. `fixture_standard` was planned as an export of the CO2
incubator test project, but Supabase was paused when the suite was built, so
it is a synthetic stand-in with the same shape (9 benchmarks, 7 factors,
6 ordinal + 1 nominal Brand, levels 2–5). It can be replaced with a real
export later — doing so requires golden regeneration per the policy above.

Notable deliberate fixture properties:

- `fixture_minimal` — attribute matrix is perfectly consistent with
  hand-computable GMM weights (4/7, 2/7, 1/7); factor `f3`'s utility order
  contradicts its display order (anchor-selection guard).
- `fixture_standard` — bench_8 overpriced (+1400), bench_4 underpriced
  (−1100) by construction; two targets.
- `fixture_concentrated` — 55%-share benchmark priced above the value trend,
  making WLS and OLS diverge by ~7% of mean price on B.
- `fixture_degenerate` — Value Indices clustered in a ~0.10 band (two
  benchmarks share an identical V with different prices); ill-conditioned
  flat-valley fit. This fixture is why the winner tie-break exists: all four
  regimes converge to the same optimum and differ only by termination noise.

## Convexity context (Item 8 Step 0 finding, June 2026)

Predicted price `B + V·(M−B)` is linear in (B, M) — V is fixed before the
solve — so weighted SSE is a convex quadratic and every regime's constraints
are linear. Each regime is a convex QP with a unique optimum; the historical
"local minima" behavior was an Excel GRG artifact. Consequently the solver
runs one optimization per regime (4 total, down from 8); dual-init agreement
is enforced here (`test_dual_init_agreement`) instead of at runtime, and the
regimes nest (`test_regime_nesting`): the UNIVERSAL_ONLY solution is always
the lowest-SSE solution, with anchored regimes serving as user-override
alternatives only.
