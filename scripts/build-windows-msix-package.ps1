# Builds a full MSIX desktop package from a release NSIS staging directory.
# Store signing requires a production certificate — this script uses the same dev cert as sparse identity.
param(
  [Parameter(Mandatory = $true)][string]$StageDir,
  [string]$Version = "2.7.0.0",
  [string]$OutDir = "src-tauri/windows/msix/out"
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$MsixDir = Join-Path $Root "src-tauri/windows/msix"
$SparseAssets = Join-Path $Root "src-tauri/windows/sparse/Assets"
$AssetsDir = Join-Path $MsixDir "Assets"

if (-not (Test-Path $StageDir)) {
  Write-Error "Stage directory not found: $StageDir"
}

New-Item -ItemType Directory -Path $AssetsDir -Force | Out-Null
if (Test-Path $SparseAssets) {
  Copy-Item "$SparseAssets\*" $AssetsDir -Force
}

# Stage application binaries beside the manifest for MakeAppx.
$StageMsix = Join-Path $env:TEMP "plethora-msix-stage"
if (Test-Path $StageMsix) { Remove-Item -Recurse -Force $StageMsix }
New-Item -ItemType Directory -Path $StageMsix -Force | Out-Null
Copy-Item (Join-Path $MsixDir "Package.appxmanifest") $StageMsix -Force
Copy-Item $AssetsDir (Join-Path $StageMsix "Assets") -Recurse -Force
Copy-Item "$StageDir\*" $StageMsix -Recurse -Force

New-Item -ItemType Directory -Path $OutDir -Force | Out-Null
$MsixPath = Join-Path $OutDir "Plethora.msix"
$CertPath = Join-Path (Join-Path $Root "src-tauri/windows/sparse/out") "plethora-sparse-dev.pfx"
$CertPassword = "plethora-dev"

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

& $makeAppx pack /d $StageMsix /p $MsixPath /o

if (Test-Path $CertPath) {
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
}

Write-Host "MSIX package: $MsixPath"
