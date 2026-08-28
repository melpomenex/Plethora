use crate::battery::BatteryState;
use crate::entitlements::{CapabilityId, EntitlementCache};

const LOW_BATTERY_THRESHOLD: f32 = 0.20;

pub fn cloud_sync_enabled(cache: &EntitlementCache) -> bool {
    cache.is_enabled(CapabilityId::CloudSync)
}

pub fn bulk_lane_allowed(battery: &BatteryState, wifi_only: bool, on_wifi: bool) -> bool {
    if wifi_only && !on_wifi {
        return false;
    }
    if battery.is_present && !battery.is_charging && battery.level < LOW_BATTERY_THRESHOLD {
        return false;
    }
    true
}

pub fn fast_lane_allowed(_battery: &BatteryState) -> bool {
    true
}
