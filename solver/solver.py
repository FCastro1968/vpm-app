# -*- coding: utf-8 -*-
"""
Value Pricing Model - Core Computation Engine

Convexity note (verified June 2026):
  Predicted price = B + V*(M-B) = B*(1-V) + M*V is LINEAR in (B, M) because the
  value indices V are fixed before the solve and never recomputed during
  optimization. Weighted SSE of a linear predictor is a convex quadratic, and
  every constraint in every regime is linear (B >= 0 and M - B >= eps are
  universal; the anchored regimes add B <= min(price) and/or M >= max(price)).
  Each regime is therefore a convex QP with a unique optimum, so multiple
  initialization strategies cannot find different solutions. The solver runs
  ONE optimization per constraint regime (4 total) from the OUTSIDE_IN start,
  which is feasible for every regime. Dual-init agreement is enforced
  permanently by the golden test suite (tests/test_solver.py), not at runtime.

  The regimes nest: UNIVERSAL_ONLY's feasible region contains all anchored
  regions, so SSE(UNIVERSAL_ONLY) <= SSE(anchored) always. The default active
  solution is the lowest-SSE valid converged run; anchored solutions exist as
  user-override alternatives only.
"""

import numpy as np
from scipy.optimize import minimize
from typing import Optional
import warnings

warnings.filterwarnings("ignore", category=RuntimeWarning)

SOLVER_VERSION = "2.1.0"  # 2.1.0 = LOO cross-validation + weight modes; 2.0.0 = 8->4 run collapse


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


def consensus_analysis(matrices, labels=None):
    """Between-respondent agreement for one comparison set (Consensus Score).

    Coherence (CR) measures within-respondent consistency; this measures
    whether the respondents agree WITH EACH OTHER. For each pair (i, j), the
    dispersion of judgments across respondents is the geometric standard
    deviation of the pairwise ratios: gsd = exp(std(ln a_ij)). gsd = 1 means
    perfect agreement; gsd = 3 means respondents typically sit a 3x ratio
    apart on that comparison.

    Per-pair agreement maps log-dispersion linearly onto [0, 1] with zero at
    one full scale width (ln 9): agreement = 1 - min(s / ln 9, 1). The set's
    Consensus Score is the mean pair agreement as a percentage. Bands:
    >= 80 STRONG, >= 60 MODERATE, else LOW. Pairs with gsd >= 2.5 are flagged
    for facilitator review, with the respondents anchoring each side named.
    Thresholds are initial calibrations — tune against real workshops.
    """
    arr = np.array(matrices, dtype=float)
    n_resp = arr.shape[0]
    if n_resp < 2:
        return {'skipped': True, 'reason': 'Requires at least 2 respondents.'}
    n = arr.shape[1]
    ln9 = float(np.log(9.0))
    logs = np.log(arr)

    pairs = []
    agreements = []
    for i in range(n):
        for j in range(i + 1, n):
            vals = logs[:, i, j]
            s = float(np.std(vals))
            gsd = float(np.exp(s))
            agreement = max(0.0, 1.0 - min(s / ln9, 1.0))
            agreements.append(agreement)
            hi = int(np.argmax(vals))
            lo = int(np.argmin(vals))
            pairs.append({
                'i': i, 'j': j,
                'gsd': round(gsd, 4),
                'agreement_pct': round(agreement * 100, 2),
                'flagged': bool(gsd >= 2.5),
                'max_label': labels[hi] if labels else f'Respondent {hi + 1}',
                'min_label': labels[lo] if labels else f'Respondent {lo + 1}',
                'max_ratio': round(float(arr[hi, i, j]), 4),
                'min_ratio': round(float(arr[lo, i, j]), 4),
            })

    score = float(np.mean(agreements) * 100) if agreements else 100.0
    band = 'STRONG' if score >= 80 else 'MODERATE' if score >= 60 else 'LOW'
    pairs.sort(key=lambda x: x['gsd'], reverse=True)
    return {
        'skipped': False,
        'consensus_score': round(score, 2),
        'band': band,
        'n_respondents': int(n_resp),
        'pairs': pairs,
    }


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


