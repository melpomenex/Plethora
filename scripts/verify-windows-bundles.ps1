Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

$msiFiles = Get-ChildItem -Path "src-tauri/target" -Recurse -File -Filter "*.msi" |
  Where-Object { $_.FullName -match "\\release\\bundle\\msi\\" }
$exeFiles = Get-ChildItem -Path "src-tauri/target" -Recurse -File -Filter "*.exe" |
  Where-Object {
    $_.FullName -match "\\release\\bundle\\nsis\\" -and
    $_.Name -notmatch "\.exe\.zip$"
  }

if (-not $msiFiles -and -not $exeFiles) {
  throw "No Windows installer bundles found under src-tauri/target/**/release/bundle/"
}

$tmpRoot = Join-Path $env:RUNNER_TEMP "incrementum_bundle_verify"
if (Test-Path $tmpRoot) {
  Remove-Item -Recurse -Force $tmpRoot
}
New-Item -ItemType Directory -Path $tmpRoot | Out-Null

function Assert-RequiredSidecars {
  param(
    [Parameter(Mandatory = $true)][string]$RootPath,
    [Parameter(Mandatory = $true)][string]$Label
  )

  # Presence is insufficient: build.rs may seed zero-byte placeholders.
  $whisperSidecar = Get-ChildItem -Path $RootPath -Recurse -File -ErrorAction SilentlyContinue |
    Where-Object {
      ($_.Name -like "whisper-*" -or $_.Name -eq "whisper.exe") -and $_.Length -gt 0
    } |
    Select-Object -First 1

  if (-not $whisperSidecar) {
    throw "$Label missing whisper sidecar executable under $RootPath"
  }

  Write-Host "$Label found whisper sidecar: $($whisperSidecar.FullName)"

  $sherpaSidecar = Get-ChildItem -Path $RootPath -Recurse -File -ErrorAction SilentlyContinue |
    Where-Object {
      ($_.Name -like "sherpa-onnx-*" -or $_.Name -eq "sherpa-onnx.exe") -and $_.Length -gt 0
    } |
    Select-Object -First 1

  if (-not $sherpaSidecar) {
    throw "$Label missing non-empty sherpa-onnx sidecar executable under $RootPath"
  }

  # The sherpa-onnx sidecar's PE import table references ONNXRUNTIME.DLL by
  # exact name (not any *onnxruntime*.dll). onnxruntime_providers_shared.dll
  # alone is a 10 KB re-export shim and does NOT satisfy the import — requiring
  # the real DLL here is what catches the v2.4.0+ regression where the NSIS
  # bundle shipped only the shim and the sidecar crashed at model load with
  # "The requested API version [23] is not available ... ORT Version is: 1.17.1".
  $onnxRuntime = Get-ChildItem -Path $RootPath -Recurse -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -eq "onnxruntime.dll" -and $_.Length -gt 0 } |
    Select-Object -First 1

  if (-not $onnxRuntime) {
    throw "$Label missing non-empty onnxruntime.dll (the exact DLL sherpa-onnx.exe imports) under $RootPath"
  }

  Write-Host "$Label found sherpa sidecar: $($sherpaSidecar.FullName)"
  Write-Host "$Label found ONNX Runtime: $($onnxRuntime.FullName)"

  & node "scripts/verify-transcription-sidecars.mjs" --root $RootPath
  if ($LASTEXITCODE -ne 0) {
    throw "$Label transcription runtime smoke test failed with exit code $LASTEXITCODE"
  }

  # Check for NotebookLM runtime (venv-based on Windows)
  $notebooklmRuntime = Get-ChildItem -Path $RootPath -Recurse -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -eq "notebooklm-runtime" } |
    Select-Object -First 1

  if ($notebooklmRuntime) {
    # Check for venv-based NotebookLM installation
    $notebooklmVenv = Get-ChildItem -Path $notebooklmRuntime.FullName -Recurse -File -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -eq "notebooklm.exe" -or $_.Name -eq "notebooklm" } |
      Select-Object -First 1

    if ($notebooklmVenv) {
      Write-Host "$Label found NotebookLM runtime: $($notebooklmVenv.FullName)"
    } else {
      throw "$Label NotebookLM runtime directory found but no executable detected"
    }
  } else {
    throw "$Label missing bundled NotebookLM runtime under $RootPath"
  }

  # Check for notebooklm sidecar wrapper (alternative to venv)
  $notebooklmSidecar = Get-ChildItem -Path $RootPath -Recurse -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -like "notebooklm-*.cmd" -or $_.Name -like "notebooklm-*.exe" -or $_.Name -eq "notebooklm" } |
    Select-Object -First 1

  if ($notebooklmSidecar) {
    Write-Host "$Label found NotebookLM sidecar: $($notebooklmSidecar.FullName)"
  } else {
    throw "$Label missing NotebookLM sidecar under $RootPath"
  }
}

