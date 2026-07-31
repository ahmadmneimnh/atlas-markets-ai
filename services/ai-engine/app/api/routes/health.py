"""Liveness and readiness.

Two endpoints, not one, because the orchestrator does different things with the
answers. ``/health`` failing gets the container restarted; ``/ready`` failing
only takes it out of the load-balancer rotation. Reporting "not ready" on
``/health`` gets a perfectly healthy pod killed in a restart loop.
"""

from typing import Any

from fastapi import APIRouter, Response, status

from app.core.config import get_settings
from app.scoring import registry

router = APIRouter(tags=["health"])


@router.get("/health")
def health() -> dict[str, Any]:
    """Liveness: the process is up and can serve. Deliberately checks nothing else."""
    settings = get_settings()
    return {
        "status": "ok",
        "service": "ai-engine",
        "engineVersion": settings.engine_version,
        "contractVersion": settings.contract_version,
    }


@router.get("/ready")
def ready(response: Response) -> dict[str, Any]:
    """Readiness: the engine can actually produce a score.

    With no factor models registered it reports 503. That is accurate rather
    than pessimistic — routing scoring traffic to this instance today would
    return 501 for every request.
    """
    settings = get_settings()
    operational = registry.is_operational()

    if not operational:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE

    return {
        "status": "ready" if operational else "not_ready",
        "reason": None if operational else "no factor models registered (Phase 4)",
        "factors": registry.registered_names(),
        "minimumCoverage": settings.minimum_coverage,
    }
