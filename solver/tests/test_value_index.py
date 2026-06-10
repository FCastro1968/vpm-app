# -*- coding: utf-8 -*-
"""
Option 2 Value Index formula:  contribution = weight * (utility - minUtil) / (maxUtil - minUtil)

These tests make a formula revert (back to Option 1 raw `weight * utility`)
fail loudly with a named test, and verify base=0 / max=1 construction with
utility-driven (not display-order) anchor selection.
"""
import pytest

from pipeline import FIXTURE_NAMES, assert_matches, derive_inputs
from solver import build_value_index_scores, compute_scaled_score

TOL_EXACT = 1e-12
TOL_GOLDEN = 1e-9


@pytest.mark.parametrize('name', FIXTURE_NAMES)
def test_value_indices_match_golden(name, pipelines, goldens):
    assert_matches(pipelines[name]['benchmark_value_indices'],
                   goldens[name]['benchmark_value_indices'], TOL_GOLDEN)
    assert_matches(pipelines[name]['target_value_indices'],
                   goldens[name]['target_value_indices'], TOL_GOLDEN)


def test_option2_not_option1(fixtures, pipelines):
    """GUARD TEST — a revert of compute_scaled_score to Option 1 fails here.

    For fixture_minimal's bench_b, Option 1 (sum of weight * raw utility) and
    Option 2 (min-max scaled) diverge by ~0.09. Assert the live value matches
    the Option 2 expectation and does NOT equal the Option 1 value.
    """
    fx = fixtures['fixture_minimal']
    aw, lu, _ = derive_inputs(fx)
    bench_b = fx['benchmark_assignments'][1]

    option1 = sum(aw[a] * lu[lid] for a, lid in bench_b.items())
    live = pipelines['fixture_minimal']['benchmark_value_indices'][1]

    option2_expected = compute_scaled_score(bench_b, aw, lu, fx['attribute_levels'])
    assert abs(live - option2_expected) < TOL_EXACT
    assert abs(live - option1) > 0.05, (
        'Option 1 and Option 2 no longer diverge on this fixture — '
        'the guard has lost its teeth; pick a different probe benchmark.')


@pytest.mark.parametrize('name', FIXTURE_NAMES)
def test_base_max_construction(name, fixtures):
    """All-min product scores exactly 0, all-max exactly 1, and every real
    product in the fixture lies strictly inside (0, 1)."""
    fx = fixtures[name]
    aw, lu, _ = derive_inputs(fx)

    all_min = {a: min(lids, key=lambda l: lu[l]) for a, lids in fx['attribute_levels'].items()}
    all_max = {a: max(lids, key=lambda l: lu[l]) for a, lids in fx['attribute_levels'].items()}

    assert abs(compute_scaled_score(all_min, aw, lu, fx['attribute_levels'])) < TOL_EXACT
    assert abs(compute_scaled_score(all_max, aw, lu, fx['attribute_levels']) - 1.0) < TOL_EXACT

    bench, targ, raw_base, raw_max = build_value_index_scores(
        aw, lu, fx['attribute_levels'],
        fx['benchmark_assignments'], fx['target_assignments'])
    assert raw_base == 0.0 and raw_max == 1.0
    for s in bench + targ:
        assert 0.0 < s < 1.0, f'product score {s} not strictly inside (0, 1)'


def test_anchors_are_utility_driven_not_display_order(fixtures):
    """fixture_minimal's f3 has utility order l2 > l1 > l3, contradicting
    display order. The max anchor must select f3_l2 (highest utility), so an
    assignment using f3_l3 (last display position) must score below 1."""
    fx = fixtures['fixture_minimal']
    aw, lu, _ = derive_inputs(fx)

    # Confirm the fixture still encodes the contradiction
    assert lu['f3_l2'] > lu['f3_l1'] > lu['f3_l3']

    display_order_max = {'f1': 'f1_l3', 'f2': 'f2_l2', 'f3': 'f3_l3'}
    utility_max = {'f1': 'f1_l3', 'f2': 'f2_l2', 'f3': 'f3_l2'}

    assert abs(compute_scaled_score(utility_max, aw, lu, fx['attribute_levels']) - 1.0) < TOL_EXACT
    assert compute_scaled_score(display_order_max, aw, lu, fx['attribute_levels']) < 1.0 - 0.05
