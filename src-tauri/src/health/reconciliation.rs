//! Deterministic cross-source sleep deduplication and canonical episode reconciliation.

use std::collections::{HashMap, HashSet};

use super::models::{
    CanonicalSleepEpisode, DuplicateRelationship, HealthProviderId, RawSleepSession,
    SleepEpisodeMember, SleepKind, SleepQualityFlag, SleepStageInterval, SleepStageType,
};
use super::time::compute_anchor_local_date;

/// Cluster overlapping sleep sessions and build canonical episodes without double counting.
pub fn reconcile_sleep_sessions(
    raw_sessions: &[RawSleepSession],
    preferred_order: &[HealthProviderId],
    user_kind_overrides: &HashMap<String, SleepKind>,
) -> Vec<CanonicalSleepEpisode> {
    let active: Vec<&RawSleepSession> = raw_sessions
        .iter()
        .filter(|s| !s.is_deleted && s.end_at_ms > s.start_at_ms)
        .collect();
    if active.is_empty() {
        return Vec::new();
    }

    let mut sorted = active;
    sorted.sort_by(|a, b| {
        a.start_at_ms
            .cmp(&b.start_at_ms)
            .then_with(|| a.end_at_ms.cmp(&b.end_at_ms))
            .then_with(|| a.id.cmp(&b.id))
    });

    // Connected components over overlap equivalence.
    let n = sorted.len();
    let latest_ends: Vec<i64> = sorted
        .iter()
        .scan(i64::MIN, |latest, session| {
            *latest = (*latest).max(session.end_at_ms);
            Some(*latest)
        })
        .collect();
    let mut visited = vec![false; n];
    let mut clusters: Vec<Vec<&RawSleepSession>> = Vec::new();

    for i in 0..n {
        if visited[i] {
            continue;
        }
        visited[i] = true;
        let mut queue = vec![i];
        let mut cluster = Vec::new();
        while let Some(idx) = queue.pop() {
            let candidate = sorted[idx];
            cluster.push(candidate);
            let first = latest_ends.partition_point(|end| *end <= candidate.start_at_ms);
            let last = sorted.partition_point(|other| other.start_at_ms < candidate.end_at_ms);
            for j in first..last {
                if !visited[j] && sessions_represent_same_episode(candidate, sorted[j]) {
                    visited[j] = true;
                    queue.push(j);
                }
            }
        }
        clusters.push(cluster);
    }

    let mut episodes = Vec::with_capacity(clusters.len());
    for mut cluster in clusters {
        cluster.sort_by(|a, b| {
            session_rank_key(a, preferred_order).cmp(&session_rank_key(b, preferred_order))
        });

        let primary = cluster[0];
        let user_override = cluster
            .iter()
            .find_map(|s| user_kind_overrides.get(&s.id).copied());
        let resolved_kind = user_override.unwrap_or(primary.sleep_kind);

        let anchor_local_date = compute_anchor_local_date(
            primary.start_at_ms,
            primary.end_at_ms,
            primary.start_tz_offset_secs,
            primary.end_tz_offset_secs,
            resolved_kind,
        );

        let canonical_id = format!("ep_{}", primary.id);
        let (stage_coverage_ratio, awake_m, light_m, deep_m, rem_m, waso_m) =
            compute_stage_metrics(primary);

        let mut flags = primary.quality_flags.clone();
        if stage_coverage_ratio == 0.0 && primary.stages.is_empty() {
            if !flags.contains(&SleepQualityFlag::MissingStages) {
                flags.push(SleepQualityFlag::MissingStages);
            }
        } else if stage_coverage_ratio > 0.0 && stage_coverage_ratio < 0.70 {
            if !flags.contains(&SleepQualityFlag::PartialStages) {
                flags.push(SleepQualityFlag::PartialStages);
            }
        }

        let mut members = Vec::with_capacity(cluster.len());
        let mut max_diff_mins: f64 = 0.0;
        let mut has_conflict = false;

        for (idx, sess) in cluster.iter().enumerate() {
            let relationship = if idx == 0 {
                DuplicateRelationship::Primary
            } else if is_same_source_export_duplicate(primary, sess) {
                DuplicateRelationship::SameSourceExportDuplicate
            } else {
                let diff = (sess.duration_mins - primary.duration_mins).abs();
                if diff > 30.0 {
                    has_conflict = true;
                }
                if diff > max_diff_mins {
                    max_diff_mins = diff;
                }
                DuplicateRelationship::IndependentDeviceObservation
            };
            members.push(SleepEpisodeMember {
                canonical_episode_id: canonical_id.clone(),
                raw_session_id: sess.id.clone(),
                provider_id: sess.provider_id,
                source_app_bundle: sess.source_app_bundle.clone(),
                duration_mins: sess.duration_mins,
                relationship,
                priority_rank: idx as i32,
            });
        }

        if has_conflict && !flags.contains(&SleepQualityFlag::SourceConflict) {
            flags.push(SleepQualityFlag::SourceConflict);
        }

        let total_sleep_mins = compute_total_sleep_mins(primary);

        episodes.push(CanonicalSleepEpisode {
            id: canonical_id,
            primary_raw_session_id: primary.id.clone(),
            primary_provider_id: primary.provider_id,
            start_at_ms: primary.start_at_ms,
            end_at_ms: primary.end_at_ms,
            start_tz_offset_secs: primary.start_tz_offset_secs,
            end_tz_offset_secs: primary.end_tz_offset_secs,
            anchor_local_date,
            sleep_kind: resolved_kind,
            user_sleep_kind_override: user_override,
            total_sleep_mins,
            time_in_bed_mins: primary.time_in_bed_mins,
            sleep_efficiency_pct: primary.sleep_efficiency_pct,
            waso_mins: waso_m,
            stage_coverage_ratio,
            awake_mins: awake_m,
            light_mins: light_m,
            deep_mins: deep_m,
            rem_mins: rem_m,
            has_source_conflict: has_conflict,
            conflict_duration_diff_mins: if has_conflict {
                Some(max_diff_mins)
            } else {
                None
            },
            quality_flags: flags,
            is_synthetic: primary.is_synthetic,
            stages: primary.stages.clone(),
            members,
        });
    }

    let kinds: Vec<_> = episodes
        .iter()
        .map(|episode| super::sleep_analytics::classify_sleep_kind(episode, &episodes))
        .collect();
    for (episode, kind) in episodes.iter_mut().zip(kinds) {
        episode.sleep_kind = kind;
        episode.anchor_local_date = compute_anchor_local_date(
            episode.start_at_ms,
            episode.end_at_ms,
            episode.start_tz_offset_secs,
            episode.end_tz_offset_secs,
            kind,
        );
    }
    episodes.sort_by_key(|episode| episode.start_at_ms);
    episodes
}

