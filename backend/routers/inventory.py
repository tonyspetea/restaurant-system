"""Inventory router — stock management"""
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional
from datetime import datetime
from database import get_db
from routers.auth import require_auth, require_manager, require_admin

router = APIRouter()

class InventoryItemIn(BaseModel):
    name: str
    unit: str = "pcs"
    qty_in_stock: float = 0
    reorder_level: float = 5
    cost_per_unit: float = 0
    category: str = "general"

class StockAction(BaseModel):
    action: str          # restock | deduct | adjustment
    qty: float
    note: Optional[str] = None

@router.get("/")
def list_inventory(session=Depends(require_auth)):
    with get_db() as db:
        rows = db.execute(
            "SELECT * FROM inventory ORDER BY category, name"
        ).fetchall()
    items = [dict(r) for r in rows]
    for i in items:
        i["low_stock"] = i["qty_in_stock"] <= i["reorder_level"]
    return items

@router.get("/low-stock")
def low_stock(session=Depends(require_manager)):
    with get_db() as db:
        rows = db.execute(
            "SELECT * FROM inventory WHERE qty_in_stock <= reorder_level ORDER BY qty_in_stock"
        ).fetchall()
    return [dict(r) for r in rows]

@router.post("/", status_code=201)
def create_item(body: InventoryItemIn, session=Depends(require_manager)):
    with get_db() as db:
        cur = db.execute(
            "INSERT INTO inventory (name,unit,qty_in_stock,reorder_level,cost_per_unit,category) VALUES (?,?,?,?,?,?)",
            (body.name, body.unit, body.qty_in_stock, body.reorder_level, body.cost_per_unit, body.category)
        )
    return {"id": cur.lastrowid, **body.dict()}

@router.put("/{item_id}")
def update_item(item_id: int, body: InventoryItemIn, session=Depends(require_manager)):
    with get_db() as db:
        row = db.execute("SELECT id FROM inventory WHERE id=?", (item_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Item not found")
        db.execute("""
            UPDATE inventory SET name=?,unit=?,qty_in_stock=?,reorder_level=?,
            cost_per_unit=?,category=?,updated_at=? WHERE id=?
        """, (body.name, body.unit, body.qty_in_stock, body.reorder_level,
              body.cost_per_unit, body.category, datetime.utcnow().isoformat(), item_id))
    return {"id": item_id, **body.dict()}

@router.post("/{item_id}/stock")
def update_stock(item_id: int, body: StockAction, session=Depends(require_manager)):
    valid = {"restock", "deduct", "adjustment"}
    if body.action not in valid:
        raise HTTPException(400, f"action must be one of {valid}")
    with get_db() as db:
        row = db.execute("SELECT * FROM inventory WHERE id=?", (item_id,)).fetchone()
        if not row:
            raise HTTPException(404)
        if body.action == "restock":
            new_qty = row["qty_in_stock"] + body.qty
        elif body.action == "deduct":
            new_qty = max(0, row["qty_in_stock"] - body.qty)
        else:
            new_qty = body.qty
        db.execute(
            "UPDATE inventory SET qty_in_stock=?, updated_at=? WHERE id=?",
            (new_qty, datetime.utcnow().isoformat(), item_id)
        )
        db.execute(
            "INSERT INTO inventory_log (item_id,action,qty,note,user_id) VALUES (?,?,?,?,?)",
            (item_id, body.action, body.qty, body.note, session["user_id"])
        )
    return {"id": item_id, "qty_in_stock": new_qty, "action": body.action}

@router.get("/{item_id}/log")
def item_log(item_id: int, session=Depends(require_manager)):
    with get_db() as db:
        rows = db.execute(
            """SELECT l.*, u.name as user_name FROM inventory_log l
               LEFT JOIN users u ON l.user_id=u.id
               WHERE l.item_id=? ORDER BY l.created_at DESC LIMIT 100""",
            (item_id,)
        ).fetchall()
    return [dict(r) for r in rows]

@router.delete("/{item_id}")
def delete_item(item_id: int, session=Depends(require_admin)):
    with get_db() as db:
        db.execute("DELETE FROM inventory WHERE id=?", (item_id,))
    return {"ok": True}
