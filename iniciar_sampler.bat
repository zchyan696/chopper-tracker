@echo off
setlocal
set DIR=%~dp0

:: Mata qualquer processo antigo na porta 7270
for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr ":7270 "') do (
    taskkill /F /PID %%a >nul 2>&1
)
timeout /t 1 /nobreak >nul

:: Tenta pythonw (sem janela de terminal)
where pythonw >nul 2>&1
if %errorlevel%==0 (
    start "" pythonw "%DIR%server.py"
    goto :open
)

:: Fallback: janela minimizada
start /min "" python "%DIR%server.py"

:open
timeout /t 2 /nobreak >nul
start "" "%DIR%sampler.html"
