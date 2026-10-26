@echo off
setlocal EnableExtensions DisableDelayedExpansion

title TourPulse Quick EOD - Install or Patch

set "APP_NAME=TourPulse Quick EOD"
set "INSTALL_DIR=%LOCALAPPDATA%\Programs\TourPulse Quick EOD"
set "INSTALL_EXE=%INSTALL_DIR%\TourPulse Quick EOD.exe"
set "SOURCE_EXE=%~dp0TourPulse Quick EOD.exe"
set "RUN_KEY=HKCU\Software\Microsoft\Windows\CurrentVersion\Run"
set "STARTUP_DIR=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "STARTUP_CMD=%STARTUP_DIR%\TourPulse Quick EOD Startup.cmd"
set "LOG=%TEMP%\TourPulse-Install-or-Patch.log"

echo [%date% %time%] Starting TourPulse Install or Patch>"%LOG%"

if not exist "%SOURCE_EXE%" (
  echo ERROR: The full TourPulse program is missing from this package.
  echo [%date% %time%] Missing source EXE: %SOURCE_EXE%>>"%LOG%"
  echo.
  echo Keep "Install-or-Patch-TourPulse.cmd" in the same folder as "TourPulse Quick EOD.exe".
  pause
  exit /b 2
)

if exist "%INSTALL_EXE%" (
  set "MODE=PATCH"
  echo Existing TourPulse installation found. Applying patch...
) else (
  set "MODE=INSTALL"
  echo TourPulse is not installed in the standard location. Installing full program...
)

taskkill /IM "TourPulse Quick EOD.exe" /F >nul 2>&1
timeout /t 1 /nobreak >nul 2>&1

if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%" >nul 2>&1
if errorlevel 1 goto :fail

copy /Y "%SOURCE_EXE%" "%INSTALL_EXE%" >nul
if errorlevel 1 goto :fail

if not exist "%STARTUP_DIR%" mkdir "%STARTUP_DIR%" >nul 2>&1
(
  echo @echo off
  echo start "" "%INSTALL_EXE%" --tourpulse-startup
) > "%STARTUP_CMD%"

start "" "%INSTALL_EXE%"
timeout /t 3 /nobreak >nul 2>&1

reg query "%RUN_KEY%" /v "%APP_NAME%" >>"%LOG%" 2>&1
if errorlevel 1 (
  echo [%date% %time%] HKCU Run verification unavailable; Startup-folder fallback remains active.>>"%LOG%"
)

echo.
if /I "%MODE%"=="PATCH" (
  echo TourPulse Quick EOD was patched successfully.
) else (
  echo TourPulse Quick EOD was installed successfully.
)
echo.
echo Windows startup is now registered in TWO user-level places:
echo   1. HKCU Run
echo   2. Windows Startup folder fallback
echo.
echo Installed program:
echo   %INSTALL_EXE%
echo.
echo No administrator access was required.
echo [%date% %time%] Success mode=%MODE% install=%INSTALL_EXE%>>"%LOG%"
timeout /t 4 /nobreak >nul
exit /b 0

:fail
echo.
echo TourPulse could not complete the install/patch.
echo See this log:
echo   %LOG%
echo [%date% %time%] FAILED>>"%LOG%"
pause
exit /b 1
