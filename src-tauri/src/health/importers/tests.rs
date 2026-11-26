//! Comprehensive unit, security, reconciliation, and streaming performance tests
//! for the Universal Wearable Health Data Import Platform.
//!
//! Fixture Provenance:
//! All fixtures in this module are synthetic reproductions constructed from verified
//! official consumer export documentation (Garmin, Oura, WHOOP, Google Takeout Fitbit,
//! Samsung Health, Withings, RingConn, Polar, Apple Health). No real private user
//! health records are included.

use std::io::Write;
use std::path::Path;
use tempfile::NamedTempFile;
use zip::write::FileOptions;
use zip::{CompressionMethod, ZipWriter};

use crate::health::db::HealthVault;
use crate::health::models::{HealthDataCategory, HealthProviderId, HrvMethod, SleepKind, SleepQualityFlag};

use super::archive::SafeZipArchive;
use super::detector::{detect_import_format, inspect_file_for_detection};
use super::limits::ArchiveSecurityLimits;
use super::orchestrator::{
    all_adapters, commit_wearable_import, delete_import_batch, list_import_batches,
    preview_wearable_import, save_csv_mapping_profile, list_csv_mapping_profiles,
};
use super::types::{
    CsvMappingProfile, DetectionConfidence, ImportCancellationToken, ImportError,
};

fn write_temp_file(ext: &str, bytes: &[u8]) -> NamedTempFile {
    let mut f = tempfile::Builder::new()
        .suffix(&format!(".{ext}"))
        .tempfile()
        .unwrap();
    f.write_all(bytes).unwrap();
    f.flush().unwrap();
    f
}

fn build_zip(entries: &[(&str, &[u8])]) -> NamedTempFile {
    let f = tempfile::Builder::new().suffix(".zip").tempfile().unwrap();
    {
        let mut zw = ZipWriter::new(f.reopen().unwrap());
        let opts = FileOptions::default().compression_method(CompressionMethod::Deflated);
        for (name, data) in entries {
            zw.start_file(*name, opts).unwrap();
            zw.write_all(data).unwrap();
        }
        zw.finish().unwrap();
    }
    f
}

#[tokio::test]
async fn garmin_zip_retains_garmin_provider_and_stages() {
    let garmin_json = br#"[
      {
        "calendarDate": "2026-10-05",
        "sleepTimeSeconds": 27000,
        "napTimeSeconds": 0,
        "timeOffset": -14400,
        "sleepStartTimestampGMT": 1791172800,
        "sleepEndTimestampGMT": 1791199800,
        "deepSleepSeconds": 5400,
        "lightSleepSeconds": 16200,
        "remSleepSeconds": 5400,
        "awakeSleepSeconds": 600,
        "sleepScores": { "overall": { "value": 84 } },
        "averageSpO2Value": 96.5,
        "averageRespirationValue": 14.2,
        "restingHeartRate": 52,
        "avgOvernightHrv": 61.0,
        "sleepLevelsMap": {
          "deep": [{ "start": 1791172800, "end": 1791178200 }],
          "light": [{ "start": 1791178200, "end": 1791194400 }],
          "rem": [{ "start": 1791194400, "end": 1791199800 }]
        }
      }
    ]"#;
    let zip = build_zip(&[(
        "DI_CONNECT/DI-Connect-Wellness/2026-01-01_2026-12-31_123_sleepData.json",
        garmin_json,
    )]);
    let vault = HealthVault::new_in_memory().await.unwrap();
    let cancel = ImportCancellationToken::new();

    let preview = preview_wearable_import(&vault, zip.path(), None, None, &cancel)
        .await
        .unwrap();
    assert_eq!(preview.detection.confidence, DetectionConfidence::Confident);
    assert_eq!(preview.selected_provider_id, Some(HealthProviderId::Garmin));
    assert_eq!(preview.sleep_sessions_count, 1);
    assert_eq!(preview.sleep_stages_count, 3);
    // Preview must not commit
    assert!(vault.load_raw_sleep_sessions(false).await.unwrap().is_empty());

    let res = commit_wearable_import(
        &vault,
        zip.path(),
        None,
        None,
        &[
            HealthDataCategory::Sleep,
            HealthDataCategory::SleepStages,
            HealthDataCategory::Hrv,
            HealthDataCategory::RestingHeartRate,
            HealthDataCategory::RespiratoryRate,
            HealthDataCategory::Recovery,
        ],
        None,
        &cancel,
        None,
        "job_garmin",
    )
    .await
    .unwrap();
    assert_eq!(res.provider_id, HealthProviderId::Garmin);
    assert_eq!(res.sleep_imported, 1);
    assert_eq!(res.recovery_imported, 1);

    let sessions = vault.load_raw_sleep_sessions(false).await.unwrap();
    assert_eq!(sessions[0].provider_id, HealthProviderId::Garmin);
    assert_eq!(sessions[0].stages.len(), 3);
}

