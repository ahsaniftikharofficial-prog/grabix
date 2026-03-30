@echo off
setlocal
set "CONSUMET_DIR=%~1"
set "CONSUMET_PORT=%~2"
set "CONSUMET_LOG=%~3"

cd /d "%CONSUMET_DIR%"
set "PORT=%CONSUMET_PORT%"
npm.cmd start >> "%CONSUMET_LOG%" 2>&1
