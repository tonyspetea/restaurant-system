"""Receipts router"""
from fastapi import APIRouter, HTTPException, Depends
from database import get_db
from datetime import datetime
from routers.auth import require_auth

router = APIRouter()

def build_receipt(order, items, receipt_type):
    now  = datetime.utcnow().strftime("%d %b %Y  %H:%M")
    base = {"receipt_type": receipt_type, "order_id": order["id"],
            "table_id": order["table_id"], "waiter": order.get("waiter","Staff"),
            "printed_at": now, "created_at": order["created_at"]}

    active_items = [i for i in items if not i.get("voided")]

    if receipt_type == "kitchen":
        return {**base, "title": "KITCHEN TICKET",
                "subtitle": "Priority Print — Do Not Give to Customer",
                "destination": "kitchen",
                "items": [i for i in active_items if i["destination"] == "kitchen"]}
    if receipt_type == "bar":
        return {**base, "title": "BAR TICKET",
                "subtitle": "Beverages — Do Not Give to Customer",
                "destination": "bar",
                "items": [i for i in active_items if i["destination"] == "bar"]}
    if receipt_type == "customer":
        return {**base, "title": "ORDER RECEIPT",
                "subtitle": "Thank you for dining with us",
                "items": active_items,
                "subtotal": order["subtotal"], "tax": order["tax"],
                "total": order["total"], "payment_status": "Unpaid"}
    if receipt_type == "invoice":
        return {**base, "title": "TAX INVOICE",
                "subtitle": "Official Receipt — KRA ETR",
                "items": active_items,
                "subtotal": order["subtotal"], "tax": order["tax"],
                "total": order["total"],
                "payment_method": order.get("payment_method","—"),
                "mpesa_ref": order.get("mpesa_ref",""),
                "payment_status": "PAID",
                "kra_etr": f"ETR-{order['id']}-KE"}
    raise HTTPException(400, "Unknown receipt type")

@router.get("/{order_id}/{receipt_type}")
def get_receipt(order_id: str, receipt_type: str, session=Depends(require_auth)):
    if receipt_type not in ("kitchen","bar","customer","invoice"):
        raise HTTPException(400)
    with get_db() as db:
        row = db.execute("SELECT * FROM orders WHERE id=?", (order_id,)).fetchone()
        if not row:
            raise HTTPException(404)
        items = [dict(r) for r in db.execute(
            "SELECT * FROM order_items WHERE order_id=?", (order_id,)).fetchall()]
    return build_receipt(dict(row), items, receipt_type)
