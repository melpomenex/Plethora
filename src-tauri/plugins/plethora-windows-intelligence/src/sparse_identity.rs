//! Sparse package identity: registration command construction, result
//! classification, and the diagnostics payload for the identity-acquisition
//! path.
//!
//! Portable by design — no Windows API surface — so every decision below is
//! unit-tested on all platforms. `windows/sparse_package.rs` owns the parts that
//! need the platform (spawning PowerShell, querying current identity) and is
//! compiled on Windows only.
//!
//! Identity cannot be adopted by a running process, so this path is a *repair*
//! mechanism for installs whose installer-time registration was skipped: its
//! effect appears on the next launch. It is always best effort — Plethora runs
//! without package identity, and only identity-dependent Windows AI features
//! report `package_identity_missing`.

use std::path::{Path, PathBuf};

use serde::Serialize;

/// Identity package name declared by the shipped `PlethoraIdentity.msix`.
pub const PACKAGE_NAME: &str = "Plethora.Plethora";

/// HRESULT returned when the exact package version is already registered.
pub const ERROR_ALREADY_REGISTERED: &str = "0x80073CF9";

/// HRESULT returned when the package's signing certificate is not trusted by
/// this machine (`CERT_E_UNTRUSTEDROOT`) — the expected outcome for the
/// development certificate, and the reason registration is installer-gated.
pub const ERROR_UNTRUSTED_ROOT: &str = "0x800B0109";

/// What happened to a registration attempt.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RegistrationOutcome {
    /// The package was registered by this attempt.
    Registered,
    /// The package was already registered (`0x80073CF9`); nothing to do.
    AlreadyRegistered,
    /// No attempt was made (no package file, no install directory, identity
    /// already present, or the OS does not support package identity).
    Skipped,
    /// The attempt failed; `error_code` carries the OS code when one was reported.
    Failed,
}

/// The result of the last identity-registration attempt, surfaced through the
/// Windows AI diagnostics payload (task 4.2 of the change).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RegistrationReport {
    /// Whether PowerShell was actually invoked.
    pub attempted: bool,
    pub outcome: RegistrationOutcome,
    /// Why no attempt happened (only for [`RegistrationOutcome::Skipped`]).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub skipped_reason: Option<String>,
    /// Read-only inputs of the attempt, so a log line is reproducible.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub msix_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub external_location: Option<String>,
    /// Windows error code (for example `0x800B0109`) when the OS reported one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
    /// Raw failure text, trimmed — never a generic replacement string.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error_message: Option<String>,
}

impl RegistrationReport {
    /// No attempt was made.
    pub fn skipped(reason: impl Into<String>) -> Self {
        Self {
            attempted: false,
            outcome: RegistrationOutcome::Skipped,
            skipped_reason: Some(reason.into()),
            msix_path: None,
            external_location: None,
            error_code: None,
            error_message: None,
        }
    }

    /// Attach the attempt inputs to a skipped report (kept for diagnostics).
    pub fn with_paths(mut self, msix: Option<&Path>, external: Option<&Path>) -> Self {
        self.msix_path = msix.map(|p| p.display().to_string());
        self.external_location = external.map(|p| p.display().to_string());
        self
    }

    /// Classify the outcome of a PowerShell invocation of
    /// [`add_appx_package_command`].
    ///
    /// Success is the process exit status; a failure whose text carries the
    /// "version already registered" error is still a success for our purposes —
    /// the identity we wanted is present, and treating it as a failure would
    /// make a repair install look broken.
    pub fn from_process_result(
        msix: &Path,
        external: &Path,
        success: bool,
        output: &str,
    ) -> Self {
        let trimmed = output.trim();
        let (outcome, error_code, error_message) = if success {
            (RegistrationOutcome::Registered, None, None)
        } else if is_already_registered(trimmed) {
            (RegistrationOutcome::AlreadyRegistered, None, None)
        } else {
            (
                RegistrationOutcome::Failed,
                first_error_code(trimmed),
                if trimmed.is_empty() {
                    None
                } else {
                    Some(trimmed.to_string())
                },
            )
        };

        Self {
            attempted: true,
            outcome,
            skipped_reason: None,
            msix_path: Some(msix.display().to_string()),
            external_location: Some(external.display().to_string()),
            error_code,
            error_message,
        }
    }

    /// Whether the wanted identity is present (registered now or already).
    pub fn is_ok(&self) -> bool {
        matches!(
            self.outcome,
            RegistrationOutcome::Registered | RegistrationOutcome::AlreadyRegistered
        )
    }
}

