@echo off
setlocal EnableDelayedExpansion
cd /d "%~dp0"

echo.
echo ==========================================
echo   GRABIX Fast Build
echo ==========================================
echo.

:: ── Paths ─────────────────────────────────────────────────────────────────
set "ROOT=%~dp0"
set "FRONTEND=%ROOT%grabix-ui"
set "BACKEND=%ROOT%backend"
set "CONSUMET=%ROOT%consumet-local"
set "TAURI=%FRONTEND%\src-tauri"
set "PYTHON_RUNTIME=%TAURI%\python-runtime"
set "PYTHON_EXE=%PYTHON_RUNTIME%\python.exe"

:: Staging targets (what tauri.conf.json bundles)
set "STAGE_BACKEND=%TAURI%\backend-staging\backend"
set "STAGE_CONSUMET=%TAURI%\consumet-staging\consumet-local"
set "STAGE_NODE=%TAURI%\consumet-staging\node-runtime"
set "STAGE_GENERATED=%TAURI%\generated"

:: ── Pre-flight checks ──────────────────────────────────────────────────────
echo [1/5] Checking prerequisites...

if not exist "%PYTHON_EXE%" (
    echo.
    echo  ERROR: python.exe not found at:
    echo    %PYTHON_EXE%
    echo.
    echo  Run scripts\setup-python-runtime.ps1 first, then retry.
    echo.
    pause & exit /b 1
)

where npm >nul 2>&1
if errorlevel 1 (
    echo  ERROR: npm not found in PATH. Install Node.js and retry.
    pause & exit /b 1
)

where cargo >nul 2>&1
if errorlevel 1 (
    echo  ERROR: cargo not found in PATH. Install Rust and retry.
    pause & exit /b 1
)

if not exist "%CONSUMET%\server.cjs" (
    echo  ERROR: consumet-local\server.cjs not found.
    echo  Run:  cd consumet-local ^&^& npm install
    pause & exit /b 1
)

if not exist "%CONSUMET%\node_modules" (
    echo  ERROR: consumet-local\node_modules not found.
    echo  Run:  cd consumet-local ^&^& npm install
    pause & exit /b 1
)

:: ── IMPORTANT: stop any running backend before building ────────────────────
:: If the dev backend (1__Backend.bat) is still open, port 8000 will be taken
:: when the compiled app launches — making it look like the backend is offline.
echo  Checking for any running backend on port 8000...
for /f "tokens=5" %%P in ('netstat -ano 2^>nul ^| findstr ":8000 " ^| findstr "LISTENING"') do (
    echo  [INFO] Found running backend PID %%P - stopping it before build...
    taskkill /F /PID %%P >nul 2>&1
    timeout /t 2 /nobreak >nul
)

echo  OK - all prerequisites found.
echo.

:: ── Refresh Python packages in bundled runtime ─────────────────────────────
echo [2/5] Refreshing Python packages in bundled runtime...
echo  This ensures the compiled app has all required packages.
echo.
"%PYTHON_EXE%" -m pip install -r "%BACKEND%\requirements.txt" python-multipart --quiet --no-warn-script-location
if errorlevel 1 (
    echo.
    echo  WARNING: pip install reported errors above.
    echo  The build will continue but some features may not work.
    echo  Check the output above for details.
    echo.
    timeout /t 3 /nobreak >nul
) else (
    echo  Packages up to date.
)
echo.

:: ── Stage resources ────────────────────────────────────────────────────────
echo [3/5] Staging backend + consumet resources...

:: Clear old staging
if exist "%TAURI%\backend-staging"  rd /s /q "%TAURI%\backend-staging"
if exist "%TAURI%\consumet-staging" rd /s /q "%TAURI%\consumet-staging"
if exist "%TAURI%\generated"        rd /s /q "%TAURI%\generated"

:: Stage backend (skip venv, __pycache__, .pyc, logs, tests, db files)
robocopy "%BACKEND%" "%STAGE_BACKEND%" /E /NJH /NJS /NFL /NDL ^
    /XD __pycache__ venv .venv tests .pytest_cache .mypy_cache .ruff_cache logs ^
    /XF *.pyc *.pyo *.sqlite *.sqlite3 *.db memory.db >nul
