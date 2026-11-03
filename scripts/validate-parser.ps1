$errs = $null
[void][System.Management.Automation.Language.Parser]::ParseFile('C:\market-hup\scripts\start-site.ps1', [ref]$null, [ref]$errs)
if ($errs -and $errs.Count -gt 0) {
    $errs | ForEach-Object { $_.Message }
    exit 1
}
Write-Host 'PowerShell parse OK'
