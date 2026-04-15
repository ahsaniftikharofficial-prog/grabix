@echo off
setlocal
cd /d "%~dp0"

echo.
echo ==========================================
echo   GRABIX Installer Build
echo ==========================================
echo.

C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe -ExecutionPolicy Bypass -File "%~dp0build-installer.ps1" %*
set "EXIT_CODE=%ERRORLEVEL%"

echo.
if "%EXIT_CODE%"=="0" (
    echo Installer build finished.
    echo Output folder:
    echo %~dp0grabix-ui\src-tauri\target\release\bundle\nsis
) else (
    echo Installer build failed with exit code %EXIT_CODE%.
)
echo.
pause
exit /b %EXIT_CODE%
