use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::time::Duration;

use rand::Rng;

static CONSECUTIVE_FAILURES: AtomicU32 = AtomicU32::new(0);
static NEXT_ATTEMPT_MS: AtomicU64 = AtomicU64::new(0);

pub fn record_success() {
    CONSECUTIVE_FAILURES.store(0, Ordering::Relaxed);
    NEXT_ATTEMPT_MS.store(0, Ordering::Relaxed);
}

pub fn reset_on_network_restore() {
    record_success();
}

pub fn record_failure() -> Duration {
    let failures = CONSECUTIVE_FAILURES.fetch_add(1, Ordering::Relaxed) + 1;
    let base_secs = 2u64.saturating_pow(failures.min(6));
    let jitter_ms = rand::thread_rng().gen_range(0..1500);
    let delay = Duration::from_millis(base_secs.saturating_mul(1000).saturating_add(jitter_ms));
    let next_at = chrono::Utc::now().timestamp_millis() as u64 + delay.as_millis() as u64;
    NEXT_ATTEMPT_MS.store(next_at, Ordering::Relaxed);
    delay
}

pub fn should_attempt_now() -> bool {
    let next_at = NEXT_ATTEMPT_MS.load(Ordering::Relaxed);
    if next_at == 0 {
        return true;
    }
    chrono::Utc::now().timestamp_millis() as u64 >= next_at
}

pub fn consecutive_failures() -> u32 {
    CONSECUTIVE_FAILURES.load(Ordering::Relaxed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backoff_grows_with_failures() {
        record_success();
        let first = record_failure();
        let second = record_failure();
        assert!(second >= first);
        record_success();
        assert!(should_attempt_now());
    }
}