def compute_observation_weights(market_share_weights, weight_mode='market_share'):
    """Observation weight computation, isolated in one function (Market
    Influence setting). Scale-invariant in the input shares for all modes.

      market_share (default): w_i = share_i / sum(share)
      sqrt_share ("Balanced"): w_i = sqrt(share_i) / sum(sqrt(share))
      equal:                   w_i = 1/n
    """
    s = np.array(market_share_weights, dtype=float)
    if weight_mode == 'equal':
        w = np.ones_like(s)
    elif weight_mode == 'sqrt_share':
        w = np.sqrt(np.maximum(s, 0.0))
    else:  # 'market_share'
        w = s
    return w / w.sum()


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


def run_solver(value_scores, market_prices, market_share_weights, target_value_scores=None,
               weight_mode='market_share'):
    v = np.array(value_scores, dtype=float)
    p = np.array(market_prices, dtype=float)
    w = compute_observation_weights(market_share_weights, weight_mode)

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

    # One run per regime: each regime is a convex QP (see module docstring), so a
    # single optimization finds the unique optimum. OUTSIDE_IN is used because its
    # start point is feasible for every regime (INSIDE_OUT can start infeasible
    # for M-anchored regimes when max price > 1.05x mean price).
    all_runs = []
    for regime in ['UNIVERSAL_ONLY', 'B_ANCHORED', 'M_ANCHORED', 'BOTH_ANCHORED']:
        b_init, m_init = get_init('OUTSIDE_IN')
        r = run_single_solver(v, p, w, b_init, m_init, make_constraints(regime), epsilon)
        r['constraint_regime'] = regime
        r['init_strategy'] = 'OUTSIDE_IN'
        all_runs.append(r)

    # Add R-squared, RSE, and target point estimates to each run for comparison table
    p_wmean  = float(np.average(p, weights=w))
    ss_tot   = float(np.sum(w * (p - p_wmean) ** 2))
    ss_prices = float(np.sum(w * p ** 2))
    for r in all_runs:
        if r['converged'] and not r['degenerate'] and r['b'] is not None and r['m'] is not None:
            predicted = r['b'] + v * (r['m'] - r['b'])
            ss_res = float(np.sum(w * (p - predicted) ** 2))
            r['r_squared'] = round(float(1.0 - ss_res / ss_tot) if ss_tot > 0 else 0.0, 4)
            r['rse'] = round(float(ss_res / ss_prices) if ss_prices > 0 else 0.0, 6)
            if target_value_scores:
                r['target_point_estimates'] = [
                    round(float(r['b'] + tv * (r['m'] - r['b'])), 2)
                    for tv in target_value_scores
                ]
        else:
            r['r_squared'] = None
            r['rse'] = None
            r['target_point_estimates'] = None

    valid = [
        r for r in all_runs
        if r['converged'] and not r['degenerate'] and r['weighted_sse'] is not None
    ]
    if not valid:
        return {'success': False, 'error': 'No valid solver solutions found.', 'all_runs': all_runs}

    # Winner = lowest weighted SSE among valid converged runs. When several runs
    # tie within numerical tolerance (anchors inactive -> all regimes share one
    # optimum, differing only by optimizer termination noise), prefer the
    # least-constrained regime: `valid` preserves regime order with
    # UNIVERSAL_ONLY first, so the first run within tolerance of the minimum
    # wins. This keeps the winning regime label deterministic.
    min_sse = min(r['weighted_sse'] for r in valid)
    tie_tol = min_sse * 1e-6 + 1e-12
    winner = next(r for r in valid if r['weighted_sse'] <= min_sse + tie_tol)
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
    ss_res    = float(np.sum(w * residuals ** 2))
    p_wmean   = float(np.average(p, weights=w))
    ss_tot    = float(np.sum(w * (p - p_wmean) ** 2))
    r_squared = float(1.0 - ss_res / ss_tot) if ss_tot > 0 else 0.0
    rse       = float(ss_res / ss_prices) if ss_prices > 0 else 0.0
    q1, q3 = float(np.percentile(residuals, 25)), float(np.percentile(residuals, 75))
    iqr = q3 - q1

    return {
        'success': True,
        'b': b,
        'm': m,
        'weighted_sse': float(winner['weighted_sse']),
        'r_squared_weighted': r_squared,
        'rse': rse,
        'constraint_regime': winner['constraint_regime'],
        'init_strategy': winner['init_strategy'],
        'near_equivalent_flag': near_eq,
        'suspicious_m_low': bool(winner['suspicious_m_low']),
        'suspicious_b_high': bool(winner['suspicious_b_high']),
        'benchmark_residuals': [float(r) for r in residuals.tolist()],
        'outlier_flags': [bool(abs(float(r)) > 1.5 * iqr) for r in residuals.tolist()],
        'all_runs': all_runs
    }


