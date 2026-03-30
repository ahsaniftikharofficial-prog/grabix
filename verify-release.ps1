param(
  [switch]$SkipBuild,
  [string]$ReportPath = ""
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$frontend = Join-Path $root "grabix-ui"
$tauri = Join-Path $frontend "src-tauri"
$tauriBin = Join-Path $tauri "bin"
$defaultReport = Join-Path $root "release-gate-report.json"
if ([string]::IsNullOrWhiteSpace($ReportPath)) {
  $ReportPath = $defaultReport
}

$report = [ordered]@{
  generated_at = (Get-Date).ToString("s")
  source_checks = [ordered]@{}
  packaged_binaries = [ordered]@{}
  backend_runtime = $null
}

$expectedBinaries = @(
  "grabix-backend.exe"
)

foreach ($binary in $expectedBinaries) {
  $binaryPath = Join-Path $tauriBin $binary
  if (-not (Test-Path $binaryPath) -and $binary -eq "grabix-backend.exe") {
    $binaryPath = Join-Path $tauriBin "grabix-backend\grabix-backend.exe"
  }
  if (Test-Path $binaryPath) {
    $hash = Get-FileHash -Algorithm SHA256 -Path $binaryPath
    $report.packaged_binaries[$binary] = [ordered]@{
      exists = $true
      path = $binaryPath
      size_bytes = (Get-Item $binaryPath).Length
      sha256 = $hash.Hash
    }
  } else {
    $report.packaged_binaries[$binary] = [ordered]@{
      exists = $false
      path = $binaryPath
      error = "Missing packaged binary"
    }
  }
}

if (-not $SkipBuild) {
  Push-Location $root
  python -m py_compile backend\main.py
  python -m py_compile backend\app\services\security.py
  $report.source_checks.python_compile = "passed"
  python -m unittest discover -s backend\tests -p "test_*.py"
  $report.source_checks.backend_tests = "passed"
  Pop-Location

  Push-Location $frontend
  npm.cmd run build
  $report.source_checks.frontend_build = "passed"
  Pop-Location

  Push-Location $tauri
  cargo check
  $report.source_checks.tauri_check = "passed"
  Pop-Location
}

try {
  $runtime = Invoke-RestMethod -Uri "http://127.0.0.1:8000/diagnostics/self-test" -Method Get -TimeoutSec 12
  $report.backend_runtime = $runtime
} catch {
  $report.backend_runtime = @{
    reachable = $false
    message = "Backend self-test endpoint was not reachable on http://127.0.0.1:8000/diagnostics/self-test"
  }
}

$report.release_readiness = [ordered]@{
  sidecars_present = @($report.packaged_binaries.Values | Where-Object { -not $_.exists }).Count -eq 0
  runtime_reachable = [bool]($report.backend_runtime.runtime -or $report.backend_runtime.release_gate -or $report.backend_runtime.reachable)
  backend_tests_passed = ($report.source_checks.backend_tests -eq "passed")
}

$report | ConvertTo-Json -Depth 10 | Set-Content -Path $ReportPath -Encoding UTF8
Write-Host ""
Write-Host "Release verification complete."
Write-Host "Report saved to: $ReportPath"
