@echo off
chcp 65001 >nul
title Vortex ERP - مشغل النظام الذكي
color 0A
cd /d "%~dp0"

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0\scripts\start-site.ps1"

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [تنبيه] تم إيقاف الخادم أو حدث خطأ أثناء التشغيل.
    pause
)
