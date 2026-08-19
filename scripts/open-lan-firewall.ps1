$ErrorActionPreference = 'Stop'

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  $arguments = @(
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-File', ('"{0}"' -f $PSCommandPath)
  )
  Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList $arguments -Wait
  exit $LASTEXITCODE
}

foreach ($rule in @(
  @{ Name = 'SuQCanvas LAN 8790'; Port = 8790; Description = 'SuQCanvas LAN collaboration relay' },
  @{ Name = 'SuQCanvas LAN Dev 5174'; Port = 5174; Description = 'SuQCanvas LAN development web server' }
)) {
  $existing = Get-NetFirewallRule -DisplayName $rule.Name -ErrorAction SilentlyContinue
  if ($existing) {
    Set-NetFirewallRule -DisplayName $rule.Name -Enabled True -Direction Inbound -Action Allow -Profile Any
    Get-NetFirewallRule -DisplayName $rule.Name | Get-NetFirewallAddressFilter | Set-NetFirewallAddressFilter -RemoteAddress LocalSubnet
  } else {
    New-NetFirewallRule -DisplayName $rule.Name -Direction Inbound -Action Allow -Protocol TCP -LocalPort $rule.Port -Profile Any -RemoteAddress LocalSubnet -Description $rule.Description
  }
}

Write-Host 'SuQCanvas LAN TCP ports 8790 and 5174 are allowed for the local subnet.'
