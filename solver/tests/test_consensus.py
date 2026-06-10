# -*- coding: utf-8 -*-
"""
Between-respondent Consensus Score (consensus_analysis). Pure-function unit
tests — no fixtures or goldens needed; the inputs are constructed inline.
"""
import math

from solver import consensus_analysis


def _recip(upper):
    """Build a full reciprocal matrix from a dict of upper-triangle entries.
    upper: {(i, j): value} for i < j; n inferred from the largest index."""
    n = max(max(i, j) for i, j in upper) + 1
    m = [[1.0] * n for _ in range(n)]
    for (i, j), v in upper.items():
        m[i][j] = float(v)
        m[j][i] = 1.0 / v
    return m


def test_identical_respondents_perfect_consensus():
    m = _recip({(0, 1): 3, (0, 2): 5, (1, 2): 2})
    result = consensus_analysis([m, m, m])
    assert result['skipped'] is False
    assert result['consensus_score'] == 100.0
    assert result['band'] == 'STRONG'
    assert all(not p['flagged'] for p in result['pairs'])
    assert all(p['gsd'] == 1.0 for p in result['pairs'])


def test_single_respondent_skipped():
    m = _recip({(0, 1): 3})
    result = consensus_analysis([m])
    assert result['skipped'] is True


def test_opposed_respondents_low_consensus():
    """One says 9, the other says 1/9 on the same pair — a full scale width of
    disagreement. std(ln 9, ln 1/9) = ln 9, so that pair's agreement is 0."""
    a = _recip({(0, 1): 9, (0, 2): 1, (1, 2): 1})
    b = _recip({(0, 1): 1 / 9, (0, 2): 1, (1, 2): 1})
    result = consensus_analysis([a, b], labels=['Alice', 'Bob'])

    worst = result['pairs'][0]  # sorted by gsd descending
    assert (worst['i'], worst['j']) == (0, 1)
    assert worst['flagged'] is True
    assert worst['agreement_pct'] == 0.0
    assert abs(worst['gsd'] - 9.0) < 1e-6  # exp(std) = exp(ln 9)
    assert worst['max_label'] == 'Alice'   # Alice gave the higher ratio
    assert worst['min_label'] == 'Bob'
    assert abs(worst['max_ratio'] - 9.0) < 1e-6
    assert abs(worst['min_ratio'] - 1 / 9) < 1e-3

    # The two agreed pairs hold agreement at 100, so the set average is 2/3
    assert abs(result['consensus_score'] - 200 / 3) < 0.01
    assert result['band'] == 'MODERATE'


def test_mild_disagreement_not_flagged():
    """Adjacent slider positions (2 vs 3) must not trip the divergence flag."""
    a = _recip({(0, 1): 2})
    b = _recip({(0, 1): 3})
    result = consensus_analysis([a, b])
    assert result['pairs'][0]['flagged'] is False
    assert result['band'] == 'STRONG'


def test_flag_threshold():
    """gsd >= 2.5 flags: 1 vs 9 across two respondents gives
    std = ln(9)/2 -> gsd = 3 -> flagged."""
    a = _recip({(0, 1): 1})
    b = _recip({(0, 1): 9})
    result = consensus_analysis([a, b])
    assert abs(result['pairs'][0]['gsd'] - 3.0) < 1e-6
    assert result['pairs'][0]['flagged'] is True


def test_respondent_order_invariance():
    a = _recip({(0, 1): 2, (0, 2): 4, (1, 2): 2})
    b = _recip({(0, 1): 5, (0, 2): 1, (1, 2): 1 / 2})
    r1 = consensus_analysis([a, b])
    r2 = consensus_analysis([b, a])
    assert r1['consensus_score'] == r2['consensus_score']
    assert [p['gsd'] for p in r1['pairs']] == [p['gsd'] for p in r2['pairs']]


def test_default_labels():
    a = _recip({(0, 1): 1})
    b = _recip({(0, 1): 9})
    result = consensus_analysis([a, b])
    worst = result['pairs'][0]
    assert worst['max_label'] == 'Respondent 2'
    assert worst['min_label'] == 'Respondent 1'
