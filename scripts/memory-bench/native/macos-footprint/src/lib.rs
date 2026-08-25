//! macos-footprint — per-process physical memory footprint of a process tree.
//!
//! Memory-bench helper for the macOS collector (change
//! `eliminate-long-running-memory-growth`, tasks 2.1/2.2). Given a root PID,
//! enumerates the process tree by PPID walk (`proc_pidinfo` /
//! `PROC_PIDTBSDINFO`), and for every live PID reports physical footprint and
//! friends from `proc_pid_rusage` (`ri_phys_footprint` — the same number
//! macOS itself charges and pressures) plus virtual size from
//! `PROC_PIDTASKINFO`.
//!
//! Contract with the driver-side collector (`macos-footprint.js`):
//!   - A PID that exits mid-walk is reported in `absent`, never an error —
//!     the harness treats absence as data, not failure (mirroring the Linux
//!     sampler's ABSENT rows).
//!   - Tree membership is decided HERE by ancestry from the launched root;
//!     the run-ID environment marker (`kern.procargs2`, best-effort — macOS
//!     restricts reading other processes' environments) is a secondary
//!     verification recorded per process as `markerVerified` (design D3:
//!     ancestry from the driver-launched root is authoritative; `false` plus
//!     verified ancestry is acceptable).
//!
//! The syscall layer is behind the [`ProcSource`] trait so the pure walk and
//! classification logic are unit-testable against fixtures (task 2.2).

use std::collections::HashMap;

use serde::Serialize;

#[cfg(target_os = "macos")]
pub mod sys;
#[cfg(target_os = "macos")]
pub use sys::SysProcSource;

/// Process roles, matching the Linux collector's classification
/// (`scripts/memory-bench/discovery.js::ROLES`).
pub const ROLE_NATIVE: &str = "native";
pub const ROLE_WEB_CONTENT: &str = "web-content";
pub const ROLE_NETWORK: &str = "network";
pub const ROLE_OTHER: &str = "other";

/// One process's measured footprint (bytes).
#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize)]
pub struct RusageFootprint {
    /// `ri_phys_footprint` — the macOS headline metric (Activity Monitor
    /// "Memory" column semantics). Additive across processes; this is what
    /// the tree total sums.
    pub phys_footprint: u64,
    /// `ri_resident_size` — reported per process, never summed (shared pages
    /// would double-count).
    pub resident_size: u64,
    /// `ri_wired_size`.
    pub wired_size: u64,
}

/// The BSD-layer identity we need for the PPID walk.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct ProcBsdInfo {
    pub pid: u32,
    pub ppid: u32,
    /// `pbi_comm` — short name (always populated by the kernel).
    pub comm: String,
    /// `pbi_name` — full registered name; may be empty (e.g. helper
    /// processes); the executable path is the better classifier.
    pub name: String,
}

