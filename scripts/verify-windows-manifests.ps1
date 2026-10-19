<#
.SYNOPSIS
  Verifies the embedded application manifest of every Windows executable a
  bundle ships, then smoke-launches them.

.DESCRIPTION
  The 3.3.0 Windows installer shipped executables whose embedded manifest
  declared package identity in the *package* (AppxManifest) form — child
  <publisherIdentity>/<packageIdentity> elements — while the Windows loader
  requires the *application* manifest form: a childless <msix> element carrying
  packageName / publisher / applicationId. The Side-by-Side activation context
  generator rejected the manifest at line 1 (ERROR_SXS_CANT_GEN_ACTCTX / 14001,
  SideBySide event ID 62) before main() ran, so the app could not start at all on
  any machine — and nothing in the pipeline noticed: the bundle contained every
  expected file, `tauri build` succeeded, and no test looked at the artifact.

  This script looks at the artifact:

    1. extracts RT_MANIFEST resource 1 from each executable with mt.exe
    2. asks mt.exe to validate the manifest against the schema (supplementary)
    3. asserts the <msix> element is childless, in the msix namespace, carries
       all three attributes, and that each value equals the identity package
       manifest (AppxManifest.xml) of the PlethoraIdentity.msix shipped in the
       same bundle
    4. smoke-launches each executable for a short window and checks the
       Application event log for new SideBySide event 62 entries

  The smoke launch distinguishes *loader* failures, which fail the run, from a
  host that simply cannot keep a GUI process alive (a CI runner without an
  interactive desktop), which warns — the manual Windows VM checklist item is the
  acceptance for window creation itself.

  `-SelfTest` verifies the verifier: it runs steps 3's logic against the exact
  defect from 3.3.0 and against an identity mismatch, using fixtures. That runs
  on any machine with PowerShell (including macOS/Linux CI), so the check itself
  is not taken on faith.

.EXAMPLE
  pwsh ./scripts/verify-windows-manifests.ps1 -SelfTest

.EXAMPLE
  pwsh ./scripts/verify-windows-manifests.ps1 -RootPath 'D:\Plethora' -IdentityMsix 'D:\Plethora\PlethoraIdentity.msix'