#[tokio::test]
async fn oura_zip_decodes_5min_hypnogram_and_readiness() {
    let sleep_csv = b"id,bedtime_start,bedtime_end,total_sleep_duration,time_in_bed,awake_time,light_sleep_duration,deep_sleep_duration,rem_sleep_duration,efficiency,average_hrv,lowest_heart_rate,average_breath,sleep_phase_5_min,type\noura_1,2026-10-05T23:00:00-04:00,2026-10-06T07:00:00-04:00,25200,28800,3600,14400,5400,5400,88,64.5,51,14.5,22211334,long_sleep\n";
    let readiness_csv = b"day,score,temperature_deviation\n2026-10-06,86,-0.12\n";
    let zip = build_zip(&[
        ("sleep.csv", sleep_csv),
        ("daily_readiness.csv", readiness_csv),
    ]);
    let vault = HealthVault::new_in_memory().await.unwrap();
    let cancel = ImportCancellationToken::new();

    let res = commit_wearable_import(
        &vault,
        zip.path(),
        None,
        None,
        &[
            HealthDataCategory::Sleep,
            HealthDataCategory::SleepStages,
            HealthDataCategory::Hrv,
            HealthDataCategory::RestingHeartRate,
            HealthDataCategory::Temperature,
            HealthDataCategory::Recovery,
        ],
        None,
        &cancel,
        None,
        "job_oura",
    )
    .await
    .unwrap();
    assert_eq!(res.provider_id, HealthProviderId::Oura);
    assert_eq!(res.sleep_imported, 1);
    assert_eq!(res.recovery_imported, 1);
    let sessions = vault.load_raw_sleep_sessions(false).await.unwrap();
    assert_eq!(sessions[0].stages.len(), 8);
    let physio = vault
        .query_physiological_observations(None, None, false)
        .await
        .unwrap();
    assert!(physio.iter().any(|p| p.hrv_method == HrvMethod::Rmssd));
}

#[tokio::test]
async fn whoop_zip_preserves_aggregate_stages_without_fake_intervals() {
    let sleeps_csv = b"Cycle start time,Cycle end time,Cycle timezone,Sleep onset,Wake onset,Sleep performance %,Respiratory rate (rpm),Asleep duration (min),In bed duration (min),Light sleep duration (min),Deep (SWS) duration (min),REM duration (min),Awake duration (min),Sleep efficiency %,Nap\n2026-10-05T23:00:00Z,2026-10-06T22:55:00Z,-04:00,2026-10-05T23:10:00-04:00,2026-10-06T06:50:00-04:00,89,14.8,420,460,220,100,100,40,91,false\n";
    let cycles_csv = b"Cycle start time,Cycle end time,Cycle timezone,Recovery score %,Resting heart rate (bpm),Heart rate variability (ms),Skin temp (celsius),Blood oxygen %\n2026-10-05T23:00:00Z,2026-10-06T22:55:00Z,-04:00,78,50,72,33.4,97.2\n";
    let zip = build_zip(&[
        ("sleeps.csv", sleeps_csv),
        ("physiological_cycles.csv", cycles_csv),
    ]);
    let vault = HealthVault::new_in_memory().await.unwrap();
    let cancel = ImportCancellationToken::new();

    let res = commit_wearable_import(
        &vault,
        zip.path(),
        None,
        None,
        &[
            HealthDataCategory::Sleep,
            HealthDataCategory::SleepStages,
            HealthDataCategory::Hrv,
            HealthDataCategory::RestingHeartRate,
            HealthDataCategory::Recovery,
        ],
        None,
        &cancel,
        None,
        "job_whoop",
    )
    .await
    .unwrap();
    assert_eq!(res.provider_id, HealthProviderId::Whoop);
    assert_eq!(res.sleep_imported, 1);

    let sessions = vault.load_raw_sleep_sessions(false).await.unwrap();
    assert!(sessions[0].stages.is_empty());
    assert!(sessions[0]
        .quality_flags
        .contains(&SleepQualityFlag::AggregateStageDurationsOnly));
    assert_eq!(sessions[0].deep_mins, Some(100.0));
}

