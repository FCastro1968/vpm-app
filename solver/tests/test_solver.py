# -*- coding: utf-8 -*-
"""
WLS solver behavior: golden solutions, weights-actually-used (WLS != OLS),
regime nesting, dual-init agreement (the permanent form of the convexity
verification), determinism, winner selection, share renormalization,
sensitivity outputs, and price recommendations.
"""
import numpy as np
import pytest

from pipeline import FIXTURE_NAMES, assert_matches, derive_inputs, run_pipeline
from solver import (
    SOLVER_VERSION,
    build_value_index_scores,
    run_single_solver,
    run_solver,
)

TOL_GOLDEN = 1e-6
REGIMES = ['UNIVERSAL_ONLY', 'B_ANCHORED', 'M_ANCHORED', 'BOTH_ANCHORED']


@pytest.mark.parametrize('name', FIXTURE_NAMES)
def test_solver_version_matches_golden(name, goldens):
    """A SOLVER_VERSION bump without golden regeneration fails here — version
    bumps are declared behavior changes and must regenerate goldens."""
    assert goldens[name]['solver_version'] == SOLVER_VERSION


@pytest.mark.parametrize('name', FIXTURE_NAMES)
def test_wls_solution_matches_golden(name, pipelines, goldens):
    assert pipelines[name]['solver_success'] is True
    assert_matches(pipelines[name]['solver'], goldens[name]['solver'], TOL_GOLDEN)


@pytest.mark.parametrize('name', FIXTURE_NAMES)
def test_all_runs_match_golden(name, pipelines, goldens):
    assert_matches(pipelines[name]['all_runs'], goldens[name]['all_runs'], TOL_GOLDEN)


@pytest.mark.parametrize('name', FIXTURE_NAMES)
def test_one_run_per_regime(name, pipelines):
    runs = pipelines[name]['all_runs']
    assert [r['constraint_regime'] for r in runs] == REGIMES


def test_wls_not_ols(fixtures, pipelines):
    """GUARD TEST — a weights-dropped regression fails here.

    On fixture_concentrated the 55%-share benchmark is priced above the value
    trend, so the weighted fit must land materially away from the unweighted
    OLS fit (B differs by ~7% of mean price at suite creation; threshold 2%).
    """
    fx = fixtures['fixture_concentrated']
    v = np.array(pipelines['fixture_concentrated']['benchmark_value_indices'])
    p = np.array(fx['market_prices'])

    slope, intercept = np.polyfit(v, p, 1)  # unweighted OLS: p = a + b*v
    b_ols, m_ols = intercept, intercept + slope
    b_wls = pipelines['fixture_concentrated']['solver']['b']
    m_wls = pipelines['fixture_concentrated']['solver']['m']

    # Sanity: the OLS comparison point satisfies the universal constraints, so
    # the difference is attributable to weighting, not to constraint clipping.
    assert b_ols >= 0 and m_ols > b_ols

    assert abs(b_wls - b_ols) > 0.02 * p.mean(), (
        f'WLS B ({b_wls:.2f}) is within 2% of mean price of OLS B ({b_ols:.2f}) '
        '— market-share weights appear to have been dropped from the objective.')


@pytest.mark.parametrize('name', FIXTURE_NAMES)
def test_regime_nesting(name, pipelines):
    """UNIVERSAL_ONLY's feasible region contains every anchored region, so its
    SSE is <= every anchored regime's SSE (up to optimizer termination noise)."""
    runs = {r['constraint_regime']: r for r in pipelines[name]['all_runs']}
    u = runs['UNIVERSAL_ONLY']
    assert u['converged'], 'UNIVERSAL_ONLY must converge on every fixture'
    for regime in ['B_ANCHORED', 'M_ANCHORED', 'BOTH_ANCHORED']:
        r = runs[regime]
        if r['converged'] and not r['degenerate']:
            assert u['weighted_sse'] <= r['weighted_sse'] * (1 + 1e-6) + 1e-9, (
                f'SSE(UNIVERSAL_ONLY)={u["weighted_sse"]} > SSE({regime})='
                f'{r["weighted_sse"]} — nesting violated')


