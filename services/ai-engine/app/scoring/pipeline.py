"""The scoring pipeline's shape, without its models.

Phase 1 defines the seams; Phase 4 fills them. What is fixed here is the part
that is expensive to change later:

1. **Factors are plugins.** Each implements ``FactorModel`` and is registered by
   name. Adding a macro model is a new file plus a registry entry, never an edit
   to the composite.

2. **A factor may refuse.** ``score()`` returns either a scored result or an
   ``Unavailable`` carrying a human-readable reason. There is no third option and
   in particular no "return 50". A missing factor is dropped from the weighted
   average and the remaining weights are renormalized — filling it with a neutral
   value invents evidence and makes a genuinely-average asset indistinguishable
   from a completely-unknown one.

3. **The composite may refuse.** Below ``minimum_coverage`` the pipeline raises
   ``InsufficientCoverage`` and the API answers 422 with the reason for each
   omitted factor.

Rule 2 is the one that is nearly impossible to retrofit: once a caller has seen
a score for an asset with no data, every downstream consumer has been written to
assume a number is always there.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from app.schemas.scoring import AssetRef, Direction, Factor, Signal


@dataclass(frozen=True)
class FactorScore:
    score: float
    """0-100, where 50 is genuinely neutral evidence — never 'unknown'."""

    confidence: float
    """0-1: how much evidence this factor actually had."""

    signals: list[Signal] = field(default_factory=list)


@dataclass(frozen=True)
class Unavailable:
    reason: str
    """Shown to the user verbatim. 'No fundamentals provider configured', not 'error'."""


FactorOutput = FactorScore | Unavailable


@dataclass(frozen=True)
class ScoringContext:
    """Everything a factor model may read. Assembled once per asset."""

    asset: AssetRef
    inputs: dict[str, Any]
    as_of: datetime


class FactorModel(ABC):
    """One scoring dimension."""

    #: Stable identifier, matching the Factor literal on the wire.
    name: Factor

    #: Weight from the product spec, before renormalization. Weights across all
    #: registered models sum to 1.0; the registry asserts it at import.
    nominal_weight: float

    @abstractmethod
    def score(self, ctx: ScoringContext) -> FactorOutput:
        """Return a score or an explicit refusal. Must never raise for missing data.

        Raising for absent input would be indistinguishable from a bug in the
        model, and the composite would have to treat both the same way.
        """


class InsufficientCoverage(Exception):
    """Raised when too little of the nominal weight could be scored."""

    def __init__(self, coverage: float, required: float, omitted: dict[str, str]) -> None:
        super().__init__(f"coverage {coverage:.0%} below required {required:.0%}")
        self.coverage = coverage
        self.required = required
        self.omitted = omitted


def recommendation_for(score: float) -> str:
    """Map a composite score onto the five-band recommendation.

    Thresholds are asymmetric on purpose. A STRONG_BUY at 80 and a STRONG_SELL at
    20 would be symmetric and wrong: the cost of a false STRONG_BUY (capital at
    risk) exceeds that of a false STRONG_SELL (opportunity missed), so the bar for
    the buy bands is higher.
    """
    if score >= 82:
        return "STRONG_BUY"
    if score >= 62:
        return "BUY"
    if score > 38:
        return "HOLD"
    if score > 18:
        return "SELL"
    return "STRONG_SELL"


def blend(direction: Direction) -> float:
    """Directional prior used by factor models with no continuous measure.

    Deliberately narrow around neutral: a categorical signal is weak evidence and
    should not by itself move a composite across a recommendation boundary.
    """
    return {"bullish": 62.0, "bearish": 38.0, "neutral": 50.0}[direction]
