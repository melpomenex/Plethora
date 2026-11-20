# Statistical & Scientific Methodology Specification

**Program:** `wearable-health-sleep-program`  
**Verification Date:** 2026-11-20

---

## 1. Scientific Foundation & Honest Proxy Framing

Wearable devices are consumer sensors, **not** polysomnography (EEG/EOG/EMG) or laboratory melatonin (DLMO) assays. Every computed sleep stage, circadian proxy, alertness curve, and correlation in Plethora explicitly discloses this distinction and separates **observed descriptive patterns** from **out-of-sample predictive validity**.

---

## 2. Sleep Architecture & Circadian Proxies

### 2.1 Stage Completeness & Non-Fabrication
- Sleep stages (`Awake`, `Light`, `Deep`, `REM`, `Asleep (Unstaged)`, `In Bed`, `Unknown`) are imported solely from provider records.
- Stage coverage ratio:
  $$\text{coverage} = \frac{\sum \text{duration}(\text{staged intervals in } \{\text{Light},\text{Deep},\text{REM}\})}{\max(1, \text{total sleep duration})}$$
- Stage percentages (`deepPct`, `remPct`, `lightPct`) are returned as `Option<f64>`: **`None` whenever `coverage < 0.70`**. Generic `asleep_unknown` intervals are never redistributed into Light/Deep/REM.

### 2.2 Circular Timing Statistics
Sleep onset and wake times wrap across midnight (`23:50` and `00:10` have mean `00:00`, not `12:00`). For timestamps converted to minutes-of-day $m_i \in [0, 1440)$ with angle $\theta_i = \frac{2\pi m_i}{1440}$:
- $\bar{C} = \frac{1}{n}\sum \cos\theta_i$, $\bar{S} = \frac{1}{n}\sum \sin\theta_i$, mean resultant length $\bar{R} = \sqrt{\bar{C}^2 + \bar{S}^2}$.
- Circular mean angle $\bar{\theta} = \text{atan2}(\bar{S}, \bar{C}) \bmod 2\pi \implies \bar{m} = \frac{1440 \bar{\theta}}{2\pi}$.
- Circular standard deviation (converted to minutes):
  $$s_{\text{circ}} = \frac{1440}{2\pi}\sqrt{-2\ln(\max(\bar{R}, 10^{-6}))}$$

### 2.3 Sleep Regularity Index (SRI) Proxy
Adapted from Phillips et al. (*Scientific Reports*, 2017): over consecutive 24h day pairs covering 96 × 15-minute epochs $e \in \{0..95\}$ (`sleep = 1`, `wake = 0`):
$$\text{SRI} = 200 \cdot \left(\frac{1}{N_{\text{pairs}} \cdot 96} \sum \mathbb{I}(s_{d,e} = s_{d+1,e}) - 0.5\right)$$
Computed **only** when $\ge 7$ consecutive day pairs contain valid non-missing sleep data; returns `None` otherwise.

### 2.4 Exploratory Borbély Two-Process Alertness Curve
- **References:** Borbély (1982), *Human Neurobiology*; Daan, Beersma & Borbély (1984), *Am J Physiol*; Borbély, Daan, Wirz-Justice & Deboer (2016), *J Sleep Res*.
- **Process S (Homeostatic sleep pressure, normalized $[0, 1]$):**
  - During wake: $S(t + \Delta t) = S_{\max} - (S_{\max} - S(t))\,e^{-\Delta t / \tau_i}$, with $\tau_i = 18.2\text{ h}$, $S_{\max} = 1.0$.
  - During sleep/nap: $S(t + \Delta t) = S_{\min} + (S(t) - S_{\min})\,e^{-\Delta t / \tau_d}$, with $\tau_d = 4.2\text{ h}$, $S_{\min} = 0.0$.
- **Process C (Circadian alerting drive, $[0, 1]$):**
  - Anchored to personal circular sleep midpoint $\bar{m}$ with nadir $\varphi = \bar{m} + 30\text{ min}$ (approximate core body temperature minimum proxy, **not** DLMO):
  - Two-harmonic formulation: $C(t) = 0.5 + 0.35\cos\left(\frac{2\pi(t - \varphi_{\text{peak}})}{24}\right) + 0.12\cos\left(\frac{4\pi(t - \varphi_{\text{peak2}})}{24}\right)$ normalized to $[0, 1]$.
- **Alertness Proxy & Explicit Uncertainty:** $A(t) = \text{clamp}(C(t) - w_s S(t) + 0.5, 0, 1)$, paired with an explicit uncertainty half-width $\sigma_A(t)$ reflecting personal schedule variability $s_{\text{circ}}$ and missing-data ratio, and tagged `isClinical: false`.

---

## 3. Zero-Leakage FSRS-7 Replay & Adjusted Learning Metrics

Raw recall accuracy is confounded by card difficulty, elapsed review intervals, and topic mix. Plethora isolates sleep/timing effects via chronological FSRS-7 replay over `review_results`:

