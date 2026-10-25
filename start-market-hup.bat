@echo off
cd /d "%~dp0"
echo جاري تشغيل المشروع...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0\scripts\start-site.ps1"
exit /b %ERRORLEVEL%