if ($msiFiles) {
  foreach ($msi in $msiFiles) {
    $outDir = Join-Path $tmpRoot ("msi_" + [IO.Path]::GetFileNameWithoutExtension($msi.Name))
    New-Item -ItemType Directory -Path $outDir | Out-Null
    $targetArg = "TARGETDIR=$outDir"
    $p = Start-Process -FilePath "msiexec.exe" -ArgumentList @("/a", $msi.FullName, "/qn", $targetArg) -PassThru -Wait
    if ($p.ExitCode -ne 0) {
      throw "MSI admin extraction failed for $($msi.FullName) with exit code $($p.ExitCode)"
    }
    Assert-RequiredSidecars -RootPath $outDir -Label "MSI $($msi.Name)"
  }
} else {
  Write-Host "No MSI bundles found; continuing with NSIS verification."
}

if ($exeFiles) {
  # 7-Zip can list NSIS installer archives (preinstalled at
  # C:\Program Files\7-Zip on windows-latest runners). Checking the ARCHIVE
  # before extraction distinguishes "the bundle never packed
  # bin/onnxruntime.dll" (resource-packing regression) from "it was packed but
  # didn't survive extraction" (e.g. AV interference on the runner).
  $sevenZip = "C:\Program Files\7-Zip\7z.exe"
  if (-not (Test-Path $sevenZip)) { $sevenZip = "7z" }

  foreach ($exe in $exeFiles) {
    $listing = & $sevenZip l $exe.FullName 2>$null
    if ($LASTEXITCODE -ne 0) {
      Write-Host "7z could not list $($exe.FullName); skipping archive pre-check."
      continue
    }
    $packedDll = $listing | Select-String -SimpleMatch "bin/onnxruntime.dll" |
      Select-Object -First 1
    if (-not $packedDll) {
      throw "$($exe.Name) archive does not contain bin/onnxruntime.dll — the NSIS resource packing dropped the ONNX Runtime DLL. Check the bin/*.dll resource set in src-tauri/bin."
    }
    Write-Host "$($exe.Name) archive contains bin/onnxruntime.dll (7z pre-check)."
  }

  foreach ($exe in $exeFiles) {
    $outDir = Join-Path $tmpRoot ("nsis_" + [IO.Path]::GetFileNameWithoutExtension($exe.Name))
    New-Item -ItemType Directory -Path $outDir | Out-Null
    $installArg = "/D=$outDir"
    $p = Start-Process -FilePath $exe.FullName -ArgumentList @("/S", $installArg) -PassThru -Wait
    if ($p.ExitCode -ne 0) {
      throw "NSIS silent install failed for $($exe.FullName) with exit code $($p.ExitCode)"
    }
    Assert-RequiredSidecars -RootPath $outDir -Label "NSIS $($exe.Name)"
  }
} else {
  Write-Host "No NSIS bundles found; continuing with MSI verification."
}

Write-Host "Windows bundle verification passed."
