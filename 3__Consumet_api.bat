@echo off
title GRABIX HiAnime Gateway
color 0E
cd /d "%~dp0consumet-local"

echo.
echo  ==========================================
echo    GRABIX HiAnime Gateway
echo    Running at http://127.0.0.1:3000
echo    Keep this window open.
echo  ==========================================
echo.

REM Install packages if first time
if not exist "node_modules" (
    echo  [SETUP] First time setup - installing packages...
    npm install
    echo.
)

node server.cjs --port 3000 --site-base "https://aniwatchtv.to"

echo.
echo  ==========================================
echo    HiAnime gateway stopped. See error above.
echo  ==========================================
pause
