# -*- coding: utf-8 -*-
"""
Value Pricing Model - Solver Microservice
FastAPI HTTP wrapper around solver.py
Called by the Next.js backend for all Phase 4-5 computation.
"""

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from typing import Optional
import uvicorn

from solver import (
    gmm_priority_vector,
    consistency_ratio,
    is_scale_adjusted,
    aggregate_pairwise_matrices,
    build_value_index_scores,
    run_solver,
    price_recommendation,
    run_sensitivity_analysis,
)

app = FastAPI(title="VPM Solver", version="0.1.0")


# ============================================================
# REQUEST / RESPONSE MODELS
# ============================================================

class PriorityVectorRequest(BaseModel):
    matrix: list[list[float]] = Field(..., description="n x n pairwise comparison matrix")

class PriorityVectorResponse(BaseModel):
    weights: list[float]
    consistency_ratio: float
    cr_flag: str  # 'OK', 'MARGINAL', 'INCONSISTENT'
    scale_adjusted: bool


class AggregateMatrixRequest(BaseModel):
    matrices: list[list[list[float]]] = Field(..., description="One n x n matrix per respondent")

class AggregateMatrixResponse(BaseModel):
    aggregated_matrix: list[list[float]]
    weights: list[float]
    consistency_ratio: float
    cr_flag: str
    scale_adjusted: bool


class SolverRequest(BaseModel):
    # Attribute framework
    attribute_ids: list[str]
    attribute_weights: dict[str, float]       # {attribute_id: weight}
    level_utilities: dict[str, float]         # {level_id: utility}
    attribute_levels: dict[str, list[str]]    # {attribute_id: [level_id_low..high]}

    # Benchmark products
    benchmark_ids: list[str]
    benchmark_assignments: list[dict[str, str]]   # [{attribute_id: level_id}, ...]
    market_prices: list[float]
    market_share_weights: list[float]

    # Target products (up to 3)
    target_ids: list[str]
    target_assignments: list[dict[str, str]]

    # Options
    run_sensitivity: bool = True


class TargetResult(BaseModel):
    target_id: str
    value_index: float
    point_estimate: float
    range_low: float
    range_high: float


class SolverResponse(BaseModel):
    success: bool
    error: Optional[str] = None

    # Winning solution
    b: Optional[float] = None
    m: Optional[float] = None
    weighted_sse: Optional[float] = None
    r_squared_weighted: Optional[float] = None
    rse: Optional[float] = None
    constraint_regime: Optional[str] = None
    init_strategy: Optional[str] = None

    # Flags
    near_equivalent_flag: bool = False
    suspicious_m_low: bool = False
    suspicious_b_high: bool = False

    # Per-benchmark results
    benchmark_value_indices: Optional[list[float]] = None
    benchmark_residuals: Optional[list[float]] = None
    outlier_flags: Optional[list[bool]] = None

    # Target recommendations
    target_results: Optional[list[TargetResult]] = None

    # Sensitivity analysis
    sensitivity: Optional[list[dict]] = None

    # All 8 solver runs (for diagnostics panel)
    all_runs: Optional[list[dict]] = None


class MarketImpliedWeightsRequest(BaseModel):
    attribute_ids: list[str]
    level_utilities: dict[str, float]
    attribute_levels: dict[str, list[str]]
    benchmark_assignments: list[dict[str, str]]
    market_prices: list[float]
    market_share_weights: list[float]


# ============================================================
# ROUTES
# ============================================================

@app.get("/health")
def health():
    return {"status": "ok", "service": "vpm-solver"}


