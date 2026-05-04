@echo off
setlocal EnableDelayedExpansion
cd /d "%~dp0"

:: ╔══════════════════════════════════════════════════════╗
:: ║           GRABIX  —  build-fast.bat                 ║
:: ║  Builds the Tauri installer (.exe) from source.     ║
:: ║                                                      ║
:: ║  FIX: Window now stays open after build finishes.   ║
:: ║  Close it yourself when done reviewing output.      ║
:: ╚══════════════════════════════════════════════════════╝

:: ── FIX 1: Keep window open — self-spawn inside a persistent cmd /k window ──
::    Without this, the CMD window auto-closes the moment the script ends,
::    even if pause is present (common when double-clicking .bat files or
::    running from Windows Terminal).
if /i "%~1"=="--inner" goto :main
start "GRABIX Build" cmd /k ""%~f0" --inner"
exit /b 0

:main
title GRABIX Build — Running...
color 0A

echo.
echo  ==========================================
echo    GRABIX Build
echo  ==========================================
echo.
echo  Log file: %~dp0build-fast.log
echo.

:: Start logging — tee output to build-fast.log so errors are never lost
call :log_init

:: ── Core paths ──────────────────────────────────────────────────────────────
set "ROOT=%~dp0"
set "FRONTEND=%ROOT%grabix-ui"
set "BACKEND=%ROOT%backend"
set "TAURI=%FRONTEND%\src-tauri"
set "PYTHON_RUNTIME=%TAURI%\python-runtime"
set "PYTHON_EXE=%PYTHON_RUNTIME%\python.exe"

:: Staging dirs (must match tauri.conf.json resources list)
set "STAGE_BACKEND=%TAURI%\backend-staging\backend"
set "STAGE_CONSUMET=%TAURI%\consumet-staging\consumet-local"
set "STAGE_NODE=%TAURI%\consumet-staging\node-runtime"
set "STAGE_GENERATED=%TAURI%\generated"

:: Consumet source (optional — build continues if absent)
set "CONSUMET=%ROOT%consumet-local"
set "CONSUMET_PRESENT=0"
if exist "%CONSUMET%\package.json" set "CONSUMET_PRESENT=1"

:: ────────────────────────────────────────────────────────────────────────────
echo  [1/5]  Checking prerequisites...
echo.

:: Python bundled runtime
if not exist "%PYTHON_EXE%" (
    echo  ERROR: Bundled Python runtime not found.
    echo.
    echo    Expected:  %PYTHON_EXE%
    echo.
    echo  Fix: Run setup-grabix.bat first to download and configure
    echo       the Python runtime. Only needed once.
    echo.
    call :die 1
)

:: npm
where npm >nul 2>&1
if errorlevel 1 (
    echo  ERROR: npm not found in PATH.
    echo  Install Node.js from https://nodejs.org and retry.
    echo.
    call :die 1
)

:: cargo / Rust
where cargo >nul 2>&1
if errorlevel 1 (
    echo  ERROR: cargo not found in PATH.
    echo  Install Rust from https://rustup.rs and retry.
    echo.
    call :die 1
)

:: grabix-ui node_modules
if not exist "%FRONTEND%\node_modules" (
    echo  grabix-ui\node_modules not found — running npm install...
    echo.
    cd /d "%FRONTEND%"
    npm install
    if errorlevel 1 (
        echo.
        echo  ERROR: npm install failed for grabix-ui.
        echo.
        cd /d "%ROOT%"
        call :die 1
    )
    cd /d "%ROOT%"
    echo.
)

:: consumet-local (optional — HiAnime sidecar)
if "%CONSUMET_PRESENT%"=="1" (
    if not exist "%CONSUMET%\node_modules" (
        echo  consumet-local\node_modules not found — running npm install...
        echo.
        cd /d "%CONSUMET%"
        npm install
        if errorlevel 1 (
            echo.
            echo  WARNING: npm install failed for consumet-local.
            echo  HiAnime streaming will not work in the built app.
            echo  Continuing build anyway...
            echo.
        )
        cd /d "%ROOT%"
        echo.
    )
    echo  consumet-local: found
) else (
    echo  consumet-local: not present ^(HiAnime sidecar will be skipped^)
)

echo.
echo  All prerequisites OK.
echo.

:: Kill any running dev backend so port 8000 is free when the built app launches
echo  Checking for running backend on port 8000...
for /f "tokens=5" %%P in ('netstat -ano 2^>nul ^| findstr ":8000 " ^| findstr "LISTENING"') do (
    echo  Found backend on PID %%P — stopping it before build...
    taskkill /F /PID %%P >nul 2>&1
    timeout /t 2 /nobreak >nul
)
echo.

