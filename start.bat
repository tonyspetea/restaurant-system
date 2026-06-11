@echo off
echo.
echo   RestoPOS - Restaurant Management System
echo   ─────────────────────────────────────────────
echo.
echo   Installing dependencies...
cd /d "%~dp0backend"
pip install -r requirements.txt --quiet 2>nul
echo.
echo   Starting server on http://localhost:8000
echo   Open your browser to: http://localhost:8000
echo.
echo   For devices on your network, find your IP:
ipconfig | findstr /i "IPv4"
echo   Then open: http://YOUR-IP:8000 on any device
echo.
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
pause
