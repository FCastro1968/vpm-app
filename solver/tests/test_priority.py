# -*- coding: utf-8 -*-
"""
Priority vector derivation: GMM, consistency ratio, aggregation, scale
correction. A GMM -> AMNC slip or a CR formula change fails here.
"""
import numpy as np
import pytest

from pipeline import FIXTURE_NAMES, assert_matches
from solver import (
    aggregate_pairwise_matrices,
    compute_scaled_score,
    consistency_ratio,
    gmm_priority_vector,
    is_scale_adjusted,
)

TOL_EXACT = 1e-12
TOL_GOLDEN = 1e-9


def test_gmm_hand_computed_3x3():
    """Hand computation for [[1,2,4],[1/2,1,2],[1/4,1/2,1]] (perfectly consistent):

      row geometric means: (1*2*4)^(1/3) = 2
                           (1/2*1*2)^(1/3) = 1
                           (1/4*1/2*1)^(1/3) = 1/2
      sum = 3.5  ->  weights = (4/7, 2/7, 1/7)

    AMNC (column-normalize then row-average) happens to agree on a perfectly
    consistent matrix, so the inconsistent-matrix golden tests below are what
    actually guard the GMM-vs-AMNC distinction; this test pins the arithmetic.
    """
    w = gmm_priority_vector([[1, 2, 4], [0.5, 1, 2], [0.25, 0.5, 1]])
    assert abs(w[0] - 4 / 7) < TOL_EXACT
    assert abs(w[1] - 2 / 7) < TOL_EXACT
    assert abs(w[2] - 1 / 7) < TOL_EXACT


def test_cr_zero_for_consistent_matrix():
    assert consistency_ratio([[1, 2, 4], [0.5, 1, 2], [0.25, 0.5, 1]]) < TOL_EXACT


@pytest.mark.parametrize('name', FIXTURE_NAMES)
def test_attribute_weights_match_golden(name, pipelines, goldens):
    assert_matches(pipelines[name]['attribute_weights'],
                   goldens[name]['attribute_weights'], TOL_GOLDEN)


@pytest.mark.parametrize('name', FIXTURE_NAMES)
def test_level_utilities_match_golden(name, pipelines, goldens):
    assert_matches(pipelines[name]['level_utilities'],
                   goldens[name]['level_utilities'], TOL_GOLDEN)


@pytest.mark.parametrize('name', FIXTURE_NAMES)
def test_consistency_ratios_match_golden(name, pipelines, goldens):
    assert_matches(pipelines[name]['attribute_cr'],
                   goldens[name]['attribute_cr'], TOL_GOLDEN)
    assert_matches(pipelines[name]['level_crs'],
                   goldens[name]['level_crs'], TOL_GOLDEN)


def test_equal_ratings_end_to_end():
    """All-Equal survey: equal weights (1/N), CR = 0, and zero scaled
    contribution per factor (equal utilities -> util_range 0 -> scaled 0).
    Permanent regression form of the one-time Equal-rating verification."""
    n = 4
    all_ones = [[1.0] * n for _ in range(n)]
    w = gmm_priority_vector(all_ones)
    assert all(abs(x - 1 / n) < TOL_EXACT for x in w)
    assert consistency_ratio(all_ones) < TOL_EXACT

    # Equal level utilities contribute zero regardless of assignment
    score = compute_scaled_score(
        {'f1': 'l2'}, {'f1': 1.0},
        {'l1': 0.25, 'l2': 0.25, 'l3': 0.25, 'l4': 0.25},
        {'f1': ['l1', 'l2', 'l3', 'l4']})
    assert abs(score) < TOL_EXACT


def test_aggregation_is_elementwise_geometric_mean():
    """geomean([[1,2],[1/2,1]], [[1,8],[1/8,1]]) = [[1,4],[1/4,1]] exactly."""
    agg = aggregate_pairwise_matrices([
        [[1.0, 2.0], [0.5, 1.0]],
        [[1.0, 8.0], [0.125, 1.0]],
    ])
    expected = [[1.0, 4.0], [0.25, 1.0]]
    assert_matches(agg, expected, TOL_EXACT)
    # Reciprocity is preserved by geometric-mean aggregation
    assert abs(agg[0][1] * agg[1][0] - 1.0) < TOL_EXACT


def test_scale_correction_binding_cap():
    """Capped entry (9) whose clean transitive path implies 12 gets corrected:
    the reported CR must be lower than the CR computed on the raw matrix."""
    capped = [[1.0, 4.0, 9.0], [0.25, 1.0, 3.0], [1 / 9, 1 / 3, 1.0]]
    assert is_scale_adjusted(capped)

    # Uncorrected CR computed inline with the same lambda_max formula
    m = np.array(capped)
    n = 3
    w = np.array(gmm_priority_vector(capped))
    lambda_max = float(np.mean((m @ w) / w))
    raw_cr = ((lambda_max - n) / (n - 1)) / 0.58
    assert consistency_ratio(capped) < raw_cr


def test_scale_correction_inactive_when_cap_not_binding():
    """A 9 entry whose transitive implication is below 9 is left untouched."""
    not_binding = [[1.0, 2.0, 9.0], [0.5, 1.0, 4.0], [1 / 9, 0.25, 1.0]]
    assert not is_scale_adjusted(not_binding)
