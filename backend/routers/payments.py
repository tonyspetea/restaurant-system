"""Payments router"""
from fastapi import APIRouter, HTTPException, Request, Depends
from pydantic import BaseModel
from typing import Optional
from datetime import datetime
from database import get_db
from routers.auth import require_auth

router = APIRouter()

class PaymentIn(BaseModel):
    payment_method: str
    mpesa_ref: Optional[str] = None
    amount_paid: Optional[float] = None

@router.post("/{order_id}")
async def record_payment(order_id: str, body: PaymentIn, request: Request, session=Depends(require_auth)):
    now = datetime.utcnow().isoformat()
    with get_db() as db:
        row = db.execute("SELECT * FROM orders WHERE id=?", (order_id,)).fetchone()
        if not row:
            raise HTTPException(404)
        if row["status"] == "paid":
            raise HTTPException(400, "Already paid")
        db.execute("""
            UPDATE orders SET status='paid', payment_method=?, mpesa_ref=?, updated_at=? WHERE id=?
        """, (body.payment_method, body.mpesa_ref, now, order_id))
        table_id = row["table_id"]
        active = db.execute(
            "SELECT COUNT(*) as c FROM orders WHERE table_id=? AND status NOT IN ('paid','void')",
            (table_id,)).fetchone()["c"]
        if active == 0:
            db.execute("UPDATE tables SET status='free' WHERE id=?", (table_id,))
    try:
        await request.app.state.manager.broadcast(
            {"event": "order_paid", "order_id": order_id, "method": body.payment_method})
    except Exception:
        pass
    return {"order_id": order_id, "status": "paid", "method": body.payment_method}