fn sessions_represent_same_episode(a: &RawSleepSession, b: &RawSleepSession) -> bool {
    if a.is_synthetic != b.is_synthetic {
        return false;
    }
    let overlap_start = a.start_at_ms.max(b.start_at_ms);
    let overlap_end = a.end_at_ms.min(b.end_at_ms);
    if overlap_end <= overlap_start {
        return false;
    }
    let intersection = (overlap_end - overlap_start) as f64;
    let len_a = (a.end_at_ms - a.start_at_ms) as f64;
    let len_b = (b.end_at_ms - b.start_at_ms) as f64;
    let union = len_a + len_b - intersection;
    let iou = if union > 0.0 {
        intersection / union
    } else {
        0.0
    };
    let containment = intersection / len_a.min(len_b).max(1.0);
    let boundary_close = (a.start_at_ms - b.start_at_ms).abs() <= 15 * 60_000
        && (a.end_at_ms - b.end_at_ms).abs() <= 15 * 60_000;

    iou >= 0.50 || containment >= 0.65 || boundary_close
}

fn session_rank_key(
    s: &RawSleepSession,
    preferred_order: &[HealthProviderId],
) -> (usize, u8, u8, i64, String) {
    let pref_idx = preferred_order
        .iter()
        .position(|p| *p == s.provider_id)
        .unwrap_or_else(|| 100 + s.provider_id.default_priority_rank());
    let aggregator_penalty = if s.provider_id.is_aggregator_hub() {
        1
    } else {
        0
    };
    let has_specific_stages = s
        .stages
        .iter()
        .any(|st| st.stage_type.is_specific_sleep_stage())
        || (s.light_mins.unwrap_or(0.0) + s.deep_mins.unwrap_or(0.0) + s.rem_mins.unwrap_or(0.0))
            > 0.0;
    let stage_penalty = if has_specific_stages { 0 } else { 1 };
    let quality_bucket = (-s.quality_score * 1000.0).round() as i64;
    (
        pref_idx,
        aggregator_penalty,
        stage_penalty,
        quality_bucket,
        s.id.clone(),
    )
}

