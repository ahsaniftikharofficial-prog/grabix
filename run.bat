@echo off
title GRABIX Launcher
color 0B

echo.
echo  ==========================================
echo    GRABIX - Starting Up
echo  ==========================================
echo.

:: Step 1: Find the script's own folder so it works from anywhere
set "ROOT=%~dp0"
set "BACKEND=%ROOT%backend"
set "FRONTEND=%ROOT%grabix-ui"

:: Step 2: Check Python is installed
python --version >nul 2>&1
if errorlevel 1 (
    echo  [ERROR] Python not found. Install Python 3.10+ and add it to PATH.
    pause
    exit /b 1
)

:: Step 3: Check Node is installed
node --version >nul 2>&1
if errorlevel 1 (
    echo  [ERROR] Node.js not found. Install Node.js from https://nodejs.org
    pause
    exit /b 1
)

:: Step 4: Create venv if it doesn't exist
if not exist "%BACKEND%\venv\Scripts\activate.bat" (
    echo  [SETUP] Creating Python virtual environment...
    python -m venv "%BACKEND%\venv"
)

:: Step 5: Install Python deps if needed
if not exist "%BACKEND%\venv\Lib\site-packages\fastapi" (
    echo  [SETUP] Installing Python packages ^(first time only^)...
    call "%BACKEND%\venv\Scripts\activate.bat"
    pip install fastapi uvicorn yt-dlp python-multipart --quiet
    echo  [SETUP] Python packages installed.
)

:: Step 6: Install Node deps if needed
if not exist "%FRONTEND%\node_modules" (
    echo  [SETUP] Installing Node packages ^(first time only, takes a minute^)...
    cd /d "%FRONTEND%"
    npm install --silent
    echo  [SETUP] Node packages installed.
)

:: Step 7: Start Backend in a new window
echo  [START] Launching backend on http://127.0.0.1:8000
start "GRABIX Backend" cmd /k "cd /d ""%BACKEND%"" && call venv\Scripts\activate.bat && uvicorn main:app --reload --port 8000"

:: Step 8: Wait 2 seconds for backend to start
timeout /t 2 /nobreak >nul

:: Step 9: Start Frontend in a new window
echo  [START] Launching frontend on http://localhost:5173
start "GRABIX Frontend" cmd /k "cd /d ""%FRONTEND%"" && npm run dev"

echo.
echo  ==========================================
echo    Both servers are starting!
echo.
echo    Backend:  http://127.0.0.1:8000
echo    Frontend: http://localhost:5173
echo.
echo    Open your browser and go to:
echo    http://localhost:5173
echo  ==========================================
echo.

:: Open the browser after 3 seconds
timeout /t 3 /nobreak >nul
start http://localhost:5173

exit /b 0
