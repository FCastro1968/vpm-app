# -*- coding: utf-8 -*-
"""
Golden file generator for the solver regression test suite.

REGENERATION POLICY — READ BEFORE RUNNING:
  This script was run once at suite creation and its outputs committed. The
  golden files are the frozen definition of correct solver behavior. NEVER
  regenerate them as a way to make failing tests pass. Regenerate only when
  the solver's behavior is changed DELIBERATELY (e.g. a methodology decision,
  a documented version bump), and document the justification in the commit
  message alongside the SOLVER_VERSION bump in solver.py.

Run from solver/:  venv\\Scripts\\python.exe tests\\generate_goldens.py
"""
import json
import os
from datetime import datetime, timezone

from pipeline import (
    FIXTURE_NAMES, GOLDENS_DIR, SOLVER_VERSION, load_fixture, run_pipeline,
)

if __name__ == '__main__':
    os.makedirs(GOLDENS_DIR, exist_ok=True)
    for name in FIXTURE_NAMES:
        golden = run_pipeline(load_fixture(name))
        golden['generated_at'] = datetime.now(timezone.utc).isoformat()
        path = os.path.join(GOLDENS_DIR, f'{name}.golden.json')
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(golden, f, indent=2)
        if golden['solver_success']:
            s = golden['solver']
            print(f"{name}: B={s['b']:.4f} M={s['m']:.4f} "
                  f"SSE={s['weighted_sse']:.6f} R2={s['r_squared_weighted']:.4f} "
                  f"regime={s['constraint_regime']} near_eq={s['near_equivalent_flag']}")
        else:
            print(f"{name}: SOLVER FAILED — {golden.get('solver_error')}")
        print(f'  -> wrote {path}  (solver_version {SOLVER_VERSION})')
