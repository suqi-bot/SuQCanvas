$ErrorActionPreference = 'Stop'

$appRoot = Split-Path -Parent $PSScriptRoot
$bundledNode = Join-Path $appRoot 'runtime\node.exe'
if (Test-Path $bundledNode) {
  $nodeExecutable = $bundledNode
} else {
  $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
  $nodeExecutable = $nodeCommand.Source
}
if (-not $nodeExecutable) {
  Write-Host 'Node.js was not found. Install Node.js 20 or newer, then run start-lan.bat again.' -ForegroundColor Red
  exit 1
}

$firewallRule = Get-NetFirewallRule -DisplayName 'SuQCanvas LAN 8790' -ErrorAction SilentlyContinue
if (-not $firewallRule -or -not $firewallRule.Enabled) {
  Write-Host 'Windows will request permission to allow LAN access on TCP port 8790.' -ForegroundColor Yellow
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'open-lan-firewall.ps1')
}

$addresses = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
  Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
  Select-Object -ExpandProperty IPAddress -Unique

Write-Host ''
Write-Host 'SuQCanvas LAN is starting...' -ForegroundColor Cyan
Write-Host 'Local: http://localhost:8790/SuQCanvas/'
foreach ($address in $addresses) {
  Write-Host "LAN:   http://${address}:8790/SuQCanvas/" -ForegroundColor Green
}
Write-Host 'Keep this window open. Press Ctrl+C to stop.' -ForegroundColor DarkGray
Write-Host ''

Start-Process 'http://localhost:8790/SuQCanvas/'
Push-Location $appRoot

# Raise Node heap limit (default 4GB is not enough for large assets / multiple clients)
if (-not $env:NODE_OPTIONS) {
  $env:NODE_OPTIONS = '--max-old-space-size=8192'
} elseif ($env:NODE_OPTIONS -notmatch 'max-old-space-size') {
  $env:NODE_OPTIONS = "$env:NODE_OPTIONS --max-old-space-size=8192"
}

try {
  & $nodeExecutable (Join-Path $appRoot 'server\lan-server.mjs')
  exit $LASTEXITCODE
} finally {
  Pop-Location
}
