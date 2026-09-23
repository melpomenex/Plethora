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

# Locate a Windows SDK binary (makeappx/signtool) whether or not it is on
# PATH. The runner images have moved the SDK layout around; search both
# Program Files roots recursively instead of assuming a versioned dir name.
function Find-SdkTool {
  param([string]$Name)
  $cmd = Get-Command $Name -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $roots = @(
    "${env:ProgramFiles(x86)}\Windows Kits\10\bin",
    "${env:ProgramFiles}\Windows Kits\10\bin"
  )
  foreach ($root in $roots) {
    if (-not (Test-Path $root)) { continue }
    $hit = Get-ChildItem $root -Recurse -Filter $Name -ErrorAction SilentlyContinue |
      Where-Object { $_.FullName -match '\\x64\\' } |
      Sort-Object FullName -Descending |
      Select-Object -First 1
    if ($hit) { return $hit.FullName }
  }
  return $null
}

$makeAppx = Find-SdkTool 'makeappx.exe'
if (-not $makeAppx) {
  Write-Error "makeappx.exe not found. Install Windows SDK."
}

# MakeAppx requires the source manifest to be named AppxManifest.xml. Keep the
# checked-in manifest's descriptive filename, but stage it under the required
# footprint filename so output files under sparse/out are never packed either.
$StageDir = Join-Path ([System.IO.Path]::GetTempPath()) ("PlethoraSparsePackage-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $StageDir -Force | Out-Null
try {
  Copy-Item $Manifest (Join-Path $StageDir "AppxManifest.xml") -Force
  Copy-Item $AssetsDir (Join-Path $StageDir "Assets") -Recurse -Force
  # /nv is required for sparse (external-location) packages: the manifest
  # declares the app executable, which lives in the NSIS install folder
  # OUTSIDE this identity-only package. MakeAppx's semantic validation would
  # otherwise reject the pack with 0x80080204 ("file name ... doesn't exist
  # in the package").
  & $makeAppx pack /d $StageDir /p $MsixPath /nv /o
  if ($LASTEXITCODE -ne 0) {
    throw "makeappx.exe failed with exit code $LASTEXITCODE"
  }
} finally {
  Remove-Item -LiteralPath $StageDir -Recurse -Force -ErrorAction SilentlyContinue
}

$signtool = Find-SdkTool 'signtool.exe'
if ($signtool) {
  & $signtool sign /fd SHA256 /f $CertPath /p $CertPassword $MsixPath
  if ($LASTEXITCODE -ne 0) {
    throw "signtool.exe failed with exit code $LASTEXITCODE"
  }
}

Write-Host "Sparse package: $MsixPath"
