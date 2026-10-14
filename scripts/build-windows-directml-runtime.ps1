param(
  [string]$BinDir = (Join-Path $PSScriptRoot "../src-tauri/bin"),
  [string]$SherpaVersion = "v1.13.6"
)

$ErrorActionPreference = "Stop"

$RuntimeDir = Join-Path $BinDir "sherpa-directml"
$BuildRoot = Join-Path $env:TEMP "plethora-sherpa-directml-$SherpaVersion"
$SourceDir = Join-Path $BuildRoot "source"
$BuildDir = Join-Path $BuildRoot "build"

New-Item -ItemType Directory -Force -Path $RuntimeDir | Out-Null

function Write-CpuOnlyManifest {
  $manifest = @{
    schema = 1
    provider = "cpu-only"
    sherpa_version = $SherpaVersion
  } | ConvertTo-Json -Compress
  [System.IO.File]::WriteAllText(
    (Join-Path $RuntimeDir "runtime-manifest.json"),
    $manifest,
    [System.Text.UTF8Encoding]::new($false)
  )
}

function Invoke-Checked {
  param([string]$Command, [string[]]$Arguments)
  & $Command @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$Command failed with exit code $LASTEXITCODE"
  }
}

try {
  if (-not (Get-Command cmake -ErrorAction SilentlyContinue)) {
    throw "CMake is required to build the Windows DirectML runtime."
  }
  if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    throw "Git is required to fetch the pinned sherpa-onnx source."
  }

  Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $BuildRoot
  New-Item -ItemType Directory -Force -Path $BuildRoot | Out-Null
  Invoke-Checked "git" @(
    "clone", "--depth", "1", "--recurse-submodules", "--branch", $SherpaVersion,
    "https://github.com/k2-fsa/sherpa-onnx.git", $SourceDir
  )

  Invoke-Checked "cmake" @(
    "-S", $SourceDir,
    "-B", $BuildDir,
    "-A", "x64",
    "-DBUILD_SHARED_LIBS=ON",
    "-DSHERPA_ONNX_ENABLE_DIRECTML=ON",
    "-DSHERPA_ONNX_ENABLE_BINARY=ON",
    "-DSHERPA_ONNX_ENABLE_C_API=OFF",
    "-DSHERPA_ONNX_ENABLE_PYTHON=OFF",
    "-DSHERPA_ONNX_ENABLE_TESTS=OFF",
    "-DSHERPA_ONNX_ENABLE_PORTAUDIO=OFF",
    "-DSHERPA_ONNX_ENABLE_WEBSOCKET=OFF",
    "-DSHERPA_ONNX_ENABLE_TTS=OFF",
    "-DSHERPA_ONNX_ENABLE_SPEAKER_DIARIZATION=OFF"
  )
  Invoke-Checked "cmake" @("--build", $BuildDir, "--config", "Release", "--parallel")

  $online = Get-ChildItem -Path $BuildDir -Filter "sherpa-onnx.exe" -File -Recurse |
    Sort-Object { $_.FullName.Length } |
    Select-Object -First 1
  if (-not $online) {
    throw "The DirectML build did not produce sherpa-onnx.exe."
  }
  $offline = Get-ChildItem -Path $BuildDir -Filter "sherpa-onnx-offline.exe" -File -Recurse |
    Sort-Object { $_.FullName.Length } |
    Select-Object -First 1
  if (-not $offline) {
    throw "The DirectML build did not produce sherpa-onnx-offline.exe."
  }

  $runtimeFiles = @(
    "onnxruntime.dll",
    "DirectML.dll"
  )
  $resolvedRuntimeFiles = @{}
  foreach ($name in $runtimeFiles) {
    $file = Get-ChildItem -Path $BuildDir -Filter $name -File -Recurse |
      Sort-Object { $_.FullName.Length } |
      Select-Object -First 1
    if (-not $file) {
      throw "The DirectML build is missing required runtime file $name."
    }
    $resolvedRuntimeFiles[$name] = $file
  }

  Get-ChildItem -Path $RuntimeDir -File | Remove-Item -Force
  Copy-Item -Path $online.FullName -Destination (Join-Path $RuntimeDir "sherpa-online.exe")
  Copy-Item -Path $offline.FullName -Destination (Join-Path $RuntimeDir "sherpa-onnx.exe")
  $dllGroups = Get-ChildItem -Path $BuildDir -Filter "*.dll" -File -Recurse |
    Group-Object Name
  foreach ($group in $dllGroups) {
    $file = $group.Group |
      Sort-Object { $_.FullName.Length } |
      Select-Object -First 1
    $destination = Join-Path $RuntimeDir $file.Name
    if (-not (Test-Path $destination)) {
      Copy-Item -Path $file.FullName -Destination $destination
    }
  }
  foreach ($name in $runtimeFiles) {
    Copy-Item -Path $resolvedRuntimeFiles[$name].FullName -Destination (Join-Path $RuntimeDir $name)
  }

  $packagedFiles = @(Get-ChildItem -Path $RuntimeDir -File |
    Select-Object -ExpandProperty Name |
    Sort-Object)
  $manifest = @{
    schema = 1
    provider = "directml"
    sherpa_version = $SherpaVersion
    source_tag = $SherpaVersion
    files = $packagedFiles
  } | ConvertTo-Json -Compress
  [System.IO.File]::WriteAllText(
    (Join-Path $RuntimeDir "runtime-manifest.json"),
    $manifest,
    [System.Text.UTF8Encoding]::new($false)
  )
  Write-Host "Built pinned sherpa-onnx $SherpaVersion DirectML runtime in $RuntimeDir"
} catch {
  Get-ChildItem -Path $RuntimeDir -File -ErrorAction SilentlyContinue | Remove-Item -Force
  Write-CpuOnlyManifest
  if ($env:CI) {
    throw
  }
  Write-Warning "Windows DirectML runtime was not built: $_. CPU transcription remains available."
}
