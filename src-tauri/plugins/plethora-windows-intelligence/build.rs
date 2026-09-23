// Builds the Phi Silica C++/WinRT bridge when Windows App SDK headers are available.

const COMMANDS: &[&str] = &[
    "windows_capabilities",
    "windows_lm_generate",
    "windows_lm_generate_stream",
    "windows_lm_cancel",
    "windows_lm_warmup",
    "windows_lm_ensure_ready",
    "windows_ocr_status",
    "windows_ocr_recognize",
    "windows_lm_diagnostics",
];

fn main() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        try_build_phi_bridge();
    }
    tauri_plugin::Builder::new(COMMANDS)
        .try_build()
        .expect("failed to build tauri-plugin for plethora-windows-intelligence");
}

#[cfg(not(target_env = "msvc"))]
fn try_build_phi_bridge() {}

#[cfg(target_env = "msvc")]
fn try_build_phi_bridge() {
    use std::env;
    use std::path::PathBuf;
    use std::process::Command;

    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let cpp = manifest_dir.join("cpp/PhiSilicaBridge.cpp");
    let out_dir = PathBuf::from(env::var("OUT_DIR").expect("OUT_DIR"));
    let lib_path = out_dir.join("plethora_phi_silica.lib");

    // Windows App SDK cppwinrt headers via NuGet cache or explicit root.
    let sdk_root = env::var("WINDOWS_APP_SDK_ROOT").ok().map(PathBuf::from).or_else(|| {
        let home = env::var("USERPROFILE").or_else(|_| env::var("HOME")).unwrap_or_default();
        let nuget = PathBuf::from(home).join(".nuget/packages/microsoft.windowsappsdk");
        if nuget.is_dir() {
            std::fs::read_dir(&nuget)
                .ok()
                .and_then(|entries| {
                    entries
                        .filter_map(|e| e.ok())
                        .map(|e| e.path())
                        .filter(|p| p.is_dir())
                        .max_by_key(|p| p.file_name().unwrap_or_default().to_string_lossy().to_string())
                })
        } else {
            None
        }
    });

    if sdk_root.is_none() {
        println!("cargo:warning=Plethora Phi Silica bridge skipped: set WINDOWS_APP_SDK_ROOT or install Microsoft.WindowsAppSDK NuGet package");
        return;
    }

    let sdk_root = sdk_root.unwrap();
    let include = sdk_root.join("include");
    let cppwinrt = include.join("winrt");

    if !cppwinrt.exists() {
        println!("cargo:warning=Plethora Phi Silica bridge skipped: cppwinrt headers not found under {:?}", include);
        return;
    }

    let cl = which_cl().unwrap_or_else(|| "cl.exe".into());
    let status = Command::new(cl)
        .args([
            "/nologo",
            "/std:c++17",
            "/EHsc",
            "/DUNICODE",
            "/D_UNICODE",
            "/DPLETHORA_PHI_SILICA_CPP",
            "/c",
            "/Fo",
        ])
        .arg(out_dir.join("PhiSilicaBridge.obj"))
        .arg(format!("/I{}", include.display()))
        .arg(&cpp)
        .status();

    match status {
        Ok(s) if s.success() => {
            let lib = which_lib().unwrap_or_else(|| "lib.exe".into());
            let lib_status = Command::new(lib)
                .args([
                    "/nologo",
                    "/OUT:",
                    &lib_path.to_string_lossy(),
                    &out_dir.join("PhiSilicaBridge.obj").to_string_lossy(),
                ])
                .status();
            if lib_status.map(|s| s.success()).unwrap_or(false) {
                println!("cargo:rustc-link-search=native={}", out_dir.display());
                println!("cargo:rustc-link-lib=static=plethora_phi_silica");
                println!("cargo:rustc-link-lib=windowsapp");
            }
        }
        _ => println!("cargo:warning=Plethora Phi Silica bridge compile failed"),
    }
}

#[cfg(target_env = "msvc")]
fn which_cl() -> Option<std::path::PathBuf> {
    std::process::Command::new("where")
        .arg("cl.exe")
        .output()
        .ok()
        .and_then(|o| {
            String::from_utf8_lossy(&o.stdout)
                .lines()
                .find(|l| !l.trim().is_empty())
                .map(|l| std::path::PathBuf::from(l.trim()))
        })
}

#[cfg(target_env = "msvc")]
fn which_lib() -> Option<std::path::PathBuf> {
    std::process::Command::new("where")
        .arg("lib.exe")
        .output()
        .ok()
        .and_then(|o| {
            String::from_utf8_lossy(&o.stdout)
                .lines()
                .find(|l| !l.trim().is_empty())
                .map(|l| std::path::PathBuf::from(l.trim()))
        })
}
