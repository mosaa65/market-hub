@echo off
chcp 65001 >nul
title Market Hub - ربط الدومين المحلي (market-hub.local)
color 0B
cd /d "%~dp0"

echo ===============================================================================
echo            MARKET HUB - ربط اسم الدومين المحلي (market-hub.local)
echo ===============================================================================
echo.
echo هذا السكربت يربط عنوان [market-hub.local] بجهازك مباشرة (127.0.0.1)
echo حتى تتمكن من فتح النظام عبر الرابط: http://market-hub.local:3000
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
    $hosts = 'C:\Windows\System32\drivers\etc\hosts';
    $entry = '127.0.0.1 market-hub.local';
    $content = Get-Content $hosts -Raw -ErrorAction SilentlyContinue;
    if ($content -match 'market-hub\.local') {
        Write-Host 'الدومين [market-hub.local] مربوط بالفعل في ملف hosts!' -ForegroundColor Green;
    } else {
        Add-Content -Path $hosts -Value \"`n# Market Hub Local Domain`n$entry\" -Encoding UTF8;
        Write-Host 'تم ربط الدومين [market-hub.local] بنجاح في ملف hosts!' -ForegroundColor Green;
    }
}"

echo.
echo ===============================================================================
echo الآن يمكنك فتح النظام عبر: http://market-hub.local:3000
echo ===============================================================================
echo.
pause
