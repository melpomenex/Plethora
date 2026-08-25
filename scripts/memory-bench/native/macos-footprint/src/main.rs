//! CLI: `macos-footprint <rootPid> [--marker <runId>] [--env-marker <NAME>=<value>]`
//!
//! Prints one JSON object on stdout (contract in lib.rs docs) and exits 0 —
//! absent PIDs are data, not errors. Usage errors exit 2.

use macos_footprint::{snapshot_tree, SysProcSource};

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let mut root_pid: Option<u32> = None;
    let mut marker: Option<String> = None;

    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--marker" => {
                i += 1;
                marker = args.get(i).cloned();
            }
            other => match other.parse::<u32>() {
                Ok(pid) if root_pid.is_none() => root_pid = Some(pid),
                _ => {
                    eprintln!("usage: macos-footprint <rootPid> [--marker <runIdValue>]");
                    eprintln!("  unknown argument: {other}");
                    std::process::exit(2);
                }
            },
        }
        i += 1;
    }

    let Some(root_pid) = root_pid else {
        eprintln!("usage: macos-footprint <rootPid> [--marker <runIdValue>]");
        std::process::exit(2);
    };

    let snapshot = snapshot_tree(&mut SysProcSource, root_pid, marker.as_deref());
    match serde_json::to_string_pretty(&snapshot) {
        Ok(json) => {
            println!("{json}");
        }
        Err(error) => {
            eprintln!("serialization failed: {error}");
            std::process::exit(1);
        }
    }
}
