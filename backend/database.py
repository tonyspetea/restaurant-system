"""
Database — SQLite WAL mode, offline-first
Includes: users/roles, inventory, reports support
"""
import sqlite3, hashlib
from pathlib import Path
from contextlib import contextmanager

DB_PATH = Path(__file__).parent / "restopos.db"

def get_connection():
    conn = sqlite3.connect(str(DB_PATH), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn

@contextmanager
def get_db():
    conn = get_connection()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

def hash_pin(pin: str) -> str:
    return hashlib.sha256(pin.encode()).hexdigest()

def init_db():
    with get_db() as db:
        db.executescript("""
            -- ── USERS & ROLES ──────────────────────────────────────────────
            CREATE TABLE IF NOT EXISTS users (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                name        TEXT NOT NULL,
                pin_hash    TEXT NOT NULL,
                role        TEXT NOT NULL DEFAULT 'waiter', -- waiter | manager | admin
                active      INTEGER DEFAULT 1,
                created_at  TEXT DEFAULT (datetime('now')),
                updated_at  TEXT DEFAULT (datetime('now'))
            );

            -- ── TABLES ─────────────────────────────────────────────────────
            CREATE TABLE IF NOT EXISTS tables (
                id          TEXT PRIMARY KEY,
                name        TEXT NOT NULL,
                capacity    INTEGER DEFAULT 4,
                status      TEXT DEFAULT 'free',
                created_at  TEXT DEFAULT (datetime('now'))
            );

            -- ── MENU ───────────────────────────────────────────────────────
            CREATE TABLE IF NOT EXISTS menu_categories (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                name        TEXT NOT NULL,
                destination TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS menu_items (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                category_id INTEGER REFERENCES menu_categories(id),
                name        TEXT NOT NULL,
                price       REAL NOT NULL,
                cost_price  REAL DEFAULT 0,
                destination TEXT NOT NULL,
                available   INTEGER DEFAULT 1,
                created_at  TEXT DEFAULT (datetime('now'))
            );

            -- ── INVENTORY ──────────────────────────────────────────────────
            CREATE TABLE IF NOT EXISTS inventory (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                name        TEXT NOT NULL,
                unit        TEXT DEFAULT 'pcs',
                qty_in_stock REAL DEFAULT 0,
                reorder_level REAL DEFAULT 5,
                cost_per_unit REAL DEFAULT 0,
                category    TEXT DEFAULT 'general',
                created_at  TEXT DEFAULT (datetime('now')),
                updated_at  TEXT DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS inventory_log (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                item_id     INTEGER REFERENCES inventory(id),
                action      TEXT NOT NULL,  -- restock | deduct | adjustment
                qty         REAL NOT NULL,
                note        TEXT,
                user_id     INTEGER REFERENCES users(id),
                created_at  TEXT DEFAULT (datetime('now'))
            );

            -- ── ORDERS ─────────────────────────────────────────────────────
            CREATE TABLE IF NOT EXISTS orders (
                id          TEXT PRIMARY KEY,
                table_id    TEXT REFERENCES tables(id),
                waiter      TEXT DEFAULT 'Staff',
                waiter_id   INTEGER REFERENCES users(id),
                status      TEXT DEFAULT 'pending',
                note        TEXT,
                subtotal    REAL DEFAULT 0,
                tax         REAL DEFAULT 0,
                total       REAL DEFAULT 0,
                payment_method TEXT,
                mpesa_ref   TEXT,
                voided_by   INTEGER REFERENCES users(id),
                void_reason TEXT,
                synced      INTEGER DEFAULT 1,
                created_at  TEXT DEFAULT (datetime('now')),
                updated_at  TEXT DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS order_items (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                order_id    TEXT REFERENCES orders(id),
                menu_item_id INTEGER REFERENCES menu_items(id),
                name        TEXT NOT NULL,
                destination TEXT NOT NULL,
                qty         INTEGER NOT NULL,
                unit_price  REAL NOT NULL,
                line_total  REAL NOT NULL,
                note        TEXT,
                voided      INTEGER DEFAULT 0,
                voided_by   INTEGER REFERENCES users(id)
            );

            CREATE TABLE IF NOT EXISTS offline_queue (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                action      TEXT NOT NULL,
                payload     TEXT NOT NULL,
                created_at  TEXT DEFAULT (datetime('now'))
            );
        """)

        # ── Seed default users ──────────────────────────────────────────────
        existing = db.execute("SELECT COUNT(*) as c FROM users").fetchone()["c"]
        if existing == 0:
            import hashlib
            def hp(p): return hashlib.sha256(p.encode()).hexdigest()
            db.executemany(
                "INSERT INTO users (name, pin_hash, role) VALUES (?,?,?)",
                [
                    ("Administrator", hp("0000"), "admin"),
                    ("Manager",       hp("1111"), "manager"),
                    ("Waiter One",    hp("2222"), "waiter"),
                    ("Waiter Two",    hp("3333"), "waiter"),
                ]
            )

        # ── Seed tables ─────────────────────────────────────────────────────
        db.executemany(
            "INSERT OR IGNORE INTO tables (id, name, capacity) VALUES (?,?,?)",
            [('T1','Table 1',4),('T2','Table 2',4),('T3','Table 3',2),
             ('T4','Table 4',6),('T5','Table 5',4),('T6','Table 6',2),
             ('T7','Table 7',8),('T8','Table 8',4),('BAR','Bar Counter',1)]
        )

        # ── Seed categories ─────────────────────────────────────────────────
        db.executemany(
            "INSERT OR IGNORE INTO menu_categories (id, name, destination) VALUES (?,?,?)",
            [(1,'Beverages','bar'),(2,'Cocktails & Spirits','bar'),
             (3,'Main Meals','kitchen'),(4,'Grills & BBQ','kitchen'),
             (5,'Sides & Snacks','kitchen')]
        )

        # ── Seed menu items ─────────────────────────────────────────────────
        db.executemany(
            "INSERT OR IGNORE INTO menu_items (id,category_id,name,price,cost_price,destination) VALUES (?,?,?,?,?,?)",
            [
                (1,1,'Tusker Lager',350,180,'bar'),
                (2,1,'White Cap',300,160,'bar'),
                (3,1,'Soda (500ml)',120,50,'bar'),
                (4,1,'Juice - Mango',200,80,'bar'),
                (5,1,'Mineral Water 750ml',80,30,'bar'),
                (6,2,'Dawa Cocktail',650,200,'bar'),
                (7,2,'House Wine (glass)',800,300,'bar'),
                (8,2,'Dawa Special',950,280,'bar'),
                (9,3,'Ugali & Sukuma Wiki',350,100,'kitchen'),
                (10,3,'Pilau Rice',450,150,'kitchen'),
                (11,3,'Beef Stew',550,200,'kitchen'),
                (12,3,'Chicken Curry',750,280,'kitchen'),
                (13,4,'Nyama Choma (500g)',1200,500,'kitchen'),
                (14,4,'Grilled Tilapia',950,400,'kitchen'),
                (15,4,'Mixed Grill Platter',1800,700,'kitchen'),
                (16,5,'Chips (Fries)',280,80,'kitchen'),
                (17,5,'Kachumbari',150,40,'kitchen'),
                (18,5,'Beef Burger',750,280,'kitchen'),
            ]
        )

        # ── Seed sample inventory ───────────────────────────────────────────
        inv_existing = db.execute("SELECT COUNT(*) as c FROM inventory").fetchone()["c"]
        if inv_existing == 0:
            db.executemany(
                "INSERT INTO inventory (name,unit,qty_in_stock,reorder_level,cost_per_unit,category) VALUES (?,?,?,?,?,?)",
                [
                    ('Tusker Lager','bottles',48,12,180,'bar'),
                    ('White Cap','bottles',36,12,160,'bar'),
                    ('Soda 500ml','bottles',60,20,50,'bar'),
                    ('Mango Juice','litres',10,5,80,'bar'),
                    ('Mineral Water','bottles',48,12,30,'bar'),
                    ('Beef (kg)','kg',15,5,600,'kitchen'),
                    ('Chicken (kg)','kg',10,4,500,'kitchen'),
                    ('Tilapia (kg)','kg',8,3,450,'kitchen'),
                    ('Ugali Flour','kg',25,10,60,'kitchen'),
                    ('Cooking Oil','litres',5,2,200,'kitchen'),
                    ('Chips/Fries (kg)','kg',20,5,80,'kitchen'),
                    ('Tomatoes','kg',8,3,100,'kitchen'),
                ]
            )
