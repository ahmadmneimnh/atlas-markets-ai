"""FastAPI application factory."""

from contextlib import asynccontextmanager
from collections.abc import AsyncIterator

from fastapi import FastAPI
from prometheus_client import CONTENT_TYPE_LATEST, generate_latest
from starlette.responses import Response

from app.api.routes import health, scoring
from app.core.config import get_settings
from app.core.logging import configure_logging, get_logger
from app.scoring import registry


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    configure_logging()
    settings = get_settings()
    log = get_logger()

    # A production deployment with no shared secret is a mistake, not a
    # preference, so it is fatal rather than a warning nobody reads.
    if settings.environment == "production" and settings.api_key is None:
        raise RuntimeError("AI_ENGINE_API_KEY is required when NODE_ENV=production")

    log.info(
        "ai-engine starting",
        environment=settings.environment,
        engine_version=settings.engine_version,
        contract_version=settings.contract_version,
        factors=registry.registered_names(),
    )
    yield
    log.info("ai-engine stopped")


def create_app() -> FastAPI:
    settings = get_settings()

    app = FastAPI(
        title="Atlas Markets AI — scoring engine",
        version=settings.engine_version,
        # No CORS middleware: this service is called by other services, never by
        # a browser. Adding permissive CORS "just in case" is how an internal
        # endpoint becomes reachable from any page a user visits.
        lifespan=lifespan,
        docs_url="/docs" if settings.environment != "production" else None,
        redoc_url=None,
        openapi_url="/openapi.json" if settings.environment != "production" else None,
    )

    app.include_router(health.router)
    app.include_router(scoring.router)

    @app.get("/metrics", include_in_schema=False)
    def metrics() -> Response:
        """Prometheus scrape target. See infra/monitoring/prometheus.yml."""
        return Response(content=generate_latest(), media_type=CONTENT_TYPE_LATEST)

    return app


app = create_app()