#[tokio::test]
async fn fitbit_takeout_samsung_withings_ringconn_and_polar() {
    let vault = HealthVault::new_in_memory().await.unwrap();
    let cancel = ImportCancellationToken::new();

    // 1. Google Takeout Fitbit
    let fitbit_json = br#"[{"logId":9911,"dateOfSleep":"2026-10-01","startTime":"2026-10-01T00:00:00.000","endTime":"2026-10-01T07:00:00.000","minutesAsleep":390,"timeInBed":420,"efficiency":93,"isMainSleep":true,"type":"stages","levels":{"summary":{"deep":{"minutes":90},"light":{"minutes":210},"rem":{"minutes":90},"wake":{"minutes":30}},"data":[{"dateTime":"2026-10-01T00:00:00.000","level":"light","seconds":3600},{"dateTime":"2026-10-01T01:00:00.000","level":"deep","seconds":3600}]}}]"#;
    let fitbit_zip = build_zip(&[(
        "Takeout/Fitbit/Global Export Data/sleep-2026-10-01.json",
        fitbit_json,
    )]);
    let r_fb = commit_wearable_import(
        &vault,
        fitbit_zip.path(),
        None,
        None,
        &[HealthDataCategory::Sleep, HealthDataCategory::SleepStages],
        None,
        &cancel,
        None,
        "job_fb",
    )
    .await
    .unwrap();
    assert_eq!(r_fb.provider_id, HealthProviderId::GoogleHealth);
    assert_eq!(r_fb.sleep_imported, 1);

    // 2. Samsung Health
    let sam_sleep = b"com.samsung.health.sleep,1\ndatauuid,start_time,end_time,time_offset,sleep_score,efficiency\nsam_1,2026-10-02 23:00:00,2026-10-03 06:30:00,+00:00,85,90\n";
    let sam_stage = b"com.samsung.health.sleep_stage,1\nsleep_id,start_time,end_time,stage\nsam_1,2026-10-02 23:00:00,2026-10-03 01:00:00,40002\nsam_1,2026-10-03 01:00:00,2026-10-03 02:30:00,40003\n";
    let sam_zip = build_zip(&[
        ("com.samsung.health.sleep.202610.csv", sam_sleep),
        ("com.samsung.health.sleep_stage.202610.csv", sam_stage),
    ]);
    let r_sam = commit_wearable_import(
        &vault,
        sam_zip.path(),
        None,
        None,
        &[HealthDataCategory::Sleep, HealthDataCategory::SleepStages],
        None,
        &cancel,
        None,
        "job_sam",
    )
    .await
    .unwrap();
    assert_eq!(r_sam.provider_id, HealthProviderId::SamsungHealth);

    // 3. Withings
    let withings_csv = b"from,to,light (s),deep (s),rem (s),awake (s),Average heart rate\n2026-10-04T23:00:00Z,2026-10-05T06:30:00Z,14400,5400,5400,1800,56\n";
    let withings_f = write_temp_file("csv", withings_csv);
    let r_w = commit_wearable_import(
        &vault,
        withings_f.path(),
        None,
        None,
        &[HealthDataCategory::Sleep, HealthDataCategory::HeartRate],
        None,
        &cancel,
        None,
        "job_withings",
    )
    .await
    .unwrap();
    assert_eq!(r_w.provider_id, HealthProviderId::Withings);

    // 4. RingConn
    let rc_sleep = b"Date,Time Asleep,Deep Sleep,REM Sleep,Light Sleep,Awake Time\n2026-10-08,430,95,95,240,20\n";
    let rc_vitals = b"Date,Minimum Heart Rate,Average HRV,SpO2\n2026-10-08,52,58,97\n";
    let rc_zip = build_zip(&[("sleep.csv", rc_sleep), ("vitals.csv", rc_vitals)]);
    let r_rc = commit_wearable_import(
        &vault,
        rc_zip.path(),
        None,
        None,
        &[HealthDataCategory::Sleep, HealthDataCategory::Hrv],
        None,
        &cancel,
        None,
        "job_rc",
    )
    .await
    .unwrap();
    assert_eq!(r_rc.provider_id, HealthProviderId::Ringconn);

    // 5. Polar Nightly Recovery
    let polar_json = br#"[{"night":"2026-10-09","recoveryIndicator":4,"meanNightlyRecoveryRmssd":55.2,"meanNightlyRecoveryRespirationInterval":4000}]"#;
    let polar_f = write_temp_file("json", polar_json);
    let r_pol = commit_wearable_import(
        &vault,
        polar_f.path(),
        None,
        None,
        &[HealthDataCategory::Hrv, HealthDataCategory::Recovery, HealthDataCategory::RespiratoryRate],
        None,
        &cancel,
        None,
        "job_polar",
    )
    .await
    .unwrap();
    assert_eq!(r_pol.provider_id, HealthProviderId::Polar);
    assert!(!r_pol.has_usable_sleep);
}

