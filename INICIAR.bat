@echo off
cd /d "%~dp0"
echo.
echo  Iniciando CHOPPER TRACKER...
echo.
start "" "http://localhost:8080"
node server.js
pause
