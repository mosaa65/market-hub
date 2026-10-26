@echo off
cd /d "%~dp0"
title Market Hub - Launcher
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-site.ps1"
if %ERRORLEVEL% NEQ 0 (
    echo.
    pause
)
