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
$tauriRuntimeToolsRoot = Join-Path $tauriDir "runtime-tools"
$tauriAria2Root = Join-Path $tauriRuntimeToolsRoot "aria2"
$tauriGeneratedRoot = Join-Path $tauriDir "generated"
$tauriRuntimeConfig = Join-Path $tauriGeneratedRoot "runtime-config.json"
$releaseDir = Join-Path $frontend "src-tauri\target\release"
$releaseExe = Join-Path $releaseDir "grabix-ui.exe"
$startupDiagnosticsDir = Join-Path $env:LOCALAPPDATA "com.grabix.app\diagnostics"
$startupLogPath = Join-Path $startupDiagnosticsDir "sidecar-startup.log"
$startupJsonPath = Join-Path $startupDiagnosticsDir "startup-diagnostics.json"
$desktopAuthPath = Join-Path (Join-Path $env:LOCALAPPDATA "com.grabix.app") "desktop-auth.json"
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

function Throw-BuildFailure(
    [string]$Code,
    [string]$Step,
    [string]$Message,
    [string]$Hint = "",
    [string]$DiagnosticsPath = "",
    [string]$LogPath = ""
) {
    $lines = New-Object System.Collections.Generic.List[string]
    $lines.Add("[$Code] $Step") | Out-Null
    $lines.Add($Message) | Out-Null
    if (-not [string]::IsNullOrWhiteSpace($DiagnosticsPath)) {
        $lines.Add("Diagnostics: $DiagnosticsPath") | Out-Null
    }
    if (-not [string]::IsNullOrWhiteSpace($LogPath)) {
        $lines.Add("Startup log: $LogPath") | Out-Null
    }
    if (-not [string]::IsNullOrWhiteSpace($Hint)) {
        $lines.Add("Next action: $Hint") | Out-Null
    }
    throw ([string]::Join("`n", $lines))
}

function Remove-PathIfPresent([string]$Path) {
    if (Test-Path -LiteralPath $Path) {
        Remove-Item -LiteralPath $Path -Recurse -Force -ErrorAction SilentlyContinue
    }
}

