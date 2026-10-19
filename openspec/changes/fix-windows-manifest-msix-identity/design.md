## Context

See `proposal.md` — Why. This section records only the current-state facts that shape the approach, each verified in this repository.

**How the manifest reaches the binary.** `src-tauri/build.rs` reads `src-tauri/windows/app.manifest` on Windows and passes it to `tauri_build::WindowsAttributes::app_manifest(...)`. tauri-build hands that string to `tauri_winres::WindowsResource::set_manifest` and calls `compile()`, which emits `cargo:rustc-link-lib` / `rustc-link-search` — directives that apply to **every binary target of the `plethora-tauri` crate**, including `src-tauri/src/bin/pdf-reflow-diag.rs`. There is no per-binary manifest and no schema validation in that path, which is why both executables ship the identical invalid manifest.

**What the identity package declares.** `src-tauri/windows/sparse/Package.appxmanifest` (packed to `PlethoraIdentity.msix` by `scripts/build-windows-sparse-package.ps1` with MakeAppx `/nv`) declares `Identity/@Name = Plethora.Plethora`, `Identity/@Publisher = CN=Plethora Sparse Dev`, `Application/@Id = Plethora`, `AppListEntry="none"` — so the identity package exposes no Start-menu entry and the loose executable launch is the only entry point. `src-tauri/tauri.windows.conf.json` maps the package into the bundle as `PlethoraIdentity.msix` next to the executables, which is where `sparse_msix_candidates()` looks for it.

**Version ownership is split.** tauri-build writes FILEVERSION/PRODUCTVERSION from `tauri.conf.json` `version` (3.3.0); identity metadata is hard-coded at `2.7.0.0` in `app.manifest`, both `Package.appxmanifest` files, and as the default parameter of `scripts/build-windows-sparse-package.ps1`. `src-tauri/windows/sparse/out/PlethoraIdentity.msix` is a 0-byte placeholder committed to git; the release workflow rebuilds it before `tauri build`.

