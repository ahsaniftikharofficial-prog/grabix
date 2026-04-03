# build-installer.ps1
# GRABIX Installer Build - PyO3 Embedded Backend Edition
#
# What this does:
#   1. Runs setup-python-runtime.ps1 to download and prepare bundled Python
#   2. Copies backend/ Python source into src-tauri/backend/ (bundled as resource)
#   3. Sets PYO3_PYTHON so Cargo links against the bundled Python DLL
#   4. Runs npm run tauri build
#
# Output: grabix-ui\src-tauri\target\release\bundle\nsis\

param(
    [switch]$SkipFrontendInstall,
    [switch]$SkipPythonSetup,
    [switch]$SkipNpmInstall
)

$ErrorActionPreference = "Stop"

$root          = Split-Path -Parent $MyInvocation.MyCommand.Path
$frontend      = Join-Path $root "grabix-ui"
$backend       = Join-Path $root "backend"
$tauriDir      = Join-Path $frontend "src-tauri"
$pythonRuntime = Join-Path $tauriDir "python-runtime"
$tauriBackend  = Join-Path $tauriDir "backend"

function Require-Command([string]$name) {
    if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
        throw "Required command not found: $name. Please install it and try again."
    }
}

Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  GRABIX Installer Build (PyO3 Edition)"   -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Architecture: Python embedded inside grabix.exe via PyO3"
Write-Host "  No separate grabix-backend.exe - crash structurally impossible."
Write-Host ""

Require-Command "npm"
Require-Command "cargo"

# Step 1: Python runtime
if ($SkipPythonSetup -and (Test-Path (Join-Path $pythonRuntime "python.exe"))) {
    Write-Host "[1/5] python-runtime/ found. Skipping setup." -ForegroundColor Green
} else {
    Write-Host "[1/5] Setting up bundled Python runtime..." -ForegroundColor Yellow
    $setupScript = Join-Path $root "scripts\setup-python-runtime.ps1"
    if (-not (Test-Path $setupScript)) {
        throw "Setup script not found: $setupScript"
    }
    & powershell -ExecutionPolicy Bypass -File $setupScript
    if ($LASTEXITCODE -ne 0) { throw "Python runtime setup failed." }
}

$pythonExe = Join-Path $pythonRuntime "python.exe"
if (-not (Test-Path $pythonExe)) {
    throw "python.exe not found at $pythonExe. Run scripts\setup-python-runtime.ps1 first."
}
Write-Host "[1/5] Python runtime ready at: $pythonRuntime" -ForegroundColor Green

# Step 2: Copy backend source into src-tauri/backend/
Write-Host "[2/5] Copying backend Python source to src-tauri/backend/..." -ForegroundColor Yellow

if (Test-Path $tauriBackend) { Remove-Item $tauriBackend -Recurse -Force }
Copy-Item $backend $tauriBackend -Recurse

Get-ChildItem $tauriBackend -Recurse -Directory -Filter "__pycache__" | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
Get-ChildItem $tauriBackend -Recurse -Directory -Filter "tests"       | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
Get-ChildItem $tauriBackend -Recurse -Filter "*.pyc"                  | Remove-Item -Force -ErrorAction SilentlyContinue

Write-Host "[2/5] Backend source copied." -ForegroundColor Green

# Step 3: npm install
if ($SkipNpmInstall -or $SkipFrontendInstall) {
    Write-Host "[3/5] Skipping npm install." -ForegroundColor Gray
} else {
    Write-Host "[3/5] Installing npm dependencies..." -ForegroundColor Yellow
    Push-Location $frontend
    npm install | Out-Host
    Pop-Location
    Write-Host "[3/5] npm install done." -ForegroundColor Green
}

# Step 4: Build
Write-Host "[4/5] Building GRABIX with Tauri + PyO3..." -ForegroundColor Yellow
Write-Host "      PYO3_PYTHON = $pythonExe"
Write-Host ""
Write-Host "  Cargo will link grabix.exe against python311.dll from python-runtime/."
Write-Host "  Python is embedded inside the exe."
Write-Host ""

$env:PYO3_PYTHON = $pythonExe

Push-Location $frontend
npm run tauri build | Out-Host
$buildResult = $LASTEXITCODE
Pop-Location

if ($buildResult -ne 0) { throw "Tauri build failed (exit code $buildResult)." }

Write-Host "[4/5] Build succeeded." -ForegroundColor Green

# Step 5: Summary
Write-Host ""
Write-Host "[5/5] All done!" -ForegroundColor Green
Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  Installer output:"                        -ForegroundColor Cyan
Write-Host "  $frontend\src-tauri\target\release\bundle\nsis" -ForegroundColor White
Write-Host ""
Write-Host "  grabix.exe now contains:"                 -ForegroundColor White
Write-Host "    - Rust/Tauri shell + React UI"          -ForegroundColor White
Write-Host "    - Python 3.11 interpreter via PyO3"     -ForegroundColor White
Write-Host "    - All pip packages: FastAPI, yt-dlp, etc." -ForegroundColor White
Write-Host "    - Backend Python source"                -ForegroundColor White
Write-Host "  No separate grabix-backend.exe. Backend cannot crash independently." -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""
