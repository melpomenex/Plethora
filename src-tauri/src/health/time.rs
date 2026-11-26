//! Timezone, DST-safe instant duration, and biological wake-date anchor helpers.

use chrono::{DateTime, FixedOffset, NaiveDate, NaiveDateTime, Timelike, Utc};

use super::models::SleepKind;

pub const MIN_PLAUSIBLE_SLEEP_MINS: f64 = 15.0;
pub const MAX_PLAUSIBLE_SLEEP_MINS: f64 = 18.0 * 60.0;

/// Parse an ISO 8601 / RFC 3339 timestamp and return `(utc_ms, Option<tz_offset_secs>)`.
pub fn parse_timestamp_with_offset(raw: &str) -> Result<(i64, Option<i32>), String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("Empty timestamp".to_string());
    }
    if let Ok(dt) = DateTime::parse_from_rfc3339(trimmed) {
        let offset = dt.offset().local_minus_utc();
        return Ok((dt.timestamp_millis(), Some(offset)));
    }
    for fmt in [
        "%Y-%m-%d %H:%M:%S %z",
        "%Y-%m-%d %H:%M:%S%z",
        "%Y-%m-%dT%H:%M:%S%z",
        "%Y-%m-%dT%H:%M:%S%.f%z",
        "%Y-%m-%dT%H:%M:%S%.f",
        "%Y-%m-%d %H:%M:%S%.f",
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%d %H:%M",
        "%Y-%m-%dT%H:%M",
    ] {
        if let Ok(dt) = DateTime::parse_from_str(trimmed, fmt) {
            let offset = dt.offset().local_minus_utc();
            return Ok((dt.timestamp_millis(), Some(offset)));
        }
        if let Ok(naive) = NaiveDateTime::parse_from_str(trimmed, fmt) {
            let utc = DateTime::<Utc>::from_naive_utc_and_offset(naive, Utc);
            return Ok((utc.timestamp_millis(), None));
        }
    }
    Err(format!("Unrecognized timestamp format: {trimmed}"))
}

/// Parse an explicit UTC offset string like `"-04:00"`, `"+02:00"`, `"-14400s"`, or `"Z"`.
pub fn parse_utc_offset_secs(raw: &str) -> Option<i32> {
    let trimmed = raw.trim();
    if trimmed.eq_ignore_ascii_case("z") {
        return Some(0);
    }
    if let Some(secs_str) = trimmed.strip_suffix('s') {
        if let Ok(secs) = secs_str.parse::<i32>() {
            return Some(secs);
        }
    }
    let sign = if let Some(rest) = trimmed.strip_prefix('-') {
        let _ = rest;
        -1
    } else if trimmed.starts_with('+') {
        1
    } else {
        return None;
    };
    let body = &trimmed[1..];
    let (h_str, m_str) = if let Some((h, m)) = body.split_once(':') {
        (h, m)
    } else if body.len() == 4 {
        (&body[0..2], &body[2..4])
    } else {
        return None;
    };
    let hours: i32 = h_str.parse().ok()?;
    let mins: i32 = m_str.parse().ok()?;
    if hours > 18 || mins >= 60 {
        return None;
    }
    Some(sign * (hours * 3600 + mins * 60))
}

/// Compute exact elapsed duration in minutes using UTC epoch milliseconds.
pub fn elapsed_minutes(start_at_ms: i64, end_at_ms: i64) -> Result<f64, String> {
    end_at_ms
        .checked_sub(start_at_ms)
        .filter(|ms| *ms > 0)
        .map(|ms| ms as f64 / 60_000.0)
        .ok_or_else(|| "Sleep end timestamp must be after start and within range".to_owned())
}

pub fn is_plausible_sleep_duration(duration_mins: f64) -> bool {
    duration_mins.is_finite()
        && duration_mins >= MIN_PLAUSIBLE_SLEEP_MINS
        && duration_mins <= MAX_PLAUSIBLE_SLEEP_MINS
}

/// Convert epoch ms + offset seconds to a local `DateTime<FixedOffset>`.
pub fn to_local_datetime(utc_ms: i64, tz_offset_secs: Option<i32>) -> DateTime<FixedOffset> {
    let offset = FixedOffset::east_opt(tz_offset_secs.unwrap_or(0).clamp(-64_800, 64_800))
        .unwrap_or_else(|| FixedOffset::east_opt(0).unwrap());
    let dt = DateTime::<Utc>::from_timestamp_millis(utc_ms).unwrap_or_else(Utc::now);
    dt.with_timezone(&offset)
}

