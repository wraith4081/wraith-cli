#Requires -Version 5
param(
  [string]$Repo       = $env:REPO,
  [string]$BinaryName = $env:BINARY_NAME,
  [string]$Version    = $env:VERSION,
  [string]$InstallDir = $env:INSTALL_DIR,
  [switch]$SkipSha
)
if (-not $Repo)       { $Repo       = "wraith4081/wraith-cli" }
if (-not $BinaryName) { $BinaryName = "ai" }
if (-not $Version)    { $Version    = "latest" }
if (-not $InstallDir) { $InstallDir = "$env:LOCALAPPDATA\wraith\bin" }

$ErrorActionPreference = "Stop"

# Arch: your current windows build is x64 only
$arch = "x64"

# Asset name in releases is always wraith-cli-windows-x64.exe
$assetFile = "wraith-cli-windows-$arch.exe"
$shaFile   = "$assetFile.sha256"
$baseUrl   = if ($Version -eq "latest") { "https://github.com/$Repo/releases/latest/download" } else { "https://github.com/$Repo/releases/download/$Version" }
$url       = "$baseUrl/$assetFile"
$shaUrl    = "$baseUrl/$shaFile"

# Prep
if (-not (Test-Path -LiteralPath $InstallDir)) { New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null }
$tmp = Join-Path ([IO.Path]::GetTempPath()) ("wraith-install-" + [guid]::NewGuid())
New-Item -ItemType Directory -Force -Path $tmp | Out-Null

# Download binary
$exePath = Join-Path $tmp $assetFile
Write-Host "Downloading $url"
Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $exePath

# Verify checksum if available
if (-not $SkipSha) {
  try {
    $shaPath = Join-Path $tmp $shaFile
    Write-Host "Fetching checksum $shaUrl"
    Invoke-WebRequest -UseBasicParsing -Uri $shaUrl -OutFile $shaPath
    $want = (Get-Content $shaPath | Select-String -Pattern '[a-f0-9]{64}' -AllMatches).Matches.Value | Select-Object -First 1
    if ($want) {
      $got = (Get-FileHash -Algorithm SHA256 $exePath).Hash.ToLower()
      if ($got -ne $want.ToLower()) {
        throw "Checksum mismatch. expected=$want got=$got"
      } else {
        Write-Host "Checksum OK ($got)"
      }
    } else {
      Write-Warning "Could not parse checksum file; skipping verification."
    }
  } catch {
    Write-Warning "Checksum file not found or verify failed: $($_.Exception.Message). Continuing without verification."
  }
} else {
  Write-Host "Skipping checksum verification (SkipSha)"
}

# Move into place
$target = Join-Path $InstallDir ($BinaryName + ".exe")
Move-Item -Force $exePath $target

# PATH (user) update if needed
$path = [Environment]::GetEnvironmentVariable("Path", "User")
if ($path -notlike "*$InstallDir*") {
  $newPath = if ($path) { "$path;$InstallDir" } else { "$InstallDir" }
  [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
  Write-Host "Added $InstallDir to your user PATH. Restart your terminal to pick it up."
}

Write-Host "✅ Installed: $target"
Write-Host "Try:  $BinaryName --version"
