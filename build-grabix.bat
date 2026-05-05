@echo off

REM ============================================================
REM  SELF-RELAUNCH — window stays open no matter what happens
REM ============================================================
if "%~1"=="LAUNCHED" goto :main
cmd /k "%~f0" LAUNCHED
exit

:main
setlocal enabledelayedexpansion
title GRABIX Builder
cd /d "%~dp0"

set BUILD_START=%TIME%
set LOG=build.log

echo GRABIX Build Log > "%LOG%"
echo Date: %DATE% %TIME% >> "%LOG%"
echo. >> "%LOG%"

call :log "============================================================"
call :log "  GRABIX - Full Production Build"
call :log "  Log saved to: build.log"
call :log "============================================================"
call :log ""

REM ============================================================
REM  PHASE 0 - Check all required tools
REM ============================================================
call :log "[PHASE 0] Checking required tools..."
call :log ""
set MISSING=0

python --version >nul 2>&1
if %errorlevel% neq 0 (
    call :log "  [MISSING] Python    https://python.org"
    set MISSING=1
) else (
    for /f "tokens=*" %%v in ('python --version 2^>^&1') do call :log "  [OK]      %%v"
)

node --version >nul 2>&1
if %errorlevel% neq 0 (
    call :log "  [MISSING] Node.js   https://nodejs.org"
    set MISSING=1
) else (
    for /f "tokens=*" %%v in ('node --version 2^>^&1') do call :log "  [OK]      Node %%v"
)

npm --version >nul 2>&1
if %errorlevel% neq 0 (
    call :log "  [MISSING] npm       reinstall Node.js"
    set MISSING=1
) else (
    for /f "tokens=*" %%v in ('npm --version 2^>^&1') do call :log "  [OK]      npm v%%v"
)

cargo --version >nul 2>&1
if %errorlevel% neq 0 (
    call :log "  [MISSING] Rust      https://rustup.rs"
    set MISSING=1
) else (
    for /f "tokens=*" %%v in ('cargo --version 2^>^&1') do call :log "  [OK]      %%v"
)

powershell -Command "exit 0" >nul 2>&1
if %errorlevel% neq 0 (
    call :log "  [MISSING] PowerShell  (needed for smoke test)"
    set MISSING=1
) else (
    call :log "  [OK]      PowerShell found"
)

call :log ""
if %MISSING%==1 (
    call :log "  STOPPED - install missing tools above then run again."
    call :elapsed
    goto :eof
)
call :log "  All tools present."
call :log ""

REM ============================================================
REM  PHASE 1 - Clean stale artifacts
REM ============================================================
call :log "[PHASE 1] Cleaning old build artifacts..."

if exist "backend\main.build" (
    call :log "  Removing Nuitka cache..."
    rmdir /s /q "backend\main.build" 2>nul
)
if exist "backend\main.onefile-build" (
    call :log "  Removing Nuitka onefile cache..."
    rmdir /s /q "backend\main.onefile-build" 2>nul
)
if exist "grabix-ui\src-tauri\backend-compiled\grabix-backend.exe" (
    call :log "  Removing old grabix-backend.exe..."
    del /f /q "grabix-ui\src-tauri\backend-compiled\grabix-backend.exe" 2>nul
)

call :log "  Done."
call :log ""

REM ============================================================
REM  PHASE 2 - Isolated virtual environment
REM ============================================================
call :log "[PHASE 2] Setting up Python environment..."
call :log "  All packages go inside build-venv\ - your system Python is untouched."
call :log ""

if not exist "build-venv\Scripts\python.exe" (
    call :log "  Creating virtual environment..."
    python -m venv build-venv >> "%LOG%" 2>&1
    if %errorlevel% neq 0 (
        call :log "  ERROR: Could not create venv. Check build.log."
        call :elapsed
        goto :eof
    )
    call :log "  Virtual environment created."
) else (
    call :log "  Reusing existing build-venv."
)

set VPYTHON="%~dp0build-venv\Scripts\python.exe"
set VPIP="%~dp0build-venv\Scripts\pip.exe"

call :log "  Upgrading pip..."
%VPYTHON% -m pip install --upgrade pip --quiet >> "%LOG%" 2>&1

