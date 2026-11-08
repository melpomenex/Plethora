# Benchmark Plan: Local-First Podcast Ad Removal

This document specifies the reproducible performance, accuracy, latency, and energy benchmark suites for the Podcast Ad Removal system in Plethora.

---

## 1. Repository Microbenchmark Suite (`vitest bench`)

In accordance with Plethora's benchmark gate (`AGENTS.md`), all in-process microbenchmarks reside in `src/podcastAd.bench.ts`, utilize the seeded PRNG `seededRandom(seed)` from `src/test/bench-support.ts`, consume results through module-level sinks, and gate against `scripts/perf-baselines.json` via the dimensionless noise-anchor cost ratio:
$$\text{Cost} = \frac{\text{anchorHz}}{\text{benchHz}}$$

### 1.1 In-Process Microbenchmarks

```typescript
// src/podcastAd.bench.ts specification
import { bench } from "vitest";
import { seededRandom } from "./test/bench-support";

let sink = 0;

bench("podcast-ad/lookahead-binary-search-100-intervals", () => {
  // Evaluates 120ms lookahead query latency against a sorted array of 100 intervals
  // Simulates 1,000 continuous audio playback ticks
});

bench("podcast-ad/cue-regex-matcher-100k-words", () => {
  // Evaluates transcript cue pattern regex matching across a 100,000-word transcript
  // Tests sponsor intros, promo codes, URLs, and transitions
});

bench("podcast-ad/interval-merger-50-intervals", () => {
  // Evaluates merging, deduping, and minimum duration clamping on 50 overlapping/adjacent intervals
});

bench("podcast-ad/boundary-snapper-1000-tokens", () => {
  // Evaluates snapping rough LLM boundary spans to closest word boundary timestamps
});
```

### 1.2 Target Performance Baselines & Budgets

| Benchmark Name | Max Allowed Cost Ratio ($\frac{\text{anchorHz}}{\text{benchHz}}$) | Typical Runtime | Notes |
| :--- | :--- | :--- | :--- |
| `podcast-ad/lookahead-binary-search-100-intervals` | `<= 0.045` | `< 12 µs` | Must be negligible inside 60fps / 25ms render loop |
| `podcast-ad/cue-regex-matcher-100k-words` | `<= 0.850` | `< 4.5 ms` | Full transcript regex scan must complete in single-digit ms |
| `podcast-ad/interval-merger-50-intervals` | `<= 0.020` | `< 5 µs` | In-memory sorting and interval coalescence |
| `podcast-ad/boundary-snapper-1000-tokens` | `<= 0.080` | `< 25 µs` | Token bisect and silence timestamp alignment |

---

## 2. Macro Accuracy & Quality Benchmark Suite

### 2.1 Benchmark Dataset Composition
The benchmark evaluation runs against a curated gold-standard dataset of 25 diverse podcast episodes with human-annotated ground truth ad boundaries:

- **Set A: Studio Interview & Talk (10 episodes, ~45m avg)**: NPR, Joe Rogan, Tim Ferriss, Lex Fridman. (Characterized by clear host sponsor reads and transition sound effects).
- **Set B: Narrative / Highly Produced Audio (8 episodes, ~35m avg)**: Radiolab, Serial, This American Life. (Characterized by music beds, subtle sponsor underwriting credits, and dynamic pacing).
- **Set C: Solo Commentary & Tech News (7 episodes, ~20m avg)**: Dithering, ATP, Stratechery. (Characterized by short mid-rolls and integrated promo codes).

### 2.2 Metrics & Threshold Targets

The benchmark script calculates detection accuracy across temporal spans at 100ms granularity:

$$\text{Precision} = \frac{\text{True Positive Time (s)}}{\text{True Positive Time (s)} + \text{False Positive Time (s)}}$$

$$\text{Recall} = \frac{\text{True Positive Time (s)}}{\text{True Positive Time (s)} + \text{False Negative Time (s)}}$$

$$\text{False Positive Rate (FPR)} = \frac{\text{False Positive Time (s)}}{\text{Total Non-Ad Content Time (s)}}$$

$$\text{Start Boundary Error} = |\text{Detected Start} - \text{Ground Truth Start}|$$

$$\text{End Boundary Error} = |\text{Detected End} - \text{Ground Truth End}|$$

| Metric | Target | Failure Gate |
| :--- | :--- | :--- |
| **Precision** | $\ge 94\%$ | $< 90\%$ |
| **Recall** | $\ge 90\%$ | $< 85\%$ |
| **False Positive Rate** | $\le 1.5\%$ | $> 3.0\%$ |
| **Mean Absolute Start Error** | $\le 250\text{ ms}$ | $> 500\text{ ms}$ |
| **Mean Absolute End Error** | $\le 300\text{ ms}$ | $> 600\text{ ms}$ |
| **95th Percentile Boundary Error** | $\le 650\text{ ms}$ | $> 1200\text{ ms}$ |

