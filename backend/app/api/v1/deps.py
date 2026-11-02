from dataclasses import dataclass
from datetime import datetime

from fastapi import Query
from sqlalchemy import Select, func, select
from sqlalchemy.orm import Session

from app.core.errors import AppError, unprocessable


@dataclass
class PageParams:
    page: int
    page_size: int
    sort: str | None


def page_params(
    page: int = Query(1, ge=1, le=10_000),
    page_size: int = Query(20, ge=1, le=100),
    sort: str | None = Query(None, max_length=40, description="Field name; prefix with '-' for descending."),
) -> PageParams:
    return PageParams(page, page_size, sort)


def apply_sort(stmt: Select, sort: str | None, allowed: dict, default) -> Select:
    if not sort:
        return stmt.order_by(*default) if isinstance(default, (list, tuple)) else stmt.order_by(default)
    desc = sort.startswith("-")
    key = sort.lstrip("-")
    if key not in allowed:
        raise unprocessable(f"Cannot sort by '{key}'. Allowed: {', '.join(sorted(allowed))}.", "sort")
    col = allowed[key]
    return stmt.order_by(col.desc() if desc else col.asc())


def paginate(db: Session, stmt: Select, params: PageParams, unique: bool = False) -> tuple[list, int]:
    total = db.scalar(select(func.count()).select_from(stmt.order_by(None).subquery())) or 0
    result = db.scalars(stmt.offset((params.page - 1) * params.page_size).limit(params.page_size))
    items = list(result.unique() if unique else result)
    return items, total


def check_version(current: datetime, provided: datetime, entity: str) -> None:
    """Optimistic concurrency: reject the write if the row changed since the client read it."""
    if abs((current - provided).total_seconds()) > 0.001:
        raise AppError(409, "STALE_WRITE",
                       f"This {entity} was changed by someone else. Reload and try again.")
