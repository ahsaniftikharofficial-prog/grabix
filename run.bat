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
set "SCRIPTS=%ROOT%scripts"
set "BACKEND_PORT=8000"
set "FRONTEND_PORT=5173"
set "BACKEND_LOG=%BACKEND%\logs\launcher-backend.log"
set "FRONTEND_LOG=%BACKEND%\logs\launcher-frontend.log"

echo  [CLEANUP] Closing installed GRABIX processes that can hijack source-mode ports...
taskkill /IM grabix-ui.exe /F >nul 2>&1
taskkill /IM grabix-backend.exe /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq GRABIX Backend" /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq GRABIX Frontend" /F >nul 2>&1
echo  [CLEANUP] Closing stale source-mode GRABIX Python/Node processes...
powershell -NoProfile -Command ^
  "$roots=@('H:\\Code\\Project 3\\grabix\\backend\\main.py','H:\\Code\\Project 3\\grabix\\grabix-ui');" ^
  "Get-CimInstance Win32_Process | Where-Object { $cmd=$_.CommandLine; $name=$_.Name; $cmd -and ($name -in @('python.exe','pythonw.exe','node.exe','npm.exe','cmd.exe')) -and (($roots | Where-Object { $cmd -like ('*' + $_ + '*') }).Count -gt 0) } | ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } catch {} }"

echo  [CLEANUP] Releasing fixed GRABIX dev ports...
powershell -NoProfile -Command ^
  "$ports=@(%BACKEND_PORT%,%FRONTEND_PORT%); foreach($port in $ports){ Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort $port -State Listen -ErrorAction SilentlyContinue | ForEach-Object { try { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue } catch {} } }"

if not exist "%BACKEND%\logs" mkdir "%BACKEND%\logs" >nul 2>&1
if exist "%BACKEND_LOG%" del /f /q "%BACKEND_LOG%" >nul 2>&1
if exist "%FRONTEND_LOG%" del /f /q "%FRONTEND_LOG%" >nul 2>&1

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

set "BACKEND_BASE=http://127.0.0.1:%BACKEND_PORT%"
set "FRONTEND_BASE=http://127.0.0.1:%FRONTEND_PORT%"
set "FRONTEND_ENV_FILE=%FRONTEND%\.env.development.local"

> "%FRONTEND_ENV_FILE%" (
    echo VITE_GRABIX_API_BASE=%BACKEND_BASE%
)

echo  [START] Launching backend on %BACKEND_BASE%
start "GRABIX Backend" /min cmd /c call "%SCRIPTS%\start-backend.cmd" "%BACKEND%" "%BACKEND_PORT%" "%BACKEND_BASE%" "%BACKEND_LOG%"

echo  [WAIT] Waiting for backend health...
powershell -NoProfile -Command ^
  "$ready=$false; for($i=0;$i -lt 80;$i++){ Start-Sleep -Milliseconds 400; try { $r=Invoke-RestMethod -Uri '%BACKEND_BASE%/health/ping' -TimeoutSec 2; if($r.ok -and $r.core_ready){$ready=$true; break} } catch {} }; if(-not $ready){ exit 1 }"
if errorlevel 1 (
    echo  [ERROR] Backend did not become ready in time.
    echo  [INFO] Showing last backend log lines:
    powershell -NoProfile -Command "if(Test-Path '%BACKEND_LOG%'){ Get-Content '%BACKEND_LOG%' -Tail 60 }"
    pause
    exit /b 1
)

echo  [START] Launching frontend on %FRONTEND_BASE%
start "GRABIX Frontend" /min cmd /c call "%SCRIPTS%\start-frontend.cmd" "%FRONTEND%" "%FRONTEND_PORT%" "%FRONTEND_LOG%"

echo  [WAIT] Waiting for frontend...
powershell -NoProfile -Command ^
  "$ready=$false; for($i=0;$i -lt 80;$i++){ Start-Sleep -Milliseconds 400; try { $r=Invoke-WebRequest -Uri '%FRONTEND_BASE%' -UseBasicParsing -TimeoutSec 2; if($r.StatusCode -ge 200){$ready=$true; break} } catch {} }; if(-not $ready){ exit 1 }"
if errorlevel 1 (
    echo  [ERROR] Frontend dev server did not become ready in time.
    echo  [INFO] Showing last frontend log lines:
    powershell -NoProfile -Command "if(Test-Path '%FRONTEND_LOG%'){ Get-Content '%FRONTEND_LOG%' -Tail 60 }"
    pause
    exit /b 1
)

echo.
echo  ==========================================
echo    All services are starting!
echo.
echo    Backend:  %BACKEND_BASE%
echo    Frontend: %FRONTEND_BASE%
echo  ==========================================
echo.

timeout /t 3 /nobreak >nul
start %FRONTEND_BASE%

exit /b 0
