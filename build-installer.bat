@echo off
setlocal
cd /d "%~dp0"

echo.
echo ==========================================
echo   GRABIX Installer Build
echo ==========================================
echo.

set "PYO3_USE_ABI3_FORWARD_COMPATIBILITY=1"

echo Running:
echo powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0build-installer.ps1" %*
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0build-installer.ps1" %*
set "EXIT_CODE=%ERRORLEVEL%"

echo.
if "%EXIT_CODE%"=="0" (
    echo Installer build finished.
    echo Main exe:
    echo %~dp0grabix-ui\src-tauri\target\release\grabix-ui.exe
    echo.
    echo Installer folder:
    echo %~dp0grabix-ui\src-tauri\target\release\bundle\nsis
    echo.
    echo Installer files:
    dir /b "%~dp0grabix-ui\src-tauri\target\release\bundle\nsis\*.exe"
) else (
    echo Installer build failed with exit code %EXIT_CODE%.
)
echo.
pause
exit /b %EXIT_CODE%
