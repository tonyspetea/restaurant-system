#!/usr/bin/env bash
# start.sh — Start the RestoPOS server
# Usage: bash start.sh [host] [port]
HOST=${1:-0.0.0.0}
PORT=${2:-8000}

echo ""
echo "  🍽  RestoPOS — Restaurant Management System"
echo "  ─────────────────────────────────────────────"
echo "  Server : http://$HOST:$PORT"
echo "  Local  : http://localhost:$PORT"
echo ""
echo "  Access on any device on your Wi-Fi network:"
LOCAL_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || ipconfig getifaddr en0 2>/dev/null)
echo "  → http://$LOCAL_IP:$PORT"
echo ""
echo "  Press Ctrl+C to stop"
echo ""

cd "$(dirname "$0")/backend"
pip install -r requirements.txt --quiet --break-system-packages 2>/dev/null || true
uvicorn main:app --host "$HOST" --port "$PORT" --reload
