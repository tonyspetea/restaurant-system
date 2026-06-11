# 🍽 RestoPOS — Restaurant Management System

A full offline-first restaurant POS with dual kitchen/bar routing, PWA mobile support, receipt printing, and M-Pesa payment integration.

---

## Features

| Feature | Details |
|---|---|
| **Dual routing** | Orders auto-split — meals → Kitchen ticket, beverages → Bar ticket |
| **4 receipt types** | Kitchen ticket, Bar ticket, Customer bill, Tax invoice |
| **Offline-first** | Works with no internet — orders queue locally (IndexedDB), sync when back online |
| **PWA** | Install on any phone/tablet like a native app |
| **Real-time** | WebSocket push to Kitchen Display (KDS) and Bar Display |
| **Tables** | Visual floor plan, auto-marks occupied/free |
| **Payments** | Cash, M-Pesa, Card — M-Pesa ref recorded on invoice |
| **Menu manager** | Add items, toggle availability, assign kitchen/bar |
| **Tax** | 16% VAT (Kenya), KRA ETR serial on invoice |

---

## Quick Start

### Requirements
- Python 3.10+
- pip

### Run (Linux / Mac)
```bash
bash start.sh
```

### Run (Windows)
```
Double-click start.bat
```
Or from PowerShell:
```powershell
cd backend
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

Open **http://localhost:8000** in your browser.

---

## Network Setup (Multi-Device)

To connect phones and tablets as waiter ordering devices:

1. Connect all devices to the **same Wi-Fi network**
2. Find your server machine's local IP:
   - Windows: `ipconfig` → look for IPv4 Address (e.g. `192.168.1.5`)
   - Linux/Mac: `hostname -I`
3. On each device, open: **http://192.168.1.5:8000**
4. In Settings on each device, set **API Base URL** to `http://192.168.1.5:8000`
5. Optionally install as PWA: tap browser menu → "Add to Home Screen"

---

## Project Structure

```
restoPOS/
├── backend/
│   ├── main.py            # FastAPI app + WebSocket
│   ├── database.py        # SQLite setup + seed data
│   ├── requirements.txt
│   └── routers/
│       ├── orders.py      # Order CRUD + WebSocket broadcast
│       ├── menu.py        # Menu items + categories
│       ├── tables.py      # Table status
│       ├── receipts.py    # Receipt generation (4 types)
│       ├── payments.py    # Payment recording
│       └── sync.py        # Offline queue sync
├── frontend/
│   ├── index.html         # SPA shell
│   └── static/
│       ├── css/app.css    # Full design system
│       ├── js/
│       │   ├── db.js      # IndexedDB wrapper
│       │   ├── api.js     # REST client (offline-aware)
│       │   ├── receipt.js # Receipt HTML renderer + print
│       │   └── app.js     # Main application controller
│       ├── sw.js          # Service Worker (PWA offline)
│       ├── manifest.json  # PWA manifest
│       └── icons/         # App icons
├── start.sh               # Linux/Mac startup
└── start.bat              # Windows startup
```

---

## API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/menu/` | Full menu with categories |
| POST | `/api/orders/` | Create order (routes to kitchen/bar) |
| GET | `/api/orders/` | List orders (filter by status/table) |
| PATCH | `/api/orders/{id}/status` | Update order status |
| GET | `/api/receipts/{id}/{type}` | Get receipt data (kitchen/bar/customer/invoice) |
| POST | `/api/payments/{id}` | Record payment |
| POST | `/api/sync/push` | Flush offline queue |
| WS | `/ws` | WebSocket for real-time KDS updates |

---

## Receipt Types

### Kitchen Ticket
- Sent to kitchen printer when order is placed
- Shows only kitchen items (meals)
- Large bold text — easy to read across the kitchen

### Bar Ticket
- Sent to bar printer simultaneously
- Shows only beverages
- Same large format

### Customer Bill
- Itemised bill with subtotal, 16% VAT, total
- M-Pesa Paybill number shown for self-pay
- Printed before payment

### Tax Invoice
- Post-payment receipt
- Includes payment method, M-Pesa reference
- KRA ETR serial number
- Official tax document

---

## Offline Mode

When the device loses internet connection:
- The status bar shows **"Offline — queueing orders"**
- New orders are saved to **IndexedDB** on the device
- When connection restores, tap **↑ Sync** in the sidebar or go to Settings → Sync Now
- All queued actions are pushed to the server in one batch

---

## Printer Setup

RestoPOS uses **ESC/POS over TCP (port 9100)** for network thermal printers.

| Printer | Default IP | Setting |
|---|---|---|
| Kitchen | 192.168.1.10 | Settings → Kitchen Printer IP |
| Bar | 192.168.1.11 | Settings → Bar Printer IP |

For browser-based printing (no ESC/POS hardware), use the **Print Receipt** button which opens a formatted print window optimised for 80mm thermal paper.

---

## M-Pesa Integration

The system records M-Pesa references on invoices. To enable full STK Push:
1. Get Daraja API credentials from [developer.safaricom.co.ke](https://developer.safaricom.co.ke)
2. Add your Consumer Key, Secret, and Paybill in `backend/routers/payments.py`
3. Set your Paybill number in Settings

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Python · FastAPI · SQLite (WAL mode) |
| Frontend | Vanilla JS · IndexedDB · Service Worker |
| Real-time | WebSocket (built into FastAPI) |
| PWA | Web App Manifest + Service Worker |
| Printing | Browser print API / ESC/POS TCP |
| Payments | M-Pesa Daraja API (STK Push ready) |

---

## Development

```bash
# Run with auto-reload
cd backend
uvicorn main:app --reload --port 8000

# API docs (auto-generated)
open http://localhost:8000/docs
```

The FastAPI `/docs` page gives you an interactive API explorer for all endpoints.
