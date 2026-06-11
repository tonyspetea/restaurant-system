"""Offline sync router — flush queued actions when back online"""
from fastapi import APIRouter
from pydantic import BaseModel
from typing import Any
from database import get_db
import json

router = APIRouter()

class QueuedAction(BaseModel):
    action: str
    payload: Any

class SyncBatch(BaseModel):
    actions: list[QueuedAction]

@router.post("/push")
def sync_push(batch: SyncBatch):
    """Accept a batch of offline-queued actions and apply them."""
    results = []
    with get_db() as db:
        for action in batch.actions:
            payload = action.payload if isinstance(action.payload, dict) else json.loads(action.payload)
            try:
                if action.action == "create_order":
                    db.execute(
                        "INSERT OR IGNORE INTO orders (id,table_id,waiter,note,subtotal,tax,total,status,synced,created_at,updated_at) VALUES (?,?,?,?,?,?,?,'pending',1,?,?)",
                        (payload["id"], payload["table_id"], payload.get("waiter","Staff"),
                         payload.get("note"), payload["subtotal"], payload["tax"], payload["total"],
                         payload["created_at"], payload["created_at"])
                    )
                    for item in payload.get("items", []):
                        db.execute(
                            "INSERT OR IGNORE INTO order_items (order_id,menu_item_id,name,destination,qty,unit_price,line_total) VALUES (?,?,?,?,?,?,?)",
                            (payload["id"], item["menu_item_id"], item["name"], item["destination"],
                             item["qty"], item["unit_price"], item["line_total"])
                        )
                    results.append({"action": action.action, "id": payload["id"], "ok": True})

                elif action.action == "update_status":
                    db.execute("UPDATE orders SET status=? WHERE id=?",
                               (payload["status"], payload["order_id"]))
                    results.append({"action": action.action, "id": payload["order_id"], "ok": True})

                elif action.action == "mark_paid":
                    db.execute("UPDATE orders SET status='paid', payment_method=?, mpesa_ref=? WHERE id=?",
                               (payload.get("payment_method"), payload.get("mpesa_ref"), payload["order_id"]))
                    results.append({"action": action.action, "id": payload["order_id"], "ok": True})

            except Exception as e:
                results.append({"action": action.action, "error": str(e), "ok": False})

    return {"synced": len([r for r in results if r["ok"]]), "results": results}

@router.get("/status")
def sync_status():
    with get_db() as db:
        queued = db.execute("SELECT COUNT(*) as c FROM offline_queue").fetchone()["c"]
    return {"queued_actions": queued, "server": "online"}
