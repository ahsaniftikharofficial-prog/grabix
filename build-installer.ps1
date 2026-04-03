# build-installer.ps1
# Deterministic GRABIX installer build for the PyO3 embedded backend edition.

param(
    [switch]$SkipFrontendInstall,
    [switch]$SkipPythonSetup,
    [switch]$SkipNpmInstall
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$frontend = Join-Path $root "grabix-ui"
$backend = Join-Path $root "backend"
$consumetSource = Join-Path $root "consumet-local"
$tauriDir = Join-Path $frontend "src-tauri"
$pythonRuntime = Join-Path $tauriDir "python-runtime"
$tauriBackendRoot = Join-Path $tauriDir "backend-staging"
$tauriBackend = Join-Path $tauriBackendRoot "backend"
$tauriConsumetRoot = Join-Path $tauriDir "consumet-staging"
$tauriConsumetApp = Join-Path $tauriConsumetRoot "consumet-local"
$tauriConsumetRuntime = Join-Path $tauriConsumetRoot "node-runtime"
$releaseDir = Join-Path $frontend "src-tauri\target\release"
$releaseExe = Join-Path $releaseDir "grabix-ui.exe"
$startupDiagnosticsDir = Join-Path $env:LOCALAPPDATA "com.grabix.app\diagnostics"
$startupLogPath = Join-Path $startupDiagnosticsDir "sidecar-startup.log"
$startupJsonPath = Join-Path $startupDiagnosticsDir "startup-diagnostics.json"
$bundleBackendSubdir = "backend-staging/backend"
$packagedConsumetPort = 3100
$installerNsis = Join-Path $frontend "src-tauri\target\release\bundle\nsis\GRABIX_0.1.0_x64-setup.exe"
$installerMsi = Join-Path $frontend "src-tauri\target\release\bundle\msi\GRABIX_0.1.0_x64_en-US.msi"

$script:BackendExcludedDirectories = @(
    "__pycache__",
    "tests",
    ".pytest_cache",
    ".mypy_cache",
    ".ruff_cache",
    "venv",
    ".venv",
    "downloads",
    "logs"
)
$script:BackendExcludedExtensions = @(".pyc", ".pyo")
$script:BackendExcludedFileNames = @("memory.db")
$script:BackendExcludedNamePatterns = @("*.sqlite", "*.sqlite3", "*.db")

function Require-Command([string]$Name) {
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Required command not found: $Name. Please install it and try again."
    }
}

function Remove-PathIfPresent([string]$Path) {
    if (Test-Path -LiteralPath $Path) {
        Remove-Item -LiteralPath $Path -Recurse -Force -ErrorAction SilentlyContinue
    }
}

function Test-IncludedBackendFile([System.IO.FileInfo]$File, [string]$RootPath) {
    $relative = $File.FullName.Substring($RootPath.Length).TrimStart('\', '/')
    if ([string]::IsNullOrWhiteSpace($relative)) {
        return $false
    }

    $segments = $relative -split '[\\/]'
    foreach ($segment in $segments) {
        if ($script:BackendExcludedDirectories -contains $segment) {
            return $false
        }
    }

    if ($script:BackendExcludedExtensions -contains $File.Extension.ToLowerInvariant()) {
        return $false
    }

    if ($script:BackendExcludedFileNames -contains $File.Name.ToLowerInvariant()) {
        return $false
    }

    foreach ($pattern in $script:BackendExcludedNamePatterns) {
        if ($File.Name -like $pattern) {
            return $false
        }
    }

    return $true
}

function Remove-ExcludedBackendArtifacts([string]$RootPath) {
    if (-not (Test-Path -LiteralPath $RootPath)) {
        return
    }

    foreach ($dirName in $script:BackendExcludedDirectories) {
        Get-ChildItem -LiteralPath $RootPath -Recurse -Directory -Force -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -eq $dirName } |
            ForEach-Object {
                Remove-Item -LiteralPath $_.FullName -Recurse -Force -ErrorAction SilentlyContinue
            }
    }

    Get-ChildItem -LiteralPath $RootPath -Recurse -File -Force -ErrorAction SilentlyContinue |
        Where-Object { -not (Test-IncludedBackendFile -File $_ -RootPath $RootPath) } |
        ForEach-Object {
            Remove-Item -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue
        }
}

