## ADDED Requirements

### Requirement: Identity acquisition never blocks launch

Windows builds SHALL start and remain usable on machines where package identity is unavailable. Missing identity SHALL only disable identity-dependent features, and SHALL never abort process creation, crash the application, or surface as a launch error.

#### Scenario: Package identity never registered

- **GIVEN** an installed Plethora on Windows 11 where the sparse identity package was never registered
- **WHEN** the user launches the application and queries `windows_capabilities`
- **THEN** the window opens normally
- **AND** identity-dependent features report `package_identity_missing`
- **AND** no Side-by-Side loader error is produced

#### Scenario: Identity-dependent request without identity

- **GIVEN** a running application with no package identity
- **WHEN** a feature that requires identity is requested
- **THEN** the request fails with `package_identity_missing`
- **AND** the process continues serving the remaining features

### Requirement: Identity repair reports the OS result

When the runtime attempts to register the sparse identity package, it SHALL use the documented package-registration command surface, SHALL tolerate the same version already being registered, and SHALL surface the outcome — package path, install directory, and the extended error code when it fails — through the Windows AI diagnostics payload.

#### Scenario: Repair succeeds for an untrusted-then-trusted package

- **GIVEN** an install whose identity package is present beside the executable and whose signing certificate is trusted
- **WHEN** capabilities are refreshed and the package is not yet registered
- **THEN** registration is attempted through the documented registration command
- **AND** the diagnostics payload records the successful registration with the package path and external location
- **AND** identity-dependent features become evaluable on the next process launch without reinstalling

#### Scenario: Repair fails with an actionable reason

- **GIVEN** registration cannot succeed because the signing certificate is untrusted, the OS build does not support identity packages, or the package file is missing
- **WHEN** capabilities are refreshed
- **THEN** the diagnostics payload reports the failing step, the package path, the install directory, and the extended error code when one is available
- **AND** the application keeps running with identity-dependent features unavailable
