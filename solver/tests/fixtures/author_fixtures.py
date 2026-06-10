# -*- coding: utf-8 -*-
r"""
One-time fixture authoring script for the golden regression test suite.

DO NOT RE-RUN without an explicit, documented decision. The JSON files this
script writes are FROZEN inputs for the golden tests; re-running overwrites
them, and any fixture change requires regenerating every golden file
(../generate_goldens.py) with a commit message justifying the change.

All construction is deterministic — no randomness anywhere. Pairwise matrices
are built either by hand (fixture_minimal, for hand-verifiable values) or by
snapping target-score ratios to the nearest Saaty scale value in log space,
which introduces realistic mild inconsistency.

fixture_standard is synthesized (Supabase was paused when this suite was
built). It stands in for the CO2 incubator project export described in the
improvements spec and can be replaced with a real export later — regenerate
goldens when that happens.

Run from solver/:  venv\Scripts\python.exe tests\fixtures\author_fixtures.py
"""
import json
import math
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..'))
from solver import gmm_priority_vector, build_value_index_scores  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))

SAATY = [1/9, 1/8, 1/7, 1/6, 1/5, 1/4, 1/3, 1/2,
         1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0]


def snap(ratio):
    """Snap a ratio to the nearest Saaty scale value in log space."""
    return min(SAATY, key=lambda s: abs(math.log(s) - math.log(ratio)))


def matrix_from_scores(scores):
    """Reciprocal pairwise matrix from target scores, snapped to the Saaty scale."""
    n = len(scores)
    m = [[1.0] * n for _ in range(n)]
    for i in range(n):
        for j in range(i + 1, n):
            a = snap(scores[i] / scores[j])
            m[i][j] = a
            m[j][i] = 1.0 / a
    return m


def assigns_from_idx(attribute_ids, attribute_levels, idx_rows):
    """Convert 1-based level-index rows to assignment dicts."""
    return [
        {a: attribute_levels[a][i - 1] for a, i in zip(attribute_ids, row)}
        for row in idx_rows
    ]


def derive(fx):
    """Mirror the production pipeline: GMM weights + per-factor GMM utilities."""
    aw_vec = gmm_priority_vector(fx['attribute_matrix'])
    attribute_weights = {a: float(w) for a, w in zip(fx['attribute_ids'], aw_vec)}
    level_utilities = {}
    for attr_id, mat in fx['level_matrices'].items():
        utils = gmm_priority_vector(mat)
        for lid, u in zip(fx['attribute_levels'][attr_id], utils):
            level_utilities[lid] = float(u)
    return attribute_weights, level_utilities


def value_indices(fx):
    aw, lu = derive(fx)
    bench, targ, _, _ = build_value_index_scores(
        aw, lu, fx['attribute_levels'],
        fx['benchmark_assignments'], fx['target_assignments'])
    return bench, targ


# ─── fixture_minimal ─────────────────────────────────────────────────────────
# 3 benchmarks, 3 factors. Hand-verifiable: the attribute matrix is perfectly
# consistent with GMM weights exactly (4/7, 2/7, 1/7) and CR = 0. Factor f3 is
# deliberately NON-monotone in display order (utility l2 > l1 > l3) so the
# golden tests can verify utility-driven (not display-order) min/max anchor
# selection in compute_scaled_score.

def fixture_minimal():
    fx = {
        '_description': '3 benchmarks, 3 factors (2-3 levels). Hand-verifiable GMM '
                        'weights (4/7, 2/7, 1/7), CR = 0 on the attribute matrix. '
                        'f3 utility order contradicts display order.',
        '_provenance': 'Authored by author_fixtures.py (deterministic). Do not edit by hand.',
        'attribute_ids': ['f1', 'f2', 'f3'],
        'attribute_matrix': [
            [1.0, 2.0, 4.0],
            [0.5, 1.0, 2.0],
            [0.25, 0.5, 1.0],
        ],
        'attribute_levels': {
            'f1': ['f1_l1', 'f1_l2', 'f1_l3'],
            'f2': ['f2_l1', 'f2_l2'],
            'f3': ['f3_l1', 'f3_l2', 'f3_l3'],
        },
        'level_matrices': {
            'f1': [[1.0, 1/3, 1/5], [3.0, 1.0, 1/3], [5.0, 3.0, 1.0]],
            'f2': [[1.0, 0.25], [4.0, 1.0]],
            # Perfectly consistent; utilities normalize to (0.3, 0.6, 0.1):
            # max utility = l2 (middle display position), min = l3 (last).
            'f3': [[1.0, 0.5, 3.0], [2.0, 1.0, 6.0], [1/3, 1/6, 1.0]],
        },
        'benchmark_ids': ['bench_a', 'bench_b', 'bench_c'],
        'benchmark_assignments': [
            {'f1': 'f1_l1', 'f2': 'f2_l1', 'f3': 'f3_l1'},
            {'f1': 'f1_l2', 'f2': 'f2_l2', 'f3': 'f3_l1'},
            {'f1': 'f1_l3', 'f2': 'f2_l2', 'f3': 'f3_l3'},
        ],
        'market_prices': [100.0, 150.0, 210.0],
        'market_share_weights': [45.0, 35.0, 20.0],  # raw %; solver normalizes
        'target_ids': ['target_1'],
        'target_assignments': [{'f1': 'f1_l3', 'f2': 'f2_l1', 'f3': 'f3_l2'}],
    }
    return fx


