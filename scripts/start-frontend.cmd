@echo off
setlocal
set "FRONTEND_DIR=%~1"
set "FRONTEND_PORT=%~2"
set "FRONTEND_LOG=%~3"

cd /d "%FRONTEND_DIR%"
npm.cmd run dev -- --host 127.0.0.1 --port %FRONTEND_PORT% >> "%FRONTEND_LOG%" 2>&1
