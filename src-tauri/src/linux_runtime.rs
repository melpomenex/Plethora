//! Linux process environment setup for packaged AppImage launches.
//!
//! AppImage's generated AppRun currently exports Python paths rooted at its
//! temporary mount. Plethora's general runtime does not contain Python's
//! standard library at that location, so these values must be removed before
//! any library can spawn GStreamer or WebKit helpers. This module also gives
//! bundled GStreamer plugins a stable per-user path so GStreamer's persistent
//! registry remains useful across AppImage mount points.

use std::ffi::OsStr;
use std::path::{Path, PathBuf};

#[derive(Debug, Default)]
pub struct RuntimeEnvironmentReport {
    pub appimage: bool,
    pub sanitized_python_keys: Vec<&'static str>,
    pub gst_plugin_dir: Option<PathBuf>,
    pub gst_registry: Option<PathBuf>,
    pub gst_plugin_cache: &'static str,
}

/// Prepare the Linux AppImage environment before any child process starts.
pub fn initialize() -> RuntimeEnvironmentReport {
    #[cfg(target_os = "linux")]
    {
        initialize_linux()
    }
    #[cfg(not(target_os = "linux"))]
    {
        RuntimeEnvironmentReport::default()
    }
}

#[cfg(target_os = "linux")]
fn initialize_linux() -> RuntimeEnvironmentReport {
    use crate::utils::python_env::sanitize_appimage_parent_env;

    let Some(appdir) = std::env::var_os("APPDIR").map(PathBuf::from) else {
        return RuntimeEnvironmentReport::default();
    };

    let sanitized_python_keys = sanitize_appimage_parent_env();
    let appdir = normalized_path(&appdir);
    let app_plugin_dir = appdir.join("usr/lib/gstreamer-1.0");
    let plugin_identity_path = appdir.join("usr/share/plethora/gstreamer-plugin-set-id");

    let mut report = RuntimeEnvironmentReport {
        appimage: true,
        sanitized_python_keys,
        gst_plugin_dir: None,
        gst_registry: None,
        gst_plugin_cache: "unavailable",
    };

    if app_plugin_dir.is_dir() {
        let identity = std::fs::read_to_string(plugin_identity_path)
            .ok()
            .map(|value| value.trim().to_ascii_lowercase())
            .filter(|value| is_sha256(value));
        let cache_root = xdg_cache_root().map(|path| path.join("plethora/gstreamer"));

        if let (Some(identity), Some(cache_root)) = (identity, cache_root) {
            let stable_plugins = cache_root.join("plugins").join(&identity);
            let was_cached = valid_plugin_cache(&stable_plugins, &identity);
            if let Some(staged) = stage_plugin_set(&app_plugin_dir, &stable_plugins, &identity) {
                report.gst_plugin_dir = Some(staged);
                report.gst_plugin_cache = if was_cached { "reused" } else { "staged" };
                let arch = std::env::consts::ARCH;
                let registry = cache_root.join(format!("registry-{arch}-{identity}.bin"));
                if ensure_private_dir(&cache_root).is_ok() {
                    if std::env::var_os("GST_REGISTRY").is_none() {
                        std::env::set_var("GST_REGISTRY", &registry);
                    }
                    report.gst_registry = std::env::var_os("GST_REGISTRY")
                        .map(PathBuf::from)
                        .or(Some(registry));
                }
            }
        }

        if report.gst_plugin_dir.is_none() {
            report.gst_plugin_dir = Some(app_plugin_dir.clone());
            report.gst_plugin_cache = "appdir-fallback";
        }

        configure_plugin_paths(&appdir, report.gst_plugin_dir.as_deref());
    }

    report
}

/// Choose the XDG cache root, with the standard `$HOME/.cache` fallback.
fn xdg_cache_root() -> Option<PathBuf> {
    if let Some(path) = std::env::var_os("XDG_CACHE_HOME").map(PathBuf::from) {
        if path.is_absolute() {
            return Some(path);
        }
    }
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .filter(|home| home.is_absolute())
        .map(|home| home.join(".cache"))
}

#[cfg(target_os = "linux")]
fn ensure_private_dir(path: &Path) -> std::io::Result<()> {
    use std::os::unix::fs::DirBuilderExt;

    let mut builder = std::fs::DirBuilder::new();
    builder.recursive(true).mode(0o700).create(path)
}

#[cfg(not(target_os = "linux"))]
fn ensure_private_dir(path: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(path)
}