REM ── FIX: requirements-lock.txt is in the PROJECT ROOT, not backend\ ──────────
if exist "requirements-lock.txt" (
    call :log "  Installing pinned requirements from requirements-lock.txt..."
    %VPIP% install -r requirements-lock.txt --quiet >> "%LOG%" 2>&1
) else if exist "backend\requirements.txt" (
    call :log "  requirements-lock.txt not found, falling back to backend\requirements.txt..."
    %VPIP% install -r backend\requirements.txt --quiet >> "%LOG%" 2>&1
) else (
    call :log "  ERROR: Cannot find requirements-lock.txt or backend\requirements.txt."
    call :elapsed
    goto :eof
)
if %errorlevel% neq 0 (
    call :log "  ERROR: pip install failed. Check build.log for details."
    call :elapsed
    goto :eof
)

call :log "  Installing Nuitka..."
%VPIP% install "nuitka==2.5.8" ordered-set zstandard --quiet >> "%LOG%" 2>&1
if %errorlevel% neq 0 (
    call :log "  ERROR: Nuitka install failed. Check build.log."
    call :elapsed
    goto :eof
)

call :log "  Done."
call :log ""

REM ============================================================
REM  PHASE 3 - Compile Python backend with Nuitka
REM ============================================================
call :log "[PHASE 3] Compiling Python backend with Nuitka..."
call :log "  First run: 15-30 min. Later runs: 3-5 min (cache)."
call :log "  Do NOT close this window."
call :log ""

if not exist "grabix-ui\src-tauri\backend-compiled" (
    mkdir "grabix-ui\src-tauri\backend-compiled"
)

REM Store the absolute project root so paths are correct when we cd into backend
set ROOT=%~dp0

cd backend

%VPYTHON% -m nuitka ^
  --standalone ^
  --onefile ^
  --output-filename=grabix-backend.exe ^
  --output-dir="%ROOT%grabix-ui\src-tauri\backend-compiled" ^
  --windows-console-mode=disable ^
  --assume-yes-for-downloads ^
  --warn-unusual-code ^
  --include-package=uvicorn ^
  --include-package=uvicorn.loops ^
  --include-package=uvicorn.protocols ^
  --include-package=uvicorn.middleware ^
  --include-package=fastapi ^
  --include-package=starlette ^
  --include-package=pydantic ^
  --include-package=pydantic_core ^
  --include-package=anyio ^
  --include-package=anyio._backends ^
  --include-package=h11 ^
  --include-package=httpx ^
  --include-package=httptools ^
  --include-package=websockets ^
  --include-package=yt_dlp ^
  --include-package=moviebox ^
  --include-package=bcrypt ^
  --include-package=imdb ^
  --include-package=curl_cffi ^
  --include-package=app ^
  --include-package=core ^
  --include-package=downloads ^
  main.py >> "%ROOT%build.log" 2>&1

if %errorlevel% neq 0 (
    cd "%ROOT%"
    call :log ""
    call :log "  ERROR: Nuitka compilation failed."
    call :log "  Open build.log and search for the word ERROR or FATAL."
    call :elapsed
    goto :eof
)

cd "%ROOT%"

REM Verify the exe was actually created and is a real size
if not exist "grabix-ui\src-tauri\backend-compiled\grabix-backend.exe" (
    call :log "  ERROR: Nuitka finished but grabix-backend.exe is missing."
    call :elapsed
    goto :eof
)

for %%F in ("grabix-ui\src-tauri\backend-compiled\grabix-backend.exe") do set EXE_SIZE=%%~zF
if %EXE_SIZE% LSS 1000000 (
    call :log "  ERROR: grabix-backend.exe is %EXE_SIZE% bytes - too small, build likely broken."
    call :elapsed
    goto :eof
)

call :log "  Compiled: grabix-backend.exe (%EXE_SIZE% bytes)"
call :log ""

REM ============================================================
REM  PHASE 3b - Smoke test the compiled backend
REM ============================================================
call :log "  Smoke testing the compiled backend..."

taskkill /f /im grabix-backend.exe >nul 2>&1

set SMOKE_DIR=%TEMP%\grabix-smoke-test
if not exist "%SMOKE_DIR%" mkdir "%SMOKE_DIR%"

start /b "" cmd /c "set GRABIX_APP_STATE_ROOT=%SMOKE_DIR%&& set GRABIX_BACKEND_PORT=18765&& set GRABIX_PACKAGED_MODE=1&& grabix-ui\src-tauri\backend-compiled\grabix-backend.exe"

call :log "  Waiting for /health/ping on port 18765 (up to 30 seconds)..."