# ─── fixture_standard ────────────────────────────────────────────────────────
# 9 benchmarks, 7 factors (6 ordinal + 1 nominal Brand), level counts 2-5.
# The "normal engagement" case. Prices are constructed from the derived Value
# Index with fixed story offsets: bench_8 clearly overpriced (+1400), bench_4
# clearly underpriced (-1100).

def fixture_standard():
    attribute_ids = ['f1_performance', 'f2_capacity', 'f3_reliability',
                     'f4_service', 'f5_connectivity', 'f6_usability', 'f7_brand']
    attribute_matrix = matrix_from_scores([0.28, 0.19, 0.15, 0.12, 0.10, 0.09, 0.07])
    level_scores = {
        'f1_performance': [1, 2, 3.5, 6],
        'f2_capacity': [1, 2.5, 5],
        'f3_reliability': [1, 1.5, 2.5, 4, 7],
        'f4_service': [1, 3, 4],
        'f5_connectivity': [1, 4],
        'f6_usability': [1, 1.8, 3, 5.5],
        # Nominal Brand factor: utilities deliberately NOT ordered by display
        # position (beta strongest, gamma weakest).
        'f7_brand': [2.5, 4, 1, 1.8],
    }
    attribute_levels = {
        a: ([f'{a}_l{i + 1}' for i in range(len(level_scores[a]))]
            if a != 'f7_brand'
            else ['brand_alpha', 'brand_beta', 'brand_gamma', 'brand_delta'])
        for a in attribute_ids
    }
    level_matrices = {a: matrix_from_scores(level_scores[a]) for a in attribute_ids}

    benchmark_idx = [
        [1, 1, 1, 1, 1, 2, 3],  # bench_1 budget (f6 above min so V > 0)
        [1, 2, 2, 1, 1, 2, 4],  # bench_2
        [2, 1, 2, 2, 1, 2, 3],  # bench_3
        [2, 2, 3, 2, 1, 3, 1],  # bench_4 (underpriced in story)
        [3, 2, 3, 1, 2, 2, 1],  # bench_5
        [3, 2, 4, 2, 2, 3, 4],  # bench_6
        [3, 3, 4, 3, 2, 3, 2],  # bench_7
        [4, 2, 4, 3, 2, 4, 2],  # bench_8 (overpriced in story)
        [4, 3, 5, 2, 2, 4, 2],  # bench_9 premium (f4 below max so V < 1)
    ]
    target_idx = [
        [4, 3, 4, 3, 2, 3, 1],  # target_premium
        [2, 2, 3, 2, 2, 2, 3],  # target_value
    ]

    fx = {
        '_description': '9 benchmarks, 7 factors (6 ordinal + nominal Brand), levels 2-5. '
                        'Synthesized stand-in for the CO2 incubator export. '
                        'bench_8 overpriced, bench_4 underpriced by construction.',
        '_provenance': 'Authored by author_fixtures.py (deterministic). Do not edit by hand.',
        'attribute_ids': attribute_ids,
        'attribute_matrix': attribute_matrix,
        'attribute_levels': attribute_levels,
        'level_matrices': level_matrices,
        'benchmark_ids': [f'bench_{i + 1}' for i in range(9)],
        'benchmark_assignments': assigns_from_idx(attribute_ids, attribute_levels, benchmark_idx),
        'market_prices': None,  # filled below from derived V
        'market_share_weights': [14.0, 9.0, 11.0, 7.0, 16.0, 10.0, 9.0, 13.0, 11.0],
        'target_ids': ['target_premium', 'target_value'],
        'target_assignments': assigns_from_idx(attribute_ids, attribute_levels, target_idx),
    }
    bench_v, _ = value_indices(fx)
    offsets = [900, -600, 400, -1100, 150, 600, -400, 1400, -250]
    fx['market_prices'] = [
        float(round((8000 + 14000 * v + off) / 50) * 50)
        for v, off in zip(bench_v, offsets)
    ]
    return fx


# ─── fixture_concentrated ────────────────────────────────────────────────────
# One benchmark holds 55% market share AND its price sits ~13% above the value
# trend, so the WLS solution must differ materially from unweighted OLS. Locks
# weighting behavior and powers test_wls_not_ols.