function Get-IncludedBackendFiles([string]$RootPath) {
    if (-not (Test-Path -LiteralPath $RootPath)) {
        throw "Backend path not found: $RootPath"
    }

    $pending = [System.Collections.Generic.Stack[string]]::new()
    $pending.Push((Resolve-Path -LiteralPath $RootPath).Path)
    $files = New-Object System.Collections.Generic.List[System.IO.FileInfo]

    while ($pending.Count -gt 0) {
        $current = $pending.Pop()

        foreach ($directory in (Get-ChildItem -LiteralPath $current -Directory -Force -ErrorAction SilentlyContinue)) {
            if ($script:BackendExcludedDirectories -contains $directory.Name) {
                continue
            }
            $pending.Push($directory.FullName)
        }

        foreach ($file in (Get-ChildItem -LiteralPath $current -File -Force -ErrorAction SilentlyContinue)) {
            if (Test-IncludedBackendFile -File $file -RootPath $RootPath) {
                [void]$files.Add($file)
            }
        }
    }

    return $files | Sort-Object FullName
}

function Copy-IncludedBackendFiles([string]$SourceRoot, [string]$DestinationRoot) {
    New-Item -ItemType Directory -Path $DestinationRoot -Force | Out-Null

    foreach ($file in (Get-IncludedBackendFiles $SourceRoot)) {
        $relative = $file.FullName.Substring($SourceRoot.Length).TrimStart('\', '/')
        $destination = Join-Path $DestinationRoot $relative
        $destinationParent = Split-Path -Parent $destination
        if (-not (Test-Path -LiteralPath $destinationParent)) {
            New-Item -ItemType Directory -Path $destinationParent -Force | Out-Null
        }
        Copy-Item -LiteralPath $file.FullName -Destination $destination -Force
    }
}

function Copy-ConsumetBundle([string]$SourceRoot, [string]$DestinationRoot) {
    Remove-PathIfPresent $DestinationRoot
    New-Item -ItemType Directory -Path $DestinationRoot -Force | Out-Null

    foreach ($fileName in @("server.cjs", "package.json", "package-lock.json")) {
        $sourceFile = Join-Path $SourceRoot $fileName
        if (-not (Test-Path -LiteralPath $sourceFile)) {
            throw "Consumet bundle is missing required file: $sourceFile"
        }
        Copy-Item -LiteralPath $sourceFile -Destination (Join-Path $DestinationRoot $fileName) -Force
    }

    $sourceNodeModules = Join-Path $SourceRoot "node_modules"
    if (-not (Test-Path -LiteralPath $sourceNodeModules)) {
        throw "Consumet node_modules were not found at $sourceNodeModules. Install consumet-local dependencies first."
    }

    Copy-Item -LiteralPath $sourceNodeModules -Destination (Join-Path $DestinationRoot "node_modules") -Recurse -Force
}

function Sync-ConsumetNodeRuntime([string]$DestinationRoot) {
    $nodeCommand = Get-Command "node" -ErrorAction Stop
    $nodeSource = $nodeCommand.Source
    if (-not (Test-Path -LiteralPath $nodeSource)) {
        throw "node executable could not be resolved from PATH."
    }

    Remove-PathIfPresent $DestinationRoot
    New-Item -ItemType Directory -Path $DestinationRoot -Force | Out-Null

    $destination = Join-Path $DestinationRoot "node.exe"
    Copy-Item -LiteralPath $nodeSource -Destination $destination -Force
    return $destination
}

function Get-BackendManifestHash([string]$RootPath) {
    if (-not (Test-Path -LiteralPath $RootPath)) {
        throw "Backend path not found: $RootPath"
    }

    $lines = New-Object System.Collections.Generic.List[string]
    foreach ($file in (Get-IncludedBackendFiles $RootPath)) {
        $relative = $file.FullName.Substring($RootPath.Length).TrimStart('\', '/').Replace('\', '/')
        $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $file.FullName).Hash.ToLowerInvariant()
        [void]$lines.Add("$relative $hash")
    }

    $manifest = [string]::Join("`n", $lines)
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($manifest)
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        return ([System.BitConverter]::ToString($sha.ComputeHash($bytes))).Replace("-", "").ToLowerInvariant()
    } finally {
        $sha.Dispose()
    }
}

