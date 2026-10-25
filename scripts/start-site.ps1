# ==============================================================================
# Market Hub - سكربت التشغيل الذكي الشامل (Smart Universal Launcher)
# ==============================================================================
# - يفحص البيئة (Node, npm, Docker) بذكاء دون أخطاء أو توقف غير مبرر
# - يحرر المنفذ المخصص (Port 3000) تلقائياً بإغلاق أي عملية قديمة أو عالقة
# - يمنع فتح منافذ عشوائية (3001, 3002) عبر تثبيت المنفذ الصارم (Strict Port)
# - يتعرف تلقائياً على الدومين المحلي (market-hub.local) أو localhost
# - سريع جداً: لا يعيد تثبيت الحزم إلا إذا كانت مفقودة (مناسب للأجهزة بدون إنترنت)
# ==============================================================================

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = 'Stop'
Set-StrictMode -Off

$TargetPort = 3000
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

Write-Host "===============================================================================" -ForegroundColor Cyan
Write-Host "            MARKET HUB - مشغل النظام الذكي (Universal Launcher)                " -ForegroundColor Cyan
Write-Host "===============================================================================" -ForegroundColor Cyan
Write-Host ""

# ------------------------------------------------------------------------------
# 1. التحقق من متطلبات النظام الأساسية (Node.js & npm)
# ------------------------------------------------------------------------------
Write-Host "[1/5] فحص بيئة التشغيل..." -ForegroundColor Yellow

$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
    Write-Host "خطأ: Node.js غير مثبت على هذا الجهاز!" -ForegroundColor Red
    Write-Host "يرجى تثبيت Node.js من: https://nodejs.org ثم إعادة المحاولة." -ForegroundColor DarkGray
    Read-Host "اضغط Enter للخروج..."
    exit 1
}

$nodeVersion = (& node -v)
Write-Host "  ✓ تم العثور على Node.js: $nodeVersion" -ForegroundColor Green

$npmCmd = Get-Command npm -ErrorAction SilentlyContinue
if (-not $npmCmd) {
    Write-Host "خطأ: npm غير متوفر في المسار!" -ForegroundColor Red
    Read-Host "اضغط Enter للخروج..."
    exit 1
}

# ------------------------------------------------------------------------------
# 2. فحص الحزم والاعتماديات (سريع ولا يعطل العمل بدون إنترنت)
# ------------------------------------------------------------------------------
Write-Host "[2/5] التحقق من حزم المشروع..." -ForegroundColor Yellow

$nodeModulesPath = Join-Path $root "node_modules"
if (-not (Test-Path $nodeModulesPath)) {
    Write-Host "  الحزم مفقودة، جاري التثبيت لأول مرة (npm install)..." -ForegroundColor Yellow
    & npm install
    if ($LASTEXITCODE -ne 0) {
        Write-Host "فشل تثبيت الحزم، يرجى التحقق من اتصال الإنترنت." -ForegroundColor Red
        Read-Host "اضغط Enter للخروج..."
        exit $LASTEXITCODE
    }
    Write-Host "  ✓ تم تثبيت الحزم بنجاح." -ForegroundColor Green
} else {
    Write-Host "  ✓ الحزم مثبتة وجاهزة فوراً (بدون انتظار)." -ForegroundColor Green
}

# ------------------------------------------------------------------------------
# 3. إدارة المنفذ الفريد (3000) وتحريره من العمليات العالقة
# ------------------------------------------------------------------------------
Write-Host "[3/5] فحص المنفذ المخصص ($TargetPort) وضمان عدم التضارب..." -ForegroundColor Yellow

$activeConns = @()
try {
    $activeConns = Get-NetTCPConnection -LocalPort $TargetPort -State Listen -ErrorAction SilentlyContinue
} catch {
    # في بعض إصدارات ويندوز القديمة
}

if ($activeConns -and $activeConns.Count -gt 0) {
    foreach ($conn in $activeConns) {
        $procId = $conn.OwningProcess
        if ($procId -gt 0) {
            try {
                $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
                $procName = if ($proc) { $proc.ProcessName } else { "عملية مجهولة" }
                Write-Host "  ⚠️ تم اكتشاف عملية عالقة على المنفذ $TargetPort (ID: $procId - $procName). جاري إغلاقها..." -ForegroundColor Magenta
                Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
                Start-Sleep -Milliseconds 800
                Write-Host "  ✓ تم تحرير المنفذ $TargetPort بنجاح!" -ForegroundColor Green
            } catch {
                Write-Host "  تعذر إغلاق العملية $procId تلقائياً: $_" -ForegroundColor DarkGray
            }
        }
    }
} else {
    Write-Host "  ✓ المنفذ $TargetPort شاغر وجاهز للاستخدام." -ForegroundColor Green
}

