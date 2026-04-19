# -*- coding: utf-8 -*-
"""
Value Pricing Model - Core Computation Engine
"""

import numpy as np
from scipy.optimize import minimize
from typing import Optional
import warnings

warnings.filterwarnings("ignore", category=RuntimeWarning)


def to_python(obj):
    """Recursively convert numpy types to native Python types."""
    if isinstance(obj, dict):
        return {k: to_python(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [to_python(v) for v in obj]
    elif isinstance(obj, np.integer):
        return int(obj)
    elif isinstance(obj, np.floating):
        return float(obj)
    elif isinstance(obj, np.bool_):
        return bool(obj)
    elif isinstance(obj, np.ndarray):
        return obj.tolist()
    return obj


RI_TABLE = {
    1: 0.00, 2: 0.00, 3: 0.58, 4: 0.90, 5: 1.12,
    6: 1.24, 7: 1.32, 8: 1.41, 9: 1.45, 10: 1.49,
    11: 1.51, 12: 1.48, 13: 1.56, 14: 1.57, 15: 1.59
}

SCALE_MAX = 9.0


def _scale_correct_matrix(m: np.ndarray) -> np.ndarray:
    """
    Replace scale-capped entries (9.0) with transitively implied ratios before
    computing CR, so that logically consistent judgments forced to the scale
    boundary are not penalised.

    For each capped upper-triangle entry m[i][j] == SCALE_MAX:
      - Collect "clean" implied ratios  m[i][k] * m[k][j]  for all intermediate
        nodes k where neither leg (i,k) nor (k,j) is itself capped.
      - If clean paths exist: replacement = arithmetic mean of clean implied ratios.
      - If no clean paths exist (all paths pass through another capped entry):
        replacement = max over all paths — the least-compressed estimate available.
      - Only substitute when replacement > SCALE_MAX (i.e. the cap was binding).
    """
    n = m.shape[0]
    corrected = m.copy()

    def is_capped(r: int, c: int) -> bool:
        # Works for both upper and lower triangle entries
        return max(m[r][c], m[c][r]) >= SCALE_MAX

    for i in range(n):
        for j in range(i + 1, n):
            if not is_capped(i, j):
                continue

            # Always compute implied ratios in the "strong" (>= 1) direction
            # so that the replacement value is > 1 and the > SCALE_MAX guard works.
            i_preferred = m[i][j] >= 1.0
            strong, weak = (i, j) if i_preferred else (j, i)

            clean, all_implied = [], []
            for k in range(n):
                if k == i or k == j:
                    continue
                implied = m[strong][k] * m[k][weak]
                all_implied.append(implied)
                if not is_capped(strong, k) and not is_capped(k, weak):
                    clean.append(implied)

            if clean:
                replacement = sum(clean) / len(clean)
            elif all_implied:
                replacement = max(all_implied)
            else:
                continue

            if replacement > SCALE_MAX:
                corrected[strong][weak] = replacement
                corrected[weak][strong] = 1.0 / replacement

    return corrected


def is_scale_adjusted(matrix) -> bool:
    """Return True if _scale_correct_matrix changes any entry in matrix."""
    m = np.array(matrix, dtype=float)
    return not np.allclose(m, _scale_correct_matrix(m))


def gmm_priority_vector(matrix):
    m = np.array(matrix, dtype=float)
    n = m.shape[0]
    row_geo_means = np.array([np.exp(np.mean(np.log(m[i, :]))) for i in range(n)])
    return row_geo_means / row_geo_means.sum()


def consistency_ratio(matrix):
    m = np.array(matrix, dtype=float)
    n = m.shape[0]
    if n <= 2:
        return 0.0
    m = _scale_correct_matrix(m)
    weights = gmm_priority_vector(m.tolist())
    weighted_sum = m @ weights
    lambda_max = float(np.mean(weighted_sum / weights))
    ci = (lambda_max - n) / (n - 1)
    ri = RI_TABLE.get(n, 1.59)
    if ri == 0:
        return 0.0
    return float(ci / ri)


def aggregate_pairwise_matrices(matrices):
    arr = np.array(matrices, dtype=float)
    return np.exp(np.mean(np.log(arr), axis=0)).tolist()


def compute_scaled_score(level_assignments, attribute_weights, level_utilities, attribute_levels):
    """Option 2 formula: weight * (utility - minUtil) / (maxUtil - minUtil) per factor.
    Min level -> 0 contribution, max level -> full factor weight.
    By construction, base product always scores 0 and max product always scores 1.
    """
    total = 0.0
    for attr_id, level_id in level_assignments.items():
        weight = attribute_weights.get(attr_id, 0.0)
        utility = level_utilities.get(level_id, 0.0)
        levels_for_attr = attribute_levels.get(attr_id, [])
        if levels_for_attr:
            utils = [level_utilities.get(lid, 0.0) for lid in levels_for_attr]
            min_u = min(utils)
            max_u = max(utils)
            util_range = max_u - min_u
            scaled = (utility - min_u) / util_range if util_range > 0 else 0.0
        else:
            scaled = utility
        total += weight * scaled
    return total


def compute_value_index(raw_score, raw_score_base, raw_score_max):
    """Normalize score to [0,1]. With Option 2 formula base=0 and max=1 by
    construction, so this is a no-op safety wrapper."""
    denom = raw_score_max - raw_score_base
    if denom == 0:
        return 0.0
    return (raw_score - raw_score_base) / denom


def build_value_index_scores(attribute_weights, level_utilities, attribute_levels,
                              benchmark_assignments, target_assignments):
    # With Option 2, base = 0 and max = 1 by construction
    raw_base = 0.0
    raw_max  = 1.0
    bench_scores = [
        compute_scaled_score(a, attribute_weights, level_utilities, attribute_levels)
        for a in benchmark_assignments
    ]
    target_scores = [
        compute_scaled_score(a, attribute_weights, level_utilities, attribute_levels)
        for a in target_assignments
    ]
    return bench_scores, target_scores, raw_base, raw_max


def weighted_sse_fn(params, v, p, w):
    b, m = params
    predicted = b + v * (m - b)
    return float(np.sum(w * (p - predicted) ** 2))


def run_single_solver(v, p, w, b_init, m_init, constraints, epsilon):
    result = minimize(
        weighted_sse_fn, x0=[b_init, m_init], args=(v, p, w),
        method='SLSQP', constraints=constraints,
        options={'ftol': 1e-10, 'maxiter': 1000}
    )
    if not result.success:
        return {
            'b': None, 'm': None, 'weighted_sse': None,
            'converged': False, 'degenerate': False,
            'suspicious_m_low': False, 'suspicious_b_high': False
        }
    b, m = float(result.x[0]), float(result.x[1])
    return {
        'b': b, 'm': m,
        'weighted_sse': float(result.fun),
        'converged': True,
        'degenerate': bool(abs(m - b) < epsilon),
        'suspicious_m_low': bool(m < float(p.min())),
        'suspicious_b_high': bool(b > float(p.max()))
    }


def run_solver(value_scores, market_prices, market_share_weights, target_value_scores=None):
    v = np.array(value_scores, dtype=float)
    p = np.array(market_prices, dtype=float)
    w = np.array(market_share_weights, dtype=float)
    w = w / w.sum()

    price_min  = float(p.min())
    price_max  = float(p.max())
    price_mean = float(p.mean())
    price_range = price_max - price_min
    epsilon = price_mean * 0.01

    def make_constraints(regime):
        u = [
            {'type': 'ineq', 'fun': lambda x: x[0]},
            {'type': 'ineq', 'fun': lambda x, e=epsilon: x[1] - x[0] - e}
        ]
        if regime == 'UNIVERSAL_ONLY':
            return u
        if regime == 'B_ANCHORED':
            return u + [{'type': 'ineq', 'fun': lambda x, pm=price_min: pm - x[0]}]
        if regime == 'M_ANCHORED':
            return u + [{'type': 'ineq', 'fun': lambda x, px=price_max: x[1] - px}]
        if regime == 'BOTH_ANCHORED':
            return u + [
                {'type': 'ineq', 'fun': lambda x, pm=price_min: pm - x[0]},
                {'type': 'ineq', 'fun': lambda x, px=price_max: x[1] - px}
            ]
        return u

    def get_init(strategy):
        if strategy == 'INSIDE_OUT':
            return price_mean * 0.95, price_mean * 1.05
        return max(0.0, price_min - price_range), price_max + price_range

    all_runs = []
    for regime in ['UNIVERSAL_ONLY', 'B_ANCHORED', 'M_ANCHORED', 'BOTH_ANCHORED']:
        for strategy in ['INSIDE_OUT', 'OUTSIDE_IN']:
            b_init, m_init = get_init(strategy)
            r = run_single_solver(v, p, w, b_init, m_init, make_constraints(regime), epsilon)
            r['constraint_regime'] = regime
            r['init_strategy'] = strategy
            all_runs.append(r)

    # Add R-squared and target point estimates to each run for comparison table
    p_wmean = float(np.average(p, weights=w))
    ss_tot = float(np.sum(w * (p - p_wmean) ** 2))
    for r in all_runs:
        if r['converged'] and not r['degenerate'] and r['b'] is not None and r['m'] is not None:
            predicted = r['b'] + v * (r['m'] - r['b'])
            ss_res = float(np.sum(w * (p - predicted) ** 2))
            r['r_squared'] = round(float(1.0 - ss_res / ss_tot) if ss_tot > 0 else 0.0, 4)
            if target_value_scores:
                r['target_point_estimates'] = [
                    round(float(r['b'] + tv * (r['m'] - r['b'])), 2)
                    for tv in target_value_scores
                ]
        else:
            r['r_squared'] = None
            r['target_point_estimates'] = None

    valid = [
        r for r in all_runs
        if r['converged'] and not r['degenerate'] and r['weighted_sse'] is not None
    ]
    if not valid:
        return {'success': False, 'error': 'No valid solver solutions found.', 'all_runs': all_runs}

    winner = min(valid, key=lambda r: r['weighted_sse'])
    threshold = winner['weighted_sse'] * 1.02
    near_eq = bool(any(
        r is not winner
        and r['weighted_sse'] <= threshold
        and (
            abs(r['b'] - winner['b']) > price_mean * 0.05
            or abs(r['m'] - winner['m']) > price_mean * 0.05
        )
        for r in valid
    ))

    b, m = winner['b'], winner['m']
    predicted = b + v * (m - b)
    residuals = p - predicted
    ss_res  = float(np.sum(w * residuals ** 2))
    p_wmean = float(np.average(p, weights=w))
    ss_tot  = float(np.sum(w * (p - p_wmean) ** 2))
    r_squared = float(1.0 - ss_res / ss_tot) if ss_tot > 0 else 0.0
    q1, q3 = float(np.percentile(residuals, 25)), float(np.percentile(residuals, 75))
    iqr = q3 - q1

    return {
        'success': True,
        'b': b,
        'm': m,
        'weighted_sse': float(winner['weighted_sse']),
        'r_squared_weighted': r_squared,
        'constraint_regime': winner['constraint_regime'],
        'init_strategy': winner['init_strategy'],
        'near_equivalent_flag': near_eq,
        'suspicious_m_low': bool(winner['suspicious_m_low']),
        'suspicious_b_high': bool(winner['suspicious_b_high']),
        'benchmark_residuals': [float(r) for r in residuals.tolist()],
        'outlier_flags': [bool(abs(float(r)) > 1.5 * iqr) for r in residuals.tolist()],
        'all_runs': all_runs
    }


def price_recommendation(b, m, target_value_index, benchmark_residuals):
    point_estimate = float(b + target_value_index * (m - b))
    residual_std = float(np.std(np.array(benchmark_residuals)))
    return {
        'point_estimate': round(point_estimate, 4),
        'range_low':      round(point_estimate - residual_std, 4),
        'range_high':     round(point_estimate + residual_std, 4)
    }


def run_sensitivity_analysis(attribute_ids, attribute_weights, level_utilities,
                              attribute_levels, benchmark_assignments, target_assignments,
                              market_prices, market_share_weights, full_model_point_estimate):
    results = []
    for excluded_attr in attribute_ids:
        remaining = {k: v for k, v in attribute_weights.items() if k != excluded_attr}
        total = sum(remaining.values())
        if total == 0:
            continue
        renormalized = {k: v / total for k, v in remaining.items()}
        remaining_levels = {k: v for k, v in attribute_levels.items() if k != excluded_attr}

        bench_scores, target_scores, _, _ = build_value_index_scores(
            renormalized, level_utilities, remaining_levels,
            benchmark_assignments, target_assignments
        )
        solver_result = run_solver(bench_scores, market_prices, market_share_weights)

        if not solver_result['success']:
            results.append({
                'excluded_attribute_id': excluded_attr,
                'weighted_sse': None,
                'r_squared_weighted': None,
                'point_estimate': None,
                'delta_from_full_model': None,
                'flagged': False
            })
            continue

        b, m = solver_result['b'], solver_result['m']
        target_vi = float(target_scores[0]) if target_scores else 0.0
        point_est = float(b + target_vi * (m - b))
        delta = float(point_est - full_model_point_estimate)

        results.append({
            'excluded_attribute_id': excluded_attr,
            'renormalized_weights': renormalized,
            'weighted_sse': solver_result['weighted_sse'],
            'r_squared_weighted': solver_result['r_squared_weighted'],
            'point_estimate': round(point_est, 4),
            'delta_from_full_model': round(delta, 4),
            'flagged': bool(abs(delta) > full_model_point_estimate * 0.05)
        })

    return results