def fixture_concentrated():
    attribute_ids = ['f1', 'f2', 'f3', 'f4', 'f5']
    attribute_matrix = matrix_from_scores([0.30, 0.25, 0.20, 0.15, 0.10])
    attribute_levels = {a: [f'{a}_l1', f'{a}_l2', f'{a}_l3'] for a in attribute_ids}
    level_matrices = {a: matrix_from_scores([1, 2.5, 5]) for a in attribute_ids}

    benchmark_idx = [
        [1, 1, 2, 1, 1],
        [2, 1, 2, 2, 1],  # bench_dominant: 55% share, priced above trend
        [2, 2, 1, 2, 2],
        [2, 3, 2, 1, 2],
        [3, 2, 3, 2, 3],
        [3, 3, 3, 2, 2],
    ]
    fx = {
        '_description': '6 benchmarks, 5 factors. bench_dominant holds 55% share and is '
                        'priced above the value trend so WLS visibly diverges from OLS.',
        '_provenance': 'Authored by author_fixtures.py (deterministic). Do not edit by hand.',
        'attribute_ids': attribute_ids,
        'attribute_matrix': attribute_matrix,
        'attribute_levels': attribute_levels,
        'level_matrices': level_matrices,
        'benchmark_ids': ['bench_1', 'bench_dominant', 'bench_3', 'bench_4', 'bench_5', 'bench_6'],
        'benchmark_assignments': assigns_from_idx(attribute_ids, attribute_levels, benchmark_idx),
        'market_prices': None,
        'market_share_weights': [15.0, 55.0, 10.0, 8.0, 7.0, 5.0],
        'target_ids': ['target_1'],
        'target_assignments': assigns_from_idx(attribute_ids, attribute_levels, [[3, 2, 2, 2, 2]]),
    }
    bench_v, _ = value_indices(fx)
    offsets = [-40, 260, -60, 30, -80, 50]
    fx['market_prices'] = [
        float(round(1000 + 2000 * v + off))
        for v, off in zip(bench_v, offsets)
    ]
    return fx


# ─── fixture_degenerate ──────────────────────────────────────────────────────
# 5 benchmarks clustered in a ~0.10-wide Value Index band with noisy prices.
# Ill-conditioned 2-parameter fit: locks near-equivalent-solutions flag
# behavior and solver stability on flat SSE valleys.

def fixture_degenerate():
    attribute_ids = ['f1', 'f2', 'f3', 'f4']
    attribute_matrix = matrix_from_scores([0.30, 0.27, 0.23, 0.20])
    attribute_levels = {a: [f'{a}_l1', f'{a}_l2', f'{a}_l3'] for a in attribute_ids}
    level_matrices = {a: matrix_from_scores([1, 2, 4]) for a in attribute_ids}

    benchmark_idx = [
        [2, 2, 2, 2],
        [1, 2, 2, 2],
        [2, 1, 2, 2],
        [2, 2, 1, 2],
        [2, 2, 2, 1],
    ]
    fx = {
        '_description': '5 benchmarks clustered in a narrow Value Index band with '
                        'prices uncorrelated to V. Ill-conditioned fit; locks '
                        'near-equivalent flag and flat-valley solver behavior.',
        '_provenance': 'Authored by author_fixtures.py (deterministic). Do not edit by hand.',
        'attribute_ids': attribute_ids,
        'attribute_matrix': attribute_matrix,
        'attribute_levels': attribute_levels,
        'level_matrices': level_matrices,
        'benchmark_ids': ['bench_1', 'bench_2', 'bench_3', 'bench_4', 'bench_5'],
        'benchmark_assignments': assigns_from_idx(attribute_ids, attribute_levels, benchmark_idx),
        'market_prices': [128.0, 96.0, 118.0, 102.0, 124.0],
        'market_share_weights': [22.0, 20.0, 19.0, 20.0, 19.0],
        'target_ids': ['target_1'],
        'target_assignments': assigns_from_idx(attribute_ids, attribute_levels, [[3, 2, 2, 2]]),
    }
    return fx


# ─── main ────────────────────────────────────────────────────────────────────

if __name__ == '__main__':
    builders = {
        'fixture_minimal': fixture_minimal,
        'fixture_standard': fixture_standard,
        'fixture_concentrated': fixture_concentrated,
        'fixture_degenerate': fixture_degenerate,
    }
    for name, build in builders.items():
        fx = build()
        bench_v, targ_v = value_indices(fx)
        path = os.path.join(HERE, f'{name}.json')
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(fx, f, indent=2)
        print(f'{name}:')
        for bid, v, p in zip(fx['benchmark_ids'], bench_v, fx['market_prices']):
            print(f'  {bid:<16} V={v:.4f}  price={p}')
        for tid, v in zip(fx['target_ids'], targ_v):
            print(f'  {tid:<16} V={v:.4f}  (target)')
        print(f'  -> wrote {path}')
