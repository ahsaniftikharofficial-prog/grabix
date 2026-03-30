param(
  [switch]$SkipFrontendInstall,
  [switch]$SkipBackendInstall
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$frontend = Join-Path $root "grabix-ui"
$backend = Join-Path $root "backend"
$consumet = Join-Path $root "consumet-local"
$tauriBin = Join-Path $frontend "src-tauri\\bin"
$backendDist = Join-Path $backend "dist"
$consumetDist = Join-Path $consumet "dist"

function Require-Command([string]$name) {
  if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
    throw "$name is required to build the installer."
  }
}

Require-Command "python"
Require-Command "npm"
Require-Command "cargo"

New-Item -ItemType Directory -Force -Path $tauriBin | Out-Null
New-Item -ItemType Directory -Force -Path $backendDist | Out-Null
New-Item -ItemType Directory -Force -Path $consumetDist | Out-Null

if (-not $SkipBackendInstall) {
  python -m pip install --upgrade pip pyinstaller | Out-Host
  python -m pip install -r (Join-Path $backend "requirements.txt") | Out-Host
}

if (-not $SkipFrontendInstall) {
  Push-Location $frontend
  npm install | Out-Host
  Pop-Location

  Push-Location $consumet
  npm install | Out-Host
  Pop-Location
}

Push-Location $root
python -m PyInstaller `
  --noconfirm `
  --clean `
  --onedir `
  --contents-directory . `
  --noconsole `
  --name grabix-backend `
  --distpath $backendDist `
  --paths $root `
  --collect-submodules backend.app `
  --collect-all moviebox_api `
  --collect-all throttlebuster `
  --hidden-import moviebox_api.v1.constants `
  --hidden-import moviebox_api.v1.core `
  --hidden-import moviebox_api.v1.download `
  --hidden-import moviebox_api.v1.requests `
  --hidden-import python_multipart `
  backend/main.py | Out-Host
Pop-Location

Push-Location $consumet
npx pkg server.cjs `
  --targets node18-win-x64 `
  --output (Join-Path $consumetDist "grabix-consumet.exe") | Out-Host
Pop-Location

Remove-Item (Join-Path $tauriBin "grabix-backend") -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path $tauriBin "grabix-backend.exe") -Force -ErrorAction SilentlyContinue
Copy-Item (Join-Path $backendDist "grabix-backend") (Join-Path $tauriBin "grabix-backend") -Recurse -Force
Copy-Item (Join-Path $consumetDist "grabix-consumet.exe") (Join-Path $tauriBin "grabix-consumet.exe") -Force

Push-Location $frontend
npm run tauri build | Out-Host
Pop-Location

Write-Host ""
Write-Host "Installer build complete."
Write-Host "Check: $frontend\\src-tauri\\target\\release\\bundle"
