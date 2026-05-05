@echo off
setlocal
title GRABIX - Build Installer
cd /d "%~dp0"

echo ============================================================
echo  GRABIX - Build Windows Installer
echo  Uses the grabix-backend.exe you already compiled
echo ============================================================
echo.

REM ── Step 1: Check the backend exe exists ─────────────────────
set BACKEND_EXE=grabix-ui\src-tauri\backend-compiled\grabix-backend.exe

if not exist "%BACKEND_EXE%" (
    echo ERROR: grabix-backend.exe not found at:
    echo   %BACKEND_EXE%
    echo.
    echo Run build-nuitka.bat first to compile the backend.
    pause & exit /b 1
)

for %%F in ("%BACKEND_EXE%") do set EXE_SIZE=%%~zF
echo [OK] Found grabix-backend.exe ^(%EXE_SIZE% bytes^)
echo.

REM ── Step 2: Install Node dependencies ────────────────────────
echo [1/2] Installing Node.js dependencies...
cd grabix-ui

call npm install --prefer-offline
if %errorlevel% neq 0 (
    echo.
    echo ERROR: npm install failed.
    cd ..
    pause & exit /b 1
)

echo.

REM ── Step 3: Build the installer with Tauri ───────────────────
echo [2/2] Building Windows installer with Tauri...
echo       This bundles: React UI + Rust shell + your backend.exe
echo       Takes 5-10 minutes. Do NOT close this window.
echo.

call npm run tauri build
if %errorlevel% neq 0 (
    echo.
    echo ERROR: Tauri build failed. Scroll up to see what went wrong.
    cd ..
    pause & exit /b 1
)

cd ..

REM ── Done: show where the installer is ────────────────────────
set INSTALLER_DIR=grabix-ui\src-tauri\target\release\bundle\nsis

echo.
echo ============================================================
echo  BUILD COMPLETE
echo.
echo  Your installer is in:
echo  %INSTALLER_DIR%\
echo.
echo  Give that .exe file to users - they just double-click to install.
echo ============================================================
echo.

explorer "%INSTALLER_DIR%"
pause
