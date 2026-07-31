"""POST /v1/score.

Phase 1 wires the route, the request schema, the contract-version check and the
auth dependency — everything except the models that produce a number. With an
empty factor registry it answers **501 Not Implemented**.

Returning a plausible-looking score here would have been a few lines and would
have been the single most damaging thing in this scaffold: a placeholder that
returns 63/100 is indistinguishable from a real recommendation to every consumer
downstream, and it will be believed.
"""

from fastapi import APIRouter, Depends, HTTPException, status

from app.core.config import Settings, get_settings
from app.core.logging import get_logger
from app.core.security import require_api_key
from app.schemas.scoring import ScoreRequest, ScoreResponse
from app.scoring import registry

router = APIRouter(prefix="/v1", tags=["scoring"])
log = get_logger()


def _check_contract(request_version: str, expected: str) -> None:
    """Reject a mismatched major version instead of parsing optimistically."""
    if request_version.split(".")[0] != expected.split(".")[0]:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "error": "contract_version_mismatch",
                "expected": expected,
                "received": request_version,
            },
        )


@router.post(
    "/score",
    response_model=ScoreResponse,
    response_model_by_alias=True,
    responses={
        422: {"description": "Insufficient factor coverage — the engine declines to score"},
        501: {"description": "No factor models registered"},
    },
    dependencies=[Depends(require_api_key)],
)
def score(payload: ScoreRequest, settings: Settings = Depends(get_settings)) -> ScoreResponse:
    _check_contract(payload.contract_version, settings.contract_version)

    log.info(
        "score requested",
        symbol=payload.asset.symbol,
        kind=payload.asset.kind,
        inputs=sorted(payload.inputs.keys()),
    )

    if not registry.is_operational():
        raise HTTPException(
            status_code=status.HTTP_501_NOT_IMPLEMENTED,
            detail={
                "error": "engine_not_implemented",
                "message": (
                    "No factor models are registered. The scoring pipeline, contract and "
                    "transport are in place; the models land in Phase 4."
                ),
                "phase": "4",
            },
        )

    # Phase 4: run each registered model, drop the refusals, renormalize the
    # remaining weights, and raise InsufficientCoverage below the floor.
    raise HTTPException(  # pragma: no cover - unreachable while REGISTERED is empty
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail={"error": "engine_not_implemented"},
    )
