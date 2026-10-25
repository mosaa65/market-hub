# ==============================================================================
# scripts/apply-local-migrations.ps1 — تطبيق الترحيلات على قاعدة Docker المحلية
# (db:local:migrate — أضيف بطلب المالك: كان يوجد أمر السحابة فقط)
#
# ماذا يفعل؟
#   1. يتحقق أن Docker daemon يعمل (نفس حماية الدليل المحلي).
#   2. يقرأ قائمة ملفات supabase/migrations/*.sql مرتبة بالاسم.
#   3. يقارنها بجدول supabase_migrations.schema_migrations — يطبق فقط
#      الملفات التي لم تُسجَّل بعد (idempotent: التشغيل الثاني = لا شيء).
#   4. لكل ملف جديد: docker cp إلى الحاوية ثم psql -f مع ON_ERROR_STOP=1
#      (القاعدة الحاكمة على Windows: لا أنبوب ولا `<` — docker cp فقط).
#   5. يسجّل كل ملف في schema_migrations حتى لا يُعاد تطبيقه.
#   6. يجري أزمة سريعة لعدد الترحيلات والجداول في النهاية.
#
# لا يمس السحابة إطلاقاً — محلي فقط. لا يستخدم supabase db reset ولا حذف.
# ==============================================================================

$ErrorActionPreference = "Stop"

# ── 0) تحقق Docker daemon (المشكلة 5.1/5.2 في الدليل المحلي) ─────────────────
$env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") +
  ";C:\Program Files\Docker\Docker\resources\bin"
$dockerVersion = & docker info --format "{{.ServerVersion}}" 2>&1
if ($LASTEXITCODE -ne 0) {
  throw "Docker daemon لا يستجيب. افتح Docker Desktop وانتظر حتى تصبح أيقونته خضراء ثم أعد المحاولة."
}
Write-Host "[OK] Docker daemon v$dockerVersion" -ForegroundColor Green

# ── 1) ابحث عن حاوية قاعدة البيانات المحلية ──────────────────────────────────
$dbContainer = (& docker ps --format "{{.Names}}" | Select-String "supabase_db_").ToString()
if (-not $dbContainer) {
  throw "لا توجد حاوية supabase_db_* شغالة. شغّل أولاً: npm run db:local:start"
}
Write-Host "[OK] حاوية القاعدة: $dbContainer" -ForegroundColor Green

# ── 2) اقرأ الترحيلات المطبَّقة حالياً ────────────────────────────────────────
$appliedRaw = docker exec $dbContainer psql -U postgres -d postgres -At -c `
  "SELECT version FROM supabase_migrations.schema_migrations ORDER BY version;"
if ($LASTEXITCODE -ne 0) { throw "تعذر قراءة supabase_migrations.schema_migrations." }
$applied = @($appliedRaw | Where-Object { $_ -and $_.Trim() -ne "" })
Write-Host "[OK] ترحيلات مطبقة حالياً: $($applied.Count)" -ForegroundColor Green

# ── 3) ملفات الترحيلات المحلية (01 → …) ──────────────────────────────────────
$migrationsDir = Join-Path $PSScriptRoot "..\supabase\migrations"
$files = Get-ChildItem $migrationsDir -Filter "*.sql" | Sort-Object Name
if ($files.Count -eq 0) { throw "لا توجد ملفات ترحيلات في supabase/migrations." }

# ── 4) طبّق الجديد فقط ────────────────────────────────────────────────────────
$appliedCount = 0
$skippedCount = 0
foreach ($file in $files) {
  # اشتق الإصدار من اسم الملف: NN_description.sql → NN (فقط الأرقام البادئة)
  if ($file.BaseName -notmatch '^(\d+)_') {
    Write-Host "[SKIP] $($file.Name) — الاسم لا يبدأ برقم إصدار" -ForegroundColor DarkGray
    continue
  }
  $version = $Matches[1]

  if ($applied -contains $version) {
    $skippedCount++
    continue
  }

  Write-Host "→ تطبيق: $($file.Name) (version $version)" -ForegroundColor Cyan
  $tmpPath = "/tmp/migration_$version.sql"
  docker cp $file.FullName "${dbContainer}:${tmpPath}"
  if ($LASTEXITCODE -ne 0) { throw "فشل docker cp للملف $($file.Name)." }

  docker exec $dbContainer psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f $tmpPath
  if ($LASTEXITCODE -ne 0) {
    throw "فشل تطبيق $($file.Name) — راجع الخطأ أعلاه. الملف لم يُسجَّل في schema_migrations."
  }

  # سجّل الملف حتى لا يعاد تطبيقه (المعرف عشوائي ثابت لن يتصادم)
  docker exec $dbContainer psql -U postgres -d postgres -At -c `
    "INSERT INTO supabase_migrations.schema_migrations(version, name, statements) VALUES ('$version', '$($file.BaseName)', 1) ON CONFLICT (version) DO NOTHING;"
  if ($LASTEXITCODE -ne 0) { throw "فشل تسجيل $version في schema_migrations." }

  $appliedCount++
}

Write-Host ""
Write-Host "════════════════════════════════════════════════════" -ForegroundColor Green
Write-Host "النتيجة: طُبّق $($appliedCount) ملفاً جديداً · تم تخطي $($skippedCount) مسبقاً" -ForegroundColor Green

# ── 4.5) تحديث ذاكرة PostgREST (مهم!) ───────────────────────────────────────
# الدوال الجديدة لا تُرى من التطبيق إلا بعد إعادة تحميل مخطط PostgREST —
# بدونها يظهر خطأ «Could not find the function» وتعود القوائم فارغة.
if ($appliedCount -gt 0) {
  docker exec $dbContainer psql -U postgres -d postgres -At -c "NOTIFY pgrst, 'reload schema';"
  Start-Sleep -Seconds 2
  Write-Host "[OK] أُعيد تحميل مخطط PostgREST" -ForegroundColor Green
}

# ── 5) فحص سريع بعد التطبيق ──────────────────────────────────────────────────
docker exec $dbContainer psql -U postgres -d postgres -At -c `
  "SELECT 'ترحيلات: ' || count(*) || ' — آخر إصدار: ' || max(version) FROM supabase_migrations.schema_migrations; SELECT 'جداول public: ' || count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE';"
if ($LASTEXITCODE -ne 0) { throw "فشل فحص ما بعد التطبيق." }