fn is_same_source_export_duplicate(primary: &RawSleepSession, candidate: &RawSleepSession) -> bool {
    if primary.provider_id == candidate.provider_id {
        return true;
    }
    let start_diff = (primary.start_at_ms - candidate.start_at_ms).abs();
    let end_diff = (primary.end_at_ms - candidate.end_at_ms).abs();
    let near_identical_bounds = start_diff <= 120_000 && end_diff <= 120_000;

    if let Some(bundle) = candidate.source_app_bundle.as_deref() {
        let lower = bundle.to_ascii_lowercase();
        let matching_vendor_bundle = match primary.provider_id {
            HealthProviderId::Oura => lower.contains("oura"),
            HealthProviderId::Whoop => lower.contains("whoop"),
            HealthProviderId::Garmin => lower.contains("garmin"),
            HealthProviderId::Polar => lower.contains("polar"),
            HealthProviderId::Withings => lower.contains("withings"),
            HealthProviderId::Suunto => lower.contains("suunto"),
            HealthProviderId::Ultrahuman => lower.contains("ultrahuman"),
            HealthProviderId::Ringconn => lower.contains("ringconn"),
            HealthProviderId::GoogleHealth => lower.contains("fitbit") || lower.contains("google"),
            _ => false,
        };
        if matching_vendor_bundle && (near_identical_bounds || start_diff <= 600_000) {
            return true;
        }
    }

    if let Some(bundle) = primary.source_app_bundle.as_deref() {
        let lower = bundle.to_ascii_lowercase();
        if candidate.provider_id == HealthProviderId::Oura && lower.contains("oura") {
            return true;
        }
        if candidate.provider_id == HealthProviderId::Whoop && lower.contains("whoop") {
            return true;
        }
    }

    near_identical_bounds
        && (primary.device_id.is_some() && primary.device_id == candidate.device_id)
}

fn compute_total_sleep_mins(primary: &RawSleepSession) -> f64 {
    if !primary.stages.is_empty() {
        let staged_asleep_ms: i64 = primary
            .stages
            .iter()
            .filter(|s| s.stage_type.counts_as_asleep() && s.end_at_ms > s.start_at_ms)
            .map(|s| s.end_at_ms - s.start_at_ms)
            .sum();
        if staged_asleep_ms > 0 {
            return staged_asleep_ms as f64 / 60_000.0;
        }
    }
    primary.duration_mins
}