fn stage_plugin_set(source: &Path, destination: &Path, identity: &str) -> Option<PathBuf> {
    if valid_plugin_cache(destination, identity) {
        return Some(destination.to_path_buf());
    }

    let parent = destination.parent()?;
    ensure_private_dir(parent).ok()?;
    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .ok()?
        .as_nanos();
    let staging = parent.join(format!(".stage-{}-{nonce}", std::process::id()));
    ensure_private_dir(&staging).ok()?;

    let result = (|| {
        let mut copied = 0usize;
        for entry in std::fs::read_dir(source).ok()? {
            let entry = entry.ok()?;
            let file_type = entry.file_type().ok()?;
            let name = entry.file_name();
            if !file_type.is_file() || Path::new(&name).extension() != Some(OsStr::new("so")) {
                continue;
            }
            std::fs::copy(entry.path(), staging.join(name)).ok()?;
            copied += 1;
        }
        if copied == 0 {
            return None;
        }
        std::fs::write(staging.join(".plethora-plugin-set-id"), identity).ok()?;

        // Renaming a complete directory publishes it atomically. If another
        // process won the race, use its complete cache after checking marker.
        if std::fs::rename(&staging, destination).is_ok() {
            Some(destination.to_path_buf())
        } else if valid_plugin_cache(destination, identity) {
            Some(destination.to_path_buf())
        } else {
            None
        }
    })();

    // A successful rename removes this path. A concurrent publisher that
    // reuses the winner's cache must still remove its own staging directory.
    let _ = std::fs::remove_dir_all(&staging);
    result
}

fn valid_plugin_cache(path: &Path, identity: &str) -> bool {
    std::fs::read_to_string(path.join(".plethora-plugin-set-id"))
        .map(|value| value.trim() == identity)
        .unwrap_or(false)
        && std::fs::read_dir(path)
            .map(|entries| {
                entries.flatten().any(|entry| {
                    entry
                        .file_type()
                        .map(|kind| kind.is_file())
                        .unwrap_or(false)
                        && Path::new(&entry.file_name()).extension() == Some(OsStr::new("so"))
                })
            })
            .unwrap_or(false)
}

fn configure_plugin_paths(appdir: &Path, bundled_path: Option<&Path>) {
    let mut plugin_paths = Vec::new();
    if let Some(path) = bundled_path {
        push_unique(&mut plugin_paths, path.to_path_buf());
    }
    append_external_paths(
        &mut plugin_paths,
        std::env::var_os("GST_PLUGIN_PATH"),
        appdir,
    );
    if let Ok(value) = std::env::join_paths(&plugin_paths) {
        std::env::set_var("GST_PLUGIN_PATH", value);
    }

    let mut system_paths = Vec::new();
    append_external_paths(
        &mut system_paths,
        std::env::var_os("GST_PLUGIN_SYSTEM_PATH_1_0"),
        appdir,
    );
    append_external_paths(
        &mut system_paths,
        std::env::var_os("GST_PLUGIN_SYSTEM_PATH"),
        appdir,
    );
    for directory in [
        "/usr/lib/gstreamer-1.0",
        "/usr/lib64/gstreamer-1.0",
        "/usr/lib/x86_64-linux-gnu/gstreamer-1.0",
        "/usr/lib/aarch64-linux-gnu/gstreamer-1.0",
    ] {
        let path = PathBuf::from(directory);
        if path.is_dir() {
            push_unique(&mut system_paths, path);
        }
    }

    if let Ok(value) = std::env::join_paths(&system_paths) {
        // Override AppRun's ephemeral plugin path while preserving host paths.
        std::env::set_var("GST_PLUGIN_SYSTEM_PATH_1_0", &value);
        std::env::set_var("GST_PLUGIN_SYSTEM_PATH", value);
    }

    if std::env::var_os("GST_REGISTRY").is_none() {
        if let Some(cache_root) = xdg_cache_root() {
            let registry_dir = cache_root.join("plethora/gstreamer");
            if ensure_private_dir(&registry_dir).is_ok() {
                std::env::set_var(
                    "GST_REGISTRY",
                    registry_dir.join(format!("registry-{}.bin", std::env::consts::ARCH)),
                );
            }
        }
    }
}

fn append_external_paths(
    paths: &mut Vec<PathBuf>,
    value: Option<std::ffi::OsString>,
    appdir: &Path,
) {
    let Some(value) = value else { return };
    for path in std::env::split_paths(&value) {
        if path.as_os_str().is_empty() || normalized_path(&path).starts_with(appdir) {
            continue;
        }
        push_unique(paths, path);
    }
}

