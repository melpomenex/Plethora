//! CLI: `macos-footprint <rootPid> [--marker <runId>] [--env-marker <NAME>=<value>]`
//!
//! Prints one JSON object on stdout (contract in lib.rs docs) and exits 0 —
//! absent PIDs are data, not errors. Usage errors exit 2.

use macos_footprint::{list_webkit_pids, snapshot_tree, SysProcSource};

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let mut root_pid: Option<u32> = None;
    let mut marker: Option<String> = None;
    let mut webkit_baseline: Option<Vec<u32>> = None;
    let mut list_webkit = false;

    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--marker" => {
                i += 1;
                marker = args.get(i).cloned();
            }
            "--webkit-baseline" => {
                i += 1;
                webkit_baseline = args.get(i).and_then(|v| {
                    Some(v.split(',').filter_map(|p| p.parse::<u32>().ok()).collect())
                });
            }
            "--list-webkit" => {
                list_webkit = true;
            }
            other => match other.parse::<u32>() {
                Ok(pid) if root_pid.is_none() => root_pid = Some(pid),
                _ => {
                    eprintln!(
                        "usage: macos-footprint <rootPid> [--marker <runIdValue>] \
                         [--webkit-baseline <pid,pid,...>] | --list-webkit"
                    );
                    eprintln!("  unknown argument: {other}");
                    std::process::exit(2);
                }
            },
        }
        i += 1;
    }

    if list_webkit {
        for pid in list_webkit_pids(&mut SysProcSource) {
            println!("{pid}");
        }
        return;
    }

    let Some(root_pid) = root_pid else {
        eprintln!(
            "usage: macos-footprint <rootPid> [--marker <runIdValue>] \
             [--webkit-baseline <pid,pid,...>] | --list-webkit"
        );
        std::process::exit(2);
    };

    let snapshot = snapshot_tree(
        &mut SysProcSource,
        root_pid,
        marker.as_deref(),
        webkit_baseline.as_deref(),
    );
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
