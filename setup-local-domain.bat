@echo off
chcp 65001 >nul
title Vortex ERP - ربط الدومين الفخم (vortex.erp)
color 0B
cd /d "%~dp0"

echo ===============================================================================
echo            VORTEX ERP - ربط اسم الدومين المحلي الفخم (vortex.erp)
echo ===============================================================================
echo.
echo هذا السكربت يربط دومين النظام الاحترافي [vortex.erp] بجهازك مباشرة (127.0.0.1)
echo حتى تتمكن من فتح النظام عبر الرابط: http://vortex.erp:3000
echo.
echo يتطلب هذا الإجراء صلاحيات المدير (Run as Administrator) لتعديل ملف hosts.
echo.

net session >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [تنبيه] جاري طلب صلاحيات المدير تلقائياً...
    powershell -Command "Start-Process cmd -ArgumentList '/c \"\"%~f0\"\"' -Verb RunAs"
    exit /b
)

powershell -NoProfile -ExecutionPolicy Bypass -Command "& {
    `$hosts = 'C:\Windows\System32\drivers\etc\hosts';
    `$entries = @(
        '127.0.0.1 vortex.erp',
        '127.0.0.1 app.vortex.erp',
        '127.0.0.1 market-hub.local'
    );
    `$content = Get-Content `$hosts -Raw -ErrorAction SilentlyContinue;
    `$added = 0;
    foreach (`$entry in `$entries) {
        `$domain = (`$entry -split '\s+')[1];
        if (`$content -notmatch [regex]::Escape(`$domain)) {
            Add-Content -Path `$hosts -Value \"`n`$entry\" -Encoding UTF8;
            `$added++;
        }
    }
    Write-Host 'تم تحديث ملف hosts بنجاح!' -ForegroundColor Green;
    Write-Host 'الدومينات المفعلة الآن: vortex.erp و app.vortex.erp' -ForegroundColor Green;
}"

echo.
echo ===============================================================================
echo الآن يمكنك فتح النظام عبر الرابط الاحترافي:
echo   -> http://vortex.erp:3000
echo   -> http://app.vortex.erp:3000
echo ===============================================================================
echo.
pause
