@echo off
title GRABIX Frontend
color 0B
cd /d "%~dp0grabix-ui"

echo.
echo  ==========================================
echo    GRABIX Frontend
echo    Running at http://127.0.0.1:5173
echo    Keep this window open.
echo  ==========================================
echo.

REM Tell the frontend where the backend is
echo VITE_GRABIX_API_BASE=http://127.0.0.1:8000 > .env.development.local

REM Install packages if first time
if not exist "node_modules" (
    echo  [SETUP] First time setup - installing packages...
    npm install
    echo.
)

npm run dev

echo.
echo  ==========================================
echo    Frontend stopped. See error above.
echo  ==========================================
pause
