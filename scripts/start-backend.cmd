@echo off
setlocal
set "BACKEND_DIR=%~1"
set "BACKEND_PORT=%~2"
set "BACKEND_BASE=%~3"
set "BACKEND_LOG=%~4"

cd /d "%BACKEND_DIR%"
set "GRABIX_BACKEND_PORT=%BACKEND_PORT%"
set "GRABIX_PUBLIC_BASE_URL=%BACKEND_BASE%"
"%BACKEND_DIR%\venv\Scripts\python.exe" -u "%BACKEND_DIR%\main.py" >> "%BACKEND_LOG%" 2>&1
