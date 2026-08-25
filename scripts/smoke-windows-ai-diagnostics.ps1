# Manual hardware validation helper for Windows on-device AI.
# Run on Copilot+ / Windows 11 24H2+ hardware after installing Plethora.
param(
  [string]$ExePath = ""
)

$ErrorActionPreference = "Stop"

Write-Host "=== Plethora Windows AI diagnostics ==="
Write-Host "Requires: Windows 11 build 26100+, optional PLETHORA_WINDOWS_AI_LAF_TOKEN"
Write-Host ""

if ($ExePath -and (Test-Path $ExePath)) {
  $env:PLETHORA_WINDOWS_AI_DIAGNOSTICS_ONLY = "1"
  & $ExePath
  exit $LASTEXITCODE
}

Write-Host "1. Package identity (GetCurrentPackageFullName):"
$psIdentity = @"
Add-Type -Namespace Win32 -Name AppModel -MemberDefinition @'
[DllImport(\"kernel32.dll\", CharSet = CharSet.Unicode)]
public static extern int GetCurrentPackageFullName(ref uint length, System.Text.StringBuilder name);
'@
`$len = 0
[Win32.AppModel]::GetCurrentPackageFullName([ref]`$len, `$null)
if (`$len -eq 0) { 'NO_PACKAGE_IDENTITY' } else {
  `$sb = New-Object System.Text.StringBuilder `$len
  [Win32.AppModel]::GetCurrentPackageFullName([ref]`$len, `$sb)
  `$sb.ToString()
}
"@
powershell -NoProfile -Command $psIdentity

Write-Host ""
Write-Host "2. OS build:"
(Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion').CurrentBuildNumber

Write-Host ""
Write-Host "3. LAF token configured:"
if ($env:PLETHORA_WINDOWS_AI_LAF_TOKEN) { "yes" } else { "no" }

Write-Host ""
Write-Host "4. In Plethora: Settings -> On-device AI -> Refresh, then Show diagnostics."
Write-Host "   Or invoke plugin command windows_lm_diagnostics from devtools."
