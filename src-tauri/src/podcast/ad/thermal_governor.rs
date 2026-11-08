use crate::battery::{get_cached_thermal_status, is_critically_throttled, is_thermal_throttled};
use std::time::Duration;

/// Action to take based on device thermal pressure and platform constraints.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ThermalDecision {
    /// Proceed with processing at the given worker concurrency.
    Proceed { max_threads: usize },
    /// Device is warm (SEVERE); pause processing for the specified duration and drop to 1 thread.
    Throttle { pause_duration: Duration, max_threads: usize },
    /// Device is overheating (CRITICAL); immediately halt, persist partial progress, and defer.
    AbortAndDefer { reason: &'static str },
}

/// Dynamic Concurrency & Thermal Governor for podcast processing and STT
pub struct ThermalGovernor {
    pub is_mobile: bool,
}

impl ThermalGovernor {
    pub fn new(is_mobile: bool) -> Self {
        Self { is_mobile }
    }

    /// Determine maximum worker threads based on mobile profile and current thermal status.
    pub fn determine_max_worker_threads(&self, thermal_status: &str) -> usize {
        if self.is_mobile {
            match thermal_status.to_lowercase().as_str() {
                "critical" => 0,
                "severe" | "moderate" => 1,
                _ => 2, // Max 2 threads on mobile to preserve UI responsiveness
            }
        } else {
            let cores = std::thread::available_parallelism()
                .map(|p| p.get())
                .unwrap_or(4);
            match thermal_status.to_lowercase().as_str() {
                "critical" => 0,
                "severe" => 1,
                "moderate" => cores.min(2),
                _ => cores,
            }
        }
    }

    /// Evaluate current thermal status from system telemetry.
    pub fn evaluate(&self) -> ThermalDecision {
        let status = get_cached_thermal_status();
        self.evaluate_status(status)
    }

    /// Evaluate a given thermal status string.
    pub fn evaluate_status(&self, status: &str) -> ThermalDecision {
        let max_threads = self.determine_max_worker_threads(status);

        match status.to_lowercase().as_str() {
            "critical" => ThermalDecision::AbortAndDefer {
                reason: "thermal_critical",
            },
            "severe" => ThermalDecision::Throttle {
                pause_duration: Duration::from_secs(30),
                max_threads: 1,
            },
            _ => ThermalDecision::Proceed { max_threads },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_mobile_thread_limits() {
        let mobile_gov = ThermalGovernor::new(true);
        // Mobile is capped at 2 threads under normal conditions
        assert_eq!(mobile_gov.determine_max_worker_threads("normal"), 2);
        assert_eq!(mobile_gov.determine_max_worker_threads("light"), 2);
        // Drops to 1 under moderate and severe conditions
        assert_eq!(mobile_gov.determine_max_worker_threads("moderate"), 1);
        assert_eq!(mobile_gov.determine_max_worker_threads("severe"), 1);
        // Drops to 0 under critical
        assert_eq!(mobile_gov.determine_max_worker_threads("critical"), 0);
    }

    #[test]
    fn test_thermal_decisions() {
        let gov = ThermalGovernor::new(true);

        // Normal -> Proceed with 2 threads
        assert_eq!(
            gov.evaluate_status("normal"),
            ThermalDecision::Proceed { max_threads: 2 }
        );

        // Severe -> Throttle with 30s pause and drop to 1 thread
        assert_eq!(
            gov.evaluate_status("severe"),
            ThermalDecision::Throttle {
                pause_duration: Duration::from_secs(30),
                max_threads: 1
            }
        );

        // Critical -> Abort and defer
        assert_eq!(
            gov.evaluate_status("critical"),
            ThermalDecision::AbortAndDefer {
                reason: "thermal_critical"
            }
        );
    }
}
