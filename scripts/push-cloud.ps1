# push-cloud.ps1
# يطبّق ترحيلات المستودع + بذور 01_system على المشروع السحابي المرتبط.
# يستخدم `db query --linked` الذي يمرّ عبر Management API (HTTPS) — لا pooler ولا IPv6.
# تشغيل:  powershell -NoProfile -File scripts\push-cloud.ps1

$ErrorActionPreference = "Stop"
$env:Path = "C:\Program Files\nodejs;C:\Users\mousa\AppData\Roaming\npm;" + $env:Path
$cli = "node_modules\supabase\dist\supabase.js"

Write-Host "== 1. سكيما public نظيفة ==" -ForegroundColor Cyan
node $cli db query "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO postgres; GRANT ALL ON SCHEMA public TO public; GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role; TRUNCATE TABLE supabase_migrations.schema_migrations;" --linked | Out-Null
if ($LASTEXITCODE -ne 0) { throw "فشل تهيئة السكيما" }

Write-Host "== 2. تطبيق الترحيلات ==" -ForegroundColor Cyan
$migs = Get-ChildItem "supabase\migrations\*.sql" | Sort-Object Name
foreach ($m in $migs) {
  Write-Host "   -> $($m.Name)"
  node $cli db query -f $m.FullName --linked | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "فشل الترحيل: $($m.Name)" }
}

Write-Host "== 3. تسجيل النسخ ==" -ForegroundColor Cyan
foreach ($m in $migs) {
  $ver  = ($m.BaseName -split '_')[0]
  $name = $m.BaseName.Substring($ver.Length + 1)
  node $cli db query "INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('$ver','$name') ON CONFLICT (version) DO NOTHING;" --linked | Out-Null
}

Write-Host "== 4. البذور ==" -ForegroundColor Cyan
foreach ($s in (Get-ChildItem "supabase\seeds\01_system\*.sql" | Sort-Object Name)) {
  Write-Host "   -> $($s.Name)"
  node $cli db query -f $s.FullName --linked | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "فشلت البذرة: $($s.Name)" }
}

Write-Host "== تمّ ==" -ForegroundColor Green