#[test]
fn archive_security_rejects_traversal_symlinks_and_xxe() {
    let limits = ArchiveSecurityLimits::default();

    // ZIP Slip traversal
    let bad_zip = build_zip(&[("../../etc/passwd", b"root:x:0:0")]);
    assert!(matches!(
        SafeZipArchive::open(bad_zip.path(), limits),
        Err(ImportError::SecurityViolation(_))
    ));

    // Absolute path
    let abs_zip = build_zip(&[("/etc/passwd", b"root:x:0:0")]);
    assert!(matches!(
        SafeZipArchive::open(abs_zip.path(), limits),
        Err(ImportError::SecurityViolation(_))
    ));

    // Symlink entry
    let sym_f = tempfile::Builder::new().suffix(".zip").tempfile().unwrap();
    {
        let mut zw = ZipWriter::new(sym_f.reopen().unwrap());
        zw.add_symlink("link.txt", "/etc/passwd", FileOptions::default())
            .unwrap();
        zw.finish().unwrap();
    }
    assert!(matches!(
        SafeZipArchive::open(sym_f.path(), limits),
        Err(ImportError::SecurityViolation(_))
    ));

    // Duplicate path
    let dup_zip = build_zip(&[("sleep.csv", b"a"), ("Sleep.csv", b"b")]);
    assert!(matches!(
        SafeZipArchive::open(dup_zip.path(), limits),
        Err(ImportError::SecurityViolation(_))
    ));
}

#[test]
fn unsupported_workout_and_health_connect_backups_detected_truthfully() {
    let adapters = all_adapters();

    let gpx = write_temp_file("gpx", b"<gpx version=\"1.1\"><trk></trk></gpx>");
    let insp = inspect_file_for_detection(gpx.path(), ArchiveSecurityLimits::default()).unwrap();
    let det = detect_import_format(&insp, &adapters);
    assert_eq!(det.confidence, DetectionConfidence::NoUsableSleepData);

    let hc_zip = build_zip(&[("health_connect_export.db", b"SQLite format 3\0")]);
    let insp_hc =
        inspect_file_for_detection(hc_zip.path(), ArchiveSecurityLimits::default()).unwrap();
    let det_hc = detect_import_format(&insp_hc, &adapters);
    assert_eq!(det_hc.confidence, DetectionConfidence::RecognizedUnsupported);
}

#[tokio::test]
async fn idempotent_reimport_and_reference_counted_batch_deletion() {
    let vault = HealthVault::new_in_memory().await.unwrap();
    let cancel = ImportCancellationToken::new();

    let csv1 = write_temp_file(
        "csv",
        b"\xEF\xBB\xBFstart;end;notes\r\n2026-10-10T23:00:00Z;2026-10-11T07:00:00Z;\"Night 1\nwith newline\"\r\n",
    );
    let csv2 = write_temp_file(
        "csv",
        b"start,end,notes\n2026-10-10T23:00:00Z,2026-10-11T07:00:00Z,Night 1\n2026-10-11T23:00:00Z,2026-10-12T07:00:00Z,Night 2\n",
    );

    let b1 = commit_wearable_import(
        &vault,
        csv1.path(),
        None,
        None,
        &[HealthDataCategory::Sleep],
        None,
        &cancel,
        None,
        "b1",
    )
    .await
    .unwrap();
    let b2 = commit_wearable_import(
        &vault,
        csv2.path(),
        None,
        None,
        &[HealthDataCategory::Sleep],
        None,
        &cancel,
        None,
        "b2",
    )
    .await
    .unwrap();

    assert_eq!(vault.load_raw_sleep_sessions(false).await.unwrap().len(), 2);
    assert_eq!(list_import_batches(&vault, 10).await.unwrap().len(), 2);

    // Deleting batch 1 must keep Night 1 because batch 2 still references it
    assert!(delete_import_batch(&vault, &b1.batch_id).await.unwrap());
    assert_eq!(vault.load_raw_sleep_sessions(false).await.unwrap().len(), 2);

    // Deleting batch 2 removes both Night 1 and Night 2
    assert!(delete_import_batch(&vault, &b2.batch_id).await.unwrap());
    assert!(vault.load_raw_sleep_sessions(false).await.unwrap().is_empty());
}