fn compute_stage_metrics(
    primary: &RawSleepSession,
) -> (
    f64,
    Option<f64>,
    Option<f64>,
    Option<f64>,
    Option<f64>,
    Option<f64>,
) {
    if !primary.stages.is_empty() {
        let mut awake_ms = 0_i64;
        let mut light_ms = 0_i64;
        let mut deep_ms = 0_i64;
        let mut rem_ms = 0_i64;
        let mut unknown_asleep_ms = 0_i64;
        let mut first_asleep_ms: Option<i64> = None;
        let mut last_asleep_ms: Option<i64> = None;

        for st in &primary.stages {
            if st.end_at_ms <= st.start_at_ms {
                continue;
            }
            let dur = st.end_at_ms - st.start_at_ms;
            match st.stage_type {
                SleepStageType::Awake => awake_ms += dur,
                SleepStageType::Light => light_ms += dur,
                SleepStageType::Deep => deep_ms += dur,
                SleepStageType::Rem => rem_ms += dur,
                SleepStageType::AsleepUnknown => unknown_asleep_ms += dur,
                SleepStageType::InBed | SleepStageType::Unknown => {}
            }
            if st.stage_type.counts_as_asleep() {
                first_asleep_ms =
                    Some(first_asleep_ms.map_or(st.start_at_ms, |v| v.min(st.start_at_ms)));
                last_asleep_ms = Some(last_asleep_ms.map_or(st.end_at_ms, |v| v.max(st.end_at_ms)));
            }
        }

        let specific_ms = light_ms + deep_ms + rem_ms;
        let total_asleep_ms = specific_ms + unknown_asleep_ms;
        let denom = total_asleep_ms.max(1) as f64;
        let coverage = if specific_ms > 0 {
            (specific_ms as f64 / denom).clamp(0.0, 1.0)
        } else {
            0.0
        };

        let waso_mins = if let (Some(fa), Some(la)) = (first_asleep_ms, last_asleep_ms) {
            let mut waso_ms = 0_i64;
            for st in &primary.stages {
                if st.stage_type == SleepStageType::Awake
                    && st.start_at_ms >= fa
                    && st.end_at_ms <= la
                {
                    waso_ms += st.end_at_ms - st.start_at_ms;
                }
            }
            Some(waso_ms as f64 / 60_000.0)
        } else {
            None
        };

        if coverage > 0.0 {
            return (
                coverage,
                Some(awake_ms as f64 / 60_000.0),
                Some(light_ms as f64 / 60_000.0),
                Some(deep_ms as f64 / 60_000.0),
                Some(rem_ms as f64 / 60_000.0),
                waso_mins,
            );
        }
        return (0.0, None, None, None, None, waso_mins);
    }

    // Aggregate-stage summary providers (e.g., WHOOP stage_summary)
    let specific_agg = primary.light_mins.unwrap_or(0.0)
        + primary.deep_mins.unwrap_or(0.0)
        + primary.rem_mins.unwrap_or(0.0);
    if specific_agg > 0.0 && primary.duration_mins > 0.0 {
        let coverage = (specific_agg / primary.duration_mins).clamp(0.0, 1.0);
        return (
            coverage,
            primary.awake_mins,
            primary.light_mins,
            primary.deep_mins,
            primary.rem_mins,
            primary.awake_mins,
        );
    }

    (0.0, None, None, None, None, None)
}

