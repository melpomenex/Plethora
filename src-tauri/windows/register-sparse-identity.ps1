<#
.SYNOPSIS
  Registers (or removes) Plethora's sparse package identity for an NSIS install.

.DESCRIPTION
  Plethora is installed by an NSIS per-user installer, so it has no package
  identity of its own. Identity is what unlocks the Windows AI APIs, and the
  way to grant it to a loose Win32 executable is a "package with external
  location" (a.k.a. sparse package): the shipped PlethoraIdentity.msix declares
  the identity and points at the installation directory.

  The installer runs this script from NSIS_HOOK_POSTINSTALL /
  NSIS_HOOK_PREUNINSTALL. Two rules matter more than the happy path:

  * TRUST FIRST. Registration is attempted only when the package's signing
    chain already builds against this machine's certificate stores. Nothing in
    this script ever imports a certificate into TrustedPeople or Root: an
    installer that plants a root of trust to make its own artifact acceptable
    is a security defect, not a workaround. With a development certificate
    (CN=Plethora Sparse Dev) on a user machine the chain does not build, so the
    package is not registered and the app simply runs without identity.

  * NEVER FAIL THE INSTALL. Every outcome is logged and reported through the
    exit code; the NSIS hook treats non-zero as information, not as a failure.
    Running without package identity is a supported state: identity-dependent
    features report package_identity_missing and everything else works.

  Exit codes: 0 = registered / already correct, 10 = skipped by policy,
  20 = registration failed.

.PARAMETER InstallDir
  The application installation directory (the sparse package's external
  location). Required.

.PARAMETER Msix
  Path to PlethoraIdentity.msix. Defaults to <InstallDir>\PlethoraIdentity.msix.

.PARAMETER Uninstall
  Remove the registration instead of creating it. Tolerates a package that is
  not registered.

.PARAMETER LogFile
  Override the log destination (default: %LOCALAPPDATA%\Plethora\logs\identity-registration.log).

.PARAMETER DryRun
  Decide everything and log it, but perform no package registration or removal.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$InstallDir,
  [string]$Msix,
  [switch]$Uninstall,
  [string]$LogFile,
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

# Package identity as declared in the shipped identity package manifest. Used
# only for the uninstall fallback when the .msix is already gone; when the
# package is present its manifest is the authority.
$FallbackPackageName = 'Plethora.Plethora'
$FallbackPublisher = 'CN=Plethora Sparse Dev'

$ExitRegistered = 0
$ExitSkipped = 10
$ExitFailed = 20

# --- logging ---------------------------------------------------------------

function Get-IdentityLogPath {
  if ($LogFile) { return $LogFile }
  if ($env:LOCALAPPDATA) { return (Join-Path $env:LOCALAPPDATA 'Plethora\logs\identity-registration.log') }
  return (Join-Path $env:TEMP 'plethora-identity-registration.log')
}

$script:IdentityLogPath = Get-IdentityLogPath

function Write-IdentityLog {
  param([string]$Level, [string]$Message)
  $line = '{0} [{1}] {2}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Level, $Message
  try {
    $dir = Split-Path -Parent $script:IdentityLogPath
    if ($dir -and -not (Test-Path -LiteralPath $dir)) {
      New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }
    Add-Content -LiteralPath $script:IdentityLogPath -Value $line -Encoding UTF8 -ErrorAction Stop
  } catch {
    # Logging must never break installation flow.
  }
  Write-Host $line
}

# --- helpers ---------------------------------------------------------------

function Read-ZipEntryBytes {
  param([string]$Path, [string]$EntryName)
  Add-Type -AssemblyName System.IO.Compression.FileSystem -ErrorAction SilentlyContinue
  $zip = [System.IO.Compression.ZipFile]::OpenRead($Path)
  try {
    foreach ($entry in $zip.Entries) {
      if ($entry.FullName -eq $EntryName) {
        $stream = $entry.Open()
        try {
          $memory = New-Object System.IO.MemoryStream
          try {
            $stream.CopyTo($memory)
            return $memory.ToArray()
          } finally { $memory.Dispose() }
        } finally { $stream.Dispose() }
      }
    }
  } finally { $zip.Dispose() }
  return $null
}

function Read-AppxIdentityFromMsix {
  param([string]$Path)
  $bytes = Read-ZipEntryBytes -Path $Path -EntryName 'AppxManifest.xml'
  if ($null -eq $bytes) { throw "AppxManifest.xml is missing from $Path" }

  $xml = [xml][System.Text.Encoding]::UTF8.GetString($bytes)
  $identity = $xml.SelectSingleNode("/*[local-name()='Package']/*[local-name()='Identity']")
  $application = $xml.SelectSingleNode("/*[local-name()='Package']/*[local-name()='Applications']/*[local-name()='Application']")
  if ($null -eq $identity) { throw "Identity element is missing from the package manifest in $Path" }

  return @{
    PackageName   = [string]$identity.Name
    Publisher     = [string]$identity.Publisher
    Version       = [string]$identity.Version
    ApplicationId = if ($null -ne $application) { [string]$application.Id } else { '' }
  }
}