/// PowerShell single-quoted literal: embedded quotes are doubled, so a path
/// containing `'` cannot truncate the argument or inject a new one. This is why
/// the registration command passes paths as literals instead of interpolating
/// them into double-quoted strings.
pub fn power_shell_literal(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

/// The documented per-user registration command
/// (<https://learn.microsoft.com/windows/apps/desktop/modernize/grant-identity-to-nonpackaged-apps>).
///
/// `Add-AppxPackage -Path <packaged identity> -ExternalLocation <install dir>` is
/// the path Microsoft prescribes; the previous implementation built a
/// `PackageManager.AddPackageByUriAsync` call with a type name that does not
/// exist in the projection and awaited a WinRT operation with a C#-only
/// extension method, so it could never have registered anything.
pub fn add_appx_package_command(msix: &Path, external_location: &Path) -> String {
    format!(
        "$ErrorActionPreference = 'Stop'; Add-AppxPackage -Path {} -ExternalLocation {}",
        power_shell_literal(&msix.display().to_string()),
        power_shell_literal(&external_location.display().to_string())
    )
}

/// Arguments for invoking the command above without a shell. The command is a
/// single `-Command` argument — never concatenated into a shell string — so
/// nothing in a path can be re-interpreted as a command.
pub fn power_shell_args(command: &str) -> Vec<String> {
    vec![
        "-NoLogo".into(),
        "-NoProfile".into(),
        "-NonInteractive".into(),
        "-ExecutionPolicy".into(),
        "Bypass".into(),
        "-Command".into(),
        command.into(),
    ]
}

/// Every Windows error code mentioned in `text`, in order of appearance.
///
/// Scans by `char`, not by byte: deployment messages carry localized prose (the
/// report in issue #4 came from a zh-CN machine), so byte slicing would panic on
/// a multi-byte character — and this runs inside the app's repair path.
pub fn error_codes(text: &str) -> Vec<String> {
    let chars: Vec<char> = text.chars().collect();
    let mut codes = Vec::new();
    let mut index = 0;
    while index + 10 <= chars.len() {
        let candidate: String = chars[index..index + 10].iter().collect();
        let has_prefix = candidate.starts_with("0x") || candidate.starts_with("0X");
        if has_prefix && candidate[2..].chars().all(|c| c.is_ascii_hexdigit()) {
            let code = format!("0x{}", candidate[2..].to_ascii_uppercase());
            if !codes.contains(&code) {
                codes.push(code);
            }
            index += 10;
        } else {
            index += 1;
        }
    }
    codes
}

/// First Windows error code in `text`, if any.
pub fn first_error_code(text: &str) -> Option<String> {
    error_codes(text).into_iter().next()
}

/// Whether a failure text means "this exact package version is already
/// registered". The HRESULT is checked first: the localized message that
/// accompanies it differs per Windows display language (the report of the 3.3.0
/// launch failure came from a zh-CN machine), so matching English prose alone
/// would be locale-fragile.
pub fn is_already_registered(text: &str) -> bool {
    if error_codes(text).iter().any(|code| code == ERROR_ALREADY_REGISTERED) {
        return true;
    }
    let lowered = text.to_ascii_lowercase();
    lowered.contains("already installed") || lowered.contains("already registered")
}

/// Diagnostics payload for the identity path, assembled where it can be tested
/// without a Windows host.
pub fn diagnostics_payload(
    last: Option<&RegistrationReport>,
    candidates: &[PathBuf],
) -> serde_json::Value {
    serde_json::json!({
        "packageName": PACKAGE_NAME,
        "candidates": candidates
            .iter()
            .map(|p| p.display().to_string())
            .collect::<Vec<_>>(),
        "lastAttempt": last,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn paths() -> (PathBuf, PathBuf) {
        (
            PathBuf::from(r"C:\Program Files\Plethora 学習\PlethoraIdentity.msix"),
            PathBuf::from(r"C:\Program Files\Plethora 学習"),
        )
    }

    #[test]
    fn registration_command_quotes_paths_with_spaces_and_non_ascii() {
        let (msix, external) = paths();
        let command = add_appx_package_command(&msix, &external);
        assert!(command.contains("Add-AppxPackage -Path 'C:\\Program Files\\Plethora 学習\\PlethoraIdentity.msix'"));
        assert!(command.contains("-ExternalLocation 'C:\\Program Files\\Plethora 学習'"));
        assert!(command.starts_with("$ErrorActionPreference = 'Stop';"));
    }

    #[test]
    fn registration_command_cannot_be_broken_by_a_quote_in_a_path() {
        let msix = PathBuf::from(r"C:\Users\O'Brien\PlethoraIdentity.msix");
        let external = PathBuf::from(r"C:\Users\O'Brien");
        let command = add_appx_package_command(&msix, &external);
        assert!(command.contains(r"-ExternalLocation 'C:\Users\O''Brien'"));
        // The doubled quote stays inside the literal: no extra argument appears.
        assert_eq!(command.matches(" -ExternalLocation ").count(), 1);
    }

    #[test]
    fn shell_arguments_keep_the_command_as_one_argument() {
        let command = add_appx_package_command(&paths().0, &paths().1);
        let args = power_shell_args(&command);
        assert_eq!(&args[..6], &["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command"]);
        assert_eq!(args.last().map(String::as_str), Some(command.as_str()));
        assert_eq!(args.len(), 7);
    }

    #[test]
    fn success_is_registered_with_no_error_fields() {
        let (msix, external) = paths();
        let report = RegistrationReport::from_process_result(&msix, &external, true, "  ");
        assert_eq!(report.outcome, RegistrationOutcome::Registered);
        assert!(report.attempted);
        assert!(report.is_ok());
        assert_eq!(report.error_code, None);
        assert_eq!(report.error_message, None);
        assert_eq!(
            report.external_location.as_deref(),
            Some(r"C:\Program Files\Plethora 学習")
        );
    }

    #[test]
    fn already_registered_by_hresult_is_treated_as_success() {
        let (msix, external) = paths();
        let output = "Add-AppxPackage : Deployment failed with HRESULT: 0x80073CF9, 无法安装程序包";
        let report = RegistrationReport::from_process_result(&msix, &external, false, output);
        assert_eq!(report.outcome, RegistrationOutcome::AlreadyRegistered);
        assert!(report.is_ok());
        assert_eq!(report.error_code, None);
    }

    #[test]
    fn already_registered_by_english_prose_is_tolerated() {
        let (msix, external) = paths();
        let report = RegistrationReport::from_process_result(
            &msix,
            &external,
            false,
            "The package is already installed for this user.",
        );
        assert_eq!(report.outcome, RegistrationOutcome::AlreadyRegistered);
    }

    #[test]
    fn untrusted_certificate_reports_the_os_code_not_a_generic_string() {
        let (msix, external) = paths();
        let output =
            "Add-AppxPackage : Deployment failed with HRESULT: 0x800B0109, Certificate not trusted";
        let report = RegistrationReport::from_process_result(&msix, &external, false, output);
        assert_eq!(report.outcome, RegistrationOutcome::Failed);
        assert!(!report.is_ok());
        assert_eq!(report.error_code.as_deref(), Some(ERROR_UNTRUSTED_ROOT));
        assert!(report
            .error_message
            .as_deref()
            .is_some_and(|m| m.contains("0x800B0109")));
    }

    #[test]
    fn failure_without_a_code_still_carries_the_raw_message() {
        let (msix, external) = paths();
        let report = RegistrationReport::from_process_result(&msix, &external, false, "Access denied");
        assert_eq!(report.outcome, RegistrationOutcome::Failed);
        assert_eq!(report.error_code, None);
        assert_eq!(report.error_message.as_deref(), Some("Access denied"));
    }

    #[test]
    fn skipped_reports_never_claim_an_attempt() {
        let report = RegistrationReport::skipped("identity package not found").with_paths(
            Some(Path::new(r"D:\Plethora\PlethoraIdentity.msix")),
            None,
        );
        assert!(!report.attempted);
        assert_eq!(report.outcome, RegistrationOutcome::Skipped);
        assert_eq!(report.skipped_reason.as_deref(), Some("identity package not found"));
        assert_eq!(
            report.msix_path.as_deref(),
            Some(r"D:\Plethora\PlethoraIdentity.msix")
        );
        assert!(!report.is_ok());
    }

    #[test]
    fn error_code_extraction_is_bounded_and_loud() {
        assert_eq!(error_codes("failed: 0x80073CF9 and 0x800b0109"), vec![
            "0x80073CF9".to_string(),
            "0x800B0109".to_string()
        ]);
        assert_eq!(error_codes("0x1234 and 0xZZZZZZZZ"), Vec::<String>::new());
        assert_eq!(first_error_code("no codes here"), None);
    }

    #[test]
    fn diagnostics_payload_exposes_the_fields_support_needs() {
        let (msix, external) = paths();
        let failed = RegistrationReport::from_process_result(
            &msix,
            &external,
            false,
            "Deployment failed with HRESULT: 0x800B0109",
        );
        let payload = diagnostics_payload(Some(&failed), &[msix.clone()]);
        assert_eq!(payload["packageName"], PACKAGE_NAME);
        assert_eq!(payload["candidates"][0], msix.display().to_string());
        assert_eq!(payload["lastAttempt"]["attempted"], true);
        assert_eq!(payload["lastAttempt"]["outcome"], "failed");
        assert_eq!(payload["lastAttempt"]["errorCode"], ERROR_UNTRUSTED_ROOT);
        assert_eq!(payload["lastAttempt"]["msixPath"], msix.display().to_string());
        assert_eq!(payload["lastAttempt"]["externalLocation"], external.display().to_string());
        assert!(payload["lastAttempt"]["errorMessage"].is_string());

        let skipped = RegistrationReport::skipped("no package");
        let payload = diagnostics_payload(Some(&skipped), &[]);
        assert_eq!(payload["lastAttempt"]["attempted"], false);
        assert_eq!(payload["lastAttempt"]["outcome"], "skipped");
        assert_eq!(payload["lastAttempt"]["skippedReason"], "no package");
        assert!(payload["lastAttempt"].get("errorCode").is_none());

        let payload = diagnostics_payload(None, &[]);
        assert!(payload["lastAttempt"].is_null());
    }
}