**Registration exists only at runtime.** `bundle.windows` is `{}` in `tauri.conf.json` — no NSIS hooks. The only registration code is `try_register_sparse_package()` in `src-tauri/plugins/plethora-windows-intelligence/src/windows/sparse_package.rs`, called lazily from `capabilities_snapshot()`. It shells out to PowerShell with two defects: `New-Object …Microsoft.Windows.Management.Deployment.AddPackageOptions` names a type that is not the documented `Windows.Management.Deployment.AddPackageOptions` projection, and PowerShell cannot await a WinRT `IAsyncOperation` (`.GetAwaiter()` is a C# extension, not a projected member).

**Current verification is presence-only.** `scripts/verify-windows-bundles.ps1` asserts a non-empty `PlethoraIdentity.msix` and the runtime sidecars; it extracts NSIS bundles by silent install and MSI bundles by administrative extraction, but never inspects an embedded manifest. The Windows leg of `.github/workflows/release.yml` already runs it before upload, which makes it the natural home for the new gate.

**Platform constraints (Microsoft Learn).** The application-manifest form of `<msix>` (`urn:schemas-microsoft-com:msix.v1`) is a childless element carrying `publisher`, `packageName`, `applicationId`, supported from Windows 10 2004; Microsoft's guidance registers the package from the installer with `Add-AppxPackage -Path … -ExternalLocation …`; the identity package's certificate must be trusted before registration succeeds; identity is attached when a process starts, so registering from inside a running process cannot grant identity to that process. `mt.exe` provides `-inputresource:<exe>;#1` for extraction and `-validate_manifest` for a schema-conformance check.

## Goals / Non-Goals

**Goals:**

- Make a launch failure of this class impossible to ship again, not merely fix the current instance.
- Keep the package-identity path functional for installs that can support it: no silent removal of the AI feature to buy launchability.
- Make identity metadata, the identity package, and the PE version resource agree by construction rather than by discipline.
- Keep the installer, the app, and the AI status reporting honest about whether identity exists.

**Non-Goals:**

- Obtaining a production signing certificate for the identity package, or choosing between Azure Trusted Signing and a CA-issued certificate (prerequisite tracked by the installer's trust check; a decision, not code).
- Changing where or how Plethora installs (per-user NSIS install, install directory, file associations).
- Store/MSIX distribution (`scripts/build-windows-msix-package.ps1`).
- Extending identity to other Windows capabilities (toasts, share targets, background tasks).
- Refactoring the Windows AI bridge beyond the identity-acquisition path.

## Decisions

### D1. Fix the `<msix>` element in place; do not remove it

Chosen: rewrite the element as childless with the three attributes, values taken from the identity package manifest. Alternative A — delete `<msix>` so the shipped manifest is minimal, as plain Tauri builds are — guarantees launch but makes package identity unreachable for NSIS installs, silently disabling the Windows AI toolchain the identity work exists for; rejected. Alternative B — ship the identity element only in a "signed" build flavour — needs a per-binary manifest, which tauri-build's link-lib mechanism cannot express (D7); rejected. The consequence of the chosen option is that the loader path must tolerate a registered-but-absent package, which is verified explicitly (see Risks).

### D2. One version source: `tauri.conf.json`, enforced by a check

`tauri.conf.json` `version` already drives the PE version resource. A new script (`scripts/sync-windows-identity.mjs`) regenerates the identity-declaring fields — the embedded manifest's `assemblyIdentity/@version` and `<msix>` attribute values, the sparse and full `Package.appxmanifest` `Identity/@Version` — from it, and supports `--check`, which fails with the file name, expected value, and declared value. `--check` runs in `npm run test:scripts` (the repository's existing `node --test` harness) and again in the release workflow before the identity package is packed; `scripts/build-windows-sparse-package.ps1` asserts equality instead of defaulting `-Version` to a hard-coded string. Rationale: this is the protocol the repository already uses for benchmarks and bundle budgets — an intentional value change updates the recorded baseline in the same commit; identity metadata is that baseline here.

### D3. The installer registers identity, and only where trust already exists

Configure `bundle.windows.nsis.installerHooks` → new `src-tauri/windows/installer-hooks.nsh` with `NSIS_HOOK_POSTINSTALL` and `NSIS_HOOK_PREUNINSTALL`. Post-install runs the Microsoft-documented per-user registration (`Add-AppxPackage -Path <install dir>\PlethoraIdentity.msix -ExternalLocation <install dir>`) through PowerShell, pre-uninstall removes it (`Remove-AppxPackage -Package <package full name>`). Rationale: install-time registration is Microsoft's prescribed step, per-user registration needs no elevation, and it makes identity available on the *first* launch instead of some later run. Two hard constraints are built into the hook:

- **Trust gate.** Before registering, the hook checks the package's Authenticode signature and its certificate chain against the machine's stores. Registration happens only when the chain already builds. The installer never imports a certificate into `TrustedPeople` or `Root` — installing a development root into a user's trust store to make a release artifact work is a security defect, not a workaround. With the current `CN=Plethora Sparse Dev` signing certificate, end-user machines therefore skip registration and the app runs without identity until a trusted certificate signs the package (a release prerequisite, tracked as a decision).
- **Non-fatal failure.** Any failure — untrusted chain, AppX services disabled, Windows Server, OS whose identity support is absent, package file missing — is logged to a file the diagnostics surface can read and reported as a warning; the install still reports success and the app still starts.

Registration is idempotent across upgrades: the version comes from D2, `0x80073CF9` ("version already registered") is treated as success when the registered identity matches, and the hook re-registers when the version or the recorded external location differs (remove, then add).

### D4. Replace the runtime self-heal mechanism

`try_register_sparse_package()` switches to the documented command surface (`Add-AppxPackage -Path … -ExternalLocation …`) and reports the outcome — package path, install directory, exit status, and the OS error text/code when present — into the Windows AI diagnostics payload. It stays best-effort and lazy: it is a repair path for installs whose installer-time registration was skipped (D3), never a launch dependency. Because identity attaches at process start, the repair's effect is documented as visible on the next launch, not immediately.

### D5. Release gate: extract, validate, compare, launch

Extend the Windows verification step with a new script (`scripts/verify-windows-manifests.ps1`) that, for each executable the bundle ships:

1. extracts `RT_MANIFEST` resource 1 with `mt.exe -inputresource:<exe>;#1 -out:<tmp>.manifest`;
2. runs `mt.exe -manifest <tmp>.manifest -validate_manifest` for schema conformance (supplementary — the structural assertions below are authoritative, since the tool's handling of the `msix` namespace is not guaranteed);
3. asserts the `<msix>` element is childless, in `urn:schemas-microsoft-com:msix.v1`, and carries all three attributes non-empty, and that each value equals the corresponding value read from the `AppxManifest.xml` inside the identity package shipped in the same bundle (the `.msix` is a zip; read it without unpacking to disk);
4. smoke-launches each installed executable from the directory the existing silent-install extraction produced, records the `SideBySide` event-log delta, and asserts each process reaches its main entry point.

In addition, a cross-platform source-level check validates `src-tauri/windows/app.manifest` and both `Package.appxmanifest` files (XML structure, identity-value agreement, version agreement with `tauri.conf.json`) inside the same `node --test` harness as D2, so a defect of this class is caught on a developer machine or in a non-Windows CI job rather than only at release time.

### D6. Smoke-launch semantics

The blocking assertion is that the process survives the loader stage: a manifest rejected by the activation-context generator kills the process within a fraction of a second, before any application code runs, and writes `SideBySide` event ID 62. For the GUI executable the check therefore asserts the process is still alive after a short window (and, where a desktop session is available, that it created a window); for `pdf-reflow-diag.exe` it asserts the documented usage output and exit. The event-log delta is asserted independently of process lifetime, so a runner without an interactive desktop still yields a meaningful verdict.

### D7. One shared manifest for all binaries

Keep the single embedded manifest rather than splitting per binary. tauri-build links one resource generated from one manifest to every bin target; splitting would mean bypassing tauri-build's Windows resource path, which reintroduces the duplicate-resource/link failure `build.rs` already documents. Both shipped executables are covered by the gate instead.

### D8. Identity package OS floor stays as declared

`TargetDeviceFamily MinVersion` stays `10.0.26100.0`. Identity only unlocks APIs gated at Windows 11 24H2 by the application code (`MIN_WIN11_AI_BUILD`), so a lower floor buys nothing today; the declared capability set targets the same generation. Because D3 makes registration failures non-fatal, an OS below the floor simply runs without identity. Lowering the floor becomes worthwhile only if identity is later needed for a capability with a lower OS floor, and is recorded as a follow-up rather than guessed at now.

### D9. Troubleshooting documentation states the failure class

`docs/USER_HANDBOOK.md` (plus the German and Spanish editions, which are maintained in-repo) gains a troubleshooting entry for the loader dialog: it happens before application code runs, the confirming evidence is `SideBySide` event ID 62 with the missing-attribute text, the cause is the embedded manifest, and reinstalling the Visual C++ Redistributable cannot help — with the `mt.exe` extraction command a support engineer can use to confirm the embedded manifest on any machine.

## Risks / Trade-offs

- **[A schema-valid `<msix>` element whose package is not registered may still abort launch — the platform behaviour could not be confirmed offline]** → This is the single highest-risk unknown, and the design does not assume an answer: the acceptance gate (D5/D6) verifies launch on a machine with the package registered *and* on a clean machine without it. If the loader aborts in the second case, the fallback is to make registration a precondition for shipping the element, i.e. ship the identity element only in builds whose installer registration is guaranteed (trusted signature present), and keep the unregistered case identity-free by omitting it. Either way the spec requirement — launch never depends on identity — is what decides, not the implementation preference.
- **[The identity element on `pdf-reflow-diag.exe` names the main application's `applicationId` while its executable differs from the package's `Application/@Executable`]** → The gate smoke-launches the diagnostic binary specifically; if the loader refuses a non-matching executable, the fallback is to give the diagnostic binary its own `Application` entry plus a per-binary `applicationId`, and if that still cannot be expressed with one shared manifest, to build it outside the tauri-build resource path. Recorded so the first Windows run produces an answer, not a surprise.
- **[No production signing certificate: every end-user machine will skip registration]** → Accept for this change; the trust gate keeps it non-fatal, the AI status stays `package_identity_missing`, and the release notes state that identity-dependent features remain off until the package is signed by a trusted certificate. The decision (Azure Trusted Signing vs. CA certificate) is tracked as a release prerequisite, not silently assumed.
- **[A signed-for-production identity package can still be rejected: AppX disabled, machine policy, Windows Server runners]** → Registration is non-fatal, its result is reported in diagnostics, and the install still succeeds.
- **[Same-version re-registration (`0x80073CF9`) on repair installs]** → Treated as success when the registered identity matches; explicit remove-then-add when the version or external location differs.
- **[CI smoke launch is unreliable without an interactive desktop]** → The event-log assertion and process-survival assertion are separated (D6); if the runner cannot host the GUI process at all, the flow stays as a documented manual checkout item on a Windows VM rather than a silently disabled check.
- **[Version drift reappears on the next release bump]** → `--check` runs in `npm run test:scripts` and in the release workflow, and the script regenerates rather than validates only, so the fix is one command.
- **[A user on a broken 3.3.0 build cannot reach the fix]** → The broken executable cannot self-update and the installer has no Start-menu entry to fall back on; release notes must say so, and the interim `mt.exe -manifest … -outputresource:…#1` workaround from the issue is documented beside the troubleshooting entry.

## Migration Plan

1. Land the manifest fix, version sync, gate, and installer hooks together on `main`, then cut a hotfix release from a clean staging step.
2. Regenerate identity metadata from `tauri.conf.json` (D2), build the identity package, build the Windows bundles, run the new gate, publish.
3. Users on 3.3.0 must download and reinstall manually — no data migration, no schema change, no user-visible state besides the app starting.
4. Rollback: revert the change and re-tag; the previous *working* artifacts are the 2.x installers whose executables carry no `<msix>` element. A partial rollback of only the installer hook is possible (it is non-fatal by design) but pointless — the manifest is baked into the executables, so the rollback unit is the whole release.
5. Follow-ups after this change: production signing decision, `MinVersion` floor revisit (D8), and `pdf-reflow-diag` identity shape if the risk above materializes.
