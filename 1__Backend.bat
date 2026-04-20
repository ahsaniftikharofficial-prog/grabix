@echo off
title GRABIX Backend
color 0A
cd /d "%~dp0backend"

echo.
echo  ==========================================
echo    GRABIX Backend
echo    Running at http://127.0.0.1:8000
echo    Keep this window open.
echo  ==========================================
echo.

REM ── Kill any existing process already using port 8000 ──────────────────────
REM    This prevents [Errno 10048] "address already in use" on restart.
for /f "tokens=5" %%P in ('netstat -ano 2^>nul ^| findstr ":8000 " ^| findstr "LISTENING"') do (
    echo  [INFO] Port 8000 is in use by PID %%P - stopping it first...
    taskkill /F /PID %%P >nul 2>&1
    timeout /t 2 /nobreak >nul
    goto :port_free
)
:port_free

REM ── Choose Python executable ────────────────────────────────────────────────
if exist "%~dp0backend\venv\Scripts\python.exe" (
    set "PY=%~dp0backend\venv\Scripts\python.exe"
) else (
    set "PY=python"
    echo  [NOTE] No venv found. Using system Python.
    echo  Run this first if packages are missing:
    echo    python -m venv backend\venv
    echo    backend\venv\Scripts\pip install -r backend\requirements.txt python-multipart
    echo.
)

set "CONSUMET_API_BASE=http://127.0.0.1:3000"
set "GRABIX_BACKEND_PORT=8000"

"%PY%" -u main.py

echo.
echo  ==========================================
echo    Backend stopped. See error above.
echo  ==========================================
pause
