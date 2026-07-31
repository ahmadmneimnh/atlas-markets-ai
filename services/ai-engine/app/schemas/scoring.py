"""Pydantic mirror of `@atlas/core/contracts/scoring`.

Kept field-for-field identical to the Zod schemas on the Node side. The two are
reconciled through ``contract_version``: a request whose major version does not
match is rejected at the door rather than parsed optimistically, because a
silently-dropped field in a scoring payload becomes a wrong recommendation, not
an error.
"""

from datetime import datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field

Score = Annotated[float, Field(ge=0, le=100)]
UnitInterval = Annotated[float, Field(ge=0, le=1)]

AssetKind = Literal["equity", "crypto"]
Factor = Literal["technical", "fundamental", "news", "social", "macro", "risk"]
Direction = Literal["bullish", "bearish", "neutral"]
Recommendation = Literal["STRONG_SELL", "SELL", "HOLD", "BUY", "STRONG_BUY"]


class Strict(BaseModel):
    """Rejects unknown fields.

    The permissive default would let a producer send ``prise`` instead of
    ``price`` and have the engine score against a missing field. Failing the
    request is the correct outcome.
    """

    model_config = ConfigDict(extra="forbid")


class AssetRef(Strict):
    kind: AssetKind
    symbol: str = Field(min_length=1, max_length=24)
    name: str | None = None


class Signal(Strict):
    """One piece of cited evidence. ``source`` is required — see the Zod twin."""

    label: str
    value: str
    direction: Direction
    weight: UnitInterval
    source: str = Field(min_length=1)


class FactorScored(Strict):
    factor: Factor
    status: Literal["scored"] = "scored"
    score: Score
    confidence: UnitInterval
    nominal_weight: UnitInterval = Field(serialization_alias="nominalWeight")
    effective_weight: UnitInterval = Field(serialization_alias="effectiveWeight")
    signals: list[Signal] = Field(default_factory=list)


class FactorUnavailable(Strict):
    factor: Factor
    status: Literal["unavailable"] = "unavailable"
    reason: str = Field(min_length=1)


FactorOutcome = Annotated[FactorScored | FactorUnavailable, Field(discriminator="status")]


class ScoreRequest(Strict):
    contract_version: str = Field(alias="contractVersion")
    asset: AssetRef
    #: Pre-fetched market data keyed by capability. The engine performs no
    #: outbound provider calls: an engine that cannot fetch cannot invent.
    inputs: dict[str, Any]
    as_of: datetime = Field(alias="asOf")


class ScoreResponse(Strict):
    contract_version: str = Field(serialization_alias="contractVersion")
    asset: AssetRef
    score: Score
    recommendation: Recommendation
    confidence: Score
    factors: list[FactorOutcome]
    top_reasons: list[Signal] = Field(serialization_alias="topReasons")
    sources: list[str]
    coverage: UnitInterval
    computed_at: datetime = Field(serialization_alias="computedAt")
    engine_version: str = Field(serialization_alias="engineVersion")


class OmittedFactor(Strict):
    factor: Factor
    reason: str


class InsufficientData(Strict):
    """The 422 body. A refusal is a first-class answer, so it is fully structured."""

    contract_version: str = Field(serialization_alias="contractVersion")
    error: Literal["insufficient_data"] = "insufficient_data"
    asset: AssetRef
    coverage: UnitInterval
    required_coverage: UnitInterval = Field(serialization_alias="requiredCoverage")
    omitted: list[OmittedFactor]
