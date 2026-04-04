param(
  [switch]$SkipBuild,
  [string]$ReportPath = ""
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$frontend = Join-Path $root "grabix-ui"
$tauri = Join-Path $frontend "src-tauri"
$pythonRuntimeExe = Join-Path $tauri "python-runtime\python.exe"
$generatedRuntimeConfig = Join-Path $tauri "generated\runtime-config.json"
$defaultReport = Join-Path $root "release-gate-report.json"
if ([string]::IsNullOrWhiteSpace($ReportPath)) {
  $ReportPath = $defaultReport
}

function Add-FileReport([System.Collections.IDictionary]$Bucket, [string]$Key, [string]$Path) {
  if (Test-Path -LiteralPath $Path) {
    $hash = Get-FileHash -Algorithm SHA256 -Path $Path
    $Bucket[$Key] = [ordered]@{
      exists = $true
      path = $Path
      size_bytes = (Get-Item $Path).Length
      sha256 = $hash.Hash
    }
  } else {
    $Bucket[$Key] = [ordered]@{
      exists = $false
      path = $Path
      error = "Missing required release artifact"
    }
  }
}

function Test-NoTmdbSecrets([string]$RootPath) {
  if (-not (Test-Path -LiteralPath $RootPath)) {
    return [ordered]@{ passed = $true; matches = @() }
  }

  $patterns = @(
    "eyJhbGciOiJIUzI1NiJ9",
    "TMDB_TOKEN",
    "TMDB_BEARER_TOKEN"
  )
  $matches = @()
  foreach ($pattern in $patterns) {
    $results = Get-ChildItem -LiteralPath $RootPath -Recurse -File -ErrorAction SilentlyContinue |
      Where-Object { $_.FullName -notmatch "\\node_modules\\" } |
      Select-String -Pattern $pattern -SimpleMatch -ErrorAction SilentlyContinue
    if ($results) {
      $matches += $results
    }
  }

  return [ordered]@{
    passed = ($matches.Count -eq 0)
    matches = @(
      $matches |
        Select-Object -First 12 |
        ForEach-Object { [ordered]@{ path = $_.Path; line = $_.LineNumber } }
    )
  }
}

$report = [ordered]@{
  generated_at = (Get-Date).ToString("s")
  source_checks = [ordered]@{}
  packaged_resources = [ordered]@{}
  backend_runtime = $null
  release_readiness = [ordered]@{}
}

Add-FileReport $report.packaged_resources "grabix_ui_exe" (Join-Path $tauri "target\release\grabix-ui.exe")
Add-FileReport $report.packaged_resources "python_runtime_python" $pythonRuntimeExe
Add-FileReport $report.packaged_resources "backend_entry" (Join-Path $tauri "backend-staging\backend\main.py")
Add-FileReport $report.packaged_resources "consumet_entry" (Join-Path $tauri "consumet-staging\consumet-local\server.cjs")
Add-FileReport $report.packaged_resources "consumet_node" (Join-Path $tauri "consumet-staging\node-runtime\node.exe")
Add-FileReport $report.packaged_resources "runtime_config" $generatedRuntimeConfig

$frontendSecretScan = Test-NoTmdbSecrets (Join-Path $frontend "src")
$report.source_checks.frontend_source_secret_scan = $frontendSecretScan

if (-not $SkipBuild) {
  Push-Location $root
  try {
    python -m py_compile backend\main.py
    python -m py_compile backend\app\services\runtime_config.py
    python -m py_compile backend\app\services\security.py
    python -m py_compile backend\app\services\tmdb.py
    $report.source_checks.python_compile = "passed"

    python -m unittest discover -s backend\tests -p "test_*.py"
    $report.source_checks.backend_tests = "passed"
  } finally {
    Pop-Location
  }

  Push-Location $frontend
  try {
    npm.cmd run build
    $report.source_checks.frontend_build = "passed"
  } finally {
    Pop-Location
  }

  Push-Location $tauri
  try {
    if (-not (Test-Path -LiteralPath $pythonRuntimeExe)) {
      throw "Bundled python runtime is missing at $pythonRuntimeExe. Run scripts\setup-python-runtime.ps1 first."
    }

    $previousPyo3Python = $env:PYO3_PYTHON
    try {
      $env:PYO3_PYTHON = $pythonRuntimeExe
      cargo check
    } finally {
      if ([string]::IsNullOrWhiteSpace($previousPyo3Python)) {
        Remove-Item Env:PYO3_PYTHON -ErrorAction SilentlyContinue
      } else {
        $env:PYO3_PYTHON = $previousPyo3Python
      }
    }
    $report.source_checks.tauri_check = "passed"
  } finally {
    Pop-Location
  }

  $report.source_checks.frontend_dist_secret_scan = Test-NoTmdbSecrets (Join-Path $frontend "dist")
}

try {
  $runtime = Invoke-RestMethod -Uri "http://127.0.0.1:8000/diagnostics/self-test" -Method Get -TimeoutSec 12
  $report.backend_runtime = $runtime
} catch {
  $report.backend_runtime = [ordered]@{
    reachable = $false
    message = "Backend self-test endpoint was not reachable on http://127.0.0.1:8000/diagnostics/self-test"
  }
}

$packagedResourcesPresent = @($report.packaged_resources.Values | Where-Object { -not $_.exists }).Count -eq 0
$frontendSecretsClean = [bool]$report.source_checks.frontend_source_secret_scan.passed -and (
  -not $report.source_checks.Contains("frontend_dist_secret_scan") -or [bool]$report.source_checks.frontend_dist_secret_scan.passed
)
$runtimeReachable = [bool]($report.backend_runtime.runtime -or $report.backend_runtime.release_gate -or $report.backend_runtime.reachable)

$report.release_readiness = [ordered]@{
  packaged_resources_present = $packagedResourcesPresent
  backend_runtime_reachable = $runtimeReachable
  backend_tests_passed = ($report.source_checks.backend_tests -eq "passed")
  frontend_tmdb_secrets_removed = $frontendSecretsClean
  packaged_tmdb_runtime_config_present = [bool]$report.packaged_resources.runtime_config.exists
}

$report | ConvertTo-Json -Depth 10 | Set-Content -Path $ReportPath -Encoding UTF8
Write-Host ""
Write-Host "Release verification complete."
Write-Host "Report saved to: $ReportPath"
