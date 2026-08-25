//! Raw macOS syscall bindings for the footprint helper.
//!
//! Hand-written minimal FFI over libSystem (libproc + sysctl) so the crate
//! carries no native dependencies. Struct layouts are transcribed from XNU's
//! `sys/proc_info.h` / `libproc.h`; the ones we read are validated at runtime
//! by the tests below (`proc_pidinfo` returns the number of bytes it wrote —
//! a layout drift shows up as a size mismatch, not silent garbage).

#![allow(non_camel_case_types)]

use std::ffi::c_void;

use crate::{ProcBsdInfo, ProcSource, RusageFootprint};

// proc_info.h flavors.
const PROC_PIDTBSDINFO: i32 = 3;
const PROC_PIDTASKINFO: i32 = 4;
/// `PROC_ALL_P` for `proc_listpids`.
const PROC_ALL_P: u32 = 1;
/// `MAXCOMLEN`.
const MAXCOMLEN: usize = 16;

// rusage flavors (libproc.h): RUSAGE_INFO_V0..V6. The vN structs only ever
// APPEND fields, and ri_wired_size / ri_resident_size / ri_phys_footprint
// sit in the v0 prefix, so any flavor that the running kernel accepts yields
// the same three numbers.
const RUSAGE_FLAVORS: [i32; 7] = [6, 5, 4, 3, 2, 1, 0];

pub const RUN_ID_ENV: &str = "PLETHORA_MEMORY_RUN_ID";

extern "C" {
    fn proc_listpids(kind: u32, typeinfo: u32, buffer: *mut c_void, buffersize: i32) -> i32;
    fn proc_pidinfo(pid: i32, flavor: i32, arg: u64, buffer: *mut c_void, buffersize: i32) -> i32;
    fn proc_pid_rusage(pid: i32, flavor: i32, buffer: *mut c_void) -> i32;
    fn proc_pidpath(pid: i32, buffer: *mut c_void, buffersize: u32) -> i32;
    fn sysctlbyname(
        name: *const u8,
        oldp: *mut c_void,
        oldlenp: *mut usize,
        newp: *mut c_void,
        newlen: usize,
    ) -> i32;
}

/// `struct proc_bsdinfo` (sys/proc_info.h) — transcribed from the SDK header;
/// the runtime test below validates `proc_pidinfo`'s returned byte count
/// against `size_of` so layout drift fails loudly instead of silently.
#[repr(C)]
struct ProcBsdInfoRaw {
    pbi_flags: u32,
    pbi_status: u32,
    pbi_xstatus: u32,
    pbi_pid: u32,
    pbi_ppid: u32,
    pbi_uid: u32,
    pbi_gid: u32,
    pbi_ruid: u32,
    pbi_rgid: u32,
    pbi_svuid: u32,
    pbi_svgid: u32,
    rfu_1: u32,
    pbi_comm: [u8; MAXCOMLEN],
    pbi_name: [u8; 2 * MAXCOMLEN],
    pbi_nfiles: u32,
    pbi_pgid: u32,
    pbi_pjobc: u32,
    e_tdev: u32,
    e_tpgid: u32,
    pbi_nice: i32,
    pbi_start_tvsec: u64,
    pbi_start_tvusec: u64,
}

/// `struct proc_task_info` — only the leading virtual size is read.
#[repr(C)]
struct ProcTaskInfoRaw {
    pti_virtual_size: u64,
    pti_resident_size: u64,
}

/// Stable prefix of every `rusage_info_vN` (identical fields across
/// versions): uuid[16] then u64 fields — user_time, system_time,
/// pkg_idle_wkups, interrupt_wkups, pageins, wired_size, resident_size,
/// phys_footprint at offset 72. Sized for the largest version (v6).
struct RusagePrefixRaw {
    buf: [u8; 1024],
}

fn cstr_at(buf: &[u8]) -> String {
    let end = buf.iter().position(|&b| b == 0).unwrap_or(buf.len());
    String::from_utf8_lossy(&buf[..end]).into_owned()
}

fn read_u64(buf: &[u8], offset: usize) -> u64 {
    let mut bytes = [0u8; 8];
    bytes.copy_from_slice(&buf[offset..offset + 8]);
    u64::from_ne_bytes(bytes)
}

/// The libSystem-backed implementation of the [`ProcSource`] seam.
pub struct SysProcSource;