/// Merge overlapping stage intervals cleanly when grouping Apple Health samples.
pub fn normalize_stage_intervals(
    mut intervals: Vec<SleepStageInterval>,
) -> Vec<SleepStageInterval> {
    intervals.retain(|i| i.end_at_ms > i.start_at_ms);
    intervals.sort_by(|a, b| a.start_at_ms.cmp(&b.start_at_ms));
    let mut seen: HashSet<(i64, i64, &'static str)> = HashSet::new();
    intervals
        .into_iter()
        .filter(|i| seen.insert((i.start_at_ms, i.end_at_ms, i.stage_type.as_str())))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::health::time::parse_timestamp_with_offset;

    fn mk_session(
        id: &str,
        provider: HealthProviderId,
        start: &str,
        end: &str,
        bundle: Option<&str>,
        with_stages: bool,
    ) -> RawSleepSession {
        let (s_ms, s_off) = parse_timestamp_with_offset(start).unwrap();
        let (e_ms, e_off) = parse_timestamp_with_offset(end).unwrap();
        let dur = (e_ms - s_ms) as f64 / 60_000.0;
        let stages = if with_stages {
            let mid = s_ms + (e_ms - s_ms) / 2;
            vec![
                SleepStageInterval {
                    id: format!("{id}_st1"),
                    raw_session_id: id.to_string(),
                    stage_type: SleepStageType::Light,
                    start_at_ms: s_ms,
                    end_at_ms: mid,
                    provider_stage_code: Some("2".into()),
                },
                SleepStageInterval {
                    id: format!("{id}_st2"),
                    raw_session_id: id.to_string(),
                    stage_type: SleepStageType::Deep,
                    start_at_ms: mid,
                    end_at_ms: e_ms,
                    provider_stage_code: Some("3".into()),
                },
            ]
        } else {
            Vec::new()
        };
        RawSleepSession {
            id: id.to_string(),
            provider_id: provider,
            device_id: None,
            external_record_id: id.to_string(),
            source_app_bundle: bundle.map(str::to_string),
            start_at_ms: s_ms,
            end_at_ms: e_ms,
            start_tz_offset_secs: s_off,
            end_tz_offset_secs: e_off,
            duration_mins: dur,
            time_in_bed_mins: Some(dur),
            sleep_efficiency_pct: Some(95.0),
            awake_mins: None,
            light_mins: None,
            deep_mins: None,
            rem_mins: None,
            sleep_kind: SleepKind::MainSleep,
            provider_sleep_kind: None,
            quality_flags: Vec::new(),
            quality_score: 1.0,
            notes: None,
            subjective_quality: None,
            acquisition_at_ms: e_ms,
            sync_batch_id: None,
            is_deleted: false,
            is_synthetic: false,
            stages,
        }
    }

    #[test]
    fn deduplicates_direct_oura_and_apple_health_mirror() {
        let direct = mk_session(
            "oura_1",
            HealthProviderId::Oura,
            "2026-11-18T23:00:00Z",
            "2026-11-19T07:00:00Z",
            None,
            true,
        );
        let mirror = mk_session(
            "hk_1",
            HealthProviderId::AppleHealthkit,
            "2026-11-18T23:01:00Z",
            "2026-11-19T07:00:00Z",
            Some("com.ouraring.oura"),
            false,
        );
        let eps = reconcile_sleep_sessions(&[mirror, direct], &[], &HashMap::new());
        assert_eq!(eps.len(), 1);
        assert_eq!(eps[0].primary_provider_id, HealthProviderId::Oura);
        assert!((eps[0].total_sleep_mins - 480.0).abs() < 1e-6);
        assert!(!eps[0].has_source_conflict);
        assert_eq!(eps[0].members.len(), 2);
        assert_eq!(
            eps[0].members[1].relationship,
            DuplicateRelationship::SameSourceExportDuplicate
        );
    }

    #[test]
    fn flags_competing_devices_and_honors_user_preference() {
        let oura = mk_session(
            "oura_1",
            HealthProviderId::Oura,
            "2026-11-18T23:00:00Z",
            "2026-11-19T07:00:00Z",
            None,
            true,
        );
        let watch = mk_session(
            "watch_1",
            HealthProviderId::AppleHealthkit,
            "2026-11-18T23:45:00Z",
            "2026-11-19T06:50:00Z",
            Some("com.apple.health.watch"),
            true,
        );
        // Default: Oura preferred over Apple HealthKit
        let eps = reconcile_sleep_sessions(&[watch.clone(), oura.clone()], &[], &HashMap::new());
        assert_eq!(eps.len(), 1);
        assert_eq!(eps[0].primary_provider_id, HealthProviderId::Oura);
        assert!(eps[0].has_source_conflict);
        assert_eq!(
            eps[0].members[1].relationship,
            DuplicateRelationship::IndependentDeviceObservation
        );

        // User reverses preference to Apple HealthKit first
        let eps_pref = reconcile_sleep_sessions(
            &[watch, oura],
            &[HealthProviderId::AppleHealthkit, HealthProviderId::Oura],
            &HashMap::new(),
        );
        assert_eq!(
            eps_pref[0].primary_provider_id,
            HealthProviderId::AppleHealthkit
        );
    }
}
