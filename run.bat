@echo off
setlocal
title GRABIX Launcher
color 0B

echo.
echo  ==========================================
echo    GRABIX - Starting Up
echo  ==========================================
echo.

set "ROOT=%~dp0"
set "BACKEND=%ROOT%backend"
set "FRONTEND=%ROOT%grabix-ui"
set "CONSUMET=%ROOT%consumet-local"
set "CONSUMET_PORT=3000"
set "CONSUMET_BASE=http://127.0.0.1:%CONSUMET_PORT%"

python --version >nul 2>&1
if errorlevel 1 (
    echo  [ERROR] Python not found. Install Python 3.10+ and add it to PATH.
    pause
    exit /b 1
)

node --version >nul 2>&1
if errorlevel 1 (
    echo  [ERROR] Node.js not found. Install Node.js from https://nodejs.org
    pause
    exit /b 1
)

if not exist "%BACKEND%\venv\Scripts\activate.bat" (
    echo  [SETUP] Creating Python virtual environment...
    python -m venv "%BACKEND%\venv"
)

if not exist "%BACKEND%\venv\Lib\site-packages\httpx" (
    echo  [SETUP] Installing Python packages ^(first time only^)...
    call "%BACKEND%\venv\Scripts\activate.bat"
    pip install -r "%BACKEND%\requirements.txt" python-multipart --quiet
    echo  [SETUP] Python packages installed.
)

if not exist "%FRONTEND%\node_modules" (
    echo  [SETUP] Installing frontend packages ^(first time only, takes a minute^)...
    cd /d "%FRONTEND%"
    npm.cmd install --silent
    if errorlevel 1 (
        echo  [ERROR] Frontend package install failed.
        pause
        exit /b 1
    )
    echo  [SETUP] Frontend packages installed.
)

if not exist "%CONSUMET%\node_modules" (
    echo  [SETUP] Installing local Consumet gateway packages ^(first time only, takes a minute^)...
    cd /d "%CONSUMET%"
    npm.cmd install --silent
    if errorlevel 1 (
        echo  [ERROR] Local Consumet gateway package install failed.
        pause
        exit /b 1
    )
    echo  [SETUP] Local Consumet gateway packages installed.
)

if not exist "%CONSUMET%\node_modules\aniwatch\dist\index.js" (
    echo  [SETUP] Repairing local Consumet gateway packages...
    cd /d "%CONSUMET%"
    if exist node_modules rmdir /s /q node_modules
    if exist package-lock.json del /f /q package-lock.json
    npm.cmd install --silent
    if errorlevel 1 (
        echo  [ERROR] Local Consumet gateway repair failed.
        pause
        exit /b 1
    )
)

echo  [START] Launching local Consumet gateway on %CONSUMET_BASE%
start "GRABIX Consumet" cmd /k "cd /d ""%CONSUMET%"" && set PORT=%CONSUMET_PORT% && npm.cmd start"

timeout /t 4 /nobreak >nul

echo  [START] Launching backend on http://127.0.0.1:8000
start "GRABIX Backend" cmd /k "cd /d ""%BACKEND%"" && call venv\Scripts\activate.bat && set CONSUMET_API_BASE=%CONSUMET_BASE% && uvicorn main:app --reload --port 8000"

timeout /t 3 /nobreak >nul

echo  [START] Launching frontend on http://localhost:5173
start "GRABIX Frontend" cmd /k "cd /d ""%FRONTEND%"" && npm.cmd run dev"

echo.
echo  ==========================================
echo    All services are starting!
echo.
echo    Consumet: %CONSUMET_BASE%
echo    Backend:  http://127.0.0.1:8000
echo    Frontend: http://localhost:5173
echo  ==========================================
echo.

timeout /t 3 /nobreak >nul
start http://localhost:5173

exit /b 0
