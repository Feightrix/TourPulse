@echo off
setlocal EnableExtensions DisableDelayedExpansion

title TourPulse Quick EOD - Startup Repair

set "APP_NAME=TourPulse Quick EOD"
set "RUN_KEY=HKCU\Software\Microsoft\Windows\CurrentVersion\Run"
set "STARTUP_DIR=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "STARTUP_CMD=%STARTUP_DIR%\TourPulse Quick EOD Startup.cmd"
set "TARGET=%LOCALAPPDATA%\Programs\TourPulse Quick EOD\TourPulse Quick EOD.exe"

if exist "%~dp0TourPulse Quick EOD.exe" set "TARGET=%~dp0TourPulse Quick EOD.exe"

if not exist "%TARGET%" (
  for %%F in ("%~dp0TourPulse-Quick-EOD-*.exe") do (
    if exist "%%~fF" set "TARGET=%%~fF"
  )
)

if not exist "%TARGET%" (
  echo TourPulse Quick EOD could not be found.
  echo.
  echo Use the Install-or-Patch package instead; it contains the full program.
  pause
  exit /b 2
)

reg add "%RUN_KEY%" /v "%APP_NAME%" /t REG_SZ /d "\"%TARGET%\" --tourpulse-startup" /f >nul 2>&1
if errorlevel 1 goto :fail

if not exist "%STARTUP_DIR%" mkdir "%STARTUP_DIR%" >nul 2>&1
(
  echo @echo off
  echo start "" "%TARGET%" --tourpulse-startup
) > "%STARTUP_CMD%"

reg query "%RUN_KEY%" /v "%APP_NAME%" >nul 2>&1
if errorlevel 1 goto :fail

start "" "%TARGET%"

echo.
echo TourPulse Windows startup has been repaired.
echo Target:
echo   %TARGET%
timeout /t 4 /nobreak >nul
exit /b 0

:fail
echo.
echo TourPulse startup could not be repaired for this Windows user.
pause
exit /b 1