impl ProcSource for SysProcSource {
    fn list_pids(&mut self) -> std::io::Result<Vec<u32>> {
        // Start generous (4 Ki pids) and grow if the system is bigger.
        let mut capacity = 4096usize;
        loop {
            let mut buffer = vec![0u8; capacity * 4];
            let written = unsafe {
                proc_listpids(
                    PROC_ALL_P,
                    0,
                    buffer.as_mut_ptr() as *mut c_void,
                    (capacity * 4) as i32,
                )
            };
            if written < 0 {
                return Err(std::io::Error::last_os_error());
            }
            if written as usize == capacity * 4 {
                capacity *= 2; // buffer was exactly full — retry larger
                continue;
            }
            let count = written as usize / 4;
            let mut pids = Vec::with_capacity(count);
            for i in 0..count {
                let mut bytes = [0u8; 4];
                bytes.copy_from_slice(&buffer[i * 4..i * 4 + 4]);
                let pid = u32::from_ne_bytes(bytes);
                if pid != 0 {
                    pids.push(pid);
                }
            }
            return Ok(pids);
        }
    }

    fn bsd_info(&mut self, pid: u32) -> Option<ProcBsdInfo> {
        let mut raw = ProcBsdInfoRaw {
            pbi_flags: 0,
            pbi_status: 0,
            pbi_xstatus: 0,
            pbi_pid: 0,
            pbi_ppid: 0,
            pbi_uid: 0,
            pbi_gid: 0,
            pbi_ruid: 0,
            pbi_rgid: 0,
            pbi_svuid: 0,
            pbi_svgid: 0,
            rfu_1: 0,
            pbi_comm: [0; MAXCOMLEN],
            pbi_name: [0; 2 * MAXCOMLEN],
            pbi_nfiles: 0,
            pbi_pgid: 0,
            pbi_pjobc: 0,
            e_tdev: 0,
            e_tpgid: 0,
            pbi_nice: 0,
            pbi_start_tvsec: 0,
            pbi_start_tvusec: 0,
        };
        let size = std::mem::size_of::<ProcBsdInfoRaw>();
        let written = unsafe {
            proc_pidinfo(
                pid as i32,
                PROC_PIDTBSDINFO,
                0,
                &mut raw as *mut ProcBsdInfoRaw as *mut c_void,
                size as i32,
            )
        };
        if written != size as i32 {
            return None; // exited, or layout drift — either way, absent
        }
        if raw.pbi_pid != pid {
            return None; // pid recycled mid-read; treat as absent
        }
        Some(ProcBsdInfo {
            pid: raw.pbi_pid,
            ppid: raw.pbi_ppid,
            comm: cstr_at(&raw.pbi_comm),
            name: cstr_at(&raw.pbi_name),
        })
    }

    fn rusage(&mut self, pid: u32) -> Option<RusageFootprint> {
        let mut raw = RusagePrefixRaw { buf: [0u8; 1024] };
        for flavor in RUSAGE_FLAVORS {
            let rc = unsafe {
                proc_pid_rusage(pid as i32, flavor, raw.buf.as_mut_ptr() as *mut c_void)
            };
            if rc == 0 {
                return Some(RusageFootprint {
                    // rusage_info_vN prefix (identical across versions):
                    // uuid[16], then u64 fields: user_time, system_time,
                    // pkg_idle_wkups, interrupt_wkups, pageins, wired_size,
                    // resident_size, phys_footprint.
                    wired_size: read_u64(&raw.buf, 16 + 5 * 8),
                    resident_size: read_u64(&raw.buf, 16 + 6 * 8),
                    phys_footprint: read_u64(&raw.buf, 16 + 7 * 8),
                });
            }
            // ENOTSUP/EINVAL → try the next older flavor; EPERM/ESRCH → absent.
            let err = std::io::Error::last_os_error().raw_os_error().unwrap_or(0);
            if err != 48 && err != 22 {
                return None;
            }
        }
        None
    }

    fn virtual_size(&mut self, pid: u32) -> Option<u64> {
        let mut raw = ProcTaskInfoRaw {
            pti_virtual_size: 0,
            pti_resident_size: 0,
        };
        let size = std::mem::size_of::<ProcTaskInfoRaw>();
        let written = unsafe {
            proc_pidinfo(
                pid as i32,
                PROC_PIDTASKINFO,
                0,
                &mut raw as *mut ProcTaskInfoRaw as *mut c_void,
                size as i32,
            )
        };
        if written <= 0 {
            return None;
        }
        Some(raw.pti_virtual_size)
    }

    fn executable_path(&mut self, pid: u32) -> Option<String> {
        let mut buffer = [0u8; proc_pidpath_max_plus_one()];
        let len = unsafe { proc_pidpath(pid as i32, buffer.as_mut_ptr() as *mut c_void, buffer.len() as u32 - 1) };
        if len <= 0 {
            return None;
        }
        Some(cstr_at(&buffer))
    }

