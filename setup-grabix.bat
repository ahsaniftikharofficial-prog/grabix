@echo off
setlocal EnableDelayedExpansion
cd /d "%~dp0"

echo.
echo ==========================================
echo   GRABIX First-Time Setup
echo   Run this ONCE before using build-fast.bat
echo ==========================================
echo.
echo  This will:
echo   1. Download Python 3.11 and install backend packages
echo   2. Install consumet-local npm packages
echo   3. Install grabix-ui npm packages
echo.
echo  Internet connection required. Takes 5-15 minutes.
echo.
pause

:: ── Paths ──────────────────────────────────────────────────────────────────
set "ROOT=%~dp0"
set "FRONTEND=%ROOT%grabix-ui"
set "CONSUMET=%ROOT%consumet-local"
set "PYTHON_EXE=%ROOT%grabix-ui\src-tauri\python-runtime\python.exe"
set "SETUP_PS1=%ROOT%scripts\setup-python-runtime.ps1"

:: ── Check tools ────────────────────────────────────────────────────────────
echo Checking required tools...

where npm >nul 2>&1
if errorlevel 1 (
    echo.
    echo  ERROR: npm not found.
    echo  Install Node.js from https://nodejs.org then re-run this script.
    echo.
    pause & exit /b 1
)

where cargo >nul 2>&1
if errorlevel 1 (
    echo.
    echo  ERROR: cargo not found.
    echo  Install Rust from https://rustup.rs then re-run this script.
    echo.
    pause & exit /b 1
)

if not exist "%SETUP_PS1%" (
    echo.
    echo  ERROR: scripts\setup-python-runtime.ps1 not found.
    echo  Make sure you are running this from the GRABIX project root folder.
    echo.
    pause & exit /b 1
)

echo  OK - Node.js, npm, and Rust found.
echo.

:: ══════════════════════════════════════════════════════════════════
echo ══════════════════════════════════════════════════════════════
echo  STEP 1 of 3 — Python Runtime Setup
echo ══════════════════════════════════════════════════════════════
echo.

if exist "%PYTHON_EXE%" (
    echo  python-runtime already exists — skipping download.
    echo  Delete grabix-ui\src-tauri\python-runtime\ to force a fresh setup.
    echo.
) else (
    echo  Downloading Python 3.11 and installing backend packages...
    echo  ^(This downloads ~30MB and installs fastapi, uvicorn, yt-dlp, etc.^)
    echo.

    powershell -ExecutionPolicy Bypass -File "%SETUP_PS1%"
    if errorlevel 1 (
        echo.
        echo  ERROR: Python setup failed. See messages above.
        echo  Common fix: check your internet connection and retry.
        echo.
        pause & exit /b 1
    )
)

if not exist "%PYTHON_EXE%" (
    echo.
    echo  ERROR: python.exe still not found after setup.
    echo  Check scripts\setup-python-runtime.ps1 output above.
    echo.
    pause & exit /b 1
)

echo  Python runtime ready.
echo.

:: ══════════════════════════════════════════════════════════════════
echo ══════════════════════════════════════════════════════════════
echo  STEP 2 of 3 — Consumet (HiAnime gateway) npm packages
echo ══════════════════════════════════════════════════════════════
echo.

if exist "%CONSUMET%\node_modules" (
    echo  consumet-local\node_modules already exists — skipping.
    echo  Delete consumet-local\node_modules\ to force reinstall.
    echo.
) else (
    echo  Installing consumet-local packages...
    echo.
    cd /d "%CONSUMET%"
    npm install
    if errorlevel 1 (
        echo.
        echo  ERROR: npm install failed for consumet-local.
        echo  Try running manually: cd consumet-local ^&^& npm install
        echo.
        cd /d "%ROOT%"
        pause & exit /b 1
    )
    cd /d "%ROOT%"
    echo.
    echo  consumet-local packages installed.
)

echo.

:: ══════════════════════════════════════════════════════════════════
echo ══════════════════════════════════════════════════════════════
echo  STEP 3 of 3 — Frontend (grabix-ui) npm packages
echo ══════════════════════════════════════════════════════════════
echo.

if exist "%FRONTEND%\node_modules" (
    echo  grabix-ui\node_modules already exists — skipping.
    echo  Delete grabix-ui\node_modules\ to force reinstall.
    echo.
) else (
    echo  Installing grabix-ui packages...
    echo.
    cd /d "%FRONTEND%"
    npm install
    if errorlevel 1 (
        echo.
        echo  ERROR: npm install failed for grabix-ui.
        echo  Try running manually: cd grabix-ui ^&^& npm install
        echo.
        cd /d "%ROOT%"
        pause & exit /b 1
    )
    cd /d "%ROOT%"
    echo.
    echo  grabix-ui packages installed.
)

echo.

:: ══════════════════════════════════════════════════════════════════
echo ══════════════════════════════════════════════════════════════
echo  Setup Complete!
echo ══════════════════════════════════════════════════════════════
echo.
echo  All three setup steps finished successfully.
echo.
echo  You can now build GRABIX anytime by running:
echo.
echo    build-fast.bat
echo.
echo  You do NOT need to run setup-grabix.bat again unless you:
echo   - Add new Python packages to backend\requirements.txt
echo   - Update consumet-local packages
echo   - Delete node_modules or python-runtime folders
echo.
echo ══════════════════════════════════════════════════════════════
echo.
pause
exit /b 0
