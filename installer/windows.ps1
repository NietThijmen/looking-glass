# Installs the latest Lookingglass release on Windows (x64) by running its NSIS installer
# silently. The installer is per-user, so no administrator rights are needed.
#
#   irm https://raw.githubusercontent.com/NietThijmen/looking-glass/main/installer/windows.ps1 | iex
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$repo = 'NietThijmen/looking-glass'

function Fail($message) {
  Write-Error "error: $message"
  exit 1
}

if ($env:OS -ne 'Windows_NT') { Fail 'this installer only supports Windows' }
if ($env:PROCESSOR_ARCHITECTURE -ne 'AMD64' -and $env:PROCESSOR_ARCHITEW6432 -ne 'AMD64') {
  Fail "releases only include x64 builds (this machine is $env:PROCESSOR_ARCHITECTURE)"
}

# GitHub requires TLS 1.2; older Windows PowerShell defaults to less.
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

Write-Host 'Looking up the latest release...'
try {
  $release = Invoke-RestMethod -Headers @{ Accept = 'application/vnd.github+json' } -Uri "https://api.github.com/repos/$repo/releases/latest"
} catch {
  Fail "couldn't fetch the latest release from GitHub"
}

# Builds are named Lookingglass Setup <version>.exe (GitHub turns the spaces into dots).
$asset = $release.assets | Where-Object { $_.name -like '*.exe' } | Select-Object -First 1
if (-not $asset) { Fail 'the latest release has no Windows download' }

if (Get-Process -Name 'Lookingglass' -ErrorAction SilentlyContinue) {
  Write-Host 'note: Lookingglass is running. Close it so the installer can replace it.'
}

$tmp = Join-Path ([IO.Path]::GetTempPath()) ([IO.Path]::GetRandomFileName())
New-Item -ItemType Directory -Path $tmp | Out-Null
try {
  $installer = Join-Path $tmp 'Lookingglass-Setup.exe'
  Write-Host "Downloading $($asset.name)..."
  try {
    Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $installer
  } catch {
    Fail 'download failed'
  }

  Write-Host 'Installing...'
  $process = Start-Process -FilePath $installer -ArgumentList '/S' -Wait -PassThru
  if ($process.ExitCode -ne 0) { Fail "the installer exited with code $($process.ExitCode)" }
} finally {
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}

Write-Host 'Installed Lookingglass. Open it from the Start menu.'
