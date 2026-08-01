"""Structured JSON logging.

Emits the same line shape as the Node services (`ts`, `level`, `service`,
`message`, `context`) so one log pipeline can query across all three without a
per-service parser.
"""

import logging
import sys
from typing import cast

import structlog

from app.core.config import get_settings

_LEVELS = {
    "debug": logging.DEBUG,
    "info": logging.INFO,
    "warning": logging.WARNING,
    "error": logging.ERROR,
}


def configure_logging() -> None:
    settings = get_settings()
    level = _LEVELS[settings.log_level]

    logging.basicConfig(format="%(message)s", stream=sys.stdout, level=level)

    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso", key="ts"),
            structlog.processors.StackInfoRenderer(),
            structlog.processors.format_exc_info,
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(level),
        logger_factory=structlog.PrintLoggerFactory(),
        cache_logger_on_first_use=True,
    )


def get_logger() -> structlog.stdlib.BoundLogger:
    # structlog.get_logger is typed as returning Any because the bound class is
    # chosen at configure() time. The cast states what configure_logging above
    # actually configures — narrowing here rather than at every call site.
    return cast(structlog.stdlib.BoundLogger, structlog.get_logger(service="ai-engine"))
