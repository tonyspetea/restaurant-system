"""Orders router — create, list, update, void"""
from fastapi import APIRouter, HTTPException, Request, Depends
from pydantic import BaseModel
from typing import Optional
from datetime import datetime
import uuid
from database import get_db
from routers.auth import require_auth, require_manager, require_admin

router = APIRouter()

class OrderItemIn(BaseModel):
    menu_item_id: int
    name: str
    destination: str
    qty: int
    unit_price: float
    note: Optional[str] = None

class OrderIn(BaseModel):
    table_id: str
    waiter: Optional[str] = "Staff"
    waiter_id: Optional[int] = None
    note: Optional[str] = None
    items: list[OrderItemIn]

class StatusUpdate(BaseModel):
    status: str

class VoidRequest(BaseModel):
    reason: Optional[str] = "Voided by manager"

def calc_totals(items):
    subtotal = sum(i.qty * i.unit_price for i in items)
    tax      = round(subtotal * 0.16, 2)
    return subtotal, tax, round(subtotal + tax, 2)

@router.post("/", status_code=201)
async def create_order(body: OrderIn, request: Request, session=Depends(require_auth)):
    order_id = "ORD-" + uuid.uuid4().hex[:6].upper()
    subtotal, tax, total = calc_totals(body.items)
    now = datetime.utcnow().isoformat()
    waiter_id = body.waiter_id or session.get("user_id")
    waiter    = body.waiter or session.get("name", "Staff")

    with get_db() as db:
        db.execute("""
            INSERT INTO orders (id,table_id,waiter,waiter_id,note,subtotal,tax,total,created_at,updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?)
        """, (order_id, body.table_id, waiter, waiter_id, body.note, subtotal, tax, total, now, now))
        for item in body.items:
            db.execute("""
                INSERT INTO order_items (order_id,menu_item_id,name,destination,qty,unit_price,line_total,note)
                VALUES (?,?,?,?,?,?,?,?)
            """, (order_id, item.menu_item_id, item.name, item.destination,
                  item.qty, item.unit_price, item.qty * item.unit_price, item.note))
        db.execute("UPDATE tables SET status='occupied' WHERE id=?", (body.table_id,))

    try:
        kitchen_items = [i.dict() for i in body.items if i.destination == "kitchen"]
        bar_items     = [i.dict() for i in body.items if i.destination == "bar"]
        await request.app.state.manager.broadcast({
            "event": "new_order", "order_id": order_id,
            "table_id": body.table_id, "waiter": waiter,
            "kitchen_items": kitchen_items, "bar_items": bar_items,
            "timestamp": now,
        })
    except Exception:
        pass

    return {"order_id": order_id, "total": total, "status": "pending"}

@router.get("/")
def list_orders(
    status:   Optional[str] = None,
    table_id: Optional[str] = None,
    session=Depends(require_auth)
):
    with get_db() as db:
        q = "SELECT o.*, u.name as waiter_name FROM orders o LEFT JOIN users u ON o.waiter_id=u.id WHERE 1=1"
        p = []
        if status:   q += " AND o.status=?"; p.append(status)
        if table_id: q += " AND o.table_id=?"; p.append(table_id)
        q += " ORDER BY o.created_at DESC LIMIT 200"
        orders = [dict(r) for r in db.execute(q, p).fetchall()]
        for o in orders:
            o["items"] = [dict(r) for r in db.execute(
                "SELECT * FROM order_items WHERE order_id=?", (o["id"],)).fetchall()]
    return orders