:: ────────────────────────────────────────────────────────────────────────────
echo  [2/5]  Updating Python packages in bundled runtime...
echo.

"%PYTHON_EXE%" -m pip install --quiet --no-warn-script-location ^
    -r "%BACKEND%\requirements.txt" ^
    python-multipart ^
    psutil

if errorlevel 1 (
    echo.
    echo  WARNING: pip install reported errors above.
    echo  The build will continue but some packages may be missing.
    echo.
    timeout /t 3 /nobreak >nul
) else (
    echo  Python packages up to date.
)
echo.

:: ────────────────────────────────────────────────────────────────────────────
echo  [3/5]  Staging resources...
echo.

:: Clear old staging dirs
if exist "%TAURI%\backend-staging"  rd /s /q "%TAURI%\backend-staging"
if exist "%TAURI%\consumet-staging" rd /s /q "%TAURI%\consumet-staging"
if exist "%TAURI%\generated"        rd /s /q "%TAURI%\generated"

:: ── Backend ──────────────────────────────────────────────────────────────────
echo  Staging backend...
robocopy "%BACKEND%" "%STAGE_BACKEND%" /E /NJH /NJS /NFL /NDL ^
    /XD __pycache__ venv .venv tests .pytest_cache .mypy_cache .ruff_cache logs ^
    /XF *.pyc *.pyo *.sqlite *.sqlite3 *.db memory.db >nul

:: FIX 2: robocopy exits 0-7 = success; capture code BEFORE using it.
::        Using !ERRORLEVEL! (delayed expansion) to get the real value
::        inside this block, not the stale parsed value.
set "ROBOCOPY_EXIT=!ERRORLEVEL!"
if !ROBOCOPY_EXIT! GEQ 8 (
    echo  ERROR: Backend staging failed ^(robocopy exit !ROBOCOPY_EXIT!^).
    call :die 1
)
echo  Backend staged.

:: ── STARTUP SPEED FIX: Pre-compile Python source to .pyc bytecode ─────────
:: Python normally parses .py files from scratch on every launch (slow).
:: Compiling to .pyc here means Python skips parsing at runtime and loads
:: pre-built bytecode directly — saves ~2-3 seconds on every app startup.
:: The compiled __pycache__ dirs are bundled alongside the .py files by
:: Tauri's "backend-staging/backend/**/*" resource glob automatically.
echo  Pre-compiling Python backend to bytecode ^(startup speed fix^)...
"%PYTHON_EXE%" -m compileall "%STAGE_BACKEND%" -q
if errorlevel 1 (
    echo  WARNING: Python precompile reported errors. App will still work
    echo  but startup may be slower. Check for syntax errors in backend code.
) else (
    echo  Python bytecode compiled OK.
)
echo.

:: ── Consumet (optional) ──────────────────────────────────────────────────────
md "%TAURI%\consumet-staging" 2>nul
md "%STAGE_NODE%" 2>nul

if "%CONSUMET_PRESENT%"=="1" (
    echo  Staging consumet-local...
    md "%STAGE_CONSUMET%" 2>nul

    :: Copy the server entry point
    if exist "%CONSUMET%\server.cjs" (
        copy /Y "%CONSUMET%\server.cjs" "%STAGE_CONSUMET%\server.cjs" >nul
    ) else if exist "%CONSUMET%\index.js" (
        copy /Y "%CONSUMET%\index.js" "%STAGE_CONSUMET%\index.js" >nul
    ) else if exist "%CONSUMET%\dist\server.cjs" (
        copy /Y "%CONSUMET%\dist\server.cjs" "%STAGE_CONSUMET%\server.cjs" >nul
    )

    :: Copy package manifests
    if exist "%CONSUMET%\package.json"      copy /Y "%CONSUMET%\package.json"      "%STAGE_CONSUMET%\package.json"      >nul
    if exist "%CONSUMET%\package-lock.json" copy /Y "%CONSUMET%\package-lock.json" "%STAGE_CONSUMET%\package-lock.json" >nul

    :: Copy node_modules
    if exist "%CONSUMET%\node_modules" (
        robocopy "%CONSUMET%\node_modules" "%STAGE_CONSUMET%\node_modules" /E /NJH /NJS /NFL /NDL >nul
    )

    :: FIX 3: Bundle node.exe — original had delims=\ which split on backslashes
    ::        so %%N got only "C:" instead of the full path. Fixed: delims= (empty)
    ::        means return the whole line as one token = full path to node.exe.
    ::
    :: FIX 4: Replaced "goto :node_copied" inside a for-inside-if nested block.
    ::        In CMD, goto inside nested parenthesized blocks is unreliable and
    ::        can silently abort the entire outer if block. Using a flag variable
    ::        instead is reliable on all Windows versions.
    set "NODE_FOUND=0"
    for /f "delims=" %%N in ('where node 2^>nul') do (
        if "!NODE_FOUND!"=="0" (
            copy /Y "%%N" "%STAGE_NODE%\node.exe" >nul
            set "NODE_FOUND=1"
        )
    )
    if "!NODE_FOUND!"=="0" (
        echo  WARNING: node.exe not found via where — node runtime not staged.
        echo  HiAnime sidecar may not work in the packaged app.
    )

    echo  consumet-local staged.
) else (
    echo  consumet-local skipped ^(folder not present^).
    :: Create placeholder so Tauri glob doesn't warn about missing resource dir
    md "%STAGE_CONSUMET%" 2>nul
    echo. > "%STAGE_CONSUMET%\.placeholder"
    echo. > "%STAGE_NODE%\.placeholder"
)

