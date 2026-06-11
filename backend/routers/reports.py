"""
Reports router — sales, orders, waiters, kitchen, bar, date ranges
All reports require manager or admin role
"""
from fastapi import APIRouter, Depends, Query
from typing import Optional
from database import get_db
from routers.auth import require_manager

router = APIRouter()

def fmt_money(v): return round(float(v or 0), 2)

# ── Sales Summary ─────────────────────────────────────────────────────────────
@router.get("/sales/summary")
def sales_summary(
    date_from: Optional[str] = Query(None, description="YYYY-MM-DD"),
    date_to:   Optional[str] = Query(None, description="YYYY-MM-DD"),
    session=Depends(require_manager)
):
    where, params = _date_filter(date_from, date_to, "o.created_at")
    with get_db() as db:
        row = db.execute(f"""
            SELECT
                COUNT(*) as total_orders,
                SUM(CASE WHEN status='paid' THEN 1 ELSE 0 END) as paid_orders,
                SUM(CASE WHEN status='void' THEN 1 ELSE 0 END) as void_orders,
                SUM(CASE WHEN status='paid' THEN subtotal ELSE 0 END) as gross_sales,
                SUM(CASE WHEN status='paid' THEN tax ELSE 0 END) as total_tax,
                SUM(CASE WHEN status='paid' THEN total ELSE 0 END) as net_revenue,
                SUM(CASE WHEN status='paid' AND payment_method='cash'  THEN total ELSE 0 END) as cash_total,
                SUM(CASE WHEN status='paid' AND payment_method='mpesa' THEN total ELSE 0 END) as mpesa_total,
                SUM(CASE WHEN status='paid' AND payment_method='card'  THEN total ELSE 0 END) as card_total,
                COUNT(DISTINCT table_id) as tables_served
            FROM orders o {where}
        """, params).fetchone()
    return {k: fmt_money(v) if isinstance(v, float) else (v or 0)
            for k, v in dict(row).items()}

# ── Sales by Day ──────────────────────────────────────────────────────────────
@router.get("/sales/by-day")
def sales_by_day(
    date_from: Optional[str] = Query(None),
    date_to:   Optional[str] = Query(None),
    session=Depends(require_manager)
):
    where, params = _date_filter(date_from, date_to, "created_at")
    with get_db() as db:
        rows = db.execute(f"""
            SELECT
                DATE(created_at) as day,
                COUNT(*) as orders,
                SUM(CASE WHEN status='paid' THEN total ELSE 0 END) as revenue,
                SUM(CASE WHEN status='paid' THEN tax   ELSE 0 END) as tax
            FROM orders {where}
            GROUP BY DATE(created_at)
            ORDER BY day DESC LIMIT 90
        """, params).fetchall()
    return [dict(r) for r in rows]

# ── Sales by Month ────────────────────────────────────────────────────────────
@router.get("/sales/by-month")
def sales_by_month(year: Optional[int] = None, session=Depends(require_manager)):
    params = []
    where  = ""
    if year:
        where  = "WHERE strftime('%Y', created_at) = ?"
        params = [str(year)]
    with get_db() as db:
        rows = db.execute(f"""
            SELECT
                strftime('%Y-%m', created_at) as month,
                COUNT(*) as orders,
                SUM(CASE WHEN status='paid' THEN total ELSE 0 END) as revenue,
                SUM(CASE WHEN status='paid' THEN tax   ELSE 0 END) as tax
            FROM orders {where}
            GROUP BY strftime('%Y-%m', created_at)
            ORDER BY month DESC LIMIT 24
        """, params).fetchall()
    return [dict(r) for r in rows]

# ── Sales by Year ─────────────────────────────────────────────────────────────
@router.get("/sales/by-year")
def sales_by_year(session=Depends(require_manager)):
    with get_db() as db:
        rows = db.execute("""
            SELECT
                strftime('%Y', created_at) as year,
                COUNT(*) as orders,
                SUM(CASE WHEN status='paid' THEN total ELSE 0 END) as revenue,
                SUM(CASE WHEN status='paid' THEN tax   ELSE 0 END) as tax
            FROM orders
            GROUP BY strftime('%Y', created_at)
            ORDER BY year DESC
        """).fetchall()
    return [dict(r) for r in rows]

# ── Orders Report ─────────────────────────────────────────────────────────────
@router.get("/orders")
def orders_report(
    status:    Optional[str] = Query(None),
    date_from: Optional[str] = Query(None),
    date_to:   Optional[str] = Query(None),
    session=Depends(require_manager)
):
    where, params = _date_filter(date_from, date_to, "o.created_at")
    if status:
        where  += (" AND " if where else "WHERE ") + "o.status=?"
        params.append(status)
    with get_db() as db:
        rows = db.execute(f"""
            SELECT o.*, u.name as waiter_name
            FROM orders o
            LEFT JOIN users u ON o.waiter_id = u.id
            {where}
            ORDER BY o.created_at DESC LIMIT 500
        """, params).fetchall()
        result = []
        for r in rows:
            order = dict(r)
            order["items"] = [dict(i) for i in db.execute(
                "SELECT * FROM order_items WHERE order_id=?", (order["id"],)).fetchall()]
            result.append(order)
    return result

