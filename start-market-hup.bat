@echo off
chcp 65001 >nul
title Market Hub - مشغل النظام
color 0A
cd /d "%~dp0"

echo ===============================================================================
echo            MARKET HUB - جاري بدء تشغيل النظام...
echo ===============================================================================
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0\scripts\start-site.ps1"

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo حدث خطأ أثناء تشغيل النظام. يرجى مراجعة الرسائل أعلاه.
    pause
)
