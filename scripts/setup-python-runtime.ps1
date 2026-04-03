# scripts/setup-python-runtime.ps1
# Downloads cpython-3.11 (python-build-standalone) for Windows x64,
# extracts it, and pip-installs all GRABIX backend requirements into it.
#
# Output: grabix-ui/src-tauri/python-runtime/
# Run this once before building. Re-run any time requirements.txt changes.

param(
    [string]$PythonVersion = "3.11.10",
    [string]$BuildDate     = "20241016",
    [switch]$Force
)

$ErrorActionPreference = "Stop"

$root      = Split-Path -Parent $PSScriptRoot
$tauriDir  = Join-Path $root "grabix-ui\src-tauri"
$outputDir = Join-Path $tauriDir "python-runtime"
$backend   = Join-Path $root "backend"
$tmpDir    = Join-Path $env:TEMP "grabix-python-setup"

$archiveName = "cpython-$PythonVersion+$BuildDate-x86_64-pc-windows-msvc-install_only.tar.gz"
$downloadUrl = "https://github.com/indygreg/python-build-standalone/releases/download/$BuildDate/$archiveName"
$archivePath = Join-Path $tmpDir $archiveName

Write-Host ""
Write-Host "======================================================" -ForegroundColor Cyan
Write-Host "  GRABIX Python Runtime Setup (python-build-standalone)" -ForegroundColor Cyan
Write-Host "======================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Python version : $PythonVersion"
Write-Host "  Output dir     : $outputDir"
Write-Host ""

# Step 1: Download (skip if already exists)
if ((Test-Path (Join-Path $outputDir "python.exe")) -and -not $Force) {
    Write-Host "[1/4] python-runtime already exists. Skipping download." -ForegroundColor Green
    Write-Host "      (Use -Force to re-download)"
} else {
    Write-Host "[1/4] Downloading Python $PythonVersion (python-build-standalone)..." -ForegroundColor Yellow

    New-Item -ItemType Directory -Force -Path $tmpDir | Out-Null

    if (-not (Test-Path $archivePath) -or $Force) {
        Write-Host "      URL: $downloadUrl"
        try {
            Invoke-WebRequest -Uri $downloadUrl -OutFile $archivePath -UseBasicParsing
            Write-Host "      Download complete." -ForegroundColor Green
        } catch {
            Write-Host ""
            Write-Host "ERROR: Download failed: $_" -ForegroundColor Red
            Write-Host "Try downloading manually from:" -ForegroundColor Yellow
            Write-Host "  $downloadUrl" -ForegroundColor Yellow
            Write-Host "and saving to: $archivePath" -ForegroundColor Yellow
            exit 1
        }
    } else {
        Write-Host "      Archive already cached at $archivePath"
    }

    # Step 2: Extract
    Write-Host "[2/4] Extracting Python runtime..." -ForegroundColor Yellow

    $extractDir = Join-Path $tmpDir "extracted"
    if (Test-Path $extractDir) { Remove-Item $extractDir -Recurse -Force }
    New-Item -ItemType Directory -Force -Path $extractDir | Out-Null

    & tar -xzf $archivePath -C $extractDir
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERROR: tar extraction failed." -ForegroundColor Red
        exit 1
    }

    $extractedPython = Join-Path $extractDir "python"
    if (-not (Test-Path $extractedPython)) {
        $extractedPython = Get-ChildItem $extractDir -Directory | Select-Object -First 1 -ExpandProperty FullName
    }

    if (-not (Test-Path (Join-Path $extractedPython "python.exe"))) {
        Write-Host "ERROR: python.exe not found in extracted archive at $extractedPython" -ForegroundColor Red
        exit 1
    }

    if (Test-Path $outputDir) { Remove-Item $outputDir -Recurse -Force }
    Move-Item $extractedPython $outputDir
    Write-Host "      Extracted to: $outputDir" -ForegroundColor Green
}

# Step 3: Install pip packages
Write-Host "[3/4] Installing GRABIX backend requirements into bundled Python..." -ForegroundColor Yellow

$bundledPython    = Join-Path $outputDir "python.exe"
$requirementsFile = Join-Path $backend "requirements.txt"

if (-not (Test-Path $requirementsFile)) {
    Write-Host "ERROR: requirements.txt not found at $requirementsFile" -ForegroundColor Red
    exit 1
}

Write-Host "      Using: $bundledPython"
Write-Host "      Requirements: $requirementsFile"
Write-Host ""

& $bundledPython -m pip install --upgrade pip --quiet
& $bundledPython -m pip install -r $requirementsFile --no-warn-script-location

if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: pip install failed." -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "[3/4] Packages installed." -ForegroundColor Green

# Step 4: Verify
Write-Host "[4/4] Verifying installation..." -ForegroundColor Yellow

$verifyScript = @"
import fastapi, uvicorn, yt_dlp
print("fastapi:", fastapi.__version__)
print("uvicorn:", uvicorn.__version__)
print("yt_dlp:", yt_dlp.version.__version__)
print("OK: All core packages importable.")
"@

& $bundledPython -c $verifyScript

if ($LASTEXITCODE -ne 0) {
    Write-Host "WARNING: Verification failed - some packages may not have installed correctly." -ForegroundColor Yellow
} else {
    Write-Host "[4/4] Verification passed." -ForegroundColor Green
}

Write-Host ""
Write-Host "======================================================" -ForegroundColor Cyan
Write-Host "  Python runtime ready at:" -ForegroundColor Cyan
Write-Host "  $outputDir" -ForegroundColor White
Write-Host ""
Write-Host "  Next step: run build-installer.bat" -ForegroundColor Cyan
Write-Host "======================================================" -ForegroundColor Cyan
Write-Host ""
