@echo off
REM سكريبت النسخ الاحتياطي التلقائي

setlocal enabledelayedexpansion
for /f "tokens=2-4 delims=/ " %%a in ('date /t') do (set mydate=%%c-%%a-%%b)
for /f "tokens=1-2 delims=/:" %%a in ('time /t') do (set mytime=%%a-%%b)

set BACKUP_FILE=backups\backup-%mydate%-%mytime%.sql
set NETWORK=supabase_network_kwzqvgdyadylwnvjghqn
set DB_CONTAINER=supabase_db_kwzqvgdyadylwnvjghqn

if not exist backups mkdir backups

echo [%date% %time%] بدء النسخ الاحتياطي...

docker run --rm ^
  --network %NETWORK% ^
  -v %cd%\backups:/backups ^
  public.ecr.aws/supabase/postgres:17.6.1.166 ^
  pg_dump -h %DB_CONTAINER% -U postgres postgres > %BACKUP_FILE%

if %ERRORLEVEL% EQU 0 (
  echo [%date% %time%] ✓ النسخة الاحتياطية: %BACKUP_FILE%
) else (
  echo [%date% %time%] ✗ خطأ في النسخ الاحتياطي
)
