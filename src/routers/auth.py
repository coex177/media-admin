"""Accounts: signup / login / logout / me, and the require_user dependency.

Sessions are random tokens in an HttpOnly SameSite=Lax cookie, stored hashed.
SameSite=Lax + no CORS wildcard is the CSRF defence: cross-site fetches never
carry the cookie. Passwords use stdlib scrypt.
"""

import hashlib
import hmac
import secrets
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Tenant, User, UserSession, current_tenant_id

router = APIRouter(prefix="/api/auth", tags=["auth"])

COOKIE = "session"
SESSION_DAYS = 30


# ── crypto helpers ──────────────────────────────────────────────────

def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=2**14, r=8, p=1)
    return f"{salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    salt_hex, digest_hex = stored.split("$")
    digest = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt_hex), n=2**14, r=8, p=1)
    return hmac.compare_digest(digest.hex(), digest_hex)


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


# ── dependency ──────────────────────────────────────────────────────

async def require_user(request: Request, db: Session = Depends(get_db)) -> User:
    """Resolve the session cookie to a User and scope the ORM to their tenant.

    async on purpose: a sync dependency runs in a worker thread with a *copy*
    of the context, so the contextvar set there would never reach the endpoint.
    """
    token = request.cookies.get(COOKIE)
    if not token:
        raise HTTPException(status_code=401, detail="Not signed in")
    row = (
        db.query(UserSession)
        .filter(UserSession.token_hash == token_hash(token), UserSession.expires_at > datetime.utcnow())
        .first()
    )
    if not row:
        raise HTTPException(status_code=401, detail="Session expired")
    current_tenant_id.set(row.user.tenant_id)
    request.state.user = row.user
    return row.user


# ── endpoints ───────────────────────────────────────────────────────

class Credentials(BaseModel):
    email: str
    password: str

    @property
    def norm_email(self) -> str:
        e = self.email.strip().lower()
        if "@" not in e or len(e) > 255:
            raise HTTPException(status_code=400, detail="Invalid email")
        return e


def _start_session(request: Request, response: Response, db: Session, user: User):
    token = secrets.token_urlsafe(32)
    db.add(UserSession(token_hash=token_hash(token), user_id=user.id,
                       expires_at=datetime.utcnow() + timedelta(days=SESSION_DAYS)))
    db.commit()
    secure = request.url.scheme == "https" or request.headers.get("x-forwarded-proto") == "https"
    response.set_cookie(COOKIE, token, max_age=SESSION_DAYS * 86400, httponly=True, samesite="lax", secure=secure)


@router.post("/signup")
async def signup(data: Credentials, request: Request, response: Response, db: Session = Depends(get_db)):
    if len(data.password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
    email = data.norm_email
    if db.query(User).filter(User.email == email).first():
        raise HTTPException(status_code=400, detail="Email already registered")
    # The migrated single-user install has tenant 1 with data but no user: the first signup claims it.
    tenant = db.query(Tenant).filter(Tenant.id == 1).first() if db.query(User).count() == 0 else None
    if tenant is None:
        tenant = Tenant(name=email)
        db.add(tenant)
        db.flush()
    user = User(tenant_id=tenant.id, email=email, password_hash=hash_password(data.password))
    db.add(user)
    db.flush()
    _start_session(request, response, db, user)
    return user.to_dict()


@router.post("/login")
async def login(data: Credentials, request: Request, response: Response, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == data.norm_email).first()
    if not user or not verify_password(data.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    _start_session(request, response, db, user)
    return user.to_dict()


@router.post("/logout")
async def logout(request: Request, response: Response, db: Session = Depends(get_db)):
    token = request.cookies.get(COOKIE)
    if token:
        db.query(UserSession).filter(UserSession.token_hash == token_hash(token)).delete()
        db.commit()
    response.delete_cookie(COOKIE)
    return {"ok": True}


@router.get("/me")
async def me(user: User = Depends(require_user)):
    return user.to_dict()
