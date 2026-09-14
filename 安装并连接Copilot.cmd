@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Please install Node.js 22+ with npm from https://nodejs.org/
) else (
  node scripts/setup-copilot.mjs
)
pause