@pytest.mark.parametrize('name', FIXTURE_NAMES)
def test_dual_init_agreement(name, fixtures, pipelines):
    """Permanent form of the convexity verification: each regime is a convex QP,
    so INSIDE_OUT and OUTSIDE_IN starts must reach the same optimum. If this
    fails, something has made the problem non-convex (or SLSQP is failing from
    one of the starts) — investigate before touching the goldens."""
    fx = fixtures[name]
    v = np.array(pipelines[name]['benchmark_value_indices'])
    p = np.array(fx['market_prices'], dtype=float)
    w = np.array(fx['market_share_weights'], dtype=float)
    w = w / w.sum()

    price_min, price_max, price_mean = float(p.min()), float(p.max()), float(p.mean())
    price_range = price_max - price_min
    epsilon = price_mean * 0.01

    inits = {
        'INSIDE_OUT': (price_mean * 0.95, price_mean * 1.05),
        'OUTSIDE_IN': (max(0.0, price_min - price_range), price_max + price_range),
    }

    def constraints(regime):
        u = [
            {'type': 'ineq', 'fun': lambda x: x[0]},
            {'type': 'ineq', 'fun': lambda x, e=epsilon: x[1] - x[0] - e},
        ]
        if regime in ('B_ANCHORED', 'BOTH_ANCHORED'):
            u.append({'type': 'ineq', 'fun': lambda x, pm=price_min: pm - x[0]})
        if regime in ('M_ANCHORED', 'BOTH_ANCHORED'):
            u.append({'type': 'ineq', 'fun': lambda x, px=price_max: x[1] - px})
        return u

    for regime in REGIMES:
        results = {}
        for strategy, (b0, m0) in inits.items():
            results[strategy] = run_single_solver(
                v, p, w, b0, m0, constraints(regime), epsilon)
        a, b = results['INSIDE_OUT'], results['OUTSIDE_IN']
        if not (a['converged'] and b['converged']):
            continue  # convergence itself is locked by the goldens
        assert abs(a['weighted_sse'] - b['weighted_sse']) <= (
            1e-6 * max(1.0, b['weighted_sse'])), (
            f'{name}/{regime}: SSE disagreement between init strategies')
        assert abs(a['b'] - b['b']) <= 1e-3 * price_mean, (
            f'{name}/{regime}: B disagreement {a["b"]} vs {b["b"]}')
        assert abs(a['m'] - b['m']) <= 1e-3 * price_mean, (
            f'{name}/{regime}: M disagreement {a["m"]} vs {b["m"]}')


@pytest.mark.parametrize('name', FIXTURE_NAMES)
def test_determinism(name, fixtures, pipelines):
    """Two invocations of the full pipeline produce identical results."""
    again = run_pipeline(fixtures[name])
    assert_matches(again, pipelines[name], 0.0)


@pytest.mark.parametrize('name', FIXTURE_NAMES)
def test_winner_selection(name, pipelines):
    """Winner = lowest weighted SSE among valid converged runs, with numerical
    ties resolved toward the least-constrained regime. Invalid or degenerate
    runs never win."""
    runs = pipelines[name]['all_runs']
    winner_regime = pipelines[name]['solver']['constraint_regime']
    winner = next(r for r in runs if r['constraint_regime'] == winner_regime)

    assert winner['converged'] and not winner['degenerate']
    valid = [r for r in runs if r['converged'] and not r['degenerate']]
    min_sse = min(r['weighted_sse'] for r in valid)
    tie_tol = min_sse * 1e-6 + 1e-12
    assert winner['weighted_sse'] <= min_sse + tie_tol
    # Tie-break: no less-constrained valid run is also within tolerance
    # earlier in regime order than the winner.
    for r in valid:
        if r is winner:
            break
        assert r['weighted_sse'] > min_sse + tie_tol, (
            f'{r["constraint_regime"]} ties the winner but precedes '
            f'{winner_regime} in regime order — tie-break violated')


def test_share_renormalization_invariance(fixtures, pipelines):
    """Raw shares and pre-normalized shares produce the identical solution."""
    fx = fixtures['fixture_standard']
    v = pipelines['fixture_standard']['benchmark_value_indices']
    raw = fx['market_share_weights']
    normalized = [s / sum(raw) for s in raw]

    r1 = run_solver(v, fx['market_prices'], raw)
    r2 = run_solver(v, fx['market_prices'], normalized)
    assert abs(r1['b'] - r2['b']) < 1e-9 * max(1.0, abs(r2['b']))
    assert abs(r1['m'] - r2['m']) < 1e-9 * max(1.0, abs(r2['m']))


def test_exclusion_changes_solution(fixtures, pipelines):
    """Excluding a benchmark (with shares renormalized over the remainder)
    changes the fitted solution."""
    fx = fixtures['fixture_standard']
    v = pipelines['fixture_standard']['benchmark_value_indices']
    full = pipelines['fixture_standard']['solver']

    # Exclude bench_8 (the overpriced one) — solution must move
    keep = [i for i in range(len(v)) if fx['benchmark_ids'][i] != 'bench_8']
    r = run_solver([v[i] for i in keep],
                   [fx['market_prices'][i] for i in keep],
                   [fx['market_share_weights'][i] for i in keep])
    assert r['success']
    moved = (abs(r['b'] - full['b']) > 1e-3 * abs(full['b'])
             or abs(r['m'] - full['m']) > 1e-3 * abs(full['m']))
    assert moved, 'excluding an off-trend benchmark did not change the solution'


@pytest.mark.parametrize('name', FIXTURE_NAMES)
def test_price_recommendations_match_golden(name, pipelines, goldens):
    assert_matches(pipelines[name]['target_recommendations'],
                   goldens[name]['target_recommendations'], TOL_GOLDEN)


@pytest.mark.parametrize('name', FIXTURE_NAMES)
def test_sensitivity_matches_golden(name, pipelines, goldens):
    assert_matches(pipelines[name]['sensitivity'],
                   goldens[name]['sensitivity'], TOL_GOLDEN)