function Remove-StaleBackendArtifacts([string]$ReleaseRoot) {
    $targets = @(
        (Join-Path $ReleaseRoot "backend"),
        (Join-Path $ReleaseRoot "backend-staging"),
        (Join-Path $ReleaseRoot "consumet-staging"),
        (Join-Path $ReleaseRoot "resources\backend"),
        (Join-Path $ReleaseRoot "resources\backend-staging"),
        (Join-Path $ReleaseRoot "resources\consumet-staging")
    )
    foreach ($target in $targets) {
        Remove-PathIfPresent $target
    }
}

function Sync-PythonRuntimeDlls([string]$RuntimeDir, [string]$ReleaseRoot) {
    $dllNames = @("python311.dll", "python3.dll", "vcruntime140.dll", "vcruntime140_1.dll")
    foreach ($dllName in $dllNames) {
        $source = Join-Path $RuntimeDir $dllName
        if (-not (Test-Path -LiteralPath $source)) {
            continue
        }
        $destination = Join-Path $ReleaseRoot $dllName
        Copy-Item -LiteralPath $source -Destination $destination -Force
    }
}

function Test-LocalPortAvailable([int]$Port) {
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Parse("127.0.0.1"), $Port)
    try {
        $listener.Start()
        return $true
    } catch {
        return $false
    } finally {
        try {
            $listener.Stop()
        } catch {
        }
    }
}

function Get-PortConflictMessage([int]$Port) {
    try {
        $connection = Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort $Port -State Listen -ErrorAction Stop |
            Select-Object -First 1
        if ($null -ne $connection) {
            $processName = ""
            try {
                $processName = (Get-Process -Id $connection.OwningProcess -ErrorAction Stop).ProcessName
            } catch {
                $processName = "unknown"
            }
            return "Port $Port is already in use by PID $($connection.OwningProcess) ($processName)."
        }
    } catch {
    }
    return "Port $Port is already in use."
}

function Read-JsonFileIfReady([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) {
        return $null
    }
    try {
        return Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json -ErrorAction Stop
    } catch {
        return $null
    }
}

function Read-StartupFailureDetails([string]$DiagnosticsPath, [string]$LogPath) {
    $details = New-Object System.Collections.Generic.List[string]

    $diagnostics = Read-JsonFileIfReady $DiagnosticsPath
    if ($null -ne $diagnostics) {
        $details.Add("startup diagnostics:") | Out-Null
        if ($diagnostics.build_id) {
            $details.Add("  build_id: $($diagnostics.build_id)") | Out-Null
        }
        if ($diagnostics.backend_resource_hash) {
            $details.Add("  backend_resource_hash: $($diagnostics.backend_resource_hash)") | Out-Null
        }
        if ($diagnostics.backend) {
            $details.Add("  backend.status: $($diagnostics.backend.status)") | Out-Null
            if ($diagnostics.backend.failure_code) {
                $details.Add("  backend.failure_code: $($diagnostics.backend.failure_code)") | Out-Null
            }
            if ($diagnostics.backend.message) {
                $details.Add("  backend.message: $($diagnostics.backend.message)") | Out-Null
            }
        }
        if ($diagnostics.consumet) {
            $details.Add("  consumet.status: $($diagnostics.consumet.status)") | Out-Null
            if ($diagnostics.consumet.failure_code) {
                $details.Add("  consumet.failure_code: $($diagnostics.consumet.failure_code)") | Out-Null
            }
            if ($diagnostics.consumet.message) {
                $details.Add("  consumet.message: $($diagnostics.consumet.message)") | Out-Null
            }
        }
    }

    if (Test-Path -LiteralPath $LogPath) {
        $tail = Get-Content -LiteralPath $LogPath -Tail 60 -ErrorAction SilentlyContinue
        if ($tail) {
            $details.Add("startup log tail:") | Out-Null
            foreach ($line in $tail) {
                $details.Add("  $line") | Out-Null
            }
        }
    }

    if ($details.Count -eq 0) {
        return "No startup diagnostics were produced."
    }

    return [string]::Join("`n", $details)
}