function Test-AppxSignatureTrusted {
  param([string]$Path)

  # An AppX/MSIX container is not a PE file: its signature is the CMS blob in
  # AppxSignature.p7x rather than an Authenticode signature on the file, so the
  # chain is built explicitly from that blob. Certificates embedded in the blob
  # are offered as intermediates only — the root still has to be trusted by the
  # platform's stores for Build() to succeed.
  $bytes = Read-ZipEntryBytes -Path $Path -EntryName 'AppxSignature.p7x'
  if ($null -eq $bytes) {
    return @{ Trusted = $false; Reason = 'the identity package is not signed (no AppxSignature.p7x)' }
  }

  try {
    $cms = New-Object System.Security.Cryptography.Pkcs.SignedCms
    $cms.Decode($bytes)
  } catch {
    return @{ Trusted = $false; Reason = "the packaged signature could not be decoded: $($_.Exception.Message)" }
  }

  $signer = $null
  if ($cms.SignerInfos.Count -gt 0) { $signer = $cms.SignerInfos[0].Certificate }
  if ($null -eq $signer -and $cms.Certificates.Count -gt 0) { $signer = $cms.Certificates[0] }
  if ($null -eq $signer) {
    return @{ Trusted = $false; Reason = 'the package signature carries no certificate' }
  }

  $chain = New-Object System.Security.Cryptography.X509Certificates.X509Chain
  # Installers must not depend on the network: revocation is the caller's
  # problem, trust of the root is not.
  $chain.ChainPolicy.RevocationMode = [System.Security.Cryptography.X509Certificates.X509RevocationMode]::NoCheck
  foreach ($certificate in $cms.Certificates) {
    [void]$chain.ChainPolicy.ExtraStore.Add($certificate)
  }

  $built = $false
  try { $built = $chain.Build($signer) } catch { $built = $false }

  if ($built) {
    return @{ Trusted = $true; Reason = "signed by $($signer.Subject), chain builds against the local stores" }
  }
  $statuses = ($chain.ChainStatus | ForEach-Object { "$($_.Status)" }) -join ', '
  return @{
    Trusted = $false
    Reason  = "signing certificate $($signer.Subject) is not trusted on this machine ($statuses)"
  }
}

function Test-IdentityPackageSupported {
  # Add-AppxPackage -ExternalLocation needs Windows 10 2004 (build 19041).
  $build = 0
  try {
    $currentVersion = Get-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion' -ErrorAction Stop
    $build = [int]$currentVersion.CurrentBuildNumber
  } catch {
    try { $build = [int][Environment]::OSVersion.Version.Build } catch { $build = 0 }
  }
  if ($build -gt 0 -and $build -lt 19041) {
    return @{ Supported = $false; Reason = "Windows build $build predates package identity support (19041)" }
  }
  return @{ Supported = $true; Reason = "Windows build $build" }
}

function Get-InstalledIdentityPackages {
  param([string]$PackageName)
  try {
    return @(Get-AppxPackage -Name $PackageName -ErrorAction SilentlyContinue)
  } catch {
    return @()
  }
}

