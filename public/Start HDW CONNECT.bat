@echo off
setlocal
cd /d "%~dp0"

where py >nul 2>nul
if %errorlevel%==0 (
  py -3 "run-local-pwa.py"
  goto :done
)

where python >nul 2>nul
if %errorlevel%==0 (
  python "run-local-pwa.py"
  goto :done
)

echo Python is not installed on this PC, so the local app server could not start.
echo Ask your IT support person to install Python 3, then double-click this file again.
pause

:done
endlocal
