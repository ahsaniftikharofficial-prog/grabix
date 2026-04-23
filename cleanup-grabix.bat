@echo off
title GRABIX — Cleanup Unnecessary Files
color 0C
setlocal

echo.
echo  ==========================================
echo    GRABIX — Cleanup Script
echo    Removes anime + junk files from disk
echo  ==========================================
echo.

REM ── Run from the GRABIX project root ─────────────────────────────────────────
cd /d "%~dp0"

echo  [CHECK] Making sure we're in the right folder...
if not exist "backend\main.py" (
    echo.
    echo  [ERROR] Could not find backend\main.py
    echo  Make sure this .bat file is in your GRABIX project root folder.
    echo.
    pause
    exit /b 1
)
echo  [OK] Project root confirmed.
echo.

echo  ─────────────────────────────────────────
echo   ANIME BACKEND FILES
echo  ─────────────────────────────────────────

REM anime/ module
if exist "backend\anime" (
    rd /s /q "backend\anime"
    echo  [DELETED] backend\anime\
) else (
    echo  [SKIP]    backend\anime\ ^(not found^)
)

REM aniwatch routes
call :del_file "backend\app\routes\aniwatch.py"
call :del_file "backend\app\routes\aniwatch_routes.py"
call :del_file "backend\app\routes\consumet.py"
call :del_file "backend\app\routes\consumet_anime_debug.py"
call :del_file "backend\app\routes\consumet_anime_stream.py"
call :del_file "backend\app\routes\consumet_helpers.py"

REM aniwatch services
call :del_file "backend\app\services\aniwatch.py"
call :del_file "backend\app\services\aniwatch_service.py"
call :del_file "backend\app\services\consumet.py"
call :del_file "backend\app\services\megacloud.py"

REM anime test
call :del_file "backend\tests\test_hls_sync_regression.py"

echo.
echo  ─────────────────────────────────────────
echo   ANIME FRONTEND FILES
echo  ─────────────────────────────────────────

REM Anime pages folder
if exist "grabix-ui\src\pages\Anime" (
    rd /s /q "grabix-ui\src\pages\Anime"
    echo  [DELETED] grabix-ui\src\pages\Anime\
) else (
    echo  [SKIP]    grabix-ui\src\pages\Anime\ ^(not found^)
)

call :del_file "grabix-ui\src\pages\AnimePage.tsx"
call :del_file "grabix-ui\src\pages\AnimePageV2.tsx"
call :del_file "grabix-ui\src\lib\aniwatchProviders.ts"
call :del_file "grabix-ui\src\lib\consumetProviders.ts"

echo.
echo  ─────────────────────────────────────────
echo   CONSUMET SIDECAR
echo  ─────────────────────────────────────────

if exist "consumet-local" (
    rd /s /q "consumet-local"
    echo  [DELETED] consumet-local\
) else (
    echo  [SKIP]    consumet-local\ ^(not found^)
)

call :del_file "scripts\start-consumet.cmd"
call :del_file "3__Consumet_api.bat"

echo.
echo  ─────────────────────────────────────────
echo   JUNK / SCRATCH FILES
echo  ─────────────────────────────────────────

call :del_file "1804"
call :del_file "direct"
call :del_file "backend\all_tests_results.txt"
call :del_file "backend\test_shape_results.txt"
call :del_file "test_shape_results.txt"

echo.
echo  ==========================================
echo   Done! All unnecessary files removed.
echo  ==========================================
echo.
pause
exit /b 0


REM ── Helper: delete a single file with status output ───────────────────────────
:del_file
if exist "%~1" (
    del /f /q "%~1"
    echo  [DELETED] %~1
) else (
    echo  [SKIP]    %~1 ^(not found^)
)
exit /b 0