@app.post("/priority-vector", response_model=PriorityVectorResponse)
def derive_priority_vector(req: PriorityVectorRequest):
    """
    Derive GMM priority vector and CR from a single pairwise matrix.
    Used for per-respondent CR calculation before aggregation.
    """
    try:
        weights = gmm_priority_vector(req.matrix).tolist()
        cr = consistency_ratio(req.matrix)
        cr_flag = cr_flag_label(cr)
        return PriorityVectorResponse(
            weights=weights,
            consistency_ratio=round(cr, 6),
            cr_flag=cr_flag,
            scale_adjusted=is_scale_adjusted(req.matrix),
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/aggregate-matrix", response_model=AggregateMatrixResponse)
def aggregate_matrix(req: AggregateMatrixRequest):
    """
    Aggregate multiple respondent matrices using geometric mean,
    then derive priority vector and CR from the aggregated matrix.
    """
    try:
        aggregated = aggregate_pairwise_matrices(req.matrices)
        weights = gmm_priority_vector(aggregated).tolist()
        cr = consistency_ratio(aggregated)
        cr_flag = cr_flag_label(cr)
        return AggregateMatrixResponse(
            aggregated_matrix=aggregated,
            weights=weights,
            consistency_ratio=round(cr, 6),
            cr_flag=cr_flag,
            scale_adjusted=is_scale_adjusted(aggregated),
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/solve", response_model=SolverResponse)
def solve(req: SolverRequest):
    """
    Full model solve:
      1. Build value index scores for benchmarks and targets
      2. Run 8-instance WLS solver
      3. Compute price recommendations for each target
      4. Optionally run sensitivity analysis
    """
    try:
        # Build value index scores
        bench_scores, target_scores, raw_base, raw_max = build_value_index_scores(
            attribute_weights=req.attribute_weights,
            level_utilities=req.level_utilities,
            attribute_levels=req.attribute_levels,
            benchmark_assignments=req.benchmark_assignments,
            target_assignments=req.target_assignments
        )

        # Run solver
        result = run_solver(bench_scores, req.market_prices, req.market_share_weights, target_value_scores=target_scores)

        if not result['success']:
            return SolverResponse(success=False, error=result.get('error'))

        b = result['b']
        m = result['m']

        # Price recommendations for each target
        target_results = []
        for i, (t_id, t_vi) in enumerate(zip(req.target_ids, target_scores)):
            rec = price_recommendation(b, m, t_vi, result['benchmark_residuals'])
            target_results.append(TargetResult(
                target_id=t_id,
                value_index=round(t_vi, 6),
                point_estimate=rec['point_estimate'],
                range_low=rec['range_low'],
                range_high=rec['range_high']
            ))

        # Sensitivity analysis
        sensitivity = None
        if req.run_sensitivity and target_results:
            full_model_pe = target_results[0].point_estimate
            sensitivity = run_sensitivity_analysis(
                attribute_ids=req.attribute_ids,
                attribute_weights=req.attribute_weights,
                level_utilities=req.level_utilities,
                attribute_levels=req.attribute_levels,
                benchmark_assignments=req.benchmark_assignments,
                target_assignments=req.target_assignments,
                market_prices=req.market_prices,
                market_share_weights=req.market_share_weights,
                full_model_point_estimate=full_model_pe
            )

        return SolverResponse(
            success=True,
            b=round(b, 4),
            m=round(m, 4),
            weighted_sse=round(result['weighted_sse'], 6),
            r_squared_weighted=round(result['r_squared_weighted'], 6),
            rse=round(result['rse'], 6),
            constraint_regime=result['constraint_regime'],
            init_strategy=result['init_strategy'],
            near_equivalent_flag=result['near_equivalent_flag'],
            suspicious_m_low=result['suspicious_m_low'],
            suspicious_b_high=result['suspicious_b_high'],
            benchmark_value_indices=[round(s, 6) for s in bench_scores],
            benchmark_residuals=[round(r, 4) for r in result['benchmark_residuals']],
            outlier_flags=result['outlier_flags'],
            target_results=target_results,
            sensitivity=sensitivity,
            all_runs=result['all_runs']
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/market-implied-weights")
def market_implied_weights(req: MarketImpliedWeightsRequest):
    """
    Single-stage diagnostic model: find attribute weights that minimize
    weighted SSE against market prices (Tool 3 - Advanced Diagnostics).
    Attribute weights treated as free parameters alongside B and M.
    """
    from scipy.optimize import minimize as sp_minimize
    import numpy as np

    try:
        n_attrs = len(req.attribute_ids)
        market_prices = np.array(req.market_prices, dtype=float)
        mw = np.array(req.market_share_weights, dtype=float)
        mw = mw / mw.sum()

        def objective(params):
            # params = [w1..wn, B, M]
            raw_weights = params[:n_attrs]
            b, m = params[n_attrs], params[n_attrs + 1]

            # Softmax to ensure weights sum to 1 and are positive
            exp_w = np.exp(raw_weights - np.max(raw_weights))
            weights = exp_w / exp_w.sum()

            attr_weights = {
                req.attribute_ids[i]: float(weights[i])
                for i in range(n_attrs)
            }

            bench_scores, _, _, _ = build_value_index_scores(
                attribute_weights=attr_weights,
                level_utilities=req.level_utilities,
                attribute_levels=req.attribute_levels,
                benchmark_assignments=req.benchmark_assignments,
                target_assignments=[]
            )

            v = np.array(bench_scores, dtype=float)
            predicted = b + v * (m - b)
            residuals = market_prices - predicted
            return float(np.sum(mw * residuals ** 2))

        # Initialize: equal weights (log space = 0), B/M from price range
        price_min = float(market_prices.min())
        price_max = float(market_prices.max())
        x0 = [0.0] * n_attrs + [price_min * 0.9, price_max * 1.1]

        result = sp_minimize(objective, x0, method='Nelder-Mead',
                             options={'maxiter': 10000, 'xatol': 1e-8})

        # Decode result
        raw_weights = result.x[:n_attrs]
        exp_w = np.exp(raw_weights - np.max(raw_weights))
        implied_weights = (exp_w / exp_w.sum()).tolist()
        b_implied, m_implied = float(result.x[n_attrs]), float(result.x[n_attrs + 1])

        implied_weights_dict = {
            req.attribute_ids[i]: round(implied_weights[i], 6)
            for i in range(n_attrs)
        }

        return {
            'success': result.success,
            'implied_weights': implied_weights_dict,
            'b_value': round(b_implied, 4),
            'm_value': round(m_implied, 4),
            'weighted_sse': round(float(result.fun), 6)
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================
# HELPERS
# ============================================================

def cr_flag_label(cr: float) -> str:
    if cr < 0.10:
        return 'OK'
    elif cr <= 0.20:
        return 'MARGINAL'
    else:
        return 'INCONSISTENT'


# ============================================================
# ENTRY POINT
# ============================================================

if __name__ == "__main__":
    import os
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=False)
