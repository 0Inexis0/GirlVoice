@echo off
setlocal
cd /d "%~dp0"

rem Prefer the portable build. No Node.js installation is needed for it.
if exist "release\GirlVoice-0.1.0-Windows.exe" (
  start "GirlVoice" "release\GirlVoice-0.1.0-Windows.exe"
  exit /b 0
)
if exist "release\win-unpacked\GirlVoice.exe" (
  start "GirlVoice" "release\win-unpacked\GirlVoice.exe"
  exit /b 0
)

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js fehlt. Bitte Node.js 22 oder neuer installieren:
  echo https://nodejs.org/
  pause
  exit /b 1
)
node -e "process.exit(Number(process.versions.node.split('.')[0]) < 22 ? 1 : 0)"
if errorlevel 1 (
  echo Bitte Node.js auf Version 22 oder neuer aktualisieren.
  pause
  exit /b 1
)
where npm.cmd >nul 2>nul
if errorlevel 1 (
  echo npm fehlt. Bitte Node.js inklusive npm installieren.
  pause
  exit /b 1
)
if not exist "node_modules\electron\dist\electron.exe" (
  echo GirlVoice wird eingerichtet. Dies kann einige Minuten dauern.
  call npm.cmd ci
  if errorlevel 1 goto failed
)
call npm.cmd start
if errorlevel 1 goto failed
exit /b 0

:failed
echo.
echo GirlVoice konnte nicht gestartet werden. Details stehen oben.
pause
exit /b 1