def run_loo_cv(value_scores, market_prices, market_share_weights, b_full, m_full,
               weight_mode='market_share'):
    """Leave-one-out cross-validation (shared utility — also intended to power
    the Benchmark Outlier Review ranking, which should rank by |LOO residual|).

    For each benchmark i: exclude it, renormalize the remaining market-share
    weights (run_solver does this internally), run the full multi-regime
    solve, and predict the held-out benchmark's price from the refit model.

    loo_rmse mirrors the in-sample metric semantics — sqrt(weighted SSE / n)
    with weights summing to 1 — so the two numbers are directly comparable.

    stability = max over i of the relative movement of B or M when benchmark i
    is excluded. Denominators are guarded with 1% of mean price so a B near
    zero cannot explode the ratio.

    Skipped (with a reason) when exclusion would drop the benchmark count
    below 3, or when no held-out refit converges.
    """
    v = np.array(value_scores, dtype=float)
    p = np.array(market_prices, dtype=float)
    raw_shares = np.array(market_share_weights, dtype=float)
    w = compute_observation_weights(market_share_weights, weight_mode)
    n = len(v)
    if n < 4:
        return {'skipped': True,
                'reason': 'Requires at least 4 included reference products.'}

    price_mean = float(p.mean())
    residuals, predictions, refits = [], [], []
    for i in range(n):
        keep = [j for j in range(n) if j != i]
        sub = run_solver(v[keep].tolist(), p[keep].tolist(),
                         raw_shares[keep].tolist(), weight_mode=weight_mode)
        if not sub['success']:
            residuals.append(None)
            predictions.append(None)
            refits.append({'b': None, 'm': None, 'success': False})
            continue
        pred = float(sub['b'] + v[i] * (sub['m'] - sub['b']))
        predictions.append(round(pred, 4))
        residuals.append(round(float(p[i]) - pred, 4))
        refits.append({'b': round(sub['b'], 4), 'm': round(sub['m'], 4), 'success': True})

    ok = [i for i in range(n) if residuals[i] is not None]
    if not ok:
        return {'skipped': True, 'reason': 'No held-out refit converged.'}

    w_ok = np.array([w[i] for i in ok])
    w_ok = w_ok / w_ok.sum()
    sse = float(sum(wi * (float(p[i]) - predictions[i]) ** 2
                    for wi, i in zip(w_ok, ok)))
    loo_rmse = float(np.sqrt(sse / len(ok)))

    denom_b = max(abs(b_full), 0.01 * price_mean)
    denom_m = max(abs(m_full), 0.01 * price_mean)
    influence = [
        (max(abs(refits[i]['b'] - b_full) / denom_b,
             abs(refits[i]['m'] - m_full) / denom_m), i)
        for i in ok
    ]
    stability, max_influence_index = max(influence)

    return {
        'skipped': False,
        'loo_rmse': round(loo_rmse, 4),
        'loo_nrmse_pct': round(loo_rmse / price_mean * 100, 4) if price_mean > 0 else None,
        'residuals': residuals,
        'predictions': predictions,
        'stability': round(float(stability), 6),
        'max_influence_index': int(max_influence_index),
        'refits': refits,
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
                              market_prices, market_share_weights, full_model_point_estimate,
                              weight_mode='market_share'):
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
        solver_result = run_solver(bench_scores, market_prices, market_share_weights,
                                   weight_mode=weight_mode)

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