function Invoke-PackagedSmokeTest(
    [string]$ExePath,
    [string]$ExpectedBuildId,
    [string]$ExpectedBackendHash,
    [int]$ConsumetPort,
    [string]$DiagnosticsPath,
    [string]$LogPath
) {
    $backendPort = 8000
    if (-not (Test-LocalPortAvailable $backendPort)) {
        throw (Get-PortConflictMessage $backendPort)
    }
    if (-not (Test-LocalPortAvailable $ConsumetPort)) {
        throw (Get-PortConflictMessage $ConsumetPort)
    }

    New-Item -ItemType Directory -Path (Split-Path -Parent $DiagnosticsPath) -Force | Out-Null
    Remove-Item -LiteralPath $DiagnosticsPath -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $LogPath -Force -ErrorAction SilentlyContinue

    $process = Start-Process -FilePath $ExePath -PassThru
    try {
        $deadline = (Get-Date).AddSeconds(90)
        $backendReady = $false
        $consumetReady = $false

        while ((Get-Date) -lt $deadline) {
            try {
                $consumetRoot = Invoke-WebRequest -Uri "http://127.0.0.1:$ConsumetPort/" -UseBasicParsing -TimeoutSec 2
                if ($consumetRoot.StatusCode -ge 200) {
                    $consumetReady = $true
                }
            } catch {
            }

            try {
                $ping = Invoke-RestMethod -Uri "http://127.0.0.1:8000/health/ping" -TimeoutSec 2
                if ($ping.ok -and $ping.core_ready) {
                    $backendReady = $true
                }
            } catch {
            }

            if ($backendReady -and $consumetReady) {
                break
            }

            $diagnostics = Read-JsonFileIfReady $DiagnosticsPath
            if ($null -ne $diagnostics -and $diagnostics.backend) {
                $terminalStatuses = @("failed", "missing", "port_in_use", "timeout")
                if (
                    ($terminalStatuses -contains [string]$diagnostics.backend.status) -or
                    ($diagnostics.consumet -and ($terminalStatuses -contains [string]$diagnostics.consumet.status))
                ) {
                    break
                }
            }

            if ($process.HasExited) {
                break
            }

            Start-Sleep -Milliseconds 500
        }

        if (-not $backendReady -or -not $consumetReady) {
            $failureDetails = Read-StartupFailureDetails -DiagnosticsPath $DiagnosticsPath -LogPath $LogPath
            throw "Packaged smoke test failed. The built executable did not bring up both the embedded backend and the bundled HiAnime gateway.`n$failureDetails"
        }

        $diagnostics = Read-JsonFileIfReady $DiagnosticsPath
        if ($null -eq $diagnostics) {
            throw "Packaged smoke test passed /health/ping, but startup-diagnostics.json was not written."
        }
        if ([string]$diagnostics.build_id -ne $ExpectedBuildId) {
            throw "Packaged smoke test build_id mismatch. Expected '$ExpectedBuildId' but got '$($diagnostics.build_id)'."
        }
        if ([string]$diagnostics.backend_resource_hash -ne $ExpectedBackendHash) {
            throw "Packaged smoke test backend hash mismatch. Expected '$ExpectedBackendHash' but got '$($diagnostics.backend_resource_hash)'."
        }
        if ($null -eq $diagnostics.consumet) {
            throw "Packaged smoke test did not produce consumet startup diagnostics."
        }
        if ([string]$diagnostics.consumet.status -notin @("started", "online", "reused", "starting")) {
            throw "Packaged smoke test consumet status was '$($diagnostics.consumet.status)' instead of a ready state."
        }
    } finally {
        if ($process -and -not $process.HasExited) {
            Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
        }

        $cleanupDeadline = (Get-Date).AddSeconds(15)
        while ((Get-Date) -lt $cleanupDeadline) {
            if ((Test-LocalPortAvailable 8000) -and (Test-LocalPortAvailable $ConsumetPort)) {
                break
            }
            Start-Sleep -Milliseconds 300
        }

        foreach ($port in @($backendPort, $ConsumetPort)) {
            if (Test-LocalPortAvailable $port) {
                continue
            }
            try {
                Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
                    ForEach-Object {
                        try {
                            Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue
                        } catch {
                        }
                    }
            } catch {
            }
        }
    }
}

Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  GRABIX Installer Build (PyO3 Edition)" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Architecture: Python embedded inside grabix-ui.exe via PyO3"
Write-Host "  Backend and HiAnime gateway resources are staged fresh for every build."
Write-Host ""

