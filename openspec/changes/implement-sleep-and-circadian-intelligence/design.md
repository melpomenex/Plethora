## Context

Sleep onset and wake times cross midnight (`23:50` vs `00:10`), making linear mean/SD mathematically broken. Similarly, wearable sleep stages are often absent on manual entries, older iOS versions, or some Health Connect writers.

## Goals / Non-Goals

- **Goals:**
  - Circular timing math (`atan2(mean_sin, mean_cos)`) for accurate bed/wake/midpoint means & SDs.
  - Strict non-fabrication: stage percentages omitted (`None`) when stage coverage `< 0.70`; SRI omitted (`None`) when `< 7` consecutive sleep-observed days exist.
  - Exploratory Borbély two-process alertness curve anchored to personal midpoint rather than population defaults, with explicit uncertainty band.
- **Non-Goals:**
  - Estimating REM/Deep stages from heart rate or claiming biological DLMO circadian phase from watch timestamps.

## Decisions

### Circular & Epoch Regularity Formulation
Sleep onset, wake time, and midpoint convert to $[0, 2\pi)$ radians over 1,440 minutes/day. SRI evaluates 15-minute sleep/wake epochs across consecutive 24-hour pairs only where both days have valid tracking coverage (missing days are never treated as "awake").

### Exploratory Two-Process Model (`borbely_two_process_v1`)
Uses $\tau_i = 18.2\text{h}$ wake rise and $\tau_d = 4.2\text{h}$ sleep decay (Borbély 1982; Daan et al. 1984; Borbély et al. 2016) combined with a two-harmonic Process C aligned to personal circular midpoint $+ 30\text{ min}$. Uncertainty band scales directly with personal circular midpoint SD and recent missing-data fraction.