# ── Waiter Performance ────────────────────────────────────────────────────────
@router.get("/waiters")
def waiter_report(
    date_from: Optional[str] = Query(None),
    date_to:   Optional[str] = Query(None),
    session=Depends(require_manager)
):
    where, params = _date_filter(date_from, date_to, "o.created_at")
    with get_db() as db:
        rows = db.execute(f"""
            SELECT
                o.waiter,
                o.waiter_id,
                u.name as user_name,
                COUNT(*) as total_orders,
                SUM(CASE WHEN o.status='paid' THEN 1 ELSE 0 END) as paid_orders,
                SUM(CASE WHEN o.status='void' THEN 1 ELSE 0 END) as void_orders,
                SUM(CASE WHEN o.status='paid' THEN o.total ELSE 0 END) as total_sales,
                AVG(CASE WHEN o.status='paid' THEN o.total END) as avg_order_value
            FROM orders o
            LEFT JOIN users u ON o.waiter_id = u.id
            {where}
            GROUP BY o.waiter_id, o.waiter
            ORDER BY total_sales DESC
        """, params).fetchall()
    return [dict(r) for r in rows]

# ── Kitchen Orders ────────────────────────────────────────────────────────────
@router.get("/kitchen")
def kitchen_report(
    date_from: Optional[str] = Query(None),
    date_to:   Optional[str] = Query(None),
    session=Depends(require_manager)
):
    return _destination_report("kitchen", date_from, date_to)

# ── Bar Orders ────────────────────────────────────────────────────────────────
@router.get("/bar")
def bar_report(
    date_from: Optional[str] = Query(None),
    date_to:   Optional[str] = Query(None),
    session=Depends(require_manager)
):
    return _destination_report("bar", date_from, date_to)

# ── Top Items ─────────────────────────────────────────────────────────────────
@router.get("/top-items")
def top_items(
    destination: Optional[str] = Query(None),
    date_from:   Optional[str] = Query(None),
    date_to:     Optional[str] = Query(None),
    limit: int = 10,
    session=Depends(require_manager)
):
    where, params = _date_filter(date_from, date_to, "o.created_at")
    dest_clause = ""
    if destination:
        dest_clause = (" AND " if where else "WHERE ") + "oi.destination=?"
        params.append(destination)
    with get_db() as db:
        rows = db.execute(f"""
            SELECT
                oi.name,
                oi.destination,
                SUM(oi.qty) as qty_sold,
                SUM(oi.line_total) as revenue
            FROM order_items oi
            JOIN orders o ON oi.order_id = o.id
            {where}{dest_clause}
            AND o.status='paid'
            GROUP BY oi.name, oi.destination
            ORDER BY qty_sold DESC
            LIMIT ?
        """, params + [limit]).fetchall()
    return [dict(r) for r in rows]

# ── Payment Methods ───────────────────────────────────────────────────────────
@router.get("/payments")
def payment_report(
    date_from: Optional[str] = Query(None),
    date_to:   Optional[str] = Query(None),
    session=Depends(require_manager)
):
    where, params = _date_filter(date_from, date_to, "created_at")
    with get_db() as db:
        rows = db.execute(f"""
            SELECT
                payment_method,
                COUNT(*) as count,
                SUM(total) as total
            FROM orders
            {where}
            {"AND" if where else "WHERE"} status='paid'
            AND payment_method IS NOT NULL
            GROUP BY payment_method
        """, params).fetchall()
    return [dict(r) for r in rows]

# ── Void Report ───────────────────────────────────────────────────────────────
@router.get("/voids")
def void_report(
    date_from: Optional[str] = Query(None),
    date_to:   Optional[str] = Query(None),
    session=Depends(require_manager)
):
    where, params = _date_filter(date_from, date_to, "o.created_at")
    with get_db() as db:
        rows = db.execute(f"""
            SELECT o.*, u.name as voided_by_name
            FROM orders o
            LEFT JOIN users u ON o.voided_by = u.id
            {where}
            {"AND" if where else "WHERE"} o.status='void'
            ORDER BY o.created_at DESC LIMIT 200
        """, params).fetchall()
    return [dict(r) for r in rows]

# ── Inventory Valuation ───────────────────────────────────────────────────────
@router.get("/inventory")
def inventory_report(session=Depends(require_manager)):
    with get_db() as db:
        rows = db.execute("""
            SELECT *, (qty_in_stock * cost_per_unit) as stock_value,
            (qty_in_stock <= reorder_level) as low_stock
            FROM inventory ORDER BY category, name
        """).fetchall()
        total = db.execute(
            "SELECT SUM(qty_in_stock * cost_per_unit) as val FROM inventory"
        ).fetchone()["val"] or 0
    return {
        "items": [dict(r) for r in rows],
        "total_stock_value": round(float(total), 2)
    }

# ── Helpers ───────────────────────────────────────────────────────────────────
def _date_filter(date_from, date_to, col):
    clauses, params = [], []
    if date_from:
        clauses.append(f"DATE({col}) >= ?")
        params.append(date_from)
    if date_to:
        clauses.append(f"DATE({col}) <= ?")
        params.append(date_to)
    where = ("WHERE " + " AND ".join(clauses)) if clauses else ""
    return where, params

def _destination_report(dest, date_from, date_to):
    where, params = _date_filter(date_from, date_to, "o.created_at")
    with get_db() as db:
        summary = db.execute(f"""
            SELECT
                COUNT(DISTINCT o.id) as total_orders,
                SUM(oi.qty) as total_items,
                SUM(oi.line_total) as total_revenue
            FROM order_items oi
            JOIN orders o ON oi.order_id = o.id
            {where}
            {"AND" if where else "WHERE"} oi.destination=? AND o.status='paid'
        """, params + [dest]).fetchone()

        items = db.execute(f"""
            SELECT oi.name, SUM(oi.qty) as qty, SUM(oi.line_total) as revenue
            FROM order_items oi JOIN orders o ON oi.order_id=o.id
            {where}
            {"AND" if where else "WHERE"} oi.destination=? AND o.status='paid'
            GROUP BY oi.name ORDER BY qty DESC
        """, params + [dest]).fetchall()
    return {
        "destination": dest,
        "summary": dict(summary),
        "items": [dict(r) for r in items]
    }
