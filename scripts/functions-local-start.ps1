# ---------------------------------------------------------------------------
# functions-local-start.ps1 — يشغّل Edge Functions محليًا خلف Kong (منفذ 54321)
#
# Note (the Arabic description lives in the docs): `supabase start` brings up
# db/auth/rest/kong but NOT Edge Functions. Without `functions serve`, Kong
# answers every function call with 503 "name resolution failed", which is the
# error users see when creating a staff account from the Users screen.
#
# Usage:
#   npm run db:functions:start   (separate terminal, keep it open)
#   npm run db:functions:stop
#
# Env vars starting with SUPABASE_ are injected by the runtime itself; their
# presence in .env only produces a warning, so it is safe to pass --env-file.
# ---------------------------------------------------------------------------
[CmdletBinding()]
param(
    [switch]$StopMode
)

# "Stop" is a reserved verb in PowerShell, hence -StopMode here and the
# -Stop flag forwarded from package.json.
if ($PSBoundParameters.ContainsKey("stop")) { $StopMode = $true }

$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

$functions = @("admin-create-user", "raw-rest")

function Get-RunningServers {
    # The CLI keeps a `supabase_edge_runtime_*` container alive after the
    # `functions serve` process exits, so stopping must also drop that
    # container; otherwise Kong still routes to a dead runtime and every call
    # fails with an opaque 5xx.
    $processes = Get-CimInstance Win32_Process -Filter "Name = 'node.exe' OR Name = 'deno.exe'" |
        Where-Object { $_.CommandLine -and $_.CommandLine -match "supabase[\s\S]*functions\s+serve" }
    $containers = @()
    if (Get-Command docker -ErrorAction SilentlyContinue) {
        $containers = @(docker ps --filter "name=supabase_edge_runtime_" --format "{{.Names}}" 2>$null)
    }
    return [pscustomobject]@{ Processes = @($processes); Containers = $containers }
}

if ($StopMode) {
    $running = Get-RunningServers
    if (-not $running.Processes -and -not $running.Containers) {
        Write-Host "no functions server is running" -ForegroundColor Yellow
        return
    }
    foreach ($container in $running.Containers) {
        docker stop $container | Out-Null
        Write-Host "stopped edge runtime container $container" -ForegroundColor Green
    }
    foreach ($server in $running.Processes) {
        Stop-Process -Id $server.ProcessId -Force -ErrorAction SilentlyContinue
        Write-Host "stopped functions server (PID $($server.ProcessId))" -ForegroundColor Green
    }
    return
}

function Resolve-SupabaseCli {
    $cmd = Get-Command supabase -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    # npm installs the CLI under node_modules so it is reachable through npx
    # even when a global install is missing — that is the case on this machine.
    return "npx"
}

$cli = Resolve-SupabaseCli
if (-not (Test-Path ".env")) {
    throw "missing .env - run npm run db:local:start first"
}

if ((Get-RunningServers).Processes) {
    Write-Host "functions server already running at http://127.0.0.1:54321/functions/v1/" -ForegroundColor Green
    foreach ($name in $functions) {
        Write-Host "  - http://127.0.0.1:54321/functions/v1/$name"
    }
    return
}

npx supabase functions serve --env-file .env @functions

Write-Host ""
Write-Host "Functions server stopped. If the containers were restarted:" -ForegroundColor Yellow
Write-Host "  1) npm run db:local:status`n  2) npm run db:local:start`n  3) npm run db:functions:start" -ForegroundColor Yellow
