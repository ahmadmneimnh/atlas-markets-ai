"""Shared-secret authentication for service-to-service calls.

The engine is only reachable from the BFF and the worker on a private network,
which is a deployment assumption rather than a security control: one misconfigured
ingress turns an unauthenticated scoring endpoint into a public one.

When ``AI_ENGINE_API_KEY`` is unset the dependency allows the request and logs a
warning — a local `docker compose up` should not require secret provisioning. In
production the setting is required; ``main.py`` refuses to start without it.
"""

import hmac

from fastapi import Depends, Header, HTTPException, status

from app.core.config import Settings, get_settings
from app.core.logging import get_logger

log = get_logger()


def require_api_key(
    x_atlas_key: str | None = Header(default=None),
    settings: Settings = Depends(get_settings),
) -> None:
    # Settings arrive through Depends rather than a direct `get_settings()` call so
    # that `app.dependency_overrides` can swap them in tests. A dependency that
    # reaches for global state is a dependency that cannot be tested without
    # monkeypatching the module.
    if settings.api_key is None:
        log.warning("ai-engine api key not configured; accepting unauthenticated request")
        return

    # Constant-time comparison. `==` on strings short-circuits at the first
    # differing byte, which leaks the shared secret one character at a time to
    # anyone who can measure response latency.
    if x_atlas_key is None or not hmac.compare_digest(x_atlas_key, settings.api_key):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"error": "unauthorized"},
        )
