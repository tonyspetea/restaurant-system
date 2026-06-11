"""Menu router — items, categories; admin creates, manager toggles"""
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional
from database import get_db
from routers.auth import require_auth, require_manager, require_admin

router = APIRouter()

class CategoryIn(BaseModel):
    name: str
    destination: str   # kitchen | bar

class MenuItemIn(BaseModel):
    category_id: int
    name: str
    price: float
    cost_price: float = 0
    destination: str
    available: Optional[bool] = True

@router.get("/")
def get_menu(session=Depends(require_auth)):
    with get_db() as db:
        cats  = [dict(r) for r in db.execute("SELECT * FROM menu_categories ORDER BY id").fetchall()]
        items = [dict(r) for r in db.execute(
            "SELECT * FROM menu_items WHERE available=1 ORDER BY category_id,name").fetchall()]
    for cat in cats:
        cat["items"] = [i for i in items if i["category_id"] == cat["id"]]
    return cats

@router.get("/all")
def get_menu_all(session=Depends(require_manager)):
    with get_db() as db:
        cats  = [dict(r) for r in db.execute("SELECT * FROM menu_categories ORDER BY id").fetchall()]
        items = [dict(r) for r in db.execute("SELECT * FROM menu_items ORDER BY category_id,name").fetchall()]
    for cat in cats:
        cat["items"] = [i for i in items if i["category_id"] == cat["id"]]
    return cats

@router.get("/categories")
def list_categories(session=Depends(require_auth)):
    with get_db() as db:
        rows = db.execute("SELECT * FROM menu_categories ORDER BY id").fetchall()
    return [dict(r) for r in rows]

@router.post("/categories", status_code=201)
def create_category(body: CategoryIn, session=Depends(require_manager)):
    if body.destination not in ("kitchen","bar"):
        raise HTTPException(400,"destination must be kitchen or bar")
    with get_db() as db:
        cur = db.execute("INSERT INTO menu_categories (name,destination) VALUES (?,?)",
                         (body.name, body.destination))
    return {"id": cur.lastrowid, **body.dict()}

@router.put("/categories/{cat_id}")
def update_category(cat_id: int, body: CategoryIn, session=Depends(require_manager)):
    with get_db() as db:
        db.execute("UPDATE menu_categories SET name=?,destination=? WHERE id=?",
                   (body.name, body.destination, cat_id))
    return {"id": cat_id, **body.dict()}

@router.delete("/categories/{cat_id}")
def delete_category(cat_id: int, session=Depends(require_admin)):
    with get_db() as db:
        count = db.execute("SELECT COUNT(*) as c FROM menu_items WHERE category_id=?", (cat_id,)).fetchone()["c"]
        if count > 0:
            raise HTTPException(400, f"Cannot delete — {count} items use this category")
        db.execute("DELETE FROM menu_categories WHERE id=?", (cat_id,))
    return {"ok": True}

@router.post("/items", status_code=201)
def create_item(body: MenuItemIn, session=Depends(require_manager)):
    with get_db() as db:
        cur = db.execute("""
            INSERT INTO menu_items (category_id,name,price,cost_price,destination,available)
            VALUES (?,?,?,?,?,?)
        """, (body.category_id, body.name, body.price, body.cost_price,
              body.destination, int(body.available)))
    return {"id": cur.lastrowid, **body.dict()}

@router.put("/items/{item_id}")
def update_item(item_id: int, body: MenuItemIn, session=Depends(require_manager)):
    with get_db() as db:
        row = db.execute("SELECT id FROM menu_items WHERE id=?", (item_id,)).fetchone()
        if not row:
            raise HTTPException(404)
        db.execute("""
            UPDATE menu_items SET category_id=?,name=?,price=?,cost_price=?,destination=?,available=?
            WHERE id=?
        """, (body.category_id, body.name, body.price, body.cost_price,
              body.destination, int(body.available), item_id))
    return {"id": item_id, **body.dict()}

@router.patch("/items/{item_id}/toggle")
def toggle_item(item_id: int, session=Depends(require_manager)):
    with get_db() as db:
        row = db.execute("SELECT available FROM menu_items WHERE id=?", (item_id,)).fetchone()
        if not row:
            raise HTTPException(404)
        new_val = 0 if row["available"] else 1
        db.execute("UPDATE menu_items SET available=? WHERE id=?", (new_val, item_id))
    return {"id": item_id, "available": bool(new_val)}

@router.delete("/items/{item_id}")
def delete_item(item_id: int, session=Depends(require_admin)):
    with get_db() as db:
        db.execute("DELETE FROM menu_items WHERE id=?", (item_id,))
    return {"ok": True}