/// Format epoch ms into `YYYY-MM-DD` in the given offset.
pub fn local_date_string(utc_ms: i64, tz_offset_secs: Option<i32>) -> String {
    to_local_datetime(utc_ms, tz_offset_secs)
        .date_naive()
        .format("%Y-%m-%d")
        .to_string()
}

/// Compute biological anchor calendar date (`YYYY-MM-DD`):
/// - Main sleep (and unknown primary episodes >= 3h) anchor to local wake date (`end_at_ms + end_tz_offset`).
/// - Naps anchor to local start date (`start_at_ms + start_tz_offset`).
pub fn compute_anchor_local_date(
    start_at_ms: i64,
    end_at_ms: i64,
    start_tz_offset_secs: Option<i32>,
    end_tz_offset_secs: Option<i32>,
    sleep_kind: SleepKind,
) -> String {
    match sleep_kind {
        SleepKind::Nap => {
            local_date_string(start_at_ms, start_tz_offset_secs.or(end_tz_offset_secs))
        }
        SleepKind::MainSleep | SleepKind::Unknown => {
            local_date_string(end_at_ms, end_tz_offset_secs.or(start_tz_offset_secs))
        }
    }
}

/// Minutes since local midnight in `[0.0, 1440.0)`.
pub fn local_minutes_of_day(utc_ms: i64, tz_offset_secs: Option<i32>) -> f64 {
    let local = to_local_datetime(utc_ms, tz_offset_secs);
    let secs = local.num_seconds_from_midnight() as f64;
    secs / 60.0
}

pub fn parse_naive_date(date_str: &str) -> Option<NaiveDate> {
    NaiveDate::parse_from_str(date_str.trim(), "%Y-%m-%d").ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dst_spring_forward_elapsed_minutes_is_exact() {
        // 2026-03-08 23:00-05:00 -> 2026-03-09 07:00-04:00? Wait: US DST springs forward at 2am on Mar 8:
        // 2026-03-07T23:00:00-05:00 to 2026-03-08T07:00:00-04:00 is 7 hours (420 min), not 8 hours!
        let (start_ms, start_off) =
            parse_timestamp_with_offset("2026-03-07T23:00:00-05:00").unwrap();
        let (end_ms, end_off) = parse_timestamp_with_offset("2026-03-08T07:00:00-04:00").unwrap();
        let mins = elapsed_minutes(start_ms, end_ms).unwrap();
        assert!((mins - 420.0).abs() < 1e-6);
        assert_eq!(start_off, Some(-18000));
        assert_eq!(end_off, Some(-14400));
        assert_eq!(
            compute_anchor_local_date(start_ms, end_ms, start_off, end_off, SleepKind::MainSleep),
            "2026-03-08"
        );
    }

    #[test]
    fn midnight_crossing_main_sleep_anchors_to_wake_date() {
        let (start_ms, start_off) =
            parse_timestamp_with_offset("2026-11-19T23:30:00-05:00").unwrap();
        let (end_ms, end_off) = parse_timestamp_with_offset("2026-11-20T07:15:00-05:00").unwrap();
        assert_eq!(
            compute_anchor_local_date(start_ms, end_ms, start_off, end_off, SleepKind::MainSleep),
            "2026-11-20"
        );
    }

    #[test]
    fn nap_anchors_to_start_date() {
        let (start_ms, start_off) =
            parse_timestamp_with_offset("2026-11-20T14:00:00-05:00").unwrap();
        let (end_ms, end_off) = parse_timestamp_with_offset("2026-11-20T14:40:00-05:00").unwrap();
        assert_eq!(
            compute_anchor_local_date(start_ms, end_ms, start_off, end_off, SleepKind::Nap),
            "2026-11-20"
        );
    }

    #[test]
    fn rejects_inverted_boundaries() {
        let (start_ms, _) = parse_timestamp_with_offset("2026-11-20T07:00:00Z").unwrap();
        let (end_ms, _) = parse_timestamp_with_offset("2026-11-20T06:00:00Z").unwrap();
        assert!(elapsed_minutes(start_ms, end_ms).is_err());
    }
}
