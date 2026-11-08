use crate::battery::BatteryState;
use crate::models::podcast_ad::PodcastAdSettings;
use serde::{Deserialize, Serialize};

/// Reasons why background podcast ad detection or STT is deferred on mobile devices.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DeferralReason {
    OnBattery,
    LowBattery,
    PowerSaveMode,
    ThermalPressure,
    CriticallyThrottled,
}

impl DeferralReason {
    pub fn as_str(&self) -> &'static str {
        match self {
            DeferralReason::OnBattery => "on_battery",
            DeferralReason::LowBattery => "low_battery",
            DeferralReason::PowerSaveMode => "low_power_mode",
            DeferralReason::ThermalPressure => "thermal_pressure",
            DeferralReason::CriticallyThrottled => "critically_throttled",
        }
    }
}

/// Scheduling constraints matching Android WorkManager (Constraints.Builder)
/// and iOS BGProcessingTaskRequest policies.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobSchedulingConstraint {
    pub requires_charging: bool,
    pub requires_device_idle: bool,
    pub min_battery_level: f32,
    pub allow_power_save: bool,
    pub network_required: bool,
}

impl Default for JobSchedulingConstraint {
    fn default() -> Self {
        Self {
            requires_charging: true,
            requires_device_idle: true,
            min_battery_level: 0.20,
            allow_power_save: false,
            network_required: false,
        }
    }
}

/// Mobile Background Work Scheduler
///
/// Evaluates native platform energy and thermal states to enforce battery saving,
/// idle processing, and thermal throttling before executing heavy audio compute.
pub struct MobileScheduler;

impl MobileScheduler {
    /// Evaluate whether a background podcast ad detection or transcription job
    /// should proceed immediately or be deferred until suitable device conditions exist.
    pub fn evaluate_deferral(
        battery: &BatteryState,
        settings: &PodcastAdSettings,
    ) -> Result<(), DeferralReason> {
        // Critical thermal throttle always halts execution
        if battery.thermal_status == "critical" {
            return Err(DeferralReason::CriticallyThrottled);
        }

        // Severe thermal pressure halts background batches
        if battery.thermal_status == "severe" {
            return Err(DeferralReason::ThermalPressure);
        }

        // Power save mode deferral
        if battery.is_power_save {
            return Err(DeferralReason::PowerSaveMode);
        }

        // Charging-only policy deferral
        if settings.mobile_charging_only && battery.is_present && !battery.is_charging {
            return Err(DeferralReason::OnBattery);
        }

        // Low battery guard (< 20% on battery)
        if battery.is_present && !battery.is_charging && battery.level < 0.20 {
            return Err(DeferralReason::LowBattery);
        }

        Ok(())
    }

    /// Build Android WorkManager constraints matching the user's energy policy.
    pub fn build_work_manager_constraints(settings: &PodcastAdSettings) -> JobSchedulingConstraint {
        JobSchedulingConstraint {
            requires_charging: settings.mobile_charging_only,
            requires_device_idle: true,
            min_battery_level: 0.20,
            allow_power_save: false,
            network_required: false,
        }
    }

    /// Build iOS BGProcessingTaskRequest constraints matching the user's energy policy.
    pub fn build_ios_bg_task_constraints(settings: &PodcastAdSettings) -> JobSchedulingConstraint {
        JobSchedulingConstraint {
            requires_charging: settings.mobile_charging_only,
            requires_device_idle: true,
            min_battery_level: 0.20,
            allow_power_save: false,
            network_required: false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_mobile_scheduler_charging_only_policy() {
        let settings = PodcastAdSettings {
            mobile_charging_only: true,
            ..Default::default()
        };

        // On battery with 80% charge -> deferred (on battery)
        let bat_on_battery = BatteryState {
            is_present: true,
            level: 0.80,
            is_charging: false,
            is_power_save: false,
            thermal_status: "normal".to_string(),
        };
        assert_eq!(
            MobileScheduler::evaluate_deferral(&bat_on_battery, &settings),
            Err(DeferralReason::OnBattery)
        );

        // Plugged in with 80% charge -> allowed
        let bat_charging = BatteryState {
            is_present: true,
            level: 0.80,
            is_charging: true,
            is_power_save: false,
            thermal_status: "normal".to_string(),
        };
        assert_eq!(
            MobileScheduler::evaluate_deferral(&bat_charging, &settings),
            Ok(())
        );
    }

    #[test]
    fn test_mobile_scheduler_low_battery_guard() {
        let settings = PodcastAdSettings {
            mobile_charging_only: false,
            ..Default::default()
        };

        // On battery with 15% charge -> deferred (low battery)
        let bat_low = BatteryState {
            is_present: true,
            level: 0.15,
            is_charging: false,
            is_power_save: false,
            thermal_status: "normal".to_string(),
        };
        assert_eq!(
            MobileScheduler::evaluate_deferral(&bat_low, &settings),
            Err(DeferralReason::LowBattery)
        );

        // On battery with 50% charge -> allowed when charging_only is false
        let bat_mid = BatteryState {
            is_present: true,
            level: 0.50,
            is_charging: false,
            is_power_save: false,
            thermal_status: "normal".to_string(),
        };
        assert_eq!(
            MobileScheduler::evaluate_deferral(&bat_mid, &settings),
            Ok(())
        );
    }

    #[test]
    fn test_mobile_scheduler_power_save_mode() {
        let settings = PodcastAdSettings {
            mobile_charging_only: false,
            ..Default::default()
        };

        let bat_power_save = BatteryState {
            is_present: true,
            level: 0.80,
            is_charging: true,
            is_power_save: true,
            thermal_status: "normal".to_string(),
        };
        assert_eq!(
            MobileScheduler::evaluate_deferral(&bat_power_save, &settings),
            Err(DeferralReason::PowerSaveMode)
        );
    }

    #[test]
    fn test_mobile_scheduler_thermal_pressure() {
        let settings = PodcastAdSettings {
            mobile_charging_only: false,
            ..Default::default()
        };

        // Severe thermal pressure
        let bat_severe = BatteryState {
            is_present: true,
            level: 0.90,
            is_charging: true,
            is_power_save: false,
            thermal_status: "severe".to_string(),
        };
        assert_eq!(
            MobileScheduler::evaluate_deferral(&bat_severe, &settings),
            Err(DeferralReason::ThermalPressure)
        );

        // Critical thermal pressure
        let bat_critical = BatteryState {
            is_present: true,
            level: 0.90,
            is_charging: true,
            is_power_save: false,
            thermal_status: "critical".to_string(),
        };
        assert_eq!(
            MobileScheduler::evaluate_deferral(&bat_critical, &settings),
            Err(DeferralReason::CriticallyThrottled)
        );
    }

    #[test]
    fn test_constraints_builder() {
        let settings = PodcastAdSettings {
            mobile_charging_only: true,
            ..Default::default()
        };
        let wm_constraints = MobileScheduler::build_work_manager_constraints(&settings);
        assert!(wm_constraints.requires_charging);
        assert!(wm_constraints.requires_device_idle);
        assert_eq!(wm_constraints.min_battery_level, 0.20);
        assert!(!wm_constraints.allow_power_save);
    }
}
