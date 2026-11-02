from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.api.v1 import auth, dashboard, demo, logs, patients, prescriptions, qa, tickets
from app.core.config import get_settings
from app.core.errors import AppError, register_error_handlers
from app.core.logging_middleware import RequestLoggingMiddleware

DESCRIPTION = """
Healthcare SaaS demo API (pharmacy, support, QA). **All data is synthetic.**
Not HIPAA-compliant and not independently audited.

Authenticate with `POST /api/v1/auth/login`, then click **Authorize** and paste the `access_token`.
Every response carries an `X-Request-ID` header; errors repeat it in the body for support lookups.
"""


def create_app() -> FastAPI:
    s = get_settings()
    app = FastAPI(title="MediCare QA Lab API", version=s.app_version, description=DESCRIPTION,
                  docs_url="/api/docs", redoc_url="/api/redoc", openapi_url="/api/openapi.json")
    register_error_handlers(app)
    app.add_middleware(RequestLoggingMiddleware)
    if s.cors_origin_list:
        app.add_middleware(CORSMiddleware, allow_origins=s.cors_origin_list, allow_credentials=False,
                           allow_methods=["*"], allow_headers=["*"],
                           expose_headers=["X-Request-ID", "X-Response-Time-ms", "Idempotent-Replay"])

    for module in (auth, dashboard, patients, prescriptions, tickets, qa, logs, demo):
        app.include_router(module.router, prefix="/api/v1")

    @app.api_route("/api/{rest:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"], include_in_schema=False)
    def api_not_found(rest: str):
        raise AppError(404, "NOT_FOUND", f"No API route for /api/{rest}.")

    dist = Path(s.frontend_dist) if s.frontend_dist else None
    if dist and (dist / "index.html").exists():
        app.mount("/assets", StaticFiles(directory=dist / "assets"), name="assets")

        @app.get("/{full_path:path}", include_in_schema=False)
        def spa(full_path: str):
            candidate = (dist / full_path).resolve()
            if full_path and candidate.is_file() and dist.resolve() in candidate.parents:
                return FileResponse(candidate)
            return FileResponse(dist / "index.html")  # client-side routing

    return app


app = create_app()
