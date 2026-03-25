@echo off
title GRABIX Launcher
color 0A

echo.
echo  ╔══════════════════════════════════╗
echo  ║        GRABIX — Starting...      ║
echo  ╚══════════════════════════════════╝
echo.

:: Check if Node.js is installed
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo  [ERROR] Node.js is not installed.
    echo  Please install it from: https://nodejs.org
    echo.
    pause
    exit /b 1
)

:: Go to the grabix-ui folder (same folder as this .cmd file)
cd /d "%~dp0grabix-ui"

:: Install dependencies if node_modules doesn't exist
if not exist "node_modules" (
    echo  [SETUP] Installing dependencies for the first time...
    echo  This only happens once. Please wait...
    echo.
    call npm install
    echo.
)

:: Start the app
echo  [LAUNCH] Starting GRABIX UI...
echo  Opening in your browser at http://localhost:5173
echo.
echo  Press Ctrl+C to stop the app.
echo.

start "" "http://localhost:5173"
call npm run dev

pause
