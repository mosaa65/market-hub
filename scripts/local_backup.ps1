# ============================================================================
# scripts/local_backup.ps1
#
# نسخ احتياطي كامل على مستوى الملفات لقاعدة بيانات Supabase المحلية (Docker)
# عبر pg_dump — ينتج ملف SQL حقيقي قابل للاستعادة بنقرة واحدة.
#
# الاستخدام:
#   .\scripts\local_backup.ps1                     # نسخة عادية
#   .\scripts\local_backup.ps1 -Keep 10            # الاحتفاظ بآخر 10 نسخ
#   .\scripts\local_backup.ps1 -CopyTo "D:\Backups","E:\USB"   # مسارات إضافية
#
# النسخ تُكتب في مجلد backups/ داخل المشروع تلقائياً، وبأي مسارات إضافية
# يحددها المستخدم. الصلاحيات (RLS) مشمولة لأن pg_dump يأخذ كل المخطط.
# ============================================================================

param(
  [int]$Keep = 20,
  [string[]]$CopyTo = @()
)

$ErrorActionPreference = "Stop"

# ── 1. تحديد الحاوية الجارية لـ Supabase Postgres ──
$container = docker ps --format "{{.Names}}" | Where-Object { $_ -match "supabase.*db|supabase-db" } | Select-Object -First 1
if (-not $container) {
  Write-Error "لم يُعثر على حاوية Supabase Postgres قيد التشغيل. نفّذ 'supabase start' أولاً."
}

# ── 2. إعداد مجلد النسخ ──
$backupDir = Join-Path $PSScriptRoot "..\backups"
if (-not (Test-Path $backupDir)) { New-Item -ItemType Directory -Path $backupDir | Out-Null }

$timestamp = Get-Date -Format "yyyy-MM-dd_HH-mm-ss"
$fileName  = "market_hup_full_backup_$timestamp.sql"
$filePath  = Join-Path $backupDir $fileName

Write-Host "🔄 جارٍ التفريغ من الحاوية: $container ..." -ForegroundColor Cyan

# ── 3. pg_dump — تفريغ كامل (سكيما + بيانات + RLS + sequences) ──
docker exec $container pg_dump -U postgres --schema-only --no-owner --no-privileges -f /tmp/schema.sql
docker exec $container pg_dump -U postgres --data-only --no-owner --no-privileges -f /tmp/data.sql
docker exec $container sh -c "cat /tmp/schema.sql /tmp/data.sql" | Out-File -FilePath $filePath -Encoding utf8
docker exec $container rm /tmp/schema.sql /tmp/data.sql

if ((Get-Item $filePath).Length -lt 1KB) {
  Write-Error "الملف الناتج فارغ — فشل التفريغ."
}

Write-Host "✅ النسخة: $fileName ($([math]::Round((Get-Item $filePath).Length / 1MB, 2)) MB)" -ForegroundColor Green

# ── 4. مسارات إضافية يحددها المستخدم ──
foreach ($dest in $CopyTo) {
  if (Test-Path $dest) {
    Copy-Item $filePath -Destination $dest -Force
    Write-Host "📦 نسخة إضافية إلى: $dest" -ForegroundColor Green
  } else {
    Write-Host "⚠️ المسار غير موجود، تم تجاهله: $dest" -ForegroundColor Yellow
  }
}

# ── 5. تدوير النسخ القديمة (الاحتفاظ بآخر $Keep نسخة فقط) ──
$oldBackups = Get-ChildItem $backupDir -Filter "market_hup_full_backup_*.sql" | Sort-Object LastWriteTime -Descending
if ($oldBackups.Count -gt $Keep) {
  $toDelete = $oldBackups | Select-Object -Skip $Keep
  $toDelete | Remove-Item -Force
  Write-Host "🧹 حُذفت $($toDelete.Count) نسخة قديمة (تدوير إلى $Keep)" -ForegroundColor DarkGray
}

Write-Host "اكتمل التفريغ بنجاح." -ForegroundColor Green