Require-Command "npm"
Require-Command "cargo"

if ($SkipPythonSetup -and (Test-Path (Join-Path $pythonRuntime "python.exe"))) {
    Write-Host "[1/6] python-runtime/ found. Skipping setup." -ForegroundColor Green
} else {
    Write-Host "[1/6] Setting up bundled Python runtime..." -ForegroundColor Yellow
    $setupScript = Join-Path $root "scripts\setup-python-runtime.ps1"
    if (-not (Test-Path -LiteralPath $setupScript)) {
        throw "Setup script not found: $setupScript"
    }
    & powershell -ExecutionPolicy Bypass -File $setupScript
    if ($LASTEXITCODE -ne 0) {
        throw "Python runtime setup failed."
    }
}

$pythonExe = Join-Path $pythonRuntime "python.exe"
if (-not (Test-Path -LiteralPath $pythonExe)) {
    throw "python.exe not found at $pythonExe. Run scripts\setup-python-runtime.ps1 first."
}
Write-Host "[1/6] Python runtime ready at: $pythonRuntime" -ForegroundColor Green

if ($SkipNpmInstall -or $SkipFrontendInstall) {
    Write-Host "[2/6] Skipping npm install." -ForegroundColor Gray
} else {
    Write-Host "[2/6] Installing npm dependencies..." -ForegroundColor Yellow

    Push-Location $consumetSource
    try {
        npm ci | Out-Host
    } finally {
        Pop-Location
    }

    Push-Location $frontend
    try {
        npm install | Out-Host
    } finally {
        Pop-Location
    }

    Write-Host "[2/6] npm install done for frontend and consumet-local." -ForegroundColor Green
}

Write-Host "[3/6] Staging backend and HiAnime gateway resources..." -ForegroundColor Yellow
Remove-PathIfPresent $tauriBackendRoot
New-Item -ItemType Directory -Path $tauriBackendRoot -Force | Out-Null
Copy-IncludedBackendFiles -SourceRoot $backend -DestinationRoot $tauriBackend
Copy-ConsumetBundle -SourceRoot $consumetSource -DestinationRoot $tauriConsumetApp
$stagedNodeExe = Sync-ConsumetNodeRuntime -DestinationRoot $tauriConsumetRuntime

$backendSourceHash = Get-BackendManifestHash $backend
$backendStagedHash = Get-BackendManifestHash $tauriBackend
if ($backendSourceHash -ne $backendStagedHash) {
    throw "Backend staging hash mismatch. source=$backendSourceHash staged=$backendStagedHash"
}

