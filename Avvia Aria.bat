@echo off
cd /d "%~dp0"
echo Avvio Aria...
start "" cmd /c "npm run dev -- --host"
timeout /t 4 /nobreak >nul
start "" http://localhost:5173
