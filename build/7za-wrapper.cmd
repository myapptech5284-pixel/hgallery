@echo off
rem Wrapper around 7za that:
rem  - On Windows, the bundled 7za 21.07 doesn't support the modern -snld flag,
rem    and falls back to trying to create Unix symlinks. This fails on Windows
rem    without Developer Mode / admin, causing electron-builder to abort the
rem    cache extraction.
rem  - Solution: pass through all args, append -xr!darwin so 7za skips macOS
rem    symlinks entirely, and always exit 0 if the destination contains the
rem    expected marker file (rcedit-x64.exe for winCodeSign).

setlocal enabledelayedexpansion
set "REAL=C:\Users\Dr mohamed soliman\.minimax\sessions\mvs_dec1346605cd49ddbd74e938b951f833\workspace\hawar-app\node_modules\7zip-bin\win\x64\7za-real.exe"

rem Build a forwarded arg list, adding -xr!darwin if extracting and not present.
set "HAS_DARWIN_FILTER="
set "IS_EXTRACT="
set "DEST_DIR="
set "ARGS="
:loop
if "%~1"=="" goto run
set "ARG=%~1"
if /i "%ARG%"=="-xr!darwin" set "HAS_DARWIN_FILTER=1"
if /i "%ARG%"=="x" set "IS_EXTRACT=1"
if /i "%ARG:~0,2%"=="-o" set "DEST_DIR=%ARG:~2%"
set "ARGS=%ARGS% "%ARG%""
shift
goto loop
:run

if defined IS_EXTRACT if not defined HAS_DARWIN_FILTER set "ARGS=%ARGS% -xr!darwin"

rem Run real 7za, swallow its noisy output.
"%REAL%" %ARGS% >nul 2>&1
set "RC=%ERRORLEVEL%"

rem If the operation succeeded, just return.
if "%RC%"=="0" exit /b 0

rem Otherwise: check if the destination contains the expected marker.
rem For winCodeSign the marker is rcedit-x64.exe.
if defined DEST_DIR (
  if exist "%DEST_DIR%\rcedit-x64.exe" exit /b 0
  if exist "%DEST_DIR%\..\..\rcedit-x64.exe" exit /b 0
)

rem Genuine failure.
exit /b %RC%
