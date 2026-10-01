//! Scrubbing environment variables that break a Python child process.
//!
//! The Linux AppImage's `AppRun` — the AppImageKit binary `appimagetool`
//! installs — exports a fixed set of variables for a hypothetical bundled
//! Python, unconditionally:
//!
//! ```text
//! PYTHONHOME=$APPDIR/usr/
//! PYTHONPATH=$APPDIR/usr/share/pyshared/:
//! ```
//!
//! Plethora bundles no system Python on Linux (only the NotebookLM runtime),
//! so those paths name directories that hold no standard library. A child
//! `python3` therefore starts with `sys.base_prefix` pointing at the AppImage
//! mount and dies before `main` with `ModuleNotFoundError: No module named
//! 'encodings'` — which surfaces as an opaque "Could not create a Python
//! environment" when the command was `python3 -m venv`.
//!
//! Any spawn of a system interpreter — yt-dlp, the Pocket TTS provisioner —
//! must drop these first. `PYTHONHOME` is the fatal one; the rest steer the
//! interpreter away from the user's own install.

use std::process::Command;

/// Variables a host launcher may leak that must not reach a system Python.
///
/// `__PYVENV_LAUNCHER__` and `VIRTUAL_ENV` matter for `python -m venv`: a
/// process that believes it is already inside a virtual environment builds a
/// venv without its own `pyvenv.cfg`.
pub const HOSTILE_PYTHON_ENV_KEYS: &[&str] = &[
    "PYTHONHOME",
    "PYTHONPATH",
    "PYTHONUSERBASE",
    "PYTHONNOUSERSITE",
    "PYTHONEXECUTABLE",
    "__PYVENV_LAUNCHER__",
    "VIRTUAL_ENV",
];

/// Remove [`HOSTILE_PYTHON_ENV_KEYS`] from a command's environment.
///
/// Call this *after* the intended variables are set: `Command::env_remove`
/// wins over an earlier `Command::env` for the same key.
pub fn sanitize_python_env(cmd: &mut Command) {
    for key in HOSTILE_PYTHON_ENV_KEYS {
        cmd.env_remove(key);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn env_of(cmd: &Command, key: &str) -> Option<String> {
        cmd.get_envs().find(|(k, _)| *k == key).map(|(_, v)| {
            v.as_ref()
                .map(|v| v.to_string_lossy().to_string())
                .unwrap_or_else(|| "<removed>".to_string())
        })
    }

    #[test]
    fn every_hostile_key_is_removed() {
        let mut cmd = Command::new("python3");
        sanitize_python_env(&mut cmd);
        for key in HOSTILE_PYTHON_ENV_KEYS {
            assert_eq!(env_of(&cmd, key).as_deref(), Some("<removed>"), "{key}");
        }
    }

    #[test]
    fn unrelated_variables_are_left_alone() {
        let mut cmd = Command::new("python3");
        cmd.env("PYTHONDONTWRITEBYTECODE", "1");
        sanitize_python_env(&mut cmd);
        assert_eq!(
            env_of(&cmd, "PYTHONDONTWRITEBYTECODE").as_deref(),
            Some("1")
        );
        assert!(!HOSTILE_PYTHON_ENV_KEYS.contains(&"PYTHONDONTWRITEBYTECODE"));
    }
}
