@echo off
setlocal
set "CONSUMET_DIR=%~1"
set "CONSUMET_PORT=%~2"
set "CONSUMET_LOG=%~3"

cd /d "%CONSUMET_DIR%"
set "PORT=%CONSUMET_PORT%"
node server.cjs --port "%CONSUMET_PORT%" --site-base "https://aniwatchtv.to" >> "%CONSUMET_LOG%" 2>&1
