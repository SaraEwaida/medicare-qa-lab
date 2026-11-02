from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.permissions import permissions_for
from app.core.security import create_access_token, get_current_user, login_limiter, require, verify_password
from app.db.session import get_db
from app.models import User
from app.schemas.common import UserRef
from app.schemas.support import LoginRequest, MeOut, TokenOut, UserOut
from app.services.audit import audit

router = APIRouter(tags=["Auth & system"])


@router.post("/auth/login", response_model=TokenOut)
def login(body: LoginRequest, request: Request, db: Session = Depends(get_db)):
    email = body.email.lower()
    limiter_key = f"{request.client.host if request.client else '-'}:{email}"
    login_limiter.check(limiter_key)
    user = db.scalars(select(User).where(User.email == email)).first()
    if user is None or not user.is_active or not verify_password(body.password, user.password_hash):
        login_limiter.record_failure(limiter_key)
        audit(db, user, "login_failed", "user", user.id if user else None, {"reason": "invalid_credentials"})
        db.commit()
        # Same message whether the email exists or not (no account enumeration).
        raise HTTPException(status_code=401, detail="Invalid email or password.")
    login_limiter.reset(limiter_key)  # only failed attempts count toward the limit
    user.last_login_at = datetime.now(UTC)
    request.state.user_id, request.state.user_role = user.id, user.role.value
    audit(db, user, "login", "user", user.id)
    db.commit()
    token, expires = create_access_token(user)
    return TokenOut(access_token=token, expires_in=expires, user=UserOut.model_validate(user))


@router.get("/auth/me", response_model=MeOut)
def me(user: User = Depends(get_current_user)):
    return MeOut(id=user.id, email=user.email, full_name=user.full_name, role=user.role.value,
                 permissions=permissions_for(user.role))


@router.get("/users", response_model=list[UserRef])
def list_users(_: User = Depends(require("tickets:read_all")), db: Session = Depends(get_db)):
    return db.scalars(select(User).where(User.is_active).order_by(User.full_name)).all()


@router.get("/health")
def health(db: Session = Depends(get_db)):
    s = get_settings()
    try:
        db.execute(text("SELECT 1"))
        db_ok = True
    except Exception:
        db_ok = False
    return {"status": "ok" if db_ok else "degraded", "database": "ok" if db_ok else "unreachable",
            "version": s.app_version, "environment": s.environment, "demo_bugs_enabled": s.demo_bugs_enabled}