    fn environ_has_marker(&mut self, pid: u32, marker: &str) -> Option<bool> {
        let name = format!("kern.procargs2.{pid}\0");
        let mut len = 0usize;
        unsafe {
            if sysctlbyname(name.as_ptr(), std::ptr::null_mut(), &mut len, std::ptr::null_mut(), 0) != 0 {
                return None; // unreadable (permissions) — caller records false
            }
        }
        if len < 4 || len > 1 << 20 {
            return None;
        }
        let mut buf = vec![0u8; len];
        unsafe {
            if sysctlbyname(name.as_ptr(), buf.as_mut_ptr() as *mut c_void, &mut len, std::ptr::null_mut(), 0) != 0 {
                return None;
            }
        }
        buf.truncate(len);
        Some(procargs2_env_has_marker(&buf, marker))
    }
}

const fn proc_pidpath_max_plus_one() -> usize {
    // PROC_PIDPATHINFO_MAXSIZE = 4096 (libproc.h).
    4097
}

/// Parse a `kern.procargs2` blob: `int32 argc`, argv strings, a NUL
/// separator, then `KEY=VALUE` env strings, terminated by an empty string.
fn procargs2_env_has_marker(blob: &[u8], marker: &str) -> bool {
    if blob.len() < 4 {
        return false;
    }
    let argc = u32::from_ne_bytes([blob[0], blob[1], blob[2], blob[3]]) as usize;
    if argc > 4096 {
        return false;
    }
    let mut pos = 4usize;
    let mut next_string = |pos: &mut usize| -> Option<String> {
        if *pos >= blob.len() {
            return None;
        }
        let start = *pos;
        let end = blob[start..].iter().position(|&b| b == 0)? + start;
        *pos = end + 1;
        Some(String::from_utf8_lossy(&blob[start..end]).into_owned())
    };
    for _ in 0..argc {
        if next_string(&mut pos).is_none() {
            return false; // truncated blob — best-effort parse gives up
        }
    }
    // The argv vector terminator: one extra NUL (or an empty string).
    if pos < blob.len() && blob[pos] == 0 {
        pos += 1;
    }
    let needle = format!("{RUN_ID_ENV}={marker}");
    while let Some(entry) = next_string(&mut pos) {
        if entry.is_empty() {
            break;
        }
        if entry == needle {
            return true;
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn procargs2_env_parse_finds_the_marker() {
        let mut blob = vec![0u8; 4];
        blob[0..4].copy_from_slice(&2u32.to_ne_bytes());
        blob.extend_from_slice(b"/bin/app\0");
        blob.extend_from_slice(b"--flag\0");
        blob.push(0); // argv terminator
        blob.extend_from_slice(b"PATH=/usr/bin\0");
        blob.extend_from_slice(b"PLETHORA_MEMORY_RUN_ID=run-42\0");
        blob.extend_from_slice(b"HOME=/Users/x\0");
        blob.push(0);
        assert!(procargs2_env_has_marker(&blob, "run-42"));
        assert!(!procargs2_env_has_marker(&blob, "run-43"));
    }

    #[test]
    fn procargs2_env_parse_without_env_section() {
        let mut blob = vec![0u8; 4];
        blob[0..4].copy_from_slice(&1u32.to_ne_bytes());
        blob.extend_from_slice(b"/bin/app\0");
        assert!(!procargs2_env_has_marker(&blob, "anything"));
    }

    // Runtime layout validation: read our own process.
    #[test]
    #[cfg(target_os = "macos")]
    fn bsd_info_of_self_is_consistent() {
        let mut src = SysProcSource;
        let pid = std::process::id();
        let info = src.bsd_info(pid).expect("own bsd_info readable");
        assert_eq!(info.pid, pid);
        // Self-parenting or a zero ppid means the struct layout drifted.
        assert!(info.ppid > 0 && info.ppid != pid, "ppid {}", info.ppid);
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn rusage_of_self_has_sane_footprint() {
        let mut src = SysProcSource;
        let r = src.rusage(std::process::id()).expect("own rusage readable");
        // A running test process holds at least its binary + stacks.
        assert!(r.phys_footprint > 1024 * 1024, "footprint {}", r.phys_footprint);
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn absent_pid_is_none_everywhere() {
        let mut src = SysProcSource;
        // Pid 0xFFFFFFFF: never valid; kernel reports ESRCH/EINVAL.
        assert!(src.bsd_info(u32::MAX).is_none());
        assert!(src.rusage(u32::MAX).is_none());
    }
}