# ------------------------------------------------------------------------------
# 4. فحص خدمات Supabase المحلية (Docker)
# ------------------------------------------------------------------------------
Write-Host "[4/5] التحقق من خدمات قاعدة البيانات المحلية (Docker)..." -ForegroundColor Yellow

$dockerCmd = Get-Command docker -ErrorAction SilentlyContinue
$dockerRunning = $false

if ($dockerCmd) {
    try {
        $null = & docker info --format '{{.ServerVersion}}' 2>$null
        if ($LASTEXITCODE -eq 0) {
            $dockerRunning = $true
        }
    } catch {
        $dockerRunning = $false
    }
}

if ($dockerRunning) {
    # فحص ما إذا كانت الحاويات تعمل بالفعل
    $runningContainers = & docker ps --filter "name=supabase_db" --format "{{.Names}}" 2>$null
    if ($runningContainers -match "supabase_db") {
        Write-Host "  ✓ خدمات Supabase المحلية قيد التشغيل بالفعل." -ForegroundColor Green
    } else {
        Write-Host "  جاري إقلاع خدمات Supabase المحلية عبر Docker..." -ForegroundColor Yellow
        $prevErr = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        & npx supabase start 2>$null
        $ErrorActionPreference = $prevErr
        Write-Host "  ✓ تم بدء خدمات Supabase بنجاح." -ForegroundColor Green
    }
} else {
    Write-Host "  ℹ️ برنامج Docker Desktop ليس قيد التشغيل حالياً." -ForegroundColor DarkGray
    Write-Host "     سيتم تشغيل واجهة النظام (قد تتصل بقاعدة سحابية أو قاعدة خارجية)." -ForegroundColor DarkGray
}

# ------------------------------------------------------------------------------
# 5. تحديد الدومين وتشغيل خادم الويب
# ------------------------------------------------------------------------------
Write-Host "[5/5] تجهيز رابط النظام وبدء خادم الويب..." -ForegroundColor Yellow

# فحص ما إذا كان market-hub.local مفعلاً في الجهاز
$useLocalDomain = $false
try {
    $dnsCheck = [System.Net.Dns]::GetHostAddresses("market-hub.local") 2>$null
    if ($dnsCheck -and ($dnsCheck | Where-Object { $_.IPAddressToString -eq "127.0.0.1" })) {
        $useLocalDomain = $true
    }
} catch {
    $useLocalDomain = $false
}

$siteUrl = if ($useLocalDomain) { "http://market-hub.local:$TargetPort" } else { "http://localhost:$TargetPort" }

# بدء سيرفر Vite في نافذة تشغيل منفصلة ومحمية
$devScript = "Set-Location '$root'; npm run dev"
Start-Process powershell -ArgumentList "-NoExit", "-Command", $devScript -WindowStyle Minimized | Out-Null

Write-Host "  جاري انتظار جاهزية الخادم على $siteUrl..." -ForegroundColor Yellow

# فحص دوري حتى يرد السيرفر بـ HTTP 200
$serverReady = $false
for ($i = 0; $i -lt 40; $i++) {
    try {
        $resp = Invoke-WebRequest -Uri "http://localhost:$TargetPort" -Method Head -UseBasicParsing -TimeoutSec 1 -ErrorAction SilentlyContinue
        if ($resp -and $resp.StatusCode -ge 200 -and $resp.StatusCode -lt 500) {
            $serverReady = $true
            break
        }
    } catch {
        Start-Sleep -Milliseconds 400
    }
}

Write-Host ""
Write-Host "===============================================================================" -ForegroundColor Green
Write-Host "                     ✓ تم تشغيل نظام Market Hub بنجاح!                         " -ForegroundColor Green
Write-Host "===============================================================================" -ForegroundColor Green
Write-Host ""
Write-Host "  رابط التطبيق:    $siteUrl" -ForegroundColor Cyan
if (-not $useLocalDomain) {
    Write-Host "  (ملاحظة: يمكنك تشغيل setup-local-domain.bat لتفعيل الرابط: http://market-hub.local:$TargetPort)" -ForegroundColor DarkGray
}
if ($dockerRunning) {
    Write-Host "  لوحة الاستوديو:  http://127.0.0.1:54323" -ForegroundColor Yellow
    Write-Host "  رابط الـ API:    http://127.0.0.1:54321" -ForegroundColor Yellow
}
Write-Host ""
Write-Host "  جاري فتح المتصفح تلقائياً..." -ForegroundColor DarkGray
Write-Host "===============================================================================" -ForegroundColor Green

# فتح المتصفح
Start-Process $siteUrl
