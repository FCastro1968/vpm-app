# -*- coding: utf-8 -*-
import pytest

from pipeline import FIXTURE_NAMES, load_fixture, load_golden, run_pipeline


@pytest.fixture(scope='session')
def fixtures():
    """All frozen input fixtures, keyed by name."""
    return {n: load_fixture(n) for n in FIXTURE_NAMES}


@pytest.fixture(scope='session')
def goldens():
    """All golden files, keyed by fixture name."""
    return {n: load_golden(n) for n in FIXTURE_NAMES}


@pytest.fixture(scope='session')
def pipelines(fixtures):
    """Live pipeline outputs for every fixture (each computed once per session)."""
    return {n: run_pipeline(fixtures[n]) for n in FIXTURE_NAMES}