$buildId = (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
Write-Host "[3/6] Resource staging complete." -ForegroundColor Green
Write-Host "      build_id = $buildId"
Write-Host "      backend_resource_hash = $backendSourceHash"
Write-Host "      consumet_node_runtime = $stagedNodeExe"

Write-Host "[4/6] Building GRABIX with Tauri + PyO3..." -ForegroundColor Yellow
Write-Host "      PYO3_PYTHON = $pythonExe"
Write-Host "      GRABIX_BUILD_ID = $buildId"
Write-Host "      GRABIX_BACKEND_RESOURCE_HASH = $backendSourceHash"
Write-Host "      GRABIX_BACKEND_RESOURCE_SUBDIR = $bundleBackendSubdir"

$previousEnv = @{
    PYO3_PYTHON = $env:PYO3_PYTHON
    GRABIX_BUILD_ID = $env:GRABIX_BUILD_ID
    GRABIX_BACKEND_RESOURCE_HASH = $env:GRABIX_BACKEND_RESOURCE_HASH
    GRABIX_BACKEND_RESOURCE_SUBDIR = $env:GRABIX_BACKEND_RESOURCE_SUBDIR
}

try {
    $env:PYO3_PYTHON = $pythonExe
    $env:GRABIX_BUILD_ID = $buildId
    $env:GRABIX_BACKEND_RESOURCE_HASH = $backendSourceHash
    $env:GRABIX_BACKEND_RESOURCE_SUBDIR = $bundleBackendSubdir

    Remove-StaleBackendArtifacts $releaseDir

    if (Test-Path -LiteralPath $installerNsis) {
        Remove-Item -LiteralPath $installerNsis -Force -ErrorAction SilentlyContinue
    }
    if (Test-Path -LiteralPath $installerMsi) {
        Remove-Item -LiteralPath $installerMsi -Force -ErrorAction SilentlyContinue
    }

    Push-Location $frontend
    try {
        npm run tauri build | Out-Host
        $buildResult = $LASTEXITCODE
    } finally {
        Pop-Location
    }

    if ($buildResult -ne 0) {
        throw "Tauri build failed (exit code $buildResult)."
    }

    Sync-PythonRuntimeDlls -RuntimeDir $pythonRuntime -ReleaseRoot $releaseDir
    Write-Host "[4/6] Build succeeded." -ForegroundColor Green

    Write-Host "[5/6] Smoke-testing packaged executable..." -ForegroundColor Yellow
    if (-not (Test-Path -LiteralPath $releaseExe)) {
        throw "Built executable not found: $releaseExe"
    }

    Invoke-PackagedSmokeTest `
        -ExePath $releaseExe `
        -ExpectedBuildId $buildId `
        -ExpectedBackendHash $backendSourceHash `
        -ConsumetPort $packagedConsumetPort `
        -DiagnosticsPath $startupJsonPath `
        -LogPath $startupLogPath

    Write-Host "[5/6] Smoke test passed." -ForegroundColor Green
} finally {
    foreach ($entry in $previousEnv.GetEnumerator()) {
        if ([string]::IsNullOrEmpty($entry.Value)) {
            Remove-Item "Env:$($entry.Key)" -ErrorAction SilentlyContinue
        } else {
            Set-Item "Env:$($entry.Key)" $entry.Value
        }
    }
}

Write-Host ""
Write-Host "[6/6] All done." -ForegroundColor Green
Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  Installer output:" -ForegroundColor Cyan
Write-Host "  $frontend\src-tauri\target\release\bundle\nsis" -ForegroundColor White
Write-Host ""
Write-Host "  Verified packaged startup:" -ForegroundColor White
Write-Host "    - backend staged from backend/" -ForegroundColor White
Write-Host "    - bundled HiAnime gateway staged from consumet-local/" -ForegroundColor White
Write-Host "    - backend hash: $backendSourceHash" -ForegroundColor White
Write-Host "    - build id: $buildId" -ForegroundColor White
Write-Host "    - /health/ping responded from the built exe" -ForegroundColor White
Write-Host "    - bundled HiAnime gateway responded on port $packagedConsumetPort" -ForegroundColor White
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""
