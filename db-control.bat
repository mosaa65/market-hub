@echo off
chcp 65001 >nul
title Market Hub - لوحة تحكم قواعد البيانات و Supabase
color 0B
cd /d "%~dp0"

:MENU
cls
echo ===============================================================================
echo            MARKET HUB - لوحة تحكم قواعد البيانات و SUPABASE
echo ===============================================================================
echo.
echo   [1] تشغيل Supabase المحلي (Docker Start)
echo   [2] إيقاف Supabase المحلي (Docker Stop)
echo   [3] فحص حالة وروابط Supabase المحلي (Status)
echo   [4] تطبيق التحديثات على قاعدة حالية بأمان (Safe Migrate - دون مسح بيانات)
echo   [5] إعادة بناء وتأسيس محلي جديد (Rebuild - مع عينات المطحنة وبيانات النظام)
echo   [6] دفع التحديثات إلى Supabase السحابي (Cloud Push)
echo   [7] أخذ نسخة احتياطية محلية لقاعدة البيانات (Backup)
echo   [8] تشغيل واجهة التطبيق في المتصفح (Start App / npm run dev)
echo   [9] قراءة الدليل الشامل لقواعد البيانات (Open Master Guide)
echo   [0] خروج
echo.
echo ===============================================================================
set /p choice="اختر رقم العملية [0-9]: "

if "%choice%"=="1" goto START_LOCAL
if "%choice%"=="2" goto STOP_LOCAL
if "%choice%"=="3" goto STATUS_LOCAL
if "%choice%"=="4" goto MIGRATE_LOCAL
if "%choice%"=="5" goto REBUILD_LOCAL
if "%choice%"=="6" goto PUSH_CLOUD
if "%choice%"=="7" goto BACKUP
if "%choice%"=="8" goto START_APP
if "%choice%"=="9" goto OPEN_GUIDE
if "%choice%"=="0" exit /b 0

echo خيار غير صحيح، الرجاء اختيار رقم بين 0 و 9.
timeout /t 2 >nul
goto MENU

:START_LOCAL
cls
echo [تشغيل Supabase المحلي على Docker...]
echo تأكد أن برنامج Docker Desktop قيد التشغيل في جهازك.
echo.
call npx supabase start
echo.
pause
goto MENU

:STOP_LOCAL
cls
echo [إيقاف Supabase المحلي...]
call npx supabase stop
echo.
pause
goto MENU

:STATUS_LOCAL
cls
echo [فحص حالة وخدمات Supabase المحلي...]
call powershell -NoProfile -ExecutionPolicy Bypass -File scripts\db-local-status.ps1
echo.
pause
goto MENU

:MIGRATE_LOCAL
cls
echo [تطبيق الترحيلات بأمان دون مسح بيانات العميل...]
call powershell -NoProfile -ExecutionPolicy Bypass -File scripts\apply-local-migrations.ps1
echo.
pause
goto MENU

:REBUILD_LOCAL
cls
echo ===============================================================================
echo تنبيه: هذا الخيار مخصص لإعادة تأسيس قاعدة Docker بالكامل وتطبيق عينة المطحنة.
echo سيطلب منك كتابة عبارة تأكيد لحماية بياناتك.
echo ===============================================================================
echo.
call powershell -NoProfile -ExecutionPolicy Bypass -File scripts\db-local-rebuild.ps1
echo.
pause
goto MENU

:PUSH_CLOUD
cls
echo ===============================================================================
echo دفع التحديثات إلى مشروع Supabase السحابي (Cloud Push)
echo هذا الأمر يرفع فقط ملفات الترحيل والبذور النظامية الآمنة دون مسح أي بيانات.
echo ===============================================================================
echo.
call powershell -NoProfile -ExecutionPolicy Bypass -File scripts\push-cloud.ps1
echo.
pause
goto MENU

:BACKUP
cls
echo [أخذ نسخة احتياطية من قاعدة البيانات المحلية...]
call powershell -NoProfile -ExecutionPolicy Bypass -File scripts\local_backup.ps1
echo.
pause
goto MENU

:START_APP
cls
echo [بدء تشغيل خادم التطبيق المحلي...]
start "" "http://localhost:3000"
call npm run dev
pause
goto MENU

:OPEN_GUIDE
cls
echo [فتح الدليل الشامل لقواعد البيانات...]
if exist "docs\DATABASE_MASTER_GUIDE.md" (
    start notepad.exe "docs\DATABASE_MASTER_GUIDE.md"
) else (
    echo ملف الدليل غير موجود.
)
goto MENU