1. Fetch all `review_results` ordered by `(item_id, reviewed_at_ms ASC, id ASC)`.
2. For each `item_id`, start with `memory_state = None`.
3. For review $i$:
   - If prior review exists at $t_{i-1}$, compute exact fractional $\Delta d_i = \frac{t_i - t_{i-1}}{86{,}400{,}000}$, and call `fsrs7::current_retrievability(&state_{i-1}, Δd_i)` to obtain **$R_{\text{pred},i}$ BEFORE seeing rating $r_i$** (first-ever reviews have $R_{\text{pred},i} = \text{None}$ and are excluded from residual regression!).
   - Advance `memory_state` via `fsrs7::next_states_fractional` using `r_i` for the *next* review only.
   - Observed binary recall: $y_i = \mathbb{I}(r_i \ge 2)$ (Hard/Good/Easy = 1, Again = 0).
   - **FSRS Recall Residual:** $e_i = y_i - R_{\text{pred},i} \in [-1, +1]$.
4. **Response Latency:** $\ell_i = \ln(\text{clamp}(\text{time\_taken}_i, 0.5, 180.0))$, winsorized per session and optionally standardized within item ($z$-score when item has $\ge 3$ reviews).
5. **Session Clustering:** Adjacent reviews within a 30-minute gap form a `ComparableStudySession`, recording session start/end, review count, mean residual $\bar{e}_s$, median latency, mean FSRS difficulty $\bar{D}_s$, prior 24h workload, Study Plan tags/IDs, and timestamp-aligned sleep/physiological context.

---

## 4. Statistical Guardrails, Confounder Adjustment & Multiple Testing

### 4.1 Explicit Heuristic Guardrails (`StatisticalGuardrails`)
These thresholds are **heuristic minimum engineering safeguards** (not universal clinical constants) and are surfaced transparently in the UI:
- `min_paired_reviews = 60`
- `min_sessions = 12`
- `min_distinct_days = 10`
- `min_assessment_attempts = 8`
- `min_sleep_sd_hours = 0.5` (prevents division-by-tiny-variance spurious slopes when sleep is constant)
- `min_coverage_ratio = 0.50`
- `min_bucket_sessions = 5` and `min_bucket_reviews = 20` (for Learning Windows & Sleep Duration buckets)
- `fdr_alpha = 0.05` (Benjamini-Hochberg false discovery rate across candidate hypotheses)

### 4.2 Within-Person Confounder-Adjusted Regression & Cluster Bootstrap
For each candidate predictor $x_s$ (e.g., prior main sleep hours, hours since awakening, 7d sleep variability, overnight RMSSD within-person z-score):
1. Fit session-weighted OLS multiple regression:
   $$\bar{e}_s = \beta_0 + \beta_1 x_s + \beta_2 \sin\!\left(\frac{2\pi h_s}{24}\right) + \beta_3 \cos\!\left(\frac{2\pi h_s}{24}\right) + \beta_4 \bar{D}_s + \beta_5 w_{\text{prior},s} + \varepsilon_s$$
   (using Gauss-Jordan / ridge-stabilized solver checking design-matrix condition; skips if predictor SD is below threshold).
2. Derive partial correlation $r_{\text{partial}}$ and two-sided $p$-value.
3. Run **500 deterministic seeded day-clustered bootstrap resamples** (resampling whole calendar days with replacement rather than individual reviews) to compute robust 95% confidence intervals immune to within-session and within-day autocorrelation.
4. Apply **Benjamini-Hochberg FDR** correction across all candidate tests (`sleep_duration`, `time_awake`, `sleep_regularity`, `hrv_rmssd`, `resting_hr`, `nap_matched_delta`, `assessment_sleep`).

---

## 5. Temporal Held-Out Validation for Learning Windows

When identifying candidate personal **Learning Windows** (`Early Morning 05–09`, `Late Morning 09–12`, `Early Afternoon 12–16`, `Late Afternoon 16–20`, `Evening/Night 20–05`):
1. Require $\ge 3$ populated time-of-day buckets each with $\ge 5$ sessions and $\ge 20$ FSRS-replay reviews spanning $\ge 10$ distinct days.
2. Partition sessions chronologically into `train` (oldest 70%) and `test` (newest 30%, at least 6 sessions).
3. Evaluate held-out RMSE on `test` across nested deterministic models fitted on `train`:
   - `M0`: Constant individual baseline ($\hat{e} = \bar{e}_{\text{train}}$)
   - `M1`: Time-of-day harmonic / bucket baseline
   - `M2`: Recent 7-day rolling performance baseline
   - `M3`: Time-of-day + prior main sleep duration
   - `M4`: Time-of-day + prior sleep + time since awakening
   - `M5`: `M4` + within-person overnight HRV (only when HRV coverage $\ge 70\%$)
4. **Validation Gate:** A Learning Window is labeled **`validated_predictive`** if the model beats `M0` by at least `0.002` held-out RMSE and beats `M1` when it uses sleep features. Compare paired squared-error improvements against `M0` averaged within each held-out day, using at least six days. Require a positive mean improvement with a two-sided paired t-test at `0.05 / 4` for candidate models `M1`, `M3`, `M4`, and `M5`. The `M2` rolling baseline remains visible for comparison. A model that fails the gate yields **`descriptive_only`**. Missing minimum sample or coverage yields **`insufficient_data`**.
