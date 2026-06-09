# Stoa server installer (native Windows) — bootstrap the hub on a fresh machine.
#
#   irm https://raw.githubusercontent.com/asharijuang/stoa/master/install.ps1 | iex
#   # or, from a clone:
#   powershell -ExecutionPolicy Bypass -File .\install.ps1
#
# Checks prerequisites, fetches the code, installs deps, then runs `node cli.js install`
# which links the `stoa` command and registers the background gateway (Scheduled Task).

$ErrorActionPreference = "Stop"
$RepoUrl    = if ($env:STOA_REPO_URL) { $env:STOA_REPO_URL } else { "https://github.com/asharijuang/stoa" }
$InstallDir = if ($env:STOA_DIR)      { $env:STOA_DIR }      else { "$env:USERPROFILE\stoa" }

Write-Host "=== Stoa installer (Windows) ==="

foreach ($cmd in @("git", "node", "npm")) {
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
    Write-Error "$cmd not found. Install Node.js 20+ (https://nodejs.org/) and git (https://git-scm.com/) first."
    exit 1
  }
}
$nodeMajor = [int](node -p "process.versions.node.split('.')[0]")
if ($nodeMajor -lt 20) { Write-Error "Node 20+ required (found $(node -v))."; exit 1 }
Write-Host "ok: node $(node -v), npm $(npm -v), git present"

if ((Test-Path ".\cli.js") -and (Test-Path ".\server.js")) {
  $InstallDir = (Get-Location).Path
  Write-Host "[1/3] Using current checkout: $InstallDir"
} elseif (Test-Path "$InstallDir\.git") {
  Write-Host "[1/3] Updating existing clone: $InstallDir"
  git -C "$InstallDir" pull --ff-only
  Set-Location $InstallDir
} else {
  Write-Host "[1/3] Cloning $RepoUrl -> $InstallDir"
  git clone $RepoUrl $InstallDir
  Set-Location $InstallDir
}

Write-Host "[2/3] Installing dependencies (npm install)..."
npm install --no-audit --no-fund

Write-Host "[3/3] Bootstrapping (link command + enable gateway)..."
node cli.js install

Write-Host ""
Write-Host "=== Done ==="
Write-Host "Open the dashboard:  stoa dashboard"
Write-Host "Check status:        stoa gateway status"
Write-Host "Stop the server:     stoa gateway stop"
