param(
  [string]$Version = "1.4.363.0"
)

$ErrorActionPreference = "Stop"

$SdkRoot = Join-Path $env:RUNNER_TEMP "vulkan-sdk-$Version"
$Installer = Join-Path $env:RUNNER_TEMP "vulkan-sdk-$Version.exe"
$DownloadUrl = "https://sdk.lunarg.com/sdk/download/$Version/windows/vulkan_sdk.exe"

Invoke-WebRequest -Uri $DownloadUrl -OutFile $Installer
& $Installer --root $SdkRoot --accept-licenses --default-answer --confirm-command install copy_only=1
if ($LASTEXITCODE -ne 0) {
  throw "Vulkan SDK installer failed with exit code $LASTEXITCODE."
}

$Glslc = Join-Path $SdkRoot "Bin/glslc.exe"
if (-not (Test-Path $Glslc)) {
  throw "Vulkan SDK installation did not provide glslc.exe at $Glslc."
}

"VULKAN_SDK=$SdkRoot" | Out-File -FilePath $env:GITHUB_ENV -Encoding utf8 -Append
"$SdkRoot\Bin" | Out-File -FilePath $env:GITHUB_PATH -Encoding utf8 -Append
Write-Host "Installed build-only Vulkan SDK $Version at $SdkRoot."
