"""Users router — admin manages staff accounts"""
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional
from datetime import datetime
import hashlib
from database import get_db
from routers.auth import require_admin, require_manager

router = APIRouter()

def hp(pin): return hashlib.sha256(pin.encode()).hexdigest()

class UserIn(BaseModel):
    name: str
    pin: str
    role: str = "waiter"   # waiter | manager | admin

class PinChange(BaseModel):
    new_pin: str

class UserUpdate(BaseModel):
    name: str
    role: str

@router.get("/")
def list_users(session=Depends(require_manager)):
    with get_db() as db:
        rows = db.execute(
            "SELECT id,name,role,active,created_at FROM users ORDER BY role,name"
        ).fetchall()
    return [dict(r) for r in rows]

@router.post("/", status_code=201)
def create_user(body: UserIn, session=Depends(require_admin)):
    if len(body.pin) != 4 or not body.pin.isdigit():
        raise HTTPException(400, "PIN must be 4 digits")
    if body.role not in ("waiter", "manager", "admin"):
        raise HTTPException(400, "Role must be waiter | manager | admin")
    with get_db() as db:
        # Check PIN uniqueness
        clash = db.execute("SELECT id FROM users WHERE pin_hash=?", (hp(body.pin),)).fetchone()
        if clash:
            raise HTTPException(400, "That PIN is already in use")
        cur = db.execute(
            "INSERT INTO users (name,pin_hash,role) VALUES (?,?,?)",
            (body.name, hp(body.pin), body.role)
        )
    return {"id": cur.lastrowid, "name": body.name, "role": body.role}

@router.put("/{user_id}")
def update_user(user_id: int, body: UserUpdate, session=Depends(require_admin)):
    if body.role not in ("waiter","manager","admin"):
        raise HTTPException(400, "Invalid role")
    with get_db() as db:
        row = db.execute("SELECT id FROM users WHERE id=?", (user_id,)).fetchone()
        if not row:
            raise HTTPException(404, "User not found")
        db.execute(
            "UPDATE users SET name=?, role=?, updated_at=? WHERE id=?",
            (body.name, body.role, datetime.utcnow().isoformat(), user_id)
        )
    return {"id": user_id, "name": body.name, "role": body.role}


def change_pin(user_id: int, body: PinChange, session=Depends(require_admin)):
    if len(body.new_pin) != 4 or not body.new_pin.isdigit():
        raise HTTPException(400, "PIN must be 4 digits")
    with get_db() as db:
        clash = db.execute(
            "SELECT id FROM users WHERE pin_hash=? AND id!=?",
            (hp(body.new_pin), user_id)
        ).fetchone()
        if clash:
            raise HTTPException(400, "That PIN is already taken")
        db.execute(
            "UPDATE users SET pin_hash=?, updated_at=? WHERE id=?",
            (hp(body.new_pin), datetime.utcnow().isoformat(), user_id)
        )
    return {"ok": True}

@router.patch("/{user_id}/role")
def change_role(user_id: int, role: str, session=Depends(require_admin)):
    if role not in ("waiter","manager","admin"):
        raise HTTPException(400, "Invalid role")
    with get_db() as db:
        db.execute("UPDATE users SET role=? WHERE id=?", (role, user_id))
    return {"ok": True, "role": role}

@router.patch("/{user_id}/toggle")
def toggle_user(user_id: int, session=Depends(require_admin)):
    with get_db() as db:
        row = db.execute("SELECT active FROM users WHERE id=?", (user_id,)).fetchone()
        if not row:
            raise HTTPException(404, "User not found")
        new_val = 0 if row["active"] else 1
        db.execute("UPDATE users SET active=? WHERE id=?", (new_val, user_id))
    return {"active": bool(new_val)}

@router.delete("/{user_id}")
def delete_user(user_id: int, session=Depends(require_admin)):
    with get_db() as db:
        db.execute("UPDATE users SET active=0 WHERE id=?", (user_id,))
    return {"ok": True}
