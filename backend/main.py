"""RestoPOS — FastAPI Backend"""
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from contextlib import asynccontextmanager
import json
from pathlib import Path
from database import init_db
from routers import orders, menu, tables, receipts, payments, sync, auth, users, inventory, reports

@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield

app = FastAPI(title="RestoPOS API", version="2.0.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

app.include_router(auth.router,      prefix="/api/auth",      tags=["Auth"])
app.include_router(users.router,     prefix="/api/users",     tags=["Users"])
app.include_router(orders.router,    prefix="/api/orders",    tags=["Orders"])
app.include_router(menu.router,      prefix="/api/menu",      tags=["Menu"])
app.include_router(tables.router,    prefix="/api/tables",    tags=["Tables"])
app.include_router(receipts.router,  prefix="/api/receipts",  tags=["Receipts"])
app.include_router(payments.router,  prefix="/api/payments",  tags=["Payments"])
app.include_router(inventory.router, prefix="/api/inventory", tags=["Inventory"])
app.include_router(reports.router,   prefix="/api/reports",   tags=["Reports"])
app.include_router(sync.router,      prefix="/api/sync",      tags=["Sync"])

class ConnectionManager:
    def __init__(self):
        self.active: list[WebSocket] = []
    async def connect(self, ws: WebSocket):
        await ws.accept()
        self.active.append(ws)
    def disconnect(self, ws: WebSocket):
        if ws in self.active: self.active.remove(ws)
    async def broadcast(self, msg: dict):
        dead = []
        for ws in self.active:
            try:
                await ws.send_text(json.dumps(msg))
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws)

manager = ConnectionManager()

@app.websocket("/ws")
async def ws_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            await manager.broadcast(json.loads(data))
    except WebSocketDisconnect:
        manager.disconnect(websocket)

app.state.manager = manager

frontend = Path(__file__).parent.parent / "frontend"
app.mount("/static", StaticFiles(directory=str(frontend / "static")), name="static")

@app.get("/")
@app.get("/{full_path:path}")
async def spa(full_path: str = ""):
    index = frontend / "index.html"
    if index.exists():
        return FileResponse(str(index))
    return {"message": "RestoPOS API v2"}

@app.get("/api/health")
def health():
    from datetime import datetime
    return {"status": "ok", "version": "2.0", "time": datetime.utcnow().isoformat()}
