@echo off
setlocal
echo ============================================================
echo  GRABIX — Nuitka Backend Compiler
echo  Compiles your Python backend into a native .exe
echo  First run: 15-30 minutes (compiling C code)
echo  Subsequent runs: faster (Nuitka caches compiled C)
echo ============================================================
echo.

cd /d "%~dp0"

REM Install all backend dependencies first
echo [1/4] Installing backend requirements...
pip install -r backend\requirements.txt --quiet
if %errorlevel% neq 0 (
    echo ERROR: Failed to install backend\requirements.txt
    pause & exit /b 1
)

REM Install Nuitka and required helpers
echo [2/4] Installing Nuitka...
pip install nuitka ordered-set zstandard --quiet
if %errorlevel% neq 0 (
    echo ERROR: pip install failed. Make sure Python and pip are in your PATH.
    pause & exit /b 1
)

REM Create output directory
if not exist "grabix-ui\src-tauri\backend-compiled" (
    mkdir "grabix-ui\src-tauri\backend-compiled"
)

echo [3/4] Compiling backend with Nuitka...
echo       This will take a while. Go make some tea.
echo.

python -m nuitka ^
  --standalone ^
  --onefile ^
  --output-filename=grabix-backend.exe ^
  --output-dir=grabix-ui\src-tauri\backend-compiled ^
  --windows-console-mode=disable ^
  --include-package=uvicorn ^
  --include-package=uvicorn.loops ^
  --include-package=uvicorn.protocols ^
  --include-package=uvicorn.middleware ^
  --include-package=anyio._backends ^
  --include-package=yt_dlp ^
  --include-package=app ^
  --include-package=core ^
  --include-package=downloads ^
  backend\main.py

if %errorlevel% neq 0 (
    echo.
    echo ERROR: Nuitka compilation failed. See output above for details.
    pause & exit /b 1
)

echo.
echo [4/4] Done!
echo ============================================================
echo  Compiled backend saved to:
echo  grabix-ui\src-tauri\backend-compiled\grabix-backend.exe
echo.
echo  Now just build GRABIX normally with:
echo    npm run tauri build
echo.
echo  The app will automatically use the compiled backend.
echo  Startup time will be under 1 second.
echo ============================================================
pause