if errorlevel 8 (
    echo  ERROR: Backend staging failed.
    pause & exit /b 1
)

:: Stage consumet files
md "%STAGE_CONSUMET%" 2>nul
copy /Y "%CONSUMET%\server.cjs"        "%STAGE_CONSUMET%\server.cjs"        >nul
copy /Y "%CONSUMET%\package.json"      "%STAGE_CONSUMET%\package.json"      >nul
if exist "%CONSUMET%\package-lock.json" copy /Y "%CONSUMET%\package-lock.json" "%STAGE_CONSUMET%\package-lock.json" >nul
robocopy "%CONSUMET%\node_modules" "%STAGE_CONSUMET%\node_modules" /E /NJH /NJS /NFL /NDL >nul

:: Stage node.exe (needed to run consumet inside the packaged app)
md "%STAGE_NODE%" 2>nul
for /f "delims=" %%N in ('where node 2^>nul') do (
    copy /Y "%%N" "%STAGE_NODE%\node.exe" >nul
    goto :node_copied
)
:node_copied

:: Write minimal runtime-config.json
md "%STAGE_GENERATED%" 2>nul
if defined GRABIX_TMDB_BEARER_TOKEN (
    echo {"tmdb_bearer_token":"%GRABIX_TMDB_BEARER_TOKEN%","managed_by":"build-fast"} > "%STAGE_GENERATED%\runtime-config.json"
) else (
    echo {"tmdb_bearer_token":"","managed_by":"build-fast"} > "%STAGE_GENERATED%\runtime-config.json"
)

echo  Staging complete.
echo.

:: ── Set build env vars ─────────────────────────────────────────────────────
set "PYO3_PYTHON=%PYTHON_EXE%"
set "PYO3_USE_ABI3_FORWARD_COMPATIBILITY=1"
set "GRABIX_TMDB_BEARER_TOKEN=eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiI5OTk3Y2E5ZjY2NGZhZmI5ZWJkZmNhNDMyNGY0YTBmOCIsIm5iZiI6MTc3NDU2NDcyMC44NDYwMDAyLCJzdWIiOiI2OWM1YjU3MGE4NTBkNjcxOTE4OWJjN2MiLCJzY29wZXMiOlsiYXBpX3JlYWQiXSwidmVyc2lvbiI6MX0.uv8_l7Ub7WRhSfWtd07Sx_Yg13jubgyU7953kJZy7mw"
set "GRABIX_BUILD_ID=fast-build"
set "GRABIX_BACKEND_RESOURCE_HASH=fast-build"
set "GRABIX_BACKEND_RESOURCE_SUBDIR=backend-staging/backend"

:: ── Tauri build ────────────────────────────────────────────────────────────
echo [4/5] Running Tauri build (this takes a few minutes)...
echo  PYO3_PYTHON = %PYO3_PYTHON%
echo.

cd /d "%FRONTEND%"
npm run tauri build
set "BUILD_EXIT=%ERRORLEVEL%"
cd /d "%ROOT%"

if not "%BUILD_EXIT%"=="0" (
    echo.
    echo ==========================================
    echo  BUILD FAILED (exit code %BUILD_EXIT%)
    echo  Scroll up to see the first error.
    echo ==========================================
    echo.
    pause & exit /b %BUILD_EXIT%
)

:: ── Done ───────────────────────────────────────────────────────────────────
echo.
echo [5/5] Build finished!
echo.
echo ==========================================
echo  EXE (run directly):
echo    %FRONTEND%\src-tauri\target\release\grabix-ui.exe
echo.
echo  Installer (share/install):
echo    %FRONTEND%\src-tauri\target\release\bundle\nsis\
echo.
echo  NOTE: Close 1__Backend.bat before launching the compiled app,
echo  otherwise port 8000 will be taken and the app will show offline.
echo ==========================================
echo.
pause
exit /b 0