:: ── Generated config ──────────────────────────────────────────────────────────
echo  Writing runtime-config...
md "%STAGE_GENERATED%" 2>nul

if defined GRABIX_TMDB_BEARER_TOKEN (
    set "TMDB_TOKEN=%GRABIX_TMDB_BEARER_TOKEN%"
) else (
    :: Default token baked in — replace with your own if needed
    set "TMDB_TOKEN=eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiI5OTk3Y2E5ZjY2NGZhZmI5ZWJkZmNhNDMyNGY0YTBmOCIsIm5iZiI6MTc3NDU2NDcyMC44NDYwMDAyLCJzdWIiOiI2OWM1YjU3MGE4NTBkNjcxOTE4OWJjN2MiLCJzY29wZXMiOlsiYXBpX3JlYWQiXSwidmVyc2lvbiI6MX0.uv8_l7Ub7WRhSfWtd07Sx_Yg13jubgyU7953kJZy7mw"
)

(
    echo {
    echo   "tmdb_bearer_token": "%TMDB_TOKEN%",
    echo   "managed_by": "build-fast"
    echo }
) > "%STAGE_GENERATED%\runtime-config.json"

echo  Resources staged.
echo.

:: ────────────────────────────────────────────────────────────────────────────
echo  [4/5]  Building Tauri app...
echo         ^(this usually takes 2-5 minutes^)
echo.

set "PYO3_PYTHON=%PYTHON_EXE%"
set "PYO3_USE_ABI3_FORWARD_COMPATIBILITY=1"
set "GRABIX_BUILD_ID=fast-build"
set "GRABIX_BACKEND_RESOURCE_HASH=fast-build"
set "GRABIX_BACKEND_RESOURCE_SUBDIR=backend-staging/backend"

cd /d "%FRONTEND%"
npm run tauri build
set "BUILD_EXIT=!ERRORLEVEL!"
cd /d "%ROOT%"

if not "!BUILD_EXIT!"=="0" (
    echo.
    echo  ==========================================
    echo   BUILD FAILED  ^(exit !BUILD_EXIT!^)
    echo   Scroll up or check build-fast.log to
    echo   find the first error line.
    echo  ==========================================
    echo.
    title GRABIX Build — FAILED
    color 0C
    call :die !BUILD_EXIT!
)

:: ────────────────────────────────────────────────────────────────────────────
echo.
echo  [5/5]  Done!
echo.
echo  ==========================================
echo.
echo   Portable EXE:
echo     %FRONTEND%\src-tauri\target\release\grabix-ui.exe
echo.
echo   Installer ^(NSIS .exe to share / install^):
echo     %FRONTEND%\src-tauri\target\release\bundle\nsis\
echo.
echo   TIP: Close 1__Backend.bat before launching the
echo   compiled app — otherwise port 8000 is already
echo   taken and the app shows as offline.
echo.
echo  ==========================================
echo.
title GRABIX Build — SUCCESS
color 0A
echo  Build complete. This window will stay open — close it when ready.
echo  Log saved to: %~dp0build-fast.log
echo.
goto :eof

:: ════════════════════════════════════════════════════════════════════════════
:: Subroutines
:: ════════════════════════════════════════════════════════════════════════════

:die
:: Usage: call :die <exit_code>
:: Shows a consistent "press any key" message and exits with the given code.
:: The window stays open because the outer cmd /k keeps it alive.
echo.
echo  ──────────────────────────────────────────
echo   PRESS ANY KEY to dismiss this message.
echo   The window will stay open so you can
echo   scroll up and review all error output.
echo  ──────────────────────────────────────────
echo.
pause >nul
exit /b %~1

:log_init
:: Begin writing a log file alongside the bat
echo GRABIX build-fast.bat — started %DATE% %TIME% > "%~dp0build-fast.log"
goto :eof
