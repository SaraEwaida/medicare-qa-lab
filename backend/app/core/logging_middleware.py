"""Request ID + timing + structured, redacted request logging (stdout JSON and app_logs table)."""

import json
import logging
import re
import secrets
import sys
import time
import traceback

from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

from app.core.config import get_settings
from app.core.redaction import REDACTED, redact, redact_text
from app.core.request_context import set_request_id
from app.db.session import SessionLocal
from app.models import AppLog

_stdout = logging.getLogger("medicare.request")
if not _stdout.handlers:
    h = logging.StreamHandler(sys.stdout)
    h.setFormatter(logging.Formatter("%(message)s"))
    _stdout.addHandler(h)
    _stdout.setLevel(logging.INFO)
    _stdout.propagate = False

_VALID_RID = re.compile(r"^[A-Za-z0-9_.-]{8,40}$")
# Query parameters that may carry personal data are masked entirely.
_MASKED_QUERY_KEYS = {"q", "email", "phone", "name"}
_SKIP_PREFIXES = ("/api/v1/logs", "/api/v1/health", "/assets", "/favicon")


def new_request_id() -> str:
    return "req_" + secrets.token_hex(8)


def _level(status: int) -> str:
    return "ERROR" if status >= 500 else "WARNING" if status >= 400 else "INFO"


def _persist(entry: dict) -> None:
    db = SessionLocal()
    try:
        db.add(AppLog(**entry))
        db.commit()
    except Exception:  # logging must never break a request
        db.rollback()
    finally:
        db.close()


class RequestLoggingMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        incoming = request.headers.get("x-request-id", "")
        rid = incoming if _VALID_RID.match(incoming) else new_request_id()
        set_request_id(rid)
        request.state.request_id = rid
        start = time.perf_counter()
        try:
            response = await call_next(request)
        except Exception:  # unhandled errors still get an envelope, a request ID and a log line
            request.state.error_trace = traceback.format_exc(limit=-8)
            _stdout.error(request.state.error_trace)
            response = JSONResponse(status_code=500, content={"error": {
                "code": "INTERNAL_ERROR", "message": "Something went wrong. Share the request ID with support.",
                "details": [], "request_id": rid}})
        duration = int((time.perf_counter() - start) * 1000)
        response.headers["X-Request-ID"] = rid
        response.headers["X-Response-Time-ms"] = str(duration)

        path = request.url.path
        if not path.startswith("/api/") or path.startswith(_SKIP_PREFIXES):
            return response

        status = response.status_code
        query = {k: (REDACTED if k in _MASKED_QUERY_KEYS else redact_text(v)) for k, v in request.query_params.items()}
        context: dict = {"query": query} if query else {}
        if getattr(request.state, "validation_fields", None):
            context["invalid_fields"] = request.state.validation_fields
        if getattr(request.state, "error_trace", None):
            context["trace"] = redact_text(request.state.error_trace)[-2000:]
        if getattr(request.state, "log_context", None):
            context.update(request.state.log_context)
        context["user_agent"] = (request.headers.get("user-agent") or "")[:120]

        entry = {
            "level": _level(status), "request_id": rid, "method": request.method, "path": path[:300],
            "status_code": status, "duration_ms": duration,
            "user_id": getattr(request.state, "user_id", None),
            "user_role": getattr(request.state, "user_role", None),
            "message": f"{request.method} {path} -> {status} ({duration} ms)",
            "context": redact(context), "is_demo": bool(request.headers.get("x-demo-session")),
        }
        _stdout.info(json.dumps({"ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), **entry}, default=str))
        if get_settings().db_logging:
            await run_in_threadpool(_persist, entry)
        return response
