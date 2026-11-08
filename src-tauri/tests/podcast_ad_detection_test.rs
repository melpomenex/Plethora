//! End-to-end integration tests for podcast ad removal, chapter ingestion,
//! and energy-aware pipeline processing.

use plethora_tauri_lib::battery::BatteryState;
use plethora_tauri_lib::mobile::scheduler::{DeferralReason, MobileScheduler};
use plethora_tauri_lib::models::podcast_ad::{PodcastAdInterval, PodcastAdSettings};
use plethora_tauri_lib::podcast::ad::boundary_refiner::{snap_to_silence_window, snap_to_word_boundary, SilenceGap};
use plethora_tauri_lib::podcast::ad::cue_detector::detect_cue_spans;
use plethora_tauri_lib::podcast::ad::interval_merger::merge_and_filter_intervals;
use plethora_tauri_lib::podcast::ad::thermal_governor::{ThermalDecision, ThermalGovernor};
use plethora_tauri_lib::podcast::chapter_fetcher::parse_chapters_json;
use plethora_tauri_lib::transcription::engine::TranscriptSegment;
use plethora_tauri_lib::transcription::manager::PodcastWordToken;

#[test]
fn test_integration_podcast20_json_chapters_parsing() {
    let json_payload = r#"{
        "version": "1.2.0",
        "chapters": [
            {
                "startTime": 0,
                "title": "Welcome and Cold Open"
            },
            {
                "startTime": 90.5,
                "title": "Sponsor: BetterHelp Counseling",
                "url": "https://betterhelp.com/plethora"
            },
            {
                "startTime": 210.0,
                "title": "Deep Dive Topic"
            }
        ]
    }"#;

    let chapters = parse_chapters_json(json_payload, "ep-integration-1", Some(1800))
        .expect("parsed chapters");

    assert_eq!(chapters.len(), 3);
    assert_eq!(chapters[0].title, "Welcome and Cold Open");
    assert_eq!(chapters[0].start_ms, 0);
    assert_eq!(chapters[0].end_ms, 90_500);
    assert!(!chapters[0].is_advertisement);

    assert_eq!(chapters[1].title, "Sponsor: BetterHelp Counseling");
    assert_eq!(chapters[1].start_ms, 90_500);
    assert_eq!(chapters[1].end_ms, 210_000);
    assert!(chapters[1].is_advertisement);
}

#[test]
fn test_integration_cue_detection_and_boundary_snapping() {
    let segments = vec![
        TranscriptSegment {
            start_ms: 0,
            end_ms: 8_000,
            text: "Welcome to the show. Let's introduce today's sponsor.".into(),
            confidence: 0.95,
            words_json: None,
        },
        TranscriptSegment {
            start_ms: 8_500,
            end_ms: 18_000,
            text: "Today's episode is brought to you by Squarespace. Use promo code PLETHORA for 10% off.".into(),
            confidence: 0.98,
            words_json: None,
        },
        TranscriptSegment {
            start_ms: 18_500,
            end_ms: 25_000,
            text: "Visit squarespace.com/plethora today. Now back to the show.".into(),
            confidence: 0.96,
            words_json: None,
        },
    ];

    let spans = detect_cue_spans(&segments);
    assert!(!spans.is_empty(), "Should detect sponsor cue in transcript");
    assert_eq!(spans[0].category, "external_ad");

    // Boundary snapping with word tokens and acoustic silence gaps
    let tokens = vec![
        PodcastWordToken {
            text: "Today's".into(),
            start_ms: 10_000,
            end_ms: 10_400,
            probability: Some(0.95),
        },
        PodcastWordToken {
            text: "episode".into(),
            start_ms: 10_450,
            end_ms: 10_800,
            probability: Some(0.96),
        },
    ];

    let snapped_start = snap_to_word_boundary(&tokens, 10_200, true);
    assert_eq!(snapped_start, 10_000);

    let silence_gaps = vec![
        SilenceGap { start_ms: 9_700, end_ms: 10_050 },
        SilenceGap { start_ms: 45_000, end_ms: 45_600 },
    ];
    let acoustic_snapped = snap_to_silence_window(9_900, &silence_gaps, 500);
    assert_eq!(acoustic_snapped, 9_875); // Center of silence window
}

#[test]
fn test_integration_interval_merging_and_sanity_limits() {
    let raw_intervals = vec![
        // First sponsor block: 30s + 2s gap + 25s
        PodcastAdInterval {
            id: "i1".into(),
            episode_id: "ep-1".into(),
            media_revision: "rev".into(),
            start_ms: 60_000,
            end_ms: 90_000,
            category: "external_ad".into(),
            confidence: 0.90,
            origin: "classifier_llm".into(),
            metadata_json: None,
        },
        PodcastAdInterval {
            id: "i2".into(),
            episode_id: "ep-1".into(),
            media_revision: "rev".into(),
            start_ms: 92_000,
            end_ms: 117_000,
            category: "external_ad".into(),
            confidence: 0.92,
            origin: "classifier_llm".into(),
            metadata_json: None,
        },
        // Tiny 4-second blip (<10s) -> should be filtered out
        PodcastAdInterval {
            id: "i3".into(),
            episode_id: "ep-1".into(),
            media_revision: "rev".into(),
            start_ms: 200_000,
            end_ms: 204_000,
            category: "bumper".into(),
            confidence: 0.60,
            origin: "classifier_llm".into(),
            metadata_json: None,
        },
    ];

    let res = merge_and_filter_intervals(raw_intervals, 600_000, 10_000);
    assert_eq!(res.intervals.len(), 1);
    assert_eq!(res.intervals[0].start_ms, 60_000);
    assert_eq!(res.intervals[0].end_ms, 117_000);
    assert!(!res.is_suspicious);
}

#[test]
fn test_integration_energy_deferral_and_thermal_governance() {
    let settings = PodcastAdSettings {
        mobile_charging_only: true,
        ..Default::default()
    };

    let battery_on_battery = BatteryState {
        is_present: true,
        level: 0.75,
        is_charging: false,
        is_power_save: false,
        thermal_status: "normal".into(),
    };

    // Should defer on battery when charging_only is enabled
    assert_eq!(
        MobileScheduler::evaluate_deferral(&battery_on_battery, &settings),
        Err(DeferralReason::OnBattery)
    );

    // Thermal governor action on mobile
    let governor = ThermalGovernor::new(true);
    assert_eq!(
        governor.evaluate_status("severe"),
        ThermalDecision::Throttle {
            pause_duration: std::time::Duration::from_secs(30),
            max_threads: 1,
        }
    );
    assert_eq!(
        governor.evaluate_status("critical"),
        ThermalDecision::AbortAndDefer {
            reason: "thermal_critical",
        }
    );
}
