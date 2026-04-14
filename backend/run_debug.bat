@echo off
title GRABIX Backend Debug
cd /d "%~dp0"
echo Starting GRABIX backend...
echo.
venv\Scripts\python.exe -u main.py
echo.
echo ===================================
echo  Backend exited. See error above.
echo  Press any key to close.
echo ===================================
pause