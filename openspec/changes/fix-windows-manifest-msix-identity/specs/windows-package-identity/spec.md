## Purpose

Guarantees that every Windows build Plethora ships can start — the executable's embedded application manifest is schema-conformant, its declared package identity matches the identity package that ships beside it, and identity is registered by the installer rather than assumed — so package identity enables Windows platform features without ever becoming a launch dependency.

## ADDED Requirements

### Requirement: Shipped Windows executables embed a launchable identity manifest

Every Windows executable that embeds the shared application manifest SHALL declare its package identity as a childless `<msix>` element in the `urn:schemas-microsoft-com:msix.v1` namespace carrying the `packageName`, `publisher`, and `applicationId` attributes. The `<msix>` element SHALL NOT contain child elements, and the manifest SHALL be schema-conformant so that Side-by-Side activation context generation succeeds.

#### Scenario: Clean-install launch

- **GIVEN** a Windows 11 machine where no Plethora identity package is registered
- **WHEN** the user starts the installed `plethora-tauri.exe`
- **THEN** the process reaches its main entry point and the application window opens
- **AND** no `SideBySide` event ID 62 and no error 14001 is written to the Application event log

#### Scenario: Secondary executable inherits the shared manifest

- **GIVEN** the installed `pdf-reflow-diag.exe`, which embeds the same application manifest
- **WHEN** it is started without arguments
- **THEN** it prints its usage message and exits instead of failing with a side-by-side configuration error

#### Scenario: Embedded resource is schema-conformant

- **GIVEN** a built Windows executable
- **WHEN** its `RT_MANIFEST` resource is extracted and validated against the manifest schema
- **THEN** validation passes
- **AND** the `<msix>` element has no child elements and declares all three required attributes

### Requirement: Manifest identity values match the shipped identity package

The `packageName`, `publisher`, and `applicationId` values declared in the embedded manifest SHALL equal the shipped identity package's `Identity/@Name`, `Identity/@Publisher`, and `Applications/Application/@Id` respectively.

#### Scenario: Values agree across artifacts

- **GIVEN** a built Windows executable and the identity package built for the same release
- **WHEN** verification compares the embedded manifest with the package manifest
- **THEN** all three identity values are equal

#### Scenario: Mismatch blocks the release

- **GIVEN** a rebuilt identity package whose `Identity/@Name` differs from the value in the executable's manifest
- **WHEN** release verification runs
- **THEN** verification fails and names the mismatching field and both values

### Requirement: Identity metadata version has a single source

Identity metadata versions SHALL be derived from the application version declared in `src-tauri/tauri.conf.json`. The embedded manifest's `assemblyIdentity` version and the identity package's `Identity/@Version` SHALL equal that value, and a check that runs locally on every change SHALL fail when any identity version drifts from it.

#### Scenario: Version bump propagates

- **GIVEN** the application version in `src-tauri/tauri.conf.json` changed to a new value
- **WHEN** identity metadata is regenerated
- **THEN** both the embedded manifest identity and the identity package manifest declare that same version

#### Scenario: Drift fails fast

- **GIVEN** a manifest edited by hand so that its identity version differs from `src-tauri/tauri.conf.json`
- **WHEN** the identity check runs
- **THEN** it fails and reports the offending file together with the expected and declared versions

### Requirement: Installer registers identity without making it a launch dependency

The Windows installer SHALL register the shipped identity package with the application installation directory as its external location when — and only when — the package's signing chain is already trusted by the machine, and SHALL remove that registration on uninstall. A skipped or failed registration SHALL NOT fail the installation, SHALL NOT add any certificate to a trust store, and SHALL NOT prevent the application from launching.

#### Scenario: Identity available on first launch

- **GIVEN** a per-user installation on a Windows 11 24H2 machine whose trusted signing certificate signed the identity package
- **WHEN** installation completes and the user launches the application for the first time
- **THEN** the running process has package identity
- **AND** identity-dependent Windows AI status is evaluated instead of reporting `package_identity_missing`

#### Scenario: Registration cannot happen

- **GIVEN** an identity package signed by a certificate the machine does not trust
- **WHEN** the installer runs
- **THEN** installation reports success without modifying any certificate store
- **AND** the application launches and reports identity-dependent features as unavailable for the `package_identity_missing` reason

#### Scenario: Uninstall removes the registration

- **GIVEN** a machine where the identity package was registered by the installer
- **WHEN** the user uninstalls Plethora
- **THEN** the identity package is no longer registered for that user
- **AND** a failing removal does not report the uninstall as failed

### Requirement: Release artifacts are verified before publication

The release pipeline SHALL extract and schema-validate the embedded manifest of every Windows executable it is about to publish, SHALL verify the identity values against the identity package built in the same run, and SHALL smoke-launch each installed executable so that an executable which cannot reach its main entry point fails the release.

#### Scenario: Unlaunchable artifact is blocked

- **GIVEN** a Windows build whose embedded manifest omits one of the required identity attributes
- **WHEN** release verification runs
- **THEN** the release fails before the artifacts are published
- **AND** the failure output includes the extracted manifest

#### Scenario: Smoke launch proves the process starts

- **GIVEN** a verified Windows installer bundle
- **WHEN** verification launches the installed executables
- **THEN** each executable reaches its main entry point and terminates or stays alive as its own mode dictates
- **AND** no new `SideBySide` event is written during the run

### Requirement: Troubleshooting identifies the failure class

User-facing troubleshooting documentation SHALL state that a side-by-side configuration error originates in the embedded manifest, SHALL describe how to recognise the loader failure (dialog text plus `SideBySide` event ID 62), and SHALL state that reinstalling the Visual C++ Redistributable cannot resolve it.

#### Scenario: Reader arrives with the loader dialog

- **GIVEN** a user whose launch fails with the side-by-side configuration dialog
- **WHEN** they read the Windows troubleshooting section
- **THEN** the section explains that the failure happens before application code runs
- **AND** it names the manifest as the cause and the `SideBySide` event ID 62 as the confirming evidence
- **AND** it does not recommend reinstalling the Visual C++ Redistributable
