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

use std::ffi::{OsStr, OsString};
use std::path::{Path, PathBuf};
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

/// Remove Python paths injected by the AppImage launcher when they point
/// inside `APPDIR`. AppRun sets these values even though Plethora's AppDir
/// does not contain a top-level Python standard library. This must run in the
/// parent process before WebKit, GStreamer, or another library can spawn a
/// helper process.
///
/// Host-provided paths outside APPDIR are preserved. Bundled Python
/// integrations set their own runtime paths on their individual commands.
#[cfg(target_os = "linux")]
pub fn sanitize_appimage_parent_env() -> Vec<&'static str> {
    let Some(appdir) = std::env::var_os("APPDIR").map(PathBuf::from) else {
        return Vec::new();
    };
    let appdir = normalized_existing_path(&appdir);
    let mut sanitized = Vec::new();

    for key in ["PYTHONHOME", "PYTHONPATH"] {
        let Some(value) = std::env::var_os(key) else {
            continue;
        };
        let filtered = filter_appdir_paths(&value, &appdir);
        if filtered.as_ref() == Some(&value) {
            continue;
        }
        match filtered {
            Some(value) => std::env::set_var(key, value),
            None => std::env::remove_var(key),
        }
        sanitized.push(key);
    }

    sanitized
}

/// Filter AppDir-rooted entries from a colon-delimited Python path value.
/// `None` means no usable entries remain and the variable should be removed.
fn filter_appdir_paths(value: &OsStr, appdir: &Path) -> Option<OsString> {
    let paths: Vec<PathBuf> = std::env::split_paths(value)
        .filter(|path| {
            !path.as_os_str().is_empty() && !normalized_existing_path(path).starts_with(appdir)
        })
        .collect();
    if paths.is_empty() {
        return None;
    }
    std::env::join_paths(paths).ok()
}

fn normalized_existing_path(path: &Path) -> PathBuf {
    std::fs::canonicalize(path).unwrap_or_else(|_| {
        let mut normalized = PathBuf::new();
        for component in path.components() {
            match component {
                std::path::Component::CurDir => {}
                std::path::Component::ParentDir => {
                    normalized.pop();
                }
                other => normalized.push(other.as_os_str()),
            }
        }
        normalized
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    #[cfg(target_os = "linux")]
    static ENVIRONMENT_LOCK: Mutex<()> = Mutex::new(());

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

    #[test]
    fn appimage_pythonhome_is_removed_but_host_paths_are_preserved() {
        let root =
            std::env::temp_dir().join(format!("plethora-appdir-python-{}", std::process::id()));
        let appdir = root.join("mount");
        std::fs::create_dir_all(appdir.join("usr/share/pyshared")).unwrap();

        assert_eq!(
            filter_appdir_paths(
                appdir.join("usr").as_os_str(),
                &normalized_existing_path(&appdir)
            ),
            None
        );
        let path_value = std::env::join_paths([
            appdir.join("usr/share/pyshared"),
            PathBuf::from("/usr/lib/python3.12/site-packages"),
        ])
        .unwrap();
        assert_eq!(
            filter_appdir_paths(&path_value, &normalized_existing_path(&appdir)),
            Some(OsString::from("/usr/lib/python3.12/site-packages"))
        );
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn parent_sanitizer_only_removes_appdir_owned_python_paths() {
        struct Restore(Vec<(&'static str, Option<OsString>)>);
        impl Drop for Restore {
            fn drop(&mut self) {
                for (key, value) in &self.0 {
                    if let Some(value) = value {
                        std::env::set_var(key, value);
                    } else {
                        std::env::remove_var(key);
                    }
                }
            }
        }

        let _lock = ENVIRONMENT_LOCK.lock().unwrap();
        let keys = ["APPDIR", "PYTHONHOME", "PYTHONPATH"];
        let _restore = Restore(
            keys.iter()
                .map(|key| (*key, std::env::var_os(key)))
                .collect(),
        );
        let root = std::env::temp_dir().join(format!("plethora-appdir-env-{}", std::process::id()));
        let appdir = root.join("mount");
        std::fs::create_dir_all(appdir.join("usr/share/pyshared")).unwrap();
        let host_path = root.join("host-python");
        std::fs::create_dir_all(&host_path).unwrap();

        std::env::set_var("APPDIR", &appdir);
        std::env::set_var("PYTHONHOME", appdir.join("usr"));
        std::env::set_var(
            "PYTHONPATH",
            std::env::join_paths([appdir.join("usr/share/pyshared"), host_path.clone()]).unwrap(),
        );
        assert_eq!(sanitize_appimage_parent_env(), ["PYTHONHOME", "PYTHONPATH"]);
        assert!(std::env::var_os("PYTHONHOME").is_none());
        assert_eq!(
            std::env::var_os("PYTHONPATH").as_deref(),
            Some(host_path.as_os_str())
        );

        let output = Command::new("python3")
            .args(["-c", "import encodings; print(encodings.__file__)"])
            .output()
            .expect("host python3 is available");
        assert!(
            output.status.success(),
            "AppImage child python failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        assert!(String::from_utf8_lossy(&output.stdout).contains("encodings"));

        std::env::remove_var("APPDIR");
        std::env::set_var("PYTHONHOME", "/usr");
        std::env::set_var("PYTHONPATH", &host_path);
        assert!(sanitize_appimage_parent_env().is_empty());
        assert_eq!(std::env::var("PYTHONHOME").as_deref(), Ok("/usr"));
        assert_eq!(
            std::env::var_os("PYTHONPATH").as_deref(),
            Some(host_path.as_os_str())
        );

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn system_python_imports_encodings_with_appimage_paths_removed() {
        let appdir =
            std::env::temp_dir().join(format!("plethora-python-appdir-{}", std::process::id()));
        let mut command = Command::new("python3");
        command
            .args(["-c", "import encodings; print(encodings.__file__)"])
            .env("PYTHONHOME", appdir.join("usr"))
            .env("PYTHONPATH", appdir.join("usr/share/pyshared"));
        sanitize_python_env(&mut command);

        let output = command.output().expect("host python3 is available");
        assert!(
            output.status.success(),
            "python3 failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        let stdout = String::from_utf8_lossy(&output.stdout);
        assert!(stdout.contains("encodings"), "unexpected output: {stdout}");
        assert!(!stdout.contains(appdir.to_string_lossy().as_ref()));
    }
}
