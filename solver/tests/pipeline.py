# -*- coding: utf-8 -*-
"""
Shared test pipeline: fixture loading and the full solve chain.

Mirrors exactly what main.py's /solve endpoint does (GMM weights -> per-factor
GMM utilities -> Option 2 value indices -> multi-regime WLS -> price
recommendations -> sensitivity), but against frozen JSON fixtures instead of
live request payloads. Used by both the golden generator and the tests — one
implementation, so generator and tests can never drift apart.
"""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from solver import (  # noqa: E402
    SOLVER_VERSION,
    gmm_priority_vector,
    consistency_ratio,
    build_value_index_scores,
    run_solver,
    price_recommendation,
    run_sensitivity_analysis,
)

FIXTURES_DIR = os.path.join(os.path.dirname(__file__), 'fixtures')
GOLDENS_DIR = os.path.join(os.path.dirname(__file__), 'goldens')

FIXTURE_NAMES = [
    'fixture_minimal',
    'fixture_standard',
    'fixture_concentrated',
    'fixture_degenerate',
]


def load_fixture(name):
    with open(os.path.join(FIXTURES_DIR, f'{name}.json'), encoding='utf-8') as f:
        return json.load(f)


def load_golden(name):
    with open(os.path.join(GOLDENS_DIR, f'{name}.golden.json'), encoding='utf-8') as f:
        return json.load(f)


def derive_inputs(fx):
    """GMM attribute weights + per-factor GMM level utilities, as Phase 4 derives them."""
    aw_vec = gmm_priority_vector(fx['attribute_matrix'])
    attribute_weights = {a: float(w) for a, w in zip(fx['attribute_ids'], aw_vec)}
    level_utilities = {}
    level_crs = {}
    for attr_id, mat in fx['level_matrices'].items():
        utils = gmm_priority_vector(mat)
        for lid, u in zip(fx['attribute_levels'][attr_id], utils):
            level_utilities[lid] = float(u)
        level_crs[attr_id] = float(consistency_ratio(mat))
    return attribute_weights, level_utilities, level_crs


def run_pipeline(fx):
    """Full solve chain on a fixture; returns everything the goldens lock."""
    attribute_weights, level_utilities, level_crs = derive_inputs(fx)

    bench_scores, target_scores, _, _ = build_value_index_scores(
        attribute_weights, level_utilities, fx['attribute_levels'],
        fx['benchmark_assignments'], fx['target_assignments'])

    result = run_solver(bench_scores, fx['market_prices'],
                        fx['market_share_weights'],
                        target_value_scores=target_scores)

    out = {
        'solver_version': SOLVER_VERSION,
        'attribute_weights': attribute_weights,
        'attribute_cr': float(consistency_ratio(fx['attribute_matrix'])),
        'level_utilities': level_utilities,
        'level_crs': level_crs,
        'benchmark_value_indices': [float(s) for s in bench_scores],
        'target_value_indices': [float(s) for s in target_scores],
        'solver_success': result['success'],
        'all_runs': result.get('all_runs'),
    }

    if not result['success']:
        out['solver_error'] = result.get('error')
        return out

    out['solver'] = {k: result[k] for k in (
        'b', 'm', 'weighted_sse', 'r_squared_weighted', 'rse',
        'constraint_regime', 'init_strategy', 'near_equivalent_flag',
        'suspicious_m_low', 'suspicious_b_high',
        'benchmark_residuals', 'outlier_flags')}

    # Price recommendations, exactly as main.py builds them
    out['target_recommendations'] = [
        price_recommendation(result['b'], result['m'], t_vi,
                             result['benchmark_residuals'])
        for t_vi in target_scores
    ]

    # Sensitivity, exactly as main.py invokes it (full-model PE = first target's)
    if out['target_recommendations']:
        out['sensitivity'] = run_sensitivity_analysis(
            attribute_ids=fx['attribute_ids'],
            attribute_weights=attribute_weights,
            level_utilities=level_utilities,
            attribute_levels=fx['attribute_levels'],
            benchmark_assignments=fx['benchmark_assignments'],
            target_assignments=fx['target_assignments'],
            market_prices=fx['market_prices'],
            market_share_weights=fx['market_share_weights'],
            full_model_point_estimate=out['target_recommendations'][0]['point_estimate'],
        )

    return out


def assert_matches(live, golden, tol, path='$'):
    """Recursive structural comparison with numeric tolerance.

    Booleans, strings, and None must match exactly; numbers must agree within
    tol relative to max(1, |golden|); dict keys and list lengths must match.
    """
    if isinstance(golden, dict):
        assert isinstance(live, dict), f'{path}: expected dict, got {type(live).__name__}'
        assert set(live.keys()) == set(golden.keys()), (
            f'{path}: key mismatch live-only={set(live) - set(golden)} '
            f'golden-only={set(golden) - set(live)}')
        for k in golden:
            assert_matches(live[k], golden[k], tol, f'{path}.{k}')
    elif isinstance(golden, list):
        assert isinstance(live, list), f'{path}: expected list, got {type(live).__name__}'
        assert len(live) == len(golden), f'{path}: length {len(live)} != {len(golden)}'
        for i, (lv, gv) in enumerate(zip(live, golden)):
            assert_matches(lv, gv, tol, f'{path}[{i}]')
    elif isinstance(golden, bool):  # bool before number — bool subclasses int
        assert live is golden or live == golden, f'{path}: {live} != {golden}'
    elif isinstance(golden, (int, float)):
        assert isinstance(live, (int, float)) and not isinstance(live, bool), (
            f'{path}: expected number, got {type(live).__name__}')
        bound = tol * max(1.0, abs(golden))
        assert abs(live - golden) <= bound, (
            f'{path}: |{live} - {golden}| = {abs(live - golden)} > {bound}')
    elif golden is None:
        assert live is None, f'{path}: expected None, got {live!r}'
    else:
        assert live == golden, f'{path}: {live!r} != {golden!r}'