fn push_unique(paths: &mut Vec<PathBuf>, path: PathBuf) {
    let normalized = normalized_path(&path);
    if !paths
        .iter()
        .any(|existing| normalized_path(existing) == normalized)
    {
        paths.push(path);
    }
}

fn normalized_path(path: &Path) -> PathBuf {
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

fn is_sha256(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "plethora-{label}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }

    #[test]
    fn plugin_cache_is_reused_and_identity_changes_select_a_new_directory() {
        let root = temp_root("gst-cache");
        let source = root.join("source");
        std::fs::create_dir_all(&source).unwrap();
        std::fs::write(source.join("libgstexample.so"), b"plugin-v1").unwrap();
        let first_id = "a".repeat(64);
        let second_id = "b".repeat(64);
        let first = root.join("cache/plugins").join(&first_id);

        let staged = stage_plugin_set(&source, &first, &first_id).unwrap();
        assert_eq!(staged, first);
        assert_eq!(
            std::fs::read(staged.join("libgstexample.so")).unwrap(),
            b"plugin-v1"
        );
        assert_eq!(
            stage_plugin_set(&source, &first, &first_id),
            Some(first.clone())
        );
        assert!(!valid_plugin_cache(&first, &second_id));
        std::fs::write(source.join("libgstexample.so"), b"plugin-v2").unwrap();
        let second = root.join("cache/plugins").join(&second_id);
        assert_eq!(
            stage_plugin_set(&source, &second, &second_id),
            Some(second.clone())
        );
        assert_ne!(first, second);
        assert_eq!(
            std::fs::read(second.join("libgstexample.so")).unwrap(),
            b"plugin-v2"
        );

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn unavailable_or_read_only_cache_falls_back_to_appdir_plugins() {
        let root = temp_root("gst-readonly");
        let source = root.join("appdir/plugins");
        std::fs::create_dir_all(&source).unwrap();
        std::fs::write(source.join("libgstexample.so"), b"plugin").unwrap();
        let cache_file = root.join("cache-is-a-file");
        std::fs::write(&cache_file, b"not a directory").unwrap();
        let destination = cache_file.join("plugins").join("a".repeat(64));

        assert!(stage_plugin_set(&source, &destination, &"a".repeat(64)).is_none());
        let fallback = if stage_plugin_set(&source, &destination, &"a".repeat(64)).is_some() {
            destination
        } else {
            source.clone()
        };
        assert_eq!(fallback, source);

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn concurrent_staging_publishes_one_complete_cache() {
        let root = temp_root("gst-concurrent");
        let source = root.join("source");
        std::fs::create_dir_all(&source).unwrap();
        for index in 0..8 {
            std::fs::write(
                source.join(format!("libgst{index}.so")),
                [index as u8; 1024],
            )
            .unwrap();
        }
        let destination = root.join("cache/plugins").join("c".repeat(64));
        let identity = "c".repeat(64);
        let threads: Vec<_> = (0..4)
            .map(|_| {
                let source = source.clone();
                let destination = destination.clone();
                let identity = identity.clone();
                std::thread::spawn(move || stage_plugin_set(&source, &destination, &identity))
            })
            .collect();
        for thread in threads {
            assert_eq!(thread.join().unwrap(), Some(destination.clone()));
        }
        assert!(valid_plugin_cache(&destination, &identity));
        for index in 0..8 {
            assert_eq!(
                std::fs::metadata(destination.join(format!("libgst{index}.so")))
                    .unwrap()
                    .len(),
                1024
            );
        }
        assert!(std::fs::read_dir(destination.parent().unwrap())
            .unwrap()
            .all(|entry| !entry
                .unwrap()
                .file_name()
                .to_string_lossy()
                .starts_with(".stage-")));

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn appdir_paths_are_removed_and_host_plugin_paths_are_deduplicated() {
        let root = temp_root("gst-paths");
        let appdir = root.join("mount");
        let bundled = appdir.join("usr/lib/gstreamer-1.0");
        let host = root.join("host-plugins");
        std::fs::create_dir_all(&bundled).unwrap();
        std::fs::create_dir_all(&host).unwrap();
        let mut result = Vec::new();
        let env = std::env::join_paths([bundled, host.clone(), host.clone()]).unwrap();
        append_external_paths(&mut result, Some(env), &normalized_path(&appdir));
        assert_eq!(result, vec![host]);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn accepts_only_hex_sha256_plugin_identity() {
        assert!(is_sha256(&"a".repeat(64)));
        assert!(!is_sha256(&"g".repeat(64)));
        assert!(!is_sha256("short"));
    }
}