#>
[CmdletBinding()]
param(
  [string]$RootPath,
  [string]$IdentityMsix,
  [string[]]$Executables = @('plethora-tauri.exe', 'pdf-reflow-diag.exe'),
  [int]$SmokeSeconds = 5,
  [switch]$SkipSmoke,
  [switch]$SelfTest
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$MsixNamespace = 'urn:schemas-microsoft-com:msix.v1'
$ManagedExecutables = @('plethora-tauri.exe', 'pdf-reflow-diag.exe')

# Exit codes that mean the process died in the loader, before any application
# code: 0xC0000142 STATUS_DLL_INIT_FAILED, 0xC0000135 STATUS_DLL_NOT_FOUND,
# 0xC000007B STATUS_INVALID_IMAGE_FORMAT.
$LoaderFailureExitCodes = @(-1073741502, -1073741515, -1073741701)

# --- helpers ---------------------------------------------------------------

function Find-SdkTool {
  param([string]$Name)
  $cmd = Get-Command $Name -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $roots = @("${env:ProgramFiles(x86)}\Windows Kits\10\bin", "${env:ProgramFiles}\Windows Kits\10\bin")
  foreach ($root in $roots) {
    if (-not $root -or -not (Test-Path $root)) { continue }
    $hit = Get-ChildItem $root -Recurse -Filter $Name -ErrorAction SilentlyContinue |
      Where-Object { $_.FullName -match '\\x64\\' } |
      Sort-Object FullName -Descending |
      Select-Object -First 1
    if ($hit) { return $hit.FullName }
  }
  return $null
}

function Get-IdentityPackageValues {
  <# Reads Identity/@Name, Identity/@Publisher, Identity/@Version and
     Applications/Application[0]/@Id out of an AppxManifest.xml inside a .msix.
     The container is a zip; it is read in place, never unpacked to disk. #>
  param([Parameter(Mandatory = $true)][string]$Path)

  Add-Type -AssemblyName System.IO.Compression.FileSystem -ErrorAction SilentlyContinue
  if (-not (Test-Path -LiteralPath $Path)) {
    throw "identity package not found: $Path"
  }

  $manifestXml = $null
  $zip = [System.IO.Compression.ZipFile]::OpenRead($Path)
  try {
    foreach ($entry in $zip.Entries) {
      if ($entry.FullName -ne 'AppxManifest.xml') { continue }
      $stream = $entry.Open()
      try {
        $reader = New-Object System.IO.StreamReader($stream)
        try { $manifestXml = [xml]$reader.ReadToEnd() } finally { $reader.Dispose() }
      } finally { $stream.Dispose() }
      break
    }
  } finally { $zip.Dispose() }

  if ($null -eq $manifestXml) { throw "AppxManifest.xml is missing from $Path" }
  $identity = $manifestXml.SelectSingleNode("/*[local-name()='Package']/*[local-name()='Identity']")
  $application = $manifestXml.SelectSingleNode("/*[local-name()='Package']/*[local-name()='Applications']/*[local-name()='Application']")
  if ($null -eq $identity) { throw "Identity element is missing from the package manifest in $Path" }
  if ($null -eq $application) { throw "Application element is missing from the package manifest in $Path" }

  return @{
    PackageName   = [string]$identity.Name
    Publisher     = [string]$identity.Publisher
    Version       = [string]$identity.Version
    ApplicationId = [string]$application.Id
    MsixPath      = $Path
  }
}

function Get-EmbeddedMsixState {
  <# Structural view of the <msix> element of an application manifest. #>
  param([Parameter(Mandatory = $true)][string]$ManifestXml)

  $document = [xml]$ManifestXml
  $msix = $document.SelectSingleNode("/*[local-name()='assembly']/*[local-name()='msix']")
  if ($null -eq $msix) {
    return @{ Present = $false }
  }
  # Whitespace/comment nodes are not elements: only real children count.
  $elementChildren = @($msix.ChildNodes | Where-Object { $_.NodeType -eq 'Element' })
  return @{
    Present           = $true
    ElementCount      = $elementChildren.Count
    ChildNames        = @($elementChildren | ForEach-Object { $_.LocalName })
    Namespace         = [string]$msix.NamespaceURI
    PackageName       = [string]$msix.GetAttribute('packageName')
    Publisher         = [string]$msix.GetAttribute('publisher')
    ApplicationId     = [string]$msix.GetAttribute('applicationId')
  }
}

function Assert-ManifestIdentity {
  <# The gate. Throws with the offending detail — never a generic failure. #>
  param(
    [Parameter(Mandatory = $true)][string]$Label,
    [Parameter(Mandatory = $true)][string]$ManifestXml,
    [Parameter(Mandatory = $true)][hashtable]$Expected
  )

  $state = Get-EmbeddedMsixState -ManifestXml $ManifestXml
  if (-not $state.Present) {
    throw "$Label declares no <msix> element; package identity would never be granted (expected packageName '$($Expected.PackageName)')."
  }
  if ($state.ElementCount -gt 0) {
    throw ("$Label declares <msix> with child elements ($($state.ChildNames -join ', ')). The Windows loader requires the " +
      "childless application-manifest form (attributes packageName/publisher/applicationId); the package-manifest form " +
      "(<publisherIdentity>/<packageIdentity>) fails Side-by-Side validation with 14001 and the process never reaches main().")
  }
  if ($state.Namespace -ne $MsixNamespace) {
    throw "$Label declares <msix> in namespace '$($state.Namespace)' instead of '$MsixNamespace'."
  }

  foreach ($pair in @(
      @{ Attribute = 'packageName'; Declared = $state.PackageName; Field = 'PackageName' },
      @{ Attribute = 'publisher'; Declared = $state.Publisher; Field = 'Publisher' },
      @{ Attribute = 'applicationId'; Declared = $state.ApplicationId; Field = 'ApplicationId' })) {
    $declared = $pair.Declared
    # NOTE: not `$expected` — PowerShell variable names are case-insensitive, so
    # that would overwrite the $Expected parameter after the first iteration.
    $want = [string]$Expected[$pair.Field]
    if ([string]::IsNullOrWhiteSpace($declared)) {
      throw "$Label is missing the required <msix> attribute '$($pair.Attribute)' (expected '$want')."
    }
    if ($declared -cne $want) {
      throw "$Label declares <msix> $($pair.Attribute)='$declared' but the shipped identity package declares '$want'."
    }
  }

  return $state
}

function Get-SideBySideEventCount {
  try {
    $events = Get-WinEvent -FilterHashtable @{ LogName = 'Application'; ProviderName = 'SideBySide'; Id = 62 } -MaxEvents 50 -ErrorAction Stop
    return @($events).Count
  } catch {
    # No events, or the log is unavailable in this session.
    return 0
  }
}

function Invoke-SmokeLaunch {
  param(
    [Parameter(Mandatory = $true)][string]$ExePath,
    [Parameter(Mandatory = $true)][string]$Label
  )

  $before = Get-SideBySideEventCount
  $stdout = Join-Path ([System.IO.Path]::GetTempPath()) ("plethora-smoke-" + [guid]::NewGuid() + ".out")
  $stderr = "$stdout.err"

  $process = Start-Process -FilePath $ExePath -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr
  $deadline = (Get-Date).AddSeconds($SmokeSeconds)
  while (-not $process.HasExited -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 200 }

  $alive = -not $process.HasExited
  $exitCode = if ($alive) { $null } else { $process.ExitCode }
  if ($alive) {
    # The point is that it survived the loader stage, not that it renders.
    Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
  }

  $after = Get-SideBySideEventCount
  $newEvents = $after - $before
  $output = @()
  foreach ($file in @($stdout, $stderr)) {
    if (Test-Path $file) {
      $output += (Get-Content $file -Raw -ErrorAction SilentlyContinue)
      Remove-Item $file -Force -ErrorAction SilentlyContinue
    }
  }
  $outputText = ($output -join "`n").Trim()

  if ($newEvents -gt 0) {
    throw ("$Label added $newEvents SideBySide event(s) 62 while starting: the embedded manifest was rejected by the loader. " +
      "Inspect the Application event log for the missing element or attribute.")
  }
  if ($alive) {
    Write-Host "$Label stayed alive for ${SmokeSeconds}s and logged no SideBySide error (PASS)."
    return
  }
  if ($LoaderFailureExitCodes -contains $exitCode) {
    throw "$Label exited with loader failure code $exitCode (0x$('{0:X8}' -f $exitCode)) before any application code ran."
  }

  # The diagnostic executable has a documented no-argument behaviour: print its
  # usage line and exit 2 (src-tauri/src/bin/pdf-reflow-diag.rs). Reaching that is
  # positive proof that application code ran — a rejected manifest never gets
  # here — so it is asserted rather than inferred from timing.
  if ([System.IO.Path]::GetFileName($ExePath) -ieq 'pdf-reflow-diag.exe') {
    if ($outputText -match 'usage:\s*pdf-reflow-diag') {
      Write-Host "$Label printed its usage output and exited $exitCode (PASS: application code ran)."
      return
    }
    throw ("$Label exited with code $exitCode without printing its usage output; with no arguments it must print " +
      "'usage: pdf-reflow-diag ...' (src-tauri/src/bin/pdf-reflow-diag.rs)." + $(if ($outputText) { " Output: $outputText" } else { '' }))
  }

  Write-Warning ("$Label exited after $SmokeSeconds`s with code $exitCode and no SideBySide error. On a host without an " +
    "interactive desktop (CI runners) a GUI process may exit for reasons unrelated to the manifest, so window creation is " +
    "confirmed by the manual VM checklist; a loader-level rejection is caught by the checks above." +
    $(if ($outputText) { " Output: $outputText" } else { '' }))
}

function Invoke-SelfTest {
  Write-Host 'Self-test: the gate must reject the 3.3.0 defect and accept the fixed manifest.'

  $broken = @'
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<assembly manifestVersion="1.0" xmlns="urn:schemas-microsoft-com:asm.v1">
  <assemblyIdentity version="3.3.0.0" processorArchitecture="*" name="Plethora.Plethora" type="win32" />
  <msix xmlns="urn:schemas-microsoft-com:msix.v1">
    <publisherIdentity name="CN=Plethora Sparse Dev" publisher="CN=Plethora Sparse Dev" />
    <packageIdentity name="Plethora.Plethora" publisher="CN=Plethora Sparse Dev" version="2.7.0.0" processorArchitecture="neutral" />
  </msix>
</assembly>
'@

  $fixed = @'
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<assembly manifestVersion="1.0" xmlns="urn:schemas-microsoft-com:asm.v1">
  <assemblyIdentity version="3.3.0.0" processorArchitecture="*" name="Plethora.Plethora" type="win32" />
  <msix xmlns="urn:schemas-microsoft-com:msix.v1"
        packageName="Plethora.Plethora"
        publisher="CN=Plethora Sparse Dev"
        applicationId="Plethora" />
</assembly>
'@

  $expected = @{ PackageName = 'Plethora.Plethora'; Publisher = 'CN=Plethora Sparse Dev'; ApplicationId = 'Plethora' }

  # 1. The exact 3.3.0 defect must be rejected, naming the child elements.
  $rejected = $false
  try { Assert-ManifestIdentity -Label 'self-test:3.3.0' -ManifestXml $broken -Expected $expected | Out-Null } catch {
    $rejected = $true
    if ($_.Exception.Message -notmatch 'child elements') { throw "self-test: rejection did not name the child elements: $($_.Exception.Message)" }
    if ($_.Exception.Message -notmatch 'main\(\)') { throw "self-test: rejection did not explain the launch consequence" }
  }
  if (-not $rejected) { throw 'self-test: the 3.3.0 child-element form was accepted — the gate does not catch the defect it exists for.' }

  # 2. A mismatching identity value must be rejected, naming the field and both values.
  $mismatch = $fixed -replace 'packageName="Plethora.Plethora"', 'packageName="Plethora.Wrong"'
  $mismatchRejected = $false
  try {
    Assert-ManifestIdentity -Label 'self-test:mismatch' -ManifestXml $mismatch -Expected $expected | Out-Null
  } catch {
    $mismatchRejected = $true
    if ($_.Exception.Message -notmatch 'packageName' -or $_.Exception.Message -notmatch 'Plethora.Wrong') {
      throw "self-test: mismatch rejection did not name the field and the declared value: $($_.Exception.Message)"
    }
  }
  if (-not $mismatchRejected) { throw 'self-test: an identity mismatch was accepted — the gate would let a mismatched package through.' }

  # 3. The fixed manifest must pass.
  $state = Assert-ManifestIdentity -Label 'self-test:fixed' -ManifestXml $fixed -Expected $expected
  if ($state.ElementCount -ne 0) { throw 'self-test: fixed manifest reported child elements' }

  # 4. Reading identity values out of a real .msix container must work.
  $tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("plethora-identity-selftest-" + [guid]::NewGuid())
  New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null
  try {
    $fixtureManifest = @"
<?xml version="1.0" encoding="utf-8"?>
<Package xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10">
  <Identity Name="Plethora.Plethora" Publisher="CN=Plethora Sparse Dev" Version="3.3.0.0" ProcessorArchitecture="neutral" />
  <Applications>
    <Application Id="Plethora" Executable="plethora-tauri.exe" />
  </Applications>
</Package>
"@
    Set-Content -Path (Join-Path $tempRoot 'AppxManifest.xml') -Value $fixtureManifest -Encoding UTF8
    # Written OUTSIDE the source directory: CreateFromDirectory would otherwise
    # include the package it is still writing (and fail on the open handle).
    $fixtureMsix = Join-Path ([System.IO.Path]::GetTempPath()) ("plethora-identity-selftest-" + [guid]::NewGuid() + '.msix')
    Add-Type -AssemblyName System.IO.Compression.FileSystem -ErrorAction SilentlyContinue
    [System.IO.Compression.ZipFile]::CreateFromDirectory($tempRoot, $fixtureMsix)

    $values = Get-IdentityPackageValues -Path $fixtureMsix
    if ($values.PackageName -ne $expected.PackageName -or $values.Publisher -ne $expected.Publisher -or $values.ApplicationId -ne $expected.ApplicationId) {
      throw "self-test: identity package reader returned $($values | Out-String)"
    }
    if ($values.Version -ne '3.3.0.0') { throw "self-test: identity version read as '$($values.Version)'" }
  } finally {
    Remove-Item -Recurse -Force $tempRoot -ErrorAction SilentlyContinue
    if ($fixtureMsix) { Remove-Item -Force $fixtureMsix -ErrorAction SilentlyContinue }
  }

  Write-Host 'Self-test passed: child-element defect rejected, identity mismatch rejected, fixed manifest accepted, identity package read correctly.'
}

# --- main ------------------------------------------------------------------

if ($SelfTest) {
  Invoke-SelfTest
  return
}

if (-not $RootPath) {
  throw 'RootPath is required (the directory holding the installed executables). Use -SelfTest to verify the checker itself.'
}
if (-not (Test-Path -LiteralPath $RootPath)) {
  throw "RootPath does not exist: $RootPath"
}

if (-not $IdentityMsix) {
  $IdentityMsix = Join-Path $RootPath 'PlethoraIdentity.msix'
}
$identity = Get-IdentityPackageValues -Path $IdentityMsix
Write-Host "Identity package: $($identity.MsixPath)"
Write-Host "  packageName=$($identity.PackageName) publisher=$($identity.Publisher) applicationId=$($identity.ApplicationId) version=$($identity.Version)"

# The installer hook runs this script from the install directory to register the
# package above. If either is missing from the bundle, NSIS_HOOK_POSTINSTALL
# silently does nothing and Windows AI features can never become active — a
# bundle-level gap that no manifest check would reveal.
$registrationHelper = Join-Path $RootPath 'register-sparse-identity.ps1'
if (-not (Test-Path -LiteralPath $registrationHelper)) {
  throw ("The bundle does not ship register-sparse-identity.ps1 next to the executables; the installer would have nothing to run " +
    "and the identity package would never be registered (expected at $registrationHelper).")
}
Write-Host "Registration helper: $registrationHelper"

$missing = @()
foreach ($name in $ManagedExecutables) {
  $exe = Join-Path $RootPath $name
  if (-not (Test-Path -LiteralPath $exe)) { $missing += $name }
}
if ($missing.Count -gt 0) {
  throw "Bundle is missing executable(s) that must carry the application manifest: $($missing -join ', ')"
}

$mt = Find-SdkTool 'mt.exe'
if (-not $mt) {
  throw 'mt.exe not found. Install the Windows SDK: an unverifiable embedded manifest is exactly what this gate exists to prevent.'
}

foreach ($name in $Executables) {
  $exe = Join-Path $RootPath $name
  if (-not (Test-Path -LiteralPath $exe)) {
    Write-Warning "skipping $name (not present in $RootPath)"
    continue
  }

  $extracted = Join-Path ([System.IO.Path]::GetTempPath()) ("plethora-manifest-" + [guid]::NewGuid() + '.manifest')
  try {
    Write-Host "Extracting RT_MANIFEST from $name ..."
    & $mt "-inputresource:$exe;#1" "-out:$extracted" | Out-Null
    if (-not (Test-Path -LiteralPath $extracted)) {
      throw "mt.exe could not extract an RT_MANIFEST resource from $exe (the executable would not receive package identity)."
    }
    $manifestXml = Get-Content -LiteralPath $extracted -Raw

    Write-Host '  schema conformance (mt.exe -validate_manifest) ...'
    $validation = & $mt "-manifest:$extracted" '-validate_manifest' 2>&1
    if ($LASTEXITCODE -ne 0) {
      Write-Warning ("mt.exe -validate_manifest reported an issue for $name (supplementary check; the attribute assertions below are " +
        "authoritative): " + ($validation -join ' '))
    }

    $state = Assert-ManifestIdentity -Label $name -ManifestXml $manifestXml -Expected @{
      PackageName   = $identity.PackageName
      Publisher     = $identity.Publisher
      ApplicationId = $identity.ApplicationId
    }
    Write-Host "  identity OK: packageName=$($state.PackageName) publisher=$($state.Publisher) applicationId=$($state.ApplicationId)"
  } catch {
    Write-Host "--- extracted manifest for $name ---"
    if (Test-Path -LiteralPath $extracted) { Get-Content -LiteralPath $extracted -Raw | Write-Host }
    throw
  } finally {
    Remove-Item -LiteralPath $extracted -Force -ErrorAction SilentlyContinue
  }
}

if (-not $SkipSmoke) {
  foreach ($name in $Executables) {
    $exe = Join-Path $RootPath $name
    if (-not (Test-Path -LiteralPath $exe)) { continue }
    Invoke-SmokeLaunch -ExePath $exe -Label $name
  }
}

Write-Host 'Windows manifest verification passed.'