/// The syscall seam. The real implementation (`sys.rs`) binds libproc; tests
/// inject fixtures. Every method returns `None` for a PID that is absent (or
/// unreadable) so a mid-walk exit degrades to an `absent` row.
pub trait ProcSource {
    /// All PIDs on the system (`proc_listpids`).
    fn list_pids(&mut self) -> std::io::Result<Vec<u32>>;
    /// `proc_pidinfo` PROC_PIDTBSDINFO; `None` when the PID vanished.
    fn bsd_info(&mut self, pid: u32) -> Option<ProcBsdInfo>;
    /// `proc_pid_rusage`; `None` when the PID vanished.
    fn rusage(&mut self, pid: u32) -> Option<RusageFootprint>;
    /// `pti_virtual_size` via PROC_PIDTASKINFO; `None` when unavailable.
    fn virtual_size(&mut self, pid: u32) -> Option<u64>;
    /// Executable path (`proc_pidpath`); `None` when unavailable.
    fn executable_path(&mut self, pid: u32) -> Option<String>;
    /// Best-effort run-ID marker check in the process environment
    /// (`kern.procargs2`): `Some(true/false)` when the environment was
    /// readable, `None` when macOS refused (recorded as `markerVerified:
    /// false` by the walk — ancestry remains the authoritative signal).
    fn environ_has_marker(&mut self, pid: u32, marker: &str) -> Option<bool>;
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProcessSample {
    pub pid: u32,
    pub ppid: u32,
    pub executable: String,
    /// Classification hint from the executable/comm name (see
    /// [`classify_role`]); the driver's collector re-applies its own
    /// ancestry+marker rules on top.
    pub role_hint: &'static str,
    pub phys_footprint: u64,
    pub resident_size: u64,
    pub wired_size: u64,
    pub virtual_size: u64,
    /// Run-ID marker verified in this process's environment (`false` when
    /// unreadable — see module docs).
    pub marker_verified: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AbsentPid {
    pub pid: u32,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TreeSnapshot {
    pub root_pid: u32,
    pub processes: Vec<ProcessSample>,
    /// PIDs that were part of the tree but vanished (or could not be read)
    /// before their sample was taken.
    pub absent: Vec<AbsentPid>,
}

/// Classify a process by executable path / registered name (task 2.2 fixture
/// contract):
///   - the launched app binary (or any path whose file name is the app
///     binary / not a WebKit helper) → [`ROLE_NATIVE`]
///   - `com.apple.WebKit.WebContent*` → [`ROLE_WEB_CONTENT`]
///   - `com.apple.WebKit.Networking` → [`ROLE_NETWORK`]
///   - GPU process or anything else → [`ROLE_OTHER`]
pub fn classify_role(root_pid: u32, pid: u32, executable: &str, comm: &str) -> &'static str {
    if pid == root_pid {
        return ROLE_NATIVE;
    }
    // WKWebView helper bundles: /System/Library/Frameworks/WebKit.framework
    // exposes XPC services named com.apple.WebKit.*; wry also spawns
    // com.apple.WebKit.GPUProcess* on recent macOS.
    for candidate in [executable, comm] {
        let c = candidate.to_ascii_lowercase();
        if c.contains("webkit.webcontent") || c.contains("webkitwebprocess") {
            return ROLE_WEB_CONTENT;
        }
        if c.contains("webkit.network") || c.contains("webkitnetworkprocess") {
            return ROLE_NETWORK;
        }
        if c.contains("webkit.gpuprocess") || c.contains("webkit.gpu") {
            return ROLE_OTHER;
        }
    }
    ROLE_OTHER
}

/** Every live WebKit-named XPC process pid (driver baseline snapshot). */
pub fn list_webkit_pids(source: &mut dyn ProcSource) -> Vec<u32> {
    let mut pids = Vec::new();
    if let Ok(all) = source.list_pids() {
        for pid in all {
            if let Some(info) = source.bsd_info(pid) {
                if is_webkit_process(&info.name, &info.comm) {
                    pids.push(pid);
                }
            }
        }
    }
    pids.sort_unstable();
    pids
}

fn file_name_of(path: &str) -> &str {
    path.rsplit('/').next().unwrap_or(path)
}

/// Walk the tree rooted at `root_pid` and sample every member.
///
/// Membership = the root itself plus every process whose PPID chain (from the
/// snapshot of BSD info taken at walk start) reaches the root. Reparented
/// orphans (PPID → 1) are therefore never absorbed.
/// Membership heuristic for macOS 26+ (task 2.3 follow-up): `kern.procargs2`
/// is denied system-wide on current Darwin, so the run-ID environment
/// marker cannot attribute WKWebView XPC helpers (which are reparented to
/// launchd). When the driver supplies the WebKit PIDs that existed BEFORE
/// it launched the app, every OTHER WebKit-named process is attributed to
/// this app's tree. The pre-launch baseline guarantees an already-running
/// application's helpers are never absorbed; a foreign app spawning helpers
/// DURING the run is the documented blind spot (acceptable on a dedicated
/// benchmark machine).
pub fn is_webkit_process(executable: &str, comm: &str) -> bool {
    let name = executable.to_ascii_lowercase();
    let c = comm.to_ascii_lowercase();
    name.contains("webkit") || c.contains("webkit")
}

pub fn snapshot_tree(
    source: &mut dyn ProcSource,
    root_pid: u32,
    marker: Option<&str>,
    webkit_baseline: Option<&[u32]>,
) -> TreeSnapshot {
    let mut absent = Vec::new();
    let mut snapshot = TreeSnapshot {
        root_pid,
        processes: Vec::new(),
        absent: Vec::new(),
    };

    // One pass: BSD info for every pid on the system, then ancestry over the
    // frozen map (a parent exiting between list and walk cannot corrupt the
    // tree topology).
    let pids = match source.list_pids() {
        Ok(pids) => pids,
        Err(error) => {
            snapshot.absent.push(AbsentPid {
                pid: root_pid,
                reason: format!("proc_listpids failed: {error}"),
            });
            return snapshot;
        }
    };
    let mut bsd: HashMap<u32, ProcBsdInfo> = HashMap::new();
    for pid in pids {
        match source.bsd_info(pid) {
            Some(info) => {
                bsd.insert(pid, info);
            }
            None => {
                // Absent before we even knew whether it mattered — only the
                // root is interesting enough to record here.
                if pid == root_pid {
                    absent.push(AbsentPid {
                        pid,
                        reason: "process exited before PROC_PIDTBSDINFO".into(),
                    });
                }
            }
        }
    }

    let root_info = match bsd.get(&root_pid) {
        Some(info) => info.clone(),
        None => {
            snapshot.absent = absent;
            snapshot.absent.push(AbsentPid {
                pid: root_pid,
                reason: "root process exited before the walk".into(),
            });
            return snapshot;
        }
    };
    let _ = root_info;

    // Ancestry: BFS from the root over the frozen PPID map. On macOS,
    // WKWebView helper processes (WebContent/Networking/GPU) are XPC
    // services REPARENTED TO LAUNCHD (PPID 1), so ancestry finds only the
    // native root — the run-ID marker is the only membership signal for
    // them (design D3). With a marker provided, include every process
    // whose environment carries it; unreadable environments stay excluded
    // (a foreign application's WebKit helpers can never match).
    let mut members = vec![root_pid];
    let mut frontier = vec![root_pid];
    while let Some(pid) = frontier.pop() {
        for (candidate, info) in &bsd {
            if info.ppid == pid && !members.contains(candidate) {
                members.push(*candidate);
                frontier.push(*candidate);
            }
        }
    }
    members.sort_unstable();
    // Marker attempt (kept for OS versions where kern.procargs2 works).
    if let Some(marker) = marker {
        for (pid, info) in &bsd {
            if members.contains(pid) {
                continue;
            }
            if is_webkit_process(&info.name, &info.comm)
                && source
                    .environ_has_marker(*pid, marker)
                    .unwrap_or(false)
            {
                members.push(*pid);
            }
        }
    }
    // Differential baseline: WebKit helpers that appeared after the driver
    // launched the app belong to it.
    if let Some(baseline) = webkit_baseline {
        for (pid, info) in &bsd {
            if members.contains(pid) || baseline.contains(pid) {
                continue;
            }
            if is_webkit_process(&info.name, &info.comm) {
                members.push(*pid);
            }
        }
    }
    members.sort_unstable();
    snapshot.absent = absent;

    for pid in members {
        let info = bsd.get(&pid);
        let rusage = source.rusage(pid);
        let executable = source
            .executable_path(pid)
            .or_else(|| info.map(|i| i.name.clone()).filter(|n| !n.is_empty()))
            .or_else(|| info.map(|i| i.comm.clone()))
            .unwrap_or_default();
        let marker_verified = match marker {
            Some(marker) => source.environ_has_marker(pid, marker).unwrap_or(false),
            None => false,
        };
        let (rusage, missing) = match rusage {
            Some(r) => (r, false),
            None => (RusageFootprint::default(), true),
        };
        // The comm/name for classification: prefer the executable's file
        // name (bundle ids live there for WKWebView helpers).
        let role_hint = classify_role(
            root_pid,
            pid,
            &executable,
            info.map(|i| i.comm.as_str()).unwrap_or(""),
        );
        let _ = file_name_of(&executable);
        if missing {
            // Still emit the row (ancestry is membership; the driver decides
            // how to treat a zeroed footprint) but record the absence too.
            snapshot.absent.push(AbsentPid {
                pid,
                reason: "exited before proc_pid_rusage; footprint fields zero".into(),
            });
        }
        snapshot.processes.push(ProcessSample {
            pid,
            ppid: info.map(|i| i.ppid).unwrap_or(0),
            executable,
            role_hint,
            phys_footprint: rusage.phys_footprint,
            resident_size: rusage.resident_size,
            wired_size: rusage.wired_size,
            virtual_size: source.virtual_size(pid).unwrap_or(0),
            marker_verified,
        });
    }

    snapshot
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    /// Fixture-driven mock of the syscall layer (task 2.2).
    struct MockSource {
        pids: Vec<u32>,
        bsd: HashMap<u32, ProcBsdInfo>,
        rusage: HashMap<u32, RusageFootprint>,
        virtual_size: HashMap<u32, u64>,
        executables: HashMap<u32, String>,
        markers: HashMap<u32, bool>,
        /// Pids whose rusage read "fails" (simulating a mid-walk exit).
        exit_rusage: Vec<u32>,
        reads: RefCell<Vec<u32>>,
    }

    impl MockSource {
        fn new() -> Self {
            MockSource {
                pids: Vec::new(),
                bsd: HashMap::new(),
                rusage: HashMap::new(),
                virtual_size: HashMap::new(),
                executables: HashMap::new(),
                markers: HashMap::new(),
                exit_rusage: Vec::new(),
                reads: RefCell::new(Vec::new()),
            }
        }

        fn tree(&mut self, pid: u32, ppid: u32, exec: &str) -> &mut Self {
            self.pids.push(pid);
            self.bsd.insert(
                pid,
                ProcBsdInfo {
                    pid,
                    ppid,
                    comm: exec.rsplit('/').next().unwrap_or(exec).to_string(),
                    name: exec.to_string(),
                },
            );
            self.executables.insert(pid, exec.to_string());
            self
        }
    }

    impl ProcSource for MockSource {
        fn list_pids(&mut self) -> std::io::Result<Vec<u32>> {
            Ok(self.pids.clone())
        }
        fn bsd_info(&mut self, pid: u32) -> Option<ProcBsdInfo> {
            self.bsd.get(&pid).cloned()
        }
        fn rusage(&mut self, pid: u32) -> Option<RusageFootprint> {
            self.reads.borrow_mut().push(pid);
            if self.exit_rusage.contains(&pid) {
                return None; // vanished between discovery and sampling
            }
            self.rusage.get(&pid).copied()
        }
        fn virtual_size(&mut self, pid: u32) -> Option<u64> {
            self.virtual_size.get(&pid).copied()
        }
        fn executable_path(&mut self, pid: u32) -> Option<String> {
            self.executables.get(&pid).cloned()
        }
        fn environ_has_marker(&mut self, pid: u32, _marker: &str) -> Option<bool> {
            self.markers.get(&pid).copied()
        }
    }

    fn default_tree() -> MockSource {
        let mut m = MockSource::new();
        m.tree(100, 99, "/Applications/Plethora.app/Contents/MacOS/Plethora");
        m.tree(101, 100, "/System/Library/Frameworks/WebKit.framework/Versions/A/XPCServices/com.apple.WebKit.WebContent.xpc/Contents/MacOS/com.apple.WebKit.WebContent");
        m.tree(102, 100, "/System/Library/Frameworks/WebKit.framework/Versions/A/XPCServices/com.apple.WebKit.Networking.xpc/Contents/MacOS/com.apple.WebKit.Networking");
        m.tree(103, 100, "/System/Library/Frameworks/WebKit.framework/Versions/A/XPCServices/com.apple.WebKit.GPUProcess.xpc/Contents/MacOS/com.apple.WebKit.GPUProcess");
        // An unrelated browser's WebContent process — must NEVER be absorbed.
        m.tree(900, 899, "/System/Library/Frameworks/WebKit.framework/XPCServices/com.apple.WebKit.WebContent.xpc/com.apple.WebKit.WebContent");
        for (pid, footprint) in [(100, 1_000u64), (101, 2_000), (102, 3_000), (103, 4_000), (900, 5_000)] {
            m.rusage.insert(
                pid,
                RusageFootprint { phys_footprint: footprint, resident_size: footprint + 1, wired_size: 1 },
            );
            m.virtual_size.insert(pid, footprint * 10);
        }
        m
    }

    #[test]
    fn classifies_roles_from_executable_names() {
        let mut m = default_tree();
        let snap = snapshot_tree(&mut m, 100, None, None);
        let by_pid: HashMap<u32, &ProcessSample> =
            snap.processes.iter().map(|p| (p.pid, p)).collect();
        assert_eq!(by_pid[&100].role_hint, ROLE_NATIVE);
        assert_eq!(by_pid[&101].role_hint, ROLE_WEB_CONTENT);
        assert_eq!(by_pid[&102].role_hint, ROLE_NETWORK);
        assert_eq!(by_pid[&103].role_hint, ROLE_OTHER);
    }

    #[test]
    fn walk_absorbs_only_descendants_of_the_root() {
        let mut m = default_tree();
        let snap = snapshot_tree(&mut m, 100, None, None);
        let pids: Vec<u32> = snap.processes.iter().map(|p| p.pid).collect();
        assert_eq!(pids, vec![100, 101, 102, 103]);
        // The foreign WebContent process (pid 900, different ancestry) is
        // excluded even though its executable name matches.
        assert!(!pids.contains(&900));
    }

    #[test]
    fn absent_root_is_reported_never_an_error() {
        let mut m = MockSource::new(); // empty system: root not present
        let snap = snapshot_tree(&mut m, 4242, None, None);
        assert!(snap.processes.is_empty());
        assert!(snap.absent.iter().any(|a| a.pid == 4242));
    }

    #[test]
    fn pid_exiting_mid_walk_lands_in_absent() {
        let mut m = default_tree();
        m.exit_rusage = vec![102];
        let snap = snapshot_tree(&mut m, 100, None, None);
        assert!(snap.absent.iter().any(|a| a.pid == 102));
        // The row still exists (membership is ancestry) with zeroed footprint.
        let row = snap.processes.iter().find(|p| p.pid == 102).unwrap();
        assert_eq!(row.phys_footprint, 0);
        // ... and the other processes were still read.
        assert!(snap.processes.iter().any(|p| p.pid == 101 && p.phys_footprint == 2_000));
    }

    #[test]
    fn marker_verification_is_recorded_per_process() {
        let mut m = default_tree();
        m.markers.insert(100, true);
        m.markers.insert(101, false); // env readable, marker absent
        // 102/103: kern.procargs2 refused → None → markerVerified false.
        let snap = snapshot_tree(&mut m, 100, Some("run-42"), None);
        let by_pid: HashMap<u32, &ProcessSample> =
            snap.processes.iter().map(|p| (p.pid, p)).collect();
        assert!(by_pid[&100].marker_verified);
        assert!(!by_pid[&101].marker_verified);
        assert!(!by_pid[&102].marker_verified);
    }

    #[test]
    fn reparented_orphan_is_not_absorbed() {
        let mut m = default_tree();
        // A process whose parent died: PPID rewired to launchd (1).
        m.tree(950, 1, "/.../com.apple.WebKit.WebContent");
        let snap = snapshot_tree(&mut m, 100, None, None);
        assert!(!snap.processes.iter().any(|p| p.pid == 950));
    }

    #[test]
    fn webkit_baseline_differential_includes_new_helpers_excluding_baseline() {
        let mut m = default_tree();
        // A WebKit helper that existed BEFORE the app launched (another
        // app's) must never be absorbed...
        m.tree(800, 1, "/.../com.apple.WebKit.WebContent");
        // ...but one that appeared after launch belongs to this app.
        m.tree(801, 1, "/.../com.apple.WebKit.WebContent");
        let snap = snapshot_tree(&mut m, 100, None, Some(&[800]));
        let pids: Vec<u32> = snap.processes.iter().map(|p| p.pid).collect();
        assert!(!pids.contains(&800), "baseline helper excluded");
        assert!(pids.contains(&801), "new helper included");
        // With no baseline, differential inclusion is off.
        let snap_no_baseline = snapshot_tree(&mut m, 100, None, None);
        assert!(!snap_no_baseline.processes.iter().any(|p| p.pid == 801));
    }

    #[test]
    fn serialized_shape_matches_the_collector_contract() {
        let mut m = default_tree();
        let snap = snapshot_tree(&mut m, 100, Some("run-42"), None);
        let json = serde_json::to_value(&snap).unwrap();
        let row = &json["processes"][1]; // pid 101
        for field in [
            "pid", "ppid", "executable", "roleHint", "physFootprint",
            "residentSize", "wiredSize", "virtualSize", "markerVerified",
        ] {
            assert!(row.get(field).is_some(), "missing field {field}");
        }
        assert_eq!(row["roleHint"], "web-content");
    }
}