function Write-PackagedRuntimeConfig([string]$DestinationPath) {
    $runtimeConfigSource = [string]$env:GRABIX_RUNTIME_CONFIG_SOURCE
    $tmdbToken = [string]$env:GRABIX_TMDB_BEARER_TOKEN
    if ([string]::IsNullOrWhiteSpace($runtimeConfigSource)) {
        $defaultLocalRuntimeConfig = Join-Path $root "runtime-config.local.json"
        if (Test-Path -LiteralPath $defaultLocalRuntimeConfig) {
            $runtimeConfigSource = $defaultLocalRuntimeConfig
        }
    }

    if (-not [string]::IsNullOrWhiteSpace($runtimeConfigSource)) {
        if (-not (Test-Path -LiteralPath $runtimeConfigSource)) {
            Throw-BuildFailure `
                -Code "tmdb_config_missing" `
                -Step "Runtime config staging" `
                -Message "GRABIX_RUNTIME_CONFIG_SOURCE was set, but the file does not exist: $runtimeConfigSource" `
                -Hint "Point GRABIX_RUNTIME_CONFIG_SOURCE at a valid JSON file that contains tmdb_bearer_token."
        }

        $raw = Get-Content -LiteralPath $runtimeConfigSource -Raw -ErrorAction Stop
        try {
            $parsed = $raw | ConvertFrom-Json -ErrorAction Stop
        } catch {
            Throw-BuildFailure `
                -Code "tmdb_config_missing" `
                -Step "Runtime config staging" `
                -Message "The runtime config file is not valid JSON: $runtimeConfigSource" `
                -Hint "Fix the JSON syntax and make sure it contains tmdb_bearer_token."
        }
        $resolvedToken = [string]$parsed.tmdb_bearer_token
        if ([string]::IsNullOrWhiteSpace($resolvedToken)) {
            Throw-BuildFailure `
                -Code "tmdb_config_missing" `
                -Step "Runtime config staging" `
                -Message "The runtime config file does not contain tmdb_bearer_token: $runtimeConfigSource" `
                -Hint "Add tmdb_bearer_token to the runtime config JSON before building the installer."
        }

        New-Item -ItemType Directory -Path (Split-Path -Parent $DestinationPath) -Force | Out-Null
        Set-Content -LiteralPath $DestinationPath -Value $raw -Encoding UTF8
        return
    }

    if ([string]::IsNullOrWhiteSpace($tmdbToken)) {
        Throw-BuildFailure `
            -Code "tmdb_config_missing" `
            -Step "Runtime config staging" `
            -Message "No TMDB runtime configuration was provided for this release build." `
            -Hint "Set GRABIX_TMDB_BEARER_TOKEN, set GRABIX_RUNTIME_CONFIG_SOURCE, or create runtime-config.local.json before running build-installer.bat."
    }

    $payload = [ordered]@{
        managed_by = "build-installer"
        generated_at_utc = (Get-Date).ToUniversalTime().ToString("o")
        tmdb_bearer_token = $tmdbToken.Trim()
    }

    New-Item -ItemType Directory -Path (Split-Path -Parent $DestinationPath) -Force | Out-Null
    $payload | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $DestinationPath -Encoding UTF8
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

function Find-Aria2Executable() {
    $candidateDirs = New-Object System.Collections.Generic.List[string]

    $explicitDir = [string]$env:GRABIX_ARIA2_SOURCE_DIR
    if (-not [string]::IsNullOrWhiteSpace($explicitDir)) {
        $candidateDirs.Add($explicitDir) | Out-Null
    }

    foreach ($candidate in @(
        (Join-Path $root "runtime-tools\aria2"),
        (Join-Path $tauriDir "runtime-tools\aria2"),
        (Join-Path (Join-Path $env:LOCALAPPDATA "com.grabix.app\backend-state\runtime-tools") "aria2")
    )) {
        if (-not [string]::IsNullOrWhiteSpace($candidate)) {
            $candidateDirs.Add($candidate) | Out-Null
        }
    }

    $aria2Command = Get-Command "aria2c" -ErrorAction SilentlyContinue
    if ($aria2Command -and $aria2Command.Source) {
        $candidateDirs.Add((Split-Path -Parent $aria2Command.Source)) | Out-Null
    }

    foreach ($dir in $candidateDirs) {
        $exe = Join-Path $dir "aria2c.exe"
        if (Test-Path -LiteralPath $exe) {
            return $exe
        }
    }

    return $null
}

function Stage-Aria2Bundle([string]$DestinationRoot) {
    Remove-PathIfPresent $DestinationRoot
    New-Item -ItemType Directory -Path $DestinationRoot -Force | Out-Null

    $aria2Exe = Find-Aria2Executable
    if (-not [string]::IsNullOrWhiteSpace($aria2Exe)) {
        $sourceDir = Split-Path -Parent $aria2Exe
        Copy-Item -LiteralPath (Join-Path $sourceDir "*") -Destination $DestinationRoot -Recurse -Force
        return $aria2Exe
    }

    $tempDir = Join-Path ([System.IO.Path]::GetTempPath()) ("grabix-aria2-" + [System.Guid]::NewGuid().ToString("N"))
    New-Item -ItemType Directory -Path $tempDir -Force | Out-Null
    try {
        $headers = @{
            "User-Agent" = "GRABIX-Build"
            "Accept" = "application/vnd.github+json"
        }
        $release = Invoke-RestMethod -Uri "https://api.github.com/repos/aria2/aria2/releases/latest" -Headers $headers -TimeoutSec 60
        $asset = $release.assets |
            Where-Object { $_.name -match "win-64bit" -and $_.name -match "\.zip$" } |
            Select-Object -First 1

        if ($null -eq $asset -or [string]::IsNullOrWhiteSpace([string]$asset.browser_download_url)) {
            Throw-BuildFailure `
                -Code "aria2_bundle_failed" `
                -Step "Bundled aria2 staging" `
                -Message "The latest aria2 release did not expose a Windows 64-bit zip asset." `
                -Hint "Set GRABIX_ARIA2_SOURCE_DIR to a folder that already contains aria2c.exe and rerun the installer build."
        }

        $archivePath = Join-Path $tempDir ([string]$asset.name)
        Invoke-WebRequest -Uri ([string]$asset.browser_download_url) -Headers @{ "User-Agent" = "GRABIX-Build" } -OutFile $archivePath -TimeoutSec 120
        $extractDir = Join-Path $tempDir "extract"
        Expand-Archive -LiteralPath $archivePath -DestinationPath $extractDir -Force

        $downloadedExe = Get-ChildItem -LiteralPath $extractDir -Recurse -File -Filter "aria2c.exe" -ErrorAction SilentlyContinue |
            Select-Object -First 1
        if ($null -eq $downloadedExe) {
            Throw-BuildFailure `
                -Code "aria2_bundle_failed" `
                -Step "Bundled aria2 staging" `
                -Message "The downloaded aria2 archive did not contain aria2c.exe." `
                -Hint "Try again or set GRABIX_ARIA2_SOURCE_DIR to a working aria2 folder."
        }

        Copy-Item -LiteralPath (Join-Path $downloadedExe.Directory.FullName "*") -Destination $DestinationRoot -Recurse -Force
        return $downloadedExe.FullName
    } finally {
        Remove-PathIfPresent $tempDir
    }
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

function Assert-NoTmdbSecrets([string]$RootPath, [string]$Label) {
    if (-not (Test-Path -LiteralPath $RootPath)) {
        return
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

    if ($matches.Count -gt 0) {
        $summary = $matches |
            Select-Object -First 8 |
            ForEach-Object { "$($_.Path):$($_.LineNumber)" }
        Throw-BuildFailure `
            -Code "tmdb_secret_scan_failed" `
            -Step "Secret scan ($Label)" `
            -Message ("Direct TMDB secrets were found in $Label.`n$([string]::Join("`n", $summary))") `
            -Hint "Remove frontend or generated-asset TMDB secrets before shipping this installer."
    }
}

function Remove-StaleBackendArtifacts([string]$ReleaseRoot) {
    $targets = @(
        (Join-Path $ReleaseRoot "backend"),
        (Join-Path $ReleaseRoot "backend-staging"),
        (Join-Path $ReleaseRoot "consumet-staging"),
        (Join-Path $ReleaseRoot "runtime-tools"),
        (Join-Path $ReleaseRoot "resources\backend"),
        (Join-Path $ReleaseRoot "resources\backend-staging"),
        (Join-Path $ReleaseRoot "resources\consumet-staging"),
        (Join-Path $ReleaseRoot "resources\runtime-tools")
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

function Get-DesktopAuthToken([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) {
        return ""
    }
    try {
        $payload = Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json -ErrorAction Stop
        return [string]($payload.token)
    } catch {
        return ""
    }
}

function Assert-SettingsRoundTrip(
    [string]$DesktopAuthToken,
    [string]$DiagnosticsPath,
    [string]$LogPath
) {
    if ([string]::IsNullOrWhiteSpace($DesktopAuthToken)) {
        Throw-BuildFailure `
            -Code "desktop_auth_init_failed" `
            -Step "Packaged smoke test" `
            -Message "desktop-auth.json was not written or did not contain a token." `
            -DiagnosticsPath $DiagnosticsPath `
            -LogPath $LogPath `
            -Hint "Delete the installed app-data folder and rerun the build so desktop auth can initialize cleanly."
    }

    $headers = @{ "X-Grabix-Desktop-Auth" = $DesktopAuthToken }
    try {
        $current = Invoke-RestMethod -Uri "http://127.0.0.1:8000/settings" -Method Get -TimeoutSec 8
    } catch {
        Throw-BuildFailure `
            -Code "settings_read_failed" `
            -Step "Packaged smoke test" `
            -Message "Could not read packaged backend settings during smoke test." `
            -DiagnosticsPath $DiagnosticsPath `
            -LogPath $LogPath `
            -Hint "Inspect startup diagnostics and confirm the backend is responding on port 8000."
    }

    $currentTheme = [string]($current.theme)
    $newTheme = if ($currentTheme -eq "light") { "dark" } else { "light" }

    try {
        Invoke-RestMethod `
            -Uri "http://127.0.0.1:8000/settings" `
            -Method Post `
            -Headers $headers `
            -ContentType "application/json" `
            -Body (@{ theme = $newTheme } | ConvertTo-Json -Compress) `
            -TimeoutSec 8 | Out-Null

        $updated = Invoke-RestMethod -Uri "http://127.0.0.1:8000/settings" -Method Get -TimeoutSec 8
        if ([string]($updated.theme) -ne $newTheme) {
            Throw-BuildFailure `
                -Code "settings_write_failed" `
                -Step "Packaged smoke test" `
                -Message "Settings POST completed, but the packaged backend did not persist the new theme value." `
                -DiagnosticsPath $DiagnosticsPath `
                -LogPath $LogPath `
                -Hint "Inspect app-state write permissions and the backend settings path in diagnostics."
        }
    } finally {
        if (-not [string]::IsNullOrWhiteSpace($currentTheme)) {
            try {
                Invoke-RestMethod `
                    -Uri "http://127.0.0.1:8000/settings" `
                    -Method Post `
                    -Headers $headers `
                    -ContentType "application/json" `
                    -Body (@{ theme = $currentTheme } | ConvertTo-Json -Compress) `
                    -TimeoutSec 8 | Out-Null
            } catch {
            }
        }
    }
}

function Assert-DiagnosticsRuntimeConfig(
    [string]$DiagnosticsPath,
    [string]$LogPath
) {
    try {
        $payload = Invoke-RestMethod -Uri "http://127.0.0.1:8000/diagnostics/self-test" -Method Get -TimeoutSec 8
    } catch {
        Throw-BuildFailure `
            -Code "backend_boot_failed" `
            -Step "Packaged smoke test" `
            -Message "The packaged backend did not respond to /diagnostics/self-test." `
            -DiagnosticsPath $DiagnosticsPath `
            -LogPath $LogPath `
            -Hint "Inspect startup diagnostics and backend logs to find the first runtime initialization failure."
    }

    if (-not [bool]$payload.config.tmdb_configured) {
        Throw-BuildFailure `
            -Code "tmdb_config_missing" `
            -Step "Packaged smoke test" `
            -Message "The packaged backend started, but diagnostics reported tmdb_configured=false." `
            -DiagnosticsPath $DiagnosticsPath `
            -LogPath $LogPath `
            -Hint "Make sure build-installer staged runtime-config.json from GRABIX_TMDB_BEARER_TOKEN or GRABIX_RUNTIME_CONFIG_SOURCE."
    }
}

function Assert-BundledAria2(
    [string]$DesktopAuthToken,
    [string]$DiagnosticsPath,
    [string]$LogPath
) {
    try {
        $payload = Invoke-RestMethod `
            -Uri "http://127.0.0.1:8000/runtime/dependencies" `
            -Method Get `
            -Headers @{ "X-Grabix-Desktop-Auth" = $DesktopAuthToken } `
            -TimeoutSec 8
    } catch {
        Throw-BuildFailure `
            -Code "aria2_bundle_failed" `
            -Step "Packaged smoke test" `
            -Message "The packaged backend did not respond to /runtime/dependencies while verifying bundled aria2." `
            -DiagnosticsPath $DiagnosticsPath `
            -LogPath $LogPath `
            -Hint "Inspect startup diagnostics and confirm the bundled backend finished booting before dependency checks."
    }

    $aria2 = $payload.dependencies.aria2
    if ($null -eq $aria2 -or -not [bool]$aria2.available) {
        Throw-BuildFailure `
            -Code "aria2_bundle_failed" `
            -Step "Packaged smoke test" `
            -Message "Bundled aria2 was not available in the packaged app." `
            -DiagnosticsPath $DiagnosticsPath `
            -LogPath $LogPath `
            -Hint "Confirm build-installer staged src-tauri/runtime-tools/aria2 and that the desktop shell exported GRABIX_BUNDLED_RUNTIME_TOOLS_DIR."
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
    [string]$LogPath,
    [string]$DesktopAuthPath
) {
    $backendPort = 8000
    if (-not (Test-LocalPortAvailable $backendPort)) {
        Throw-BuildFailure `
            -Code "backend_port_in_use" `
            -Step "Packaged smoke test" `
            -Message (Get-PortConflictMessage $backendPort) `
            -Hint "Stop the local GRABIX backend or any other process using port 8000, then rerun build-installer.bat."
    }
    if (-not (Test-LocalPortAvailable $ConsumetPort)) {
        Throw-BuildFailure `
            -Code "consumet_port_in_use" `
            -Step "Packaged smoke test" `
            -Message (Get-PortConflictMessage $ConsumetPort) `
            -Hint "Stop the process using the packaged consumet port before rerunning the installer build."
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
            Throw-BuildFailure `
                -Code "release_gate_failed" `
                -Step "Packaged smoke test" `
                -Message ("The built executable did not bring up both the embedded backend and the bundled HiAnime gateway.`n$failureDetails") `
                -DiagnosticsPath $DiagnosticsPath `
                -LogPath $LogPath `
                -Hint "Open the diagnostics JSON and startup log, then fix the first startup failure before rebuilding."
        }

        $diagnostics = Read-JsonFileIfReady $DiagnosticsPath
        if ($null -eq $diagnostics) {
            Throw-BuildFailure `
                -Code "startup_diagnostics_missing" `
                -Step "Packaged smoke test" `
                -Message "The packaged backend responded, but startup-diagnostics.json was not written." `
                -DiagnosticsPath $DiagnosticsPath `
                -LogPath $LogPath `
                -Hint "Verify that the packaged app can write to its local app-data diagnostics folder."
        }
        if ([string]$diagnostics.build_id -ne $ExpectedBuildId) {
            Throw-BuildFailure `
                -Code "build_id_mismatch" `
                -Step "Packaged smoke test" `
                -Message "Expected build id '$ExpectedBuildId' but got '$($diagnostics.build_id)'." `
                -DiagnosticsPath $DiagnosticsPath `
                -LogPath $LogPath `
                -Hint "Clear stale release artifacts and rebuild so the packaged app uses the current bundle."
        }
        if ([string]$diagnostics.backend_resource_hash -ne $ExpectedBackendHash) {
            Throw-BuildFailure `
                -Code "backend_hash_mismatch" `
                -Step "Packaged smoke test" `
                -Message "Expected backend hash '$ExpectedBackendHash' but got '$($diagnostics.backend_resource_hash)'." `
                -DiagnosticsPath $DiagnosticsPath `
                -LogPath $LogPath `
                -Hint "Rebuild after clearing stale staged backend resources."
        }
        if ($null -eq $diagnostics.consumet) {
            Throw-BuildFailure `
                -Code "consumet_diagnostics_missing" `
                -Step "Packaged smoke test" `
                -Message "The packaged app did not produce consumet startup diagnostics." `
                -DiagnosticsPath $DiagnosticsPath `
                -LogPath $LogPath `
                -Hint "Confirm consumet-local and its bundled node runtime were staged into src-tauri/consumet-staging."
        }
        if ([string]$diagnostics.consumet.status -notin @("started", "online", "reused", "starting")) {
            Throw-BuildFailure `
                -Code "consumet_boot_failed" `
                -Step "Packaged smoke test" `
                -Message "Consumet status was '$($diagnostics.consumet.status)' instead of a ready state." `
                -DiagnosticsPath $DiagnosticsPath `
                -LogPath $LogPath `
                -Hint "Inspect the startup log tail for the bundled HiAnime gateway failure."
        }
        if ($null -eq $diagnostics.desktop_auth) {
            Throw-BuildFailure `
                -Code "desktop_auth_diagnostics_missing" `
                -Step "Packaged smoke test" `
                -Message "The packaged app did not produce desktop auth diagnostics." `
                -DiagnosticsPath $DiagnosticsPath `
                -LogPath $LogPath `
                -Hint "Confirm the Tauri shell initialized local app-data and wrote startup diagnostics."
        }
        if (-not [bool]$diagnostics.desktop_auth.ready) {
            Throw-BuildFailure `
                -Code "desktop_auth_init_failed" `
                -Step "Packaged smoke test" `
                -Message "Desktop auth was not ready in packaged mode." `
                -DiagnosticsPath $DiagnosticsPath `
                -LogPath $LogPath `
                -Hint "Inspect the packaged app-data folder and desktop auth token file."
        }

        $desktopAuthToken = Get-DesktopAuthToken $DesktopAuthPath
        Assert-SettingsRoundTrip `
            -DesktopAuthToken $desktopAuthToken `
            -DiagnosticsPath $DiagnosticsPath `
            -LogPath $LogPath
        Assert-DiagnosticsRuntimeConfig `
            -DiagnosticsPath $DiagnosticsPath `
            -LogPath $LogPath
        Assert-BundledAria2 `
            -DesktopAuthToken $desktopAuthToken `
            -DiagnosticsPath $DiagnosticsPath `
            -LogPath $LogPath
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
Remove-PathIfPresent $tauriRuntimeToolsRoot
Remove-PathIfPresent $tauriGeneratedRoot
New-Item -ItemType Directory -Path $tauriBackendRoot -Force | Out-Null
Copy-IncludedBackendFiles -SourceRoot $backend -DestinationRoot $tauriBackend
Copy-ConsumetBundle -SourceRoot $consumetSource -DestinationRoot $tauriConsumetApp
$stagedNodeExe = Sync-ConsumetNodeRuntime -DestinationRoot $tauriConsumetRuntime
$stagedAria2Exe = Stage-Aria2Bundle -DestinationRoot $tauriAria2Root
Write-PackagedRuntimeConfig -DestinationPath $tauriRuntimeConfig

$backendSourceHash = Get-BackendManifestHash $backend
$backendStagedHash = Get-BackendManifestHash $tauriBackend
if ($backendSourceHash -ne $backendStagedHash) {
    Throw-BuildFailure `
        -Code "backend_hash_mismatch" `
        -Step "Resource staging" `
        -Message "Backend staging hash mismatch. source=$backendSourceHash staged=$backendStagedHash" `
        -Hint "Delete src-tauri/backend-staging and rerun the build so resources are copied fresh from backend/."
}

$buildId = (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
Write-Host "[3/6] Resource staging complete." -ForegroundColor Green
Write-Host "      build_id = $buildId"
Write-Host "      backend_resource_hash = $backendSourceHash"
Write-Host "      consumet_node_runtime = $stagedNodeExe"
Write-Host "      bundled_aria2 = $stagedAria2Exe"
Write-Host "      runtime_config = $tauriRuntimeConfig"

Write-Host "[4/6] Building GRABIX with Tauri + PyO3..." -ForegroundColor Yellow
Write-Host "      PYO3_PYTHON = $pythonExe"
Write-Host "      GRABIX_BUILD_ID = $buildId"
Write-Host "      GRABIX_BACKEND_RESOURCE_HASH = $backendSourceHash"
Write-Host "      GRABIX_BACKEND_RESOURCE_SUBDIR = $bundleBackendSubdir"

Assert-NoTmdbSecrets -RootPath (Join-Path $frontend "src") -Label "frontend source"

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
        Throw-BuildFailure `
            -Code "frontend_build_failed" `
            -Step "Tauri build" `
            -Message "Tauri build failed (exit code $buildResult)." `
            -Hint "Inspect the npm/cargo output above and fix the first reported compile error before rebuilding."
    }

    Sync-PythonRuntimeDlls -RuntimeDir $pythonRuntime -ReleaseRoot $releaseDir
    Assert-NoTmdbSecrets -RootPath (Join-Path $frontend "dist") -Label "built frontend assets"
    Write-Host "[4/6] Build succeeded." -ForegroundColor Green

    Write-Host "[5/6] Smoke-testing packaged executable..." -ForegroundColor Yellow
    if (-not (Test-Path -LiteralPath $releaseExe)) {
        Throw-BuildFailure `
            -Code "frontend_build_failed" `
            -Step "Packaged smoke test" `
            -Message "Built executable not found: $releaseExe" `
            -Hint "Inspect the Tauri build output for the first compile or bundle failure."
    }

    Invoke-PackagedSmokeTest `
        -ExePath $releaseExe `
        -ExpectedBuildId $buildId `
        -ExpectedBackendHash $backendSourceHash `
        -ConsumetPort $packagedConsumetPort `
        -DiagnosticsPath $startupJsonPath `
        -LogPath $startupLogPath `
        -DesktopAuthPath $desktopAuthPath

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
