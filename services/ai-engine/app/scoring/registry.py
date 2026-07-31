"""Factor model registry.

The weights are the product specification, expressed as code.

**The TypeScript engine at ``apps/web/src/lib/analysis`` is the source of truth
for these numbers today**, and the values below are copied from it. That is a
duplication and it is a known liability: a weight that appears in two files will
eventually differ between them, and the difference is invisible because both
scores still look plausible. The resolution is in the Phase 4 plan — the
TypeScript factor scorers move here and the BFF calls this service — not a second
set of weights that drifts in the meantime. Until then, changing a weight means
changing it in both places, which is why they are asserted to sum to 1.0 here and
to 100 there.

No model is registered in Phase 1. ``REGISTERED`` is empty and
``is_operational()`` is therefore False, which is what the ``/v1/score`` endpoint
consults before agreeing to score anything. An empty registry returning scores
would be the worst possible failure mode: confident numbers derived from nothing.
"""

from __future__ import annotations

from app.scoring.pipeline import FactorModel

#: factor name -> nominal weight. Must sum to 1.0.
#: Mirrors the `weight` field on each scorer in apps/web/src/lib/analysis/factors.
NOMINAL_WEIGHTS: dict[str, float] = {
    "technical": 0.30,
    "fundamental": 0.30,
    "news": 0.15,
    "social": 0.10,
    "macro": 0.10,
    "risk": 0.05,
}

_total = round(sum(NOMINAL_WEIGHTS.values()), 6)
if _total != 1.0:  # pragma: no cover - guards a typo, not a runtime path
    raise ValueError(f"nominal factor weights must sum to 1.0, got {_total}")

#: Populated in Phase 4, one entry per implemented model.
REGISTERED: list[FactorModel] = []


def is_operational() -> bool:
    """True once at least one factor model is registered."""
    return len(REGISTERED) > 0


def registered_names() -> list[str]:
    return [model.name for model in REGISTERED]
