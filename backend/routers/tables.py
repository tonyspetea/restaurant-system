"""Tables router — floor plan management"""
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from database import get_db
from routers.auth import require_auth, require_manager, require_admin

router = APIRouter()

class TableIn(BaseModel):
    name: str
    capacity: int = 4

@router.get("/")
def list_tables(session=Depends(require_auth)):
    with get_db() as db:
        tables = [dict(r) for r in db.execute("SELECT * FROM tables ORDER BY id").fetchall()]
        for t in tables:
            t["active_order"] = dict(db.execute(
                "SELECT id,status,total FROM orders WHERE table_id=? AND status NOT IN ('paid','void') ORDER BY created_at DESC LIMIT 1",
                (t["id"],)).fetchone() or {})
    return tables

@router.post("/", status_code=201)
def create_table(body: TableIn, session=Depends(require_manager)):
    with get_db() as db:
        rows = db.execute("SELECT id FROM tables ORDER BY id").fetchall()
        # Auto-generate next table ID
        nums = [int(r["id"][1:]) for r in rows if r["id"].startswith("T") and r["id"][1:].isdigit()]
        next_num = max(nums) + 1 if nums else 1
        new_id = f"T{next_num}"
        db.execute("INSERT INTO tables (id,name,capacity) VALUES (?,?,?)",
                   (new_id, body.name, body.capacity))
    return {"id": new_id, "name": body.name, "capacity": body.capacity}

@router.put("/{table_id}")
def update_table(table_id: str, body: TableIn, session=Depends(require_manager)):
    with get_db() as db:
        row = db.execute("SELECT id FROM tables WHERE id=?", (table_id,)).fetchone()
        if not row:
            raise HTTPException(404)
        db.execute("UPDATE tables SET name=?,capacity=? WHERE id=?",
                   (body.name, body.capacity, table_id))
    return {"id": table_id, **body.dict()}

@router.patch("/{table_id}/status")
def update_status(table_id: str, status: str, session=Depends(require_auth)):
    valid = {"free","occupied","reserved"}
    if status not in valid:
        raise HTTPException(400)
    with get_db() as db:
        db.execute("UPDATE tables SET status=? WHERE id=?", (status, table_id))
    return {"table_id": table_id, "status": status}

@router.delete("/{table_id}")
def delete_table(table_id: str, session=Depends(require_admin)):
    with get_db() as db:
        active = db.execute(
            "SELECT COUNT(*) as c FROM orders WHERE table_id=? AND status NOT IN ('paid','void')",
            (table_id,)).fetchone()["c"]
        if active:
            raise HTTPException(400, "Table has active orders")
        db.execute("DELETE FROM tables WHERE id=?", (table_id,))
    return {"ok": True}