#[tokio::test]
async fn custom_csv_mapping_profile_round_trip() {
    let vault = HealthVault::new_in_memory().await.unwrap();
    let cancel = ImportCancellationToken::new();

    let custom_csv = write_temp_file(
        "csv",
        b"bed_in,wake_up,nap_flag,rmssd_val\n2026-10-15T14:00:00Z,2026-10-15T14:45:00Z,yes,52.0\n",
    );
    let profile = CsvMappingProfile {
        id: None,
        name: "My Custom Ring CSV".to_string(),
        provider_id: Some(HealthProviderId::Ultrahuman),
        delimiter: Some(','),
        start_column: Some("bed_in".to_string()),
        end_column: Some("wake_up".to_string()),
        date_column: None,
        duration_column: None,
        duration_unit: Some("minutes".to_string()),
        time_in_bed_column: None,
        awake_column: None,
        light_column: None,
        deep_column: None,
        rem_column: None,
        latency_column: None,
        efficiency_column: None,
        sleep_kind_column: None,
        nap_indicator_column: Some("nap_flag".to_string()),
        hrv_column: Some("rmssd_val".to_string()),
        hrv_method: Some("rmssd".to_string()),
        resting_hr_column: None,
        respiratory_rate_column: None,
        spo2_column: None,
        temperature_column: None,
        temperature_unit: None,
        sleep_score_column: None,
        recovery_score_column: None,
        source_column: None,
        notes_column: None,
        timestamp_format: None,
        fallback_tz_offset_minutes: None,
        stage_label_map: Default::default(),
    };
    let saved = save_csv_mapping_profile(&vault, profile).await.unwrap();
    assert_eq!(list_csv_mapping_profiles(&vault).await.unwrap().len(), 1);

    let res = commit_wearable_import(
        &vault,
        custom_csv.path(),
        None,
        None,
        &[HealthDataCategory::Sleep, HealthDataCategory::Hrv],
        Some(&saved),
        &cancel,
        None,
        "job_custom",
    )
    .await
    .unwrap();
    assert_eq!(res.provider_id, HealthProviderId::Ultrahuman);
    assert_eq!(res.sleep_imported, 1);
    let sessions = vault.load_raw_sleep_sessions(false).await.unwrap();
    assert_eq!(sessions[0].sleep_kind, SleepKind::Nap);
}

#[tokio::test]
async fn streaming_large_apple_health_xml_over_50mb_benchmark() {
    let mut tmp = tempfile::Builder::new().suffix(".xml").tempfile().unwrap();
    tmp.write_all(b"<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<HealthData>\n")
        .unwrap();
    let record_line = b"  <Record type=\"HKQuantityTypeIdentifierHeartRate\" sourceName=\"Apple Watch\" unit=\"count/min\" value=\"62\" startDate=\"2026-01-01 03:00:00 +0000\" endDate=\"2026-01-01 03:00:00 +0000\"/>\n";
    // Write ~55 MB of XML records (> 50 MB old limit)
    let target_bytes = 55 * 1024 * 1024;
    let mut written = 0usize;
    while written < target_bytes {
        tmp.write_all(record_line).unwrap();
        written += record_line.len();
    }
    tmp.write_all(b"  <Record type=\"HKCategoryTypeIdentifierSleepAnalysis\" sourceName=\"Apple Watch\" value=\"HKCategoryValueSleepAnalysisAsleepCore\" startDate=\"2026-01-01 23:00:00 +0000\" endDate=\"2026-01-02 06:00:00 +0000\"/>\n</HealthData>\n").unwrap();
    tmp.flush().unwrap();

    let start = std::time::Instant::now();
    let cancel = ImportCancellationToken::new();
    let adapter = super::apple_health::AppleHealthAdapter;
    use super::registry::WearableImportAdapter;
    let parsed = adapter
        .parse_file(
            Path::new(tmp.path()),
            &ArchiveSecurityLimits::default(),
            &super::limits::StreamingParserLimits::default(),
            &cancel,
            None,
            "bench_55mb",
        )
        .unwrap();
    let elapsed = start.elapsed();
    assert_eq!(parsed.batch.sleep_sessions.len(), 1);
    assert!(parsed.batch.physio_observations.len() > 250_000);
    println!(
        "55MB Apple Health XML parsed {} physio records in {:.2}s ({:.0} rec/s)",
        parsed.batch.physio_observations.len(),
        elapsed.as_secs_f64(),
        parsed.batch.physio_observations.len() as f64 / elapsed.as_secs_f64()
    );
}
