# Builds and signs the Plethora sparse identity package for NSIS installs.
# Requires Windows SDK MakeAppx + SignTool (Visual Studio Build Tools).
param(
  [string]$Version = "2.7.0.0",
  [string]$OutDir = "src-tauri/windows/sparse/out"
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$SparseDir = Join-Path $Root "src-tauri/windows/sparse"
$Manifest = Join-Path $SparseDir "Package.appxmanifest"
$AssetsDir = Join-Path $SparseDir "Assets"

if (-not (Test-Path $AssetsDir)) {
  New-Item -ItemType Directory -Path $AssetsDir -Force | Out-Null
  $icon = Join-Path $Root "src-tauri/icons/128x128.png"
  if (Test-Path $icon) {
    Copy-Item $icon (Join-Path $AssetsDir "Square44x44Logo.png") -Force
    Copy-Item $icon (Join-Path $AssetsDir "Square150x150Logo.png") -Force
  }
}

New-Item -ItemType Directory -Path $OutDir -Force | Out-Null
$MsixPath = Join-Path $OutDir "PlethoraIdentity.msix"
$CertPath = Join-Path $OutDir "plethora-sparse-dev.pfx"
$CertPassword = "plethora-dev"

if (-not (Test-Path $CertPath)) {
  $cert = New-SelfSignedCertificate `
    -Type Custom `
    -Subject "CN=Plethora Sparse Dev" `
    -KeyUsage DigitalSignature `
    -FriendlyName "Plethora Sparse Dev" `
    -CertStoreLocation "Cert:\CurrentUser\My" `
    -TextExtension @("2.5.4.3=Plethora Sparse Dev")
  Export-PfxCertificate -Cert $cert -FilePath $CertPath -Password (ConvertTo-SecureString -String $CertPassword -Force -AsPlainText) | Out-Null
}

$makeAppx = Get-Command makeappx.exe -ErrorAction SilentlyContinue
if (-not $makeAppx) {
  $sdk = "${env:ProgramFiles(x86)}\Windows Kits\10\bin"
  if (Test-Path $sdk) {
    $ver = Get-ChildItem $sdk | Sort-Object Name -Descending | Select-Object -First 1
    $makeAppx = Join-Path $ver.FullName "x64\makeappx.exe"
  }
}
if (-not (Test-Path $makeAppx)) {
  Write-Error "makeappx.exe not found. Install Windows SDK."
}

& $makeAppx pack /d $SparseDir /p $MsixPath /o

$signtool = Get-Command signtool.exe -ErrorAction SilentlyContinue
if (-not $signtool) {
  $sdk = "${env:ProgramFiles(x86)}\Windows Kits\10\bin"
  if (Test-Path $sdk) {
    $ver = Get-ChildItem $sdk | Sort-Object Name -Descending | Select-Object -First 1
    $signtool = Join-Path $ver.FullName "x64\signtool.exe"
  }
}
if (Test-Path $signtool) {
  & $signtool sign /fd SHA256 /f $CertPath /p $CertPassword $MsixPath
}

Write-Host "Sparse package: $MsixPath"
