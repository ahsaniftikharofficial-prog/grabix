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

REM Use the venv Python if it exists, otherwise fall back to system Python
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