powershell -NoProfile -Command "$ok=$false; for($i=0;$i -lt 30;$i++){try{$r=(Invoke-WebRequest -Uri 'http://127.0.0.1:18765/health/ping' -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop).StatusCode; if($r -eq 200){$ok=$true; break}}catch{}; Start-Sleep 1}; if($ok){exit 0}else{exit 1}" >nul 2>&1

set SMOKE_RESULT=%errorlevel%

taskkill /f /im grabix-backend.exe >nul 2>&1
rmdir /s /q "%SMOKE_DIR%" 2>nul

if %SMOKE_RESULT% neq 0 (
    call :log ""
    call :log "  ERROR: Smoke test FAILED - backend did not respond in 30 seconds."
    call :log ""
    call :log "  To diagnose:"
    call :log "    1. Open a new CMD window"
    call :log "    2. Run: set GRABIX_APP_STATE_ROOT=%TEMP%\grabix-test"
    call :log "    3. Run: grabix-ui\src-tauri\backend-compiled\grabix-backend.exe"
    call :log "    4. Look for any ImportError or traceback"
    call :elapsed
    goto :eof
)

call :log "  Smoke test PASSED. Backend is healthy."
call :log ""

REM ============================================================
REM  PHASE 4 - Install Node dependencies
REM ============================================================
call :log "[PHASE 4] Installing Node.js dependencies..."

cd grabix-ui

call npm ci --prefer-offline >> "..\%LOG%" 2>&1
if %errorlevel% neq 0 (
    call :log "  npm ci failed - trying npm install..."
    call npm install >> "..\%LOG%" 2>&1
    if %errorlevel% neq 0 (
        cd ..
        call :log "  ERROR: npm install failed. Check build.log."
        call :elapsed
        goto :eof
    )
)

call :log "  Done."
call :log ""

REM ============================================================
REM  PHASE 5 - Build installer with Tauri
REM ============================================================
call :log "[PHASE 5] Building GRABIX installer with Tauri..."
call :log "  This packages: React UI + Rust shell + compiled Python backend."
call :log "  Takes 5-10 minutes."
call :log ""

call npm run tauri build >> "..\%LOG%" 2>&1
if %errorlevel% neq 0 (
    cd ..
    call :log "  ERROR: Tauri build failed. Check build.log."
    call :elapsed
    goto :eof
)

cd ..

REM Find the installer .exe
set INSTALLER_DIR=grabix-ui\src-tauri\target\release\bundle\nsis
set INSTALLER_NAME=
set INSTALLER_SIZE=0

for %%F in ("%INSTALLER_DIR%\*.exe") do (
    set INSTALLER_NAME=%%~nxF
    set INSTALLER_SIZE=%%~zF
)

if "%INSTALLER_NAME%"=="" (
    call :log "  ERROR: No installer .exe found in %INSTALLER_DIR%"
    call :elapsed
    goto :eof
)

REM ============================================================
REM  SUCCESS
REM ============================================================
call :log ""
call :log "============================================================"
call :log "  BUILD COMPLETE"
call :log ""
call :log "  Installer : %INSTALLER_NAME%"
call :log "  Location  : %INSTALLER_DIR%\"
call :log "  Size      : %INSTALLER_SIZE% bytes"
call :log ""
call :log "  Give this .exe to users — they just double-click to install."
call :log "============================================================"
call :elapsed

explorer "%INSTALLER_DIR%"
goto :eof

REM ============================================================
REM  HELPERS
REM ============================================================
:log
echo %~1
echo %~1 >> "%LOG%"
exit /b 0

:elapsed
set END_TIME=%TIME%
for /f "tokens=1-3 delims=:.," %%a in ("%BUILD_START%") do (
    set /a SH=1%%a-100, SM=1%%b-100, SS=1%%c-100
)
for /f "tokens=1-3 delims=:.," %%a in ("%END_TIME%") do (
    set /a EH=1%%a-100, EM=1%%b-100, ES=1%%c-100
)
set /a TOTAL_S=(EH-SH)*3600+(EM-SM)*60+(ES-SS)
if %TOTAL_S% lss 0 set /a TOTAL_S+=86400
set /a ELAPSED_M=TOTAL_S/60
set /a ELAPSED_S=TOTAL_S%%60
call :log ""
call :log "  Total time: %ELAPSED_M%m %ELAPSED_S%s"
exit /b 0
