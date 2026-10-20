# Runs the RPC smoke test in chunks so no single call can stall the shell.
$env:PATH = "C:\Program Files\nodejs;" + $env:PATH
$from = 0
$size = 15
while ($from -lt 91) {
  Write-Output "=== chunk $from ==="
  $out = node supabase/_audit_tmp/smoke.mjs a0000000-0000-4000-a000-000000000001 "" $from $size 2>$null
  $out | Select-String -Pattern '^\[' | ForEach-Object { $_.Line }
  $from += $size
}