function Test-SameInstallLocation {
  param([string]$Left, [string]$Right)
  if (-not $Left -or -not $Right) { return $false }
  try {
    $normalize = {
      param([string]$Value)
      return ([System.IO.Path]::GetFullPath($Value).TrimEnd('\')).ToLowerInvariant()
    }
    return ((& $normalize $Left) -eq (& $normalize $Right))
  } catch {
    return $false
  }
}

# --- main ------------------------------------------------------------------

$InstallDir = [System.IO.Path]::GetFullPath($InstallDir).TrimEnd('\')
if (-not $Msix) { $Msix = Join-Path $InstallDir 'PlethoraIdentity.msix' }

Write-IdentityLog 'info' "Plethora identity $(if ($Uninstall) { 'unregister' } else { 'registration' }) starting (install dir: $InstallDir, package: $Msix)"

try {
  $identity = $null
  if (Test-Path -LiteralPath $Msix) {
    $identity = Read-AppxIdentityFromMsix -Path $Msix
    Write-IdentityLog 'info' "package manifest: Name=$($identity.PackageName) Publisher=$($identity.Publisher) Version=$($identity.Version) ApplicationId=$($identity.ApplicationId)"
  } elseif (-not $Uninstall) {
    Write-IdentityLog 'warn' "identity package not found at $Msix; skipping registration (Windows AI features stay off)"
    exit $ExitSkipped
  } else {
    Write-IdentityLog 'info' 'identity package is gone; using the package name and publisher recorded by the installer'
  }

  if ($Uninstall) {
    $packageName = if ($identity) { $identity.PackageName } else { $FallbackPackageName }
    $publisher = if ($identity) { $identity.Publisher } else { $FallbackPublisher }

    $failed = 0
    $removed = 0
    foreach ($package in (Get-InstalledIdentityPackages -PackageName $packageName)) {
      if ($publisher -and $package.Publisher -and ($package.Publisher -ne $publisher)) { continue }
      if ($DryRun) {
        Write-IdentityLog 'info' "[dry run] would remove $($package.PackageFullName)"
        continue
      }
      try {
        Remove-AppxPackage -Package $package.PackageFullName -ErrorAction Stop
        $removed++
        Write-IdentityLog 'info' "removed package identity $($package.PackageFullName)"
      } catch {
        $failed++
        Write-IdentityLog 'error' "could not remove $($package.PackageFullName): $($_.Exception.Message)"
      }
    }

    if ($failed -gt 0) { exit $ExitFailed }
    if ($removed -eq 0) { Write-IdentityLog 'info' 'no package identity was registered for this user' }
    exit $ExitRegistered
  }

  # --- registration --------------------------------------------------------
  $trust = Test-AppxSignatureTrusted -Path $Msix
  if (-not $trust.Trusted) {
    Write-IdentityLog 'warn' "skipping registration: $($trust.Reason)"
    Write-IdentityLog 'info' 'no certificate store was modified; the application runs without package identity'
    exit $ExitSkipped
  }
  Write-IdentityLog 'info' "signature accepted: $($trust.Reason)"

  $support = Test-IdentityPackageSupported
  if (-not $support.Supported) {
    Write-IdentityLog 'warn' "skipping registration: $($support.Reason)"
    exit $ExitSkipped
  }

  $target = [version]$identity.Version
  foreach ($package in (Get-InstalledIdentityPackages -PackageName $identity.PackageName)) {
    if ($package.Publisher -and ($package.Publisher -ne $identity.Publisher)) { continue }
    $sameVersion = $false
    try { $sameVersion = ($package.Version -eq $target) } catch { $sameVersion = $false }
    $sameLocation = Test-SameInstallLocation -Left ([string]$package.InstallLocation) -Right $InstallDir

    if ($sameVersion -and $sameLocation) {
      Write-IdentityLog 'info' "package identity $($package.PackageFullName) is already registered for this install directory"
      exit $ExitRegistered
    }

    Write-IdentityLog 'info' ("re-registering: registered version $($package.Version) at '$($package.InstallLocation)', " +
      "expected version $($identity.Version) at '$InstallDir'")
    if ($DryRun) {
      Write-IdentityLog 'info' "[dry run] would remove $($package.PackageFullName)"
      continue
    }
    try {
      Remove-AppxPackage -Package $package.PackageFullName -ErrorAction Stop
      Write-IdentityLog 'info' "removed stale registration $($package.PackageFullName)"
    } catch {
      # Removing is best effort: if it fails, the add below reports the reason
      # (typically 0x80073CF9 "already registered"), which we classify then.
      Write-IdentityLog 'warn' "could not remove $($package.PackageFullName): $($_.Exception.Message)"
    }
  }

  if ($DryRun) {
    Write-IdentityLog 'info' "[dry run] would register $Msix with external location $InstallDir"
    exit $ExitRegistered
  }

  try {
    Add-AppxPackage -Path $Msix -ExternalLocation $InstallDir -ErrorAction Stop
    Write-IdentityLog 'info' "registered $($identity.PackageName) $($identity.Version) with external location $InstallDir"
    exit $ExitRegistered
  } catch {
    $message = $_.Exception.Message
    if ($message -match '0x80073CF9|already installed|already registered') {
      Write-IdentityLog 'info' "package identity is already registered ($message)"
      exit $ExitRegistered
    }
    # Prefer the Windows error code carried in the deployment message (the
    # exception wrapper's own HResult is a generic .NET code and would mislead).
    $codes = @()
    foreach ($match in [regex]::Matches($message, '0x[0-9A-Fa-f]{8}')) { $codes += $match.Value }
    if ($codes.Count -eq 0) {
      try { $codes += ('0x{0:X8}' -f $_.Exception.HResult) } catch { }
    }
    $codeText = if ($codes.Count -gt 0) { $codes -join ', ' } else { 'no error code reported' }
    Write-IdentityLog 'error' "registration failed ($codeText): $message"
    exit $ExitFailed
  }
} catch {
  Write-IdentityLog 'error' "unexpected failure: $($_.Exception.Message)"
  exit $ExitFailed
}
