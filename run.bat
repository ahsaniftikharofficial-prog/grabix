@echo off
setlocal
title GRABIX Launcher
color 0B

echo.
echo  ==========================================
echo    GRABIX - Starting Up
echo  ==========================================
echo.

REM ── Paths (all relative to this file — no hardcoded drive letters) ──────────
set "ROOT=%~dp0"
set "BACKEND=%ROOT%backend"
set "FRONTEND=%ROOT%grabix-ui"
set "CONSUMET=%ROOT%consumet-local"
set "SCRIPTS=%ROOT%scripts"

REM ── Ports ────────────────────────────────────────────────────────────────────
set "BACKEND_PORT=8000"
set "FRONTEND_PORT=5173"
set "CONSUMET_PORT=3000"

REM ── Derived URLs ─────────────────────────────────────────────────────────────
set "BACKEND_BASE=http://127.0.0.1:%BACKEND_PORT%"
set "FRONTEND_BASE=http://127.0.0.1:%FRONTEND_PORT%"
set "CONSUMET_BASE=http://127.0.0.1:%CONSUMET_PORT%"

REM ── Log files ─────────────────────────────────────────────────────────────────
set "BACKEND_LOG=%BACKEND%\logs\launcher-backend.log"
set "FRONTEND_LOG=%BACKEND%\logs\launcher-frontend.log"
set "CONSUMET_LOG=%BACKEND%\logs\launcher-consumet.log"

REM ── Optional TMDB token / runtime config ─────────────────────────────────────
set "RUNTIME_CONFIG_FILE=%ROOT%runtime-config.local.json"

REM =============================================================================
REM  STEP 1 — Kill anything already holding our ports or process titles
REM =============================================================================
echo  [CLEANUP] Stopping any previously-running GRABIX processes...
taskkill /IM grabix-ui.exe /F >nul 2>&1
taskkill /IM grabix-backend.exe /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq GRABIX Backend" /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq GRABIX Frontend" /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq GRABIX HiAnime" /F >nul 2>&1

echo  [CLEANUP] Releasing ports %BACKEND_PORT%, %FRONTEND_PORT%, %CONSUMET_PORT%...
powershell -NoProfile -Command "$ports=@(%BACKEND_PORT%,%FRONTEND_PORT%,%CONSUMET_PORT%); foreach($p in $ports){ Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue | ForEach-Object { try { Stop-Process -Id $_.OwningProcess -Force -EA SilentlyContinue } catch {} } }"

REM =============================================================================
REM  STEP 2 — Create log folder, clear old logs
REM =============================================================================
if not exist "%BACKEND%\logs" mkdir "%BACKEND%\logs" >nul 2>&1
if exist "%BACKEND_LOG%"  del /f /q "%BACKEND_LOG%"  >nul 2>&1
if exist "%FRONTEND_LOG%" del /f /q "%FRONTEND_LOG%" >nul 2>&1
if exist "%CONSUMET_LOG%" del /f /q "%CONSUMET_LOG%" >nul 2>&1

REM =============================================================================
REM  STEP 3 — Verify Python and Node are available
REM =============================================================================
python --version >nul 2>&1
if errorlevel 1 (
    echo.
    echo  [ERROR] Python not found on PATH.
    echo  Install Python 3.10+ from https://python.org
    echo  and tick "Add Python to PATH" during install.
    echo.
    pause
    exit /b 1
)

node --version >nul 2>&1
if errorlevel 1 (
    echo.
    echo  [ERROR] Node.js not found on PATH.
    echo  Install Node.js LTS from https://nodejs.org
    echo.
    pause
    exit /b 1
)

REM =============================================================================
REM  STEP 4 — Python virtual environment
REM =============================================================================
if not exist "%BACKEND%\venv\Scripts\activate.bat" (
    echo  [SETUP] Creating Python virtual environment...
    python -m venv "%BACKEND%\venv"
    if errorlevel 1 (
        echo  [ERROR] Failed to create venv. Check your Python installation.
        pause
        exit /b 1
    )
)

echo  [SETUP] Checking Python packages...
"%BACKEND%\venv\Scripts\python.exe" -c "import fastapi,uvicorn,yt_dlp,httpx,bcrypt,multipart" >nul 2>&1
if errorlevel 1 (
    echo  [SETUP] Installing packages (first time - about a minute)...
    "%BACKEND%\venv\Scripts\pip.exe" install -r "%BACKEND%\requirements.txt" python-multipart --quiet
    if errorlevel 1 (
        echo  [ERROR] Package install failed. Check your internet connection.
        pause
        exit /b 1
    )
    echo  [SETUP] Packages installed.
)

REM =============================================================================
REM  STEP 5 — Frontend npm install
REM =============================================================================
if not exist "%FRONTEND%\node_modules" (
    echo  [SETUP] Installing frontend packages (first time only)...
    cd /d "%FRONTEND%"
    npm.cmd install --silent
    if errorlevel 1 (
        echo  [ERROR] npm install failed for frontend.
        pause
        exit /b 1
    )
    echo  [SETUP] Frontend packages installed.
)