---

## 3. Preparation Pipeline Runtime Benchmarks

The preparation pipeline benchmarks evaluate total elapsed time from raw downloaded audio to finalized ad-free playback intervals.

### 3.1 Test Scenarios by Episode Length
- **Short**: 15 minutes (~20 MB MP3)
- **Standard**: 45 minutes (~60 MB MP3)
- **Extended**: 120 minutes (~160 MB MP3)

### 3.2 Target Runtime Budgets Across Platforms

| Hardware Target | Engine | 15m Episode | 45m Episode | 120m Episode | Realtime Factor (RTFx) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Desktop GPU** (RTX 4070 / Apple M2 Max) | Parakeet / Whisper Large-v3-Turbo | `< 18s` | `< 50s` | `< 130s` | `~50x - 60x` faster than real time |
| **Desktop CPU** (Core i7 / Ryzen 7, 8 threads) | Whistle / Needle | `< 45s` | `< 135s` | `< 360s` | `~20x` faster than real time |
| **Mobile Flagship** (Snapdragon 8 Gen 3, plugged in) | Android STT / Whisper Base | `< 90s` | `< 270s` | `< 720s` | `~10x` faster than real time |
| **Mobile Efficiency** (A16 / Snapdragon 8 Gen 2, battery) | Background Worker (1 thread) | `< 180s` | `< 540s` | `< 1440s` | `~5x` faster than real time |

---

## 4. Audio Boundary Latency & Hardware Leakage Benchmark

This test verifies the physical absence of audio leakage when crossing an ad boundary.

### 4.1 Methodology
1. Connect Plethora audio output to a digital audio loopback interface (e.g. BlackHole on macOS, ALSA loopback on Linux, or AudioRecord loopback on Android).
2. Play a synthetic audio file with an ad block consisting of a distinct 1 kHz pure sine tone from `01:00.000` to `01:30.000`, surrounded by 440 Hz content tones.
3. Record the digital output buffer into a WAV file during automated playback with ad skipping active.
4. Perform Fast Fourier Transform (FFT) analysis on the recorded buffer to detect any presence of the 1 kHz frequency.

### 4.2 Latency & Leakage Pass Criteria
- **1 kHz Tone Presence**: Strictly 0.00% (-infinity dBFS). Zero decoded audio frames containing the 1 kHz ad tone may reach the OS audio mixer.
- **Seek Transition Duration**: Time from audio mute trigger to unmute at post-ad content must be $\le 45\text{ ms}$ on desktop, $\le 75\text{ ms}$ on mobile.
- **Phase Continuity & Click Suppression**: No waveform step-discontinuity producing spectral splatter $> -40\text{ dBFS}$ at the transition point.

---

## 5. Mobile Energy & Thermal Impact Benchmarks

### 5.1 Test Equipment & Protocol
- **Device Under Test (DUT)**: Pixel 8 / Samsung Galaxy S23 (Android 14) and iPhone 15 (iOS 17).
- **Measurement Tool**: Android Batterystats (`adb shell dumpsys batterystats`) and Monsoon Power Monitor / iOS Instruments Energy Profiler.
- **Environment**: Ambient temperature $21^\circ\text{C} \pm 1^\circ\text{C}$, screen off during background preparation, screen at 50% brightness during active playback.

### 5.2 Energy Consumption Targets

| Activity | Condition | Target Battery Drain | Target Thermal Impact |
| :--- | :--- | :--- | :--- |
| **Ad Detection Prep (45m Episode)** | Charging (AC Power) | N/A (Powered) | $\Delta T \le +6^\circ\text{C}$ (Peak $\le 38^\circ\text{C}$) |
| **Ad Detection Prep (45m Episode)** | On Battery (User Forced) | $\le 28\text{ mAh}$ ($\le 0.7\%$ total capacity) | $\Delta T \le +4^\circ\text{C}$ |
| **Ad-Free Playback (1 hour audio)** | On Battery, Screen Off | $\le 45\text{ mAh}$ ($\le 1.1\%$ total capacity) | $\Delta T \le +1^\circ\text{C}$ |
| **Ad-Free Playback (1 hour audio)** | Screen On, Transcript Sync | $\le 190\text{ mAh}$ ($\le 4.8\%$ total capacity) | $\Delta T \le +2^\circ\text{C}$ |

### 5.3 Thermal Throttle Trigger Verification
- When device temperature reaches $42^\circ\text{C}$ (`ThermalStatus::SEVERE`):
  - Ingestion thread pool must instantly downscale to 1 thread.
  - Duty cycle must drop to 50% (500ms compute / 500ms sleep).
- When device temperature reaches $46^\circ\text{C}$ (`ThermalStatus::CRITICAL`):
  - Ingestion must halt completely within 250ms and emit `PAUSED_THERMAL` event.
  - Zero foreground UI frame drops ($\ge 59.5\text{ fps}$ sustained) during background throttling transitions.
