@echo off
setlocal
set SCRIPT_DIR=%~dp0
set EXECUTABLE=%SCRIPT_DIR%..\..\eve.exe

if not exist "%EXECUTABLE%" (
  echo eve desktop executable not found: %EXECUTABLE% 1>&2
  exit /b 1
)

"%EXECUTABLE%" --cli %*