REM =============================================================================
REM  STEP 6 — Consumet (HiAnime) npm install
REM =============================================================================
if not exist "%CONSUMET%\node_modules\axios" (
    echo  [SETUP] Installing HiAnime packages (first time only)...
    cd /d "%CONSUMET%"
    npm.cmd install --silent
    if errorlevel 1 (
        echo  [ERROR] npm install failed for HiAnime gateway.
        pause
        exit /b 1
    )
    echo  [SETUP] HiAnime packages installed.
)

REM =============================================================================
REM  STEP 7 — Write frontend .env so it knows where the backend is
REM =============================================================================
> "%FRONTEND%\.env.development.local" (
    echo VITE_GRABIX_API_BASE=%BACKEND_BASE%
)

REM =============================================================================
REM  STEP 8 — Start HiAnime gateway
REM =============================================================================
echo  [START] Launching HiAnime gateway on %CONSUMET_BASE%...
start "GRABIX HiAnime" /min cmd /c call "%SCRIPTS%\start-consumet.cmd" "%CONSUMET%" "%CONSUMET_PORT%" "%CONSUMET_LOG%"

echo  [WAIT]  Waiting for HiAnime gateway...
powershell -NoProfile -Command "$ok=$false; for($i=0;$i -lt 60;$i++){ Start-Sleep -Milliseconds 500; try { $r=Invoke-WebRequest -Uri '%CONSUMET_BASE%' -UseBasicParsing -TimeoutSec 2; if($r.StatusCode -ge 200){$ok=$true;break} } catch {} }; Write-Host ('  [' + $(if($ok){'OK   '}else{'WARN '}) + ']  HiAnime ' + $(if($ok){'ready.'}else{'slow to start, continuing anyway.'}))"

REM =============================================================================
REM  STEP 9 — Start Python backend
REM
REM  The refactored backend still launches with:  python main.py
REM  from the backend/ directory. All new modules (core/, moviebox/,
REM  anime/, downloads/) live inside backend/ and are found automatically.
REM  No changes needed to start-backend.cmd.
REM =============================================================================
echo  [START] Launching backend on %BACKEND_BASE%...
start "GRABIX Backend" /min cmd /c call "%SCRIPTS%\start-backend.cmd" "%BACKEND%" "%BACKEND_PORT%" "%BACKEND_BASE%" "%BACKEND_LOG%" "%CONSUMET_BASE%" "%RUNTIME_CONFIG_FILE%"

echo  [WAIT]  Waiting for backend (up to 60s)...
powershell -NoProfile -Command "$ok=$false; for($i=0;$i -lt 150;$i++){ Start-Sleep -Milliseconds 400; try { $r=Invoke-RestMethod -Uri '%BACKEND_BASE%/health/ping' -TimeoutSec 3; if($r.ok){$ok=$true;break} } catch {} }; if(-not $ok){ exit 1 }"
if errorlevel 1 (
    echo.
    echo  [ERROR] Backend did not start in time. Last 50 log lines:
    echo.
    powershell -NoProfile -Command "if(Test-Path '%BACKEND_LOG%'){ Get-Content '%BACKEND_LOG%' -Tail 50 } else { Write-Host '(no log yet)' }"
    echo.
    echo  Common causes:
    echo    - Missing package: run pip install -r backend\requirements.txt
    echo    - Port %BACKEND_PORT% already in use (close other apps)
    echo    - Import error in a new module (check log above)
    echo.
    pause
    exit /b 1
)
echo  [OK]    Backend ready.

REM =============================================================================
REM  STEP 10 — Start frontend dev server
REM =============================================================================
echo  [START] Launching frontend on %FRONTEND_BASE%...
start "GRABIX Frontend" /min cmd /c call "%SCRIPTS%\start-frontend.cmd" "%FRONTEND%" "%FRONTEND_PORT%" "%FRONTEND_LOG%"

echo  [WAIT]  Waiting for frontend...
powershell -NoProfile -Command "$ok=$false; for($i=0;$i -lt 80;$i++){ Start-Sleep -Milliseconds 400; try { $r=Invoke-WebRequest -Uri '%FRONTEND_BASE%' -UseBasicParsing -TimeoutSec 2; if($r.StatusCode -ge 200){$ok=$true;break} } catch {} }; if(-not $ok){ exit 1 }"
if errorlevel 1 (
    echo.
    echo  [ERROR] Frontend did not start in time. Last 20 log lines:
    powershell -NoProfile -Command "if(Test-Path '%FRONTEND_LOG%'){ Get-Content '%FRONTEND_LOG%' -Tail 20 } else { Write-Host '(no log yet)' }"
    echo.
    pause
    exit /b 1
)
echo  [OK]    Frontend ready.

REM =============================================================================
REM  DONE
REM =============================================================================
echo.
echo  ==========================================
echo    GRABIX is running!
echo.
echo    HiAnime:  %CONSUMET_BASE%
echo    Backend:  %BACKEND_BASE%
echo    Frontend: %FRONTEND_BASE%
echo.
echo    Three minimized windows are running.
echo    Close them to stop the app.
echo  ==========================================
echo.

timeout /t 2 /nobreak >nul
start %FRONTEND_BASE%

echo  Press any key to close this launcher.
echo  (Services keep running in the background.)
echo.
pause
exit /b 0
