"""
auth.py — PIN-based login, session tokens, role enforcement
Roles: waiter < manager < admin
"""
from fastapi import APIRouter, HTTPException, Header, Depends
from pydantic import BaseModel
from typing import Optional
import hashlib, secrets
from datetime import datetime, timedelta
from database import get_db

router = APIRouter()

# In-memory session store { token: {user_id, role, name, expires} }
_sessions: dict = {}

SESSION_TTL_HOURS = 12

def hash_pin(pin: str) -> str:
    return hashlib.sha256(pin.encode()).hexdigest()

def create_session(user: dict) -> str:
    token = secrets.token_hex(32)
    _sessions[token] = {
        "user_id": user["id"],
        "name":    user["name"],
        "role":    user["role"],
        "expires": datetime.utcnow() + timedelta(hours=SESSION_TTL_HOURS),
    }
    return token

def get_session(token: str) -> Optional[dict]:
    s = _sessions.get(token)
    if not s:
        return None
    if datetime.utcnow() > s["expires"]:
        del _sessions[token]
        return None
    return s

def require_auth(x_token: str = Header(..., alias="X-Token")) -> dict:
    s = get_session(x_token)
    if not s:
        raise HTTPException(401, "Not authenticated — please log in")
    return s

def require_manager(session: dict = Depends(require_auth)) -> dict:
    if session["role"] not in ("manager", "admin"):
        raise HTTPException(403, "Manager or Admin access required")
    return session

def require_admin(session: dict = Depends(require_auth)) -> dict:
    if session["role"] != "admin":
        raise HTTPException(403, "Admin access required")
    return session

# ── Endpoints ────────────────────────────────────────────────────────────────

class LoginIn(BaseModel):
    pin: str

@router.post("/login")
def login(body: LoginIn):
    pin = body.pin.strip()
    if len(pin) != 4 or not pin.isdigit():
        raise HTTPException(400, "PIN must be exactly 4 digits")
    ph = hash_pin(pin)
    with get_db() as db:
        user = db.execute(
            "SELECT * FROM users WHERE pin_hash=? AND active=1", (ph,)
        ).fetchone()
    if not user:
        raise HTTPException(401, "Incorrect PIN")
    user = dict(user)
    token = create_session(user)
    return {
        "token": token,
        "user_id": user["id"],
        "name": user["name"],
        "role": user["role"],
    }

@router.post("/logout")
def logout(x_token: str = Header(..., alias="X-Token")):
    _sessions.pop(x_token, None)
    return {"ok": True}

@router.get("/me")
def me(session: dict = Depends(require_auth)):
    return session

@router.get("/sessions")
def list_sessions(session: dict = Depends(require_admin)):
    now = datetime.utcnow()
    return [
        {"name": v["name"], "role": v["role"],
         "expires_in_min": int((v["expires"] - now).total_seconds() // 60)}
        for v in _sessions.values()
        if now < v["expires"]
    ]