@router.get("/{order_id}")
def get_order(order_id: str, session=Depends(require_auth)):
    with get_db() as db:
        row = db.execute(
            "SELECT o.*, u.name as waiter_name FROM orders o LEFT JOIN users u ON o.waiter_id=u.id WHERE o.id=?",
            (order_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Order not found")
        order = dict(row)
        order["items"] = [dict(r) for r in db.execute(
            "SELECT * FROM order_items WHERE order_id=?", (order_id,)).fetchall()]
    return order

@router.patch("/{order_id}/status")
async def update_status(order_id: str, body: StatusUpdate, request: Request, session=Depends(require_auth)):
    # Waiters cannot void — only manager/admin
    if body.status == "void" and session["role"] == "waiter":
        raise HTTPException(403, "Waiters cannot void orders — contact manager")
    valid = {"pending","cooking","ready","paid","void"}
    if body.status not in valid:
        raise HTTPException(400, f"Status must be one of {valid}")
    now = datetime.utcnow().isoformat()
    with get_db() as db:
        row = db.execute("SELECT id FROM orders WHERE id=?", (order_id,)).fetchone()
        if not row:
            raise HTTPException(404)
        db.execute("UPDATE orders SET status=?,updated_at=? WHERE id=?", (body.status, now, order_id))
    try:
        await request.app.state.manager.broadcast(
            {"event": "status_update", "order_id": order_id, "status": body.status})
    except Exception:
        pass
    return {"order_id": order_id, "status": body.status}

class OrderEdit(BaseModel):
    table_id: Optional[str] = None
    waiter:   Optional[str] = None
    note:     Optional[str] = None

class ManualItem(BaseModel):
    name:        str
    destination: str   # kitchen | bar
    qty:         int
    unit_price:  float
    note:        Optional[str] = None

@router.patch("/{order_id}/edit")
def edit_order(order_id: str, body: OrderEdit, session=Depends(require_admin)):
    """Admin can edit table, waiter, note on a non-paid order."""
    now = datetime.utcnow().isoformat()
    with get_db() as db:
        row = db.execute("SELECT * FROM orders WHERE id=?", (order_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Order not found")
        if row["status"] in ("paid","void"):
            raise HTTPException(400, "Cannot edit a paid or void order")
        table_id = body.table_id or row["table_id"]
        waiter   = body.waiter   or row["waiter"]
        note     = body.note     if body.note is not None else row["note"]
        db.execute(
            "UPDATE orders SET table_id=?, waiter=?, note=?, updated_at=? WHERE id=?",
            (table_id, waiter, note, now, order_id)
        )
    return {"order_id": order_id, "table_id": table_id, "waiter": waiter}

@router.post("/{order_id}/manual-item")
def add_manual_item(order_id: str, body: ManualItem, session=Depends(require_admin)):
    """Admin can add a custom/manual item (not in menu) to an existing order."""
    if body.destination not in ("kitchen","bar"):
        raise HTTPException(400, "destination must be kitchen or bar")
    with get_db() as db:
        row = db.execute("SELECT * FROM orders WHERE id=?", (order_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Order not found")
        if row["status"] in ("paid","void"):
            raise HTTPException(400, "Cannot add items to a paid or void order")
        line_total = body.qty * body.unit_price
        db.execute("""
            INSERT INTO order_items (order_id, menu_item_id, name, destination, qty, unit_price, line_total, note)
            VALUES (?, NULL, ?, ?, ?, ?, ?, ?)
        """, (order_id, body.name, body.destination, body.qty, body.unit_price, line_total, body.note))
        # Recalculate totals
        items    = db.execute("SELECT * FROM order_items WHERE order_id=? AND voided=0", (order_id,)).fetchall()
        subtotal = sum(i["line_total"] for i in items)
        tax      = round(subtotal * 0.16, 2)
        db.execute("UPDATE orders SET subtotal=?, tax=?, total=?, updated_at=? WHERE id=?",
                   (subtotal, tax, subtotal+tax, datetime.utcnow().isoformat(), order_id))
    return {"ok": True, "order_id": order_id, "item": body.name, "line_total": line_total}

async def void_order(order_id: str, body: VoidRequest, request: Request, session=Depends(require_manager)):
    now = datetime.utcnow().isoformat()
    with get_db() as db:
        row = db.execute("SELECT * FROM orders WHERE id=?", (order_id,)).fetchone()
        if not row:
            raise HTTPException(404)
        if row["status"] == "paid":
            raise HTTPException(400, "Cannot void a paid order")
        db.execute("""
            UPDATE orders SET status='void', voided_by=?, void_reason=?, updated_at=? WHERE id=?
        """, (session["user_id"], body.reason, now, order_id))
        db.execute("UPDATE tables SET status='free' WHERE id=? AND NOT EXISTS (SELECT 1 FROM orders WHERE table_id=? AND status NOT IN ('paid','void') AND id!=?)",
                   (row["table_id"], row["table_id"], order_id))
    try:
        await request.app.state.manager.broadcast(
            {"event": "order_voided", "order_id": order_id, "by": session["name"]})
    except Exception:
        pass
    return {"order_id": order_id, "status": "void"}

@router.post("/{order_id}/void-item/{item_id}")
def void_item(order_id: str, item_id: int, session=Depends(require_manager)):
    with get_db() as db:
        row = db.execute("SELECT * FROM order_items WHERE id=? AND order_id=?", (item_id, order_id)).fetchone()
        if not row:
            raise HTTPException(404)
        db.execute("UPDATE order_items SET voided=1, voided_by=? WHERE id=?",
                   (session["user_id"], item_id))
        # Recalculate order totals
        items = db.execute(
            "SELECT * FROM order_items WHERE order_id=? AND voided=0", (order_id,)).fetchall()
        subtotal = sum(i["line_total"] for i in items)
        tax      = round(subtotal * 0.16, 2)
        db.execute("UPDATE orders SET subtotal=?,tax=?,total=? WHERE id=?",
                   (subtotal, tax, subtotal+tax, order_id))
    return {"ok": True, "item_id": item_id}
