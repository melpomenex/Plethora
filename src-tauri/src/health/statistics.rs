//! Statistical inference primitives for within-person sleep-learning analytics:
//! weighted OLS multiple regression, day-clustered block bootstrap,
//! Benjamini-Hochberg FDR adjustment, and matched nap comparison (Hedges' g).

use rand::rngs::StdRng;
use rand::{Rng, SeedableRng};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone)]
pub struct OlsFit {
    pub coefficients: Vec<f64>,
    pub std_errors: Vec<f64>,
    pub t_stats: Vec<f64>,
    pub p_values: Vec<f64>,
    pub partial_r_col1: f64,
    pub r_squared: f64,
    pub residual_df: usize,
}

#[derive(Debug, Clone)]
pub struct RegressionObservation {
    pub day_key: String,
    pub weight: f64,
    pub y: f64,
    /// Design row `[1.0, predictor, sin_tod, cos_tod, difficulty, workload]`
    pub x: Vec<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NapComparisonResult {
    pub nap_sessions: usize,
    pub matched_pairs: usize,
    pub mean_nap_residual: Option<f64>,
    pub mean_non_nap_residual: Option<f64>,
    pub residual_delta: Option<f64>,
    pub hedges_g: Option<f64>,
    pub ci_low: Option<f64>,
    pub ci_high: Option<f64>,
    pub p_value: Option<f64>,
    pub sufficient_matches: bool,
}

/// Weighted OLS `(X^T W X)^(-1) X^T W y` solved via Gauss-Jordan elimination
/// with condition guard + tiny ridge fallback on near-singular columns.
pub fn fit_weighted_ols(obs: &[RegressionObservation]) -> Option<OlsFit> {
    let mut moments = RegressionMoments::new(obs.first()?.x.len());
    for row in obs {
        moments.add_observation(row);
    }
    moments.fit()
}

/// The weighted normal equations and response moments are additive over days.
/// Sampling days can reuse these sums without cloning or revisiting each review.
struct RegressionMoments {
    xtwx: Vec<Vec<f64>>,
    xtwy: Vec<f64>,
    weight: f64,
    weighted_y: f64,
    weighted_y_squared: f64,
    weighted_predictor: f64,
    observations: usize,
}

impl RegressionMoments {
    fn new(columns: usize) -> Self {
        Self {
            xtwx: vec![vec![0.0; columns]; columns],
            xtwy: vec![0.0; columns],
            weight: 0.0,
            weighted_y: 0.0,
            weighted_y_squared: 0.0,
            weighted_predictor: 0.0,
            observations: 0,
        }
    }

    fn add_observation(&mut self, row: &RegressionObservation) {
        if row.x.len() != self.xtwy.len()
            || !row.y.is_finite()
            || !row.weight.is_finite()
            || row.weight <= 0.0
            || row.x.iter().any(|value| !value.is_finite())
        {
            return;
        }
        self.observations += 1;
        self.weight += row.weight;
        self.weighted_y += row.weight * row.y;
        self.weighted_y_squared += row.weight * row.y * row.y;
        if let Some(predictor) = row.x.get(1) {
            self.weighted_predictor += row.weight * predictor;
        }
        for (index, &value) in row.x.iter().enumerate() {
            let weighted = row.weight * value;
            self.xtwy[index] += weighted * row.y;
            for (sum, &other) in self.xtwx[index].iter_mut().zip(&row.x) {
                *sum += weighted * other;
            }
        }
    }

    fn add_day(&mut self, day: &Self, count: usize) {
        let factor = count as f64;
        self.observations += day.observations * count;
        self.weight += day.weight * factor;
        self.weighted_y += day.weighted_y * factor;
        self.weighted_y_squared += day.weighted_y_squared * factor;
        self.weighted_predictor += day.weighted_predictor * factor;
        for (sum, value) in self.xtwy.iter_mut().zip(&day.xtwy) {
            *sum += value * factor;
        }
        for (sums, values) in self.xtwx.iter_mut().zip(&day.xtwx) {
            for (sum, value) in sums.iter_mut().zip(values) {
                *sum += value * factor;
            }
        }
    }

    fn fit(&self) -> Option<OlsFit> {
        let p = self.xtwy.len();
        let n = self.observations;
        if p < 2 || n <= p || self.weight <= 0.0 {
            return None;
        }
        let predictor_mean = self.weighted_predictor / self.weight;
        let predictor_variance = self.xtwx[1][1] / self.weight - predictor_mean.powi(2);
        if predictor_variance < 1e-10 || !predictor_variance.is_finite() {
            return None;
        }

        let inverse = invert_matrix_with_ridge(&self.xtwx, 0.0)
            .or_else(|| invert_matrix_with_ridge(&self.xtwx, 1e-7))?;
        let beta: Vec<f64> = inverse
            .iter()
            .map(|row| {
                row.iter()
                    .zip(&self.xtwy)
                    .map(|(value, response)| value * response)
                    .sum()
            })
            .collect();
        if beta.iter().any(|value| !value.is_finite()) {
            return None;
        }

        let cross_term: f64 = beta.iter().zip(&self.xtwy).map(|(b, xy)| b * xy).sum();
        let model_sum_squares: f64 = beta
            .iter()
            .zip(&self.xtwx)
            .map(|(b, row)| {
                b * row
                    .iter()
                    .zip(&beta)
                    .map(|(xx, other)| xx * other)
                    .sum::<f64>()
            })
            .sum();
        let rss = (self.weighted_y_squared - 2.0 * cross_term + model_sum_squares).max(0.0);
        let tss = self.weighted_y_squared - self.weighted_y.powi(2) / self.weight;
        let df = n - p;
        let mean_w = self.weight / n as f64;
        let sigma2 = (rss / (df as f64 * mean_w.max(1e-9))).max(1e-12);

        let std_errors: Vec<f64> = (0..p)
            .map(|i| (inverse[i][i] * mean_w * sigma2).max(1e-18).sqrt())
            .collect();
        let t_stats: Vec<f64> = beta.iter().zip(&std_errors).map(|(b, se)| b / se).collect();
        let p_values = t_stats
            .iter()
            .map(|t| two_sided_student_t_p(t.abs(), df as f64))
            .collect();
        let t1 = t_stats[1];
        let partial_r_col1 = (t1 / (t1 * t1 + df as f64).sqrt()).clamp(-0.9999, 0.9999);

        Some(OlsFit {
            coefficients: beta,
            std_errors,
            t_stats,
            p_values,
            partial_r_col1,
            r_squared: if tss > 1e-12 {
                (1.0 - rss / tss).clamp(0.0, 1.0)
            } else {
                0.0
            },
            residual_df: df,
        })
    }
}

fn invert_matrix_with_ridge(mat: &[Vec<f64>], ridge: f64) -> Option<Vec<Vec<f64>>> {
    let n = mat.len();
    let mut aug = vec![vec![0.0_f64; 2 * n]; n];
    for i in 0..n {
        for j in 0..n {
            aug[i][j] = mat[i][j];
        }
        if ridge > 0.0 && i > 0 {
            aug[i][i] += ridge;
        }
        aug[i][n + i] = 1.0;
    }

    for col in 0..n {
        let mut pivot_row = col;
        let mut best_val = aug[col][col].abs();
        for r in (col + 1)..n {
            if aug[r][col].abs() > best_val {
                best_val = aug[r][col].abs();
                pivot_row = r;
            }
        }
        if best_val < 1e-11 || !best_val.is_finite() {
            return None;
        }
        if pivot_row != col {
            aug.swap(col, pivot_row);
        }
        let pivot = aug[col][col];
        for j in 0..(2 * n) {
            aug[col][j] /= pivot;
        }
        for r in 0..n {
            if r != col {
                let factor = aug[r][col];
                if factor.abs() > 0.0 {
                    for j in 0..(2 * n) {
                        aug[r][j] -= factor * aug[col][j];
                    }
                }
            }
        }
    }

    let mut inv = vec![vec![0.0_f64; n]; n];
    for i in 0..n {
        for j in 0..n {
            if !aug[i][n + j].is_finite() {
                return None;
            }
            inv[i][j] = aug[i][n + j];
        }
    }
    Some(inv)
}

/// Deterministic seeded day-clustered block bootstrap 95% CI on OLS predictor
/// slope `beta[1]` and partial correlation `partial_r_col1`.
pub fn bootstrap_day_clustered_slope(
    obs: &[RegressionObservation],
    resamples: usize,
    seed: u64,
) -> Option<((f64, f64), (f64, f64))> {
    let columns = obs.first()?.x.len();
    let mut by_day = std::collections::BTreeMap::new();
    for row in obs {
        by_day
            .entry(row.day_key.as_str())
            .or_insert_with(|| RegressionMoments::new(columns))
            .add_observation(row);
    }
    let days: Vec<_> = by_day.into_values().collect();
    if days.len() < 4 {
        return None;
    }

    let mut rng = StdRng::seed_from_u64(seed);
    let mut betas = Vec::with_capacity(resamples);
    let mut partials = Vec::with_capacity(resamples);
    let mut counts = vec![0; days.len()];

    for _ in 0..resamples {
        counts.fill(0);
        for _ in 0..days.len() {
            counts[rng.gen_range(0..days.len())] += 1;
        }
        let mut sample = RegressionMoments::new(columns);
        for (day, count) in days.iter().zip(&counts) {
            if *count > 0 {
                sample.add_day(day, *count);
            }
        }
        if let Some(fit) = sample.fit() {
            betas.push(fit.coefficients[1]);
            partials.push(fit.partial_r_col1);
        }
    }

    if betas.len() < 20 {
        return None;
    }

    betas.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    partials.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let lo_idx = ((betas.len() as f64) * 0.025).floor() as usize;
    let hi_idx = (((betas.len() as f64) * 0.975).ceil() as usize)
        .saturating_sub(1)
        .min(betas.len() - 1);

    Some((
        (betas[lo_idx], betas[hi_idx]),
        (partials[lo_idx], partials[hi_idx]),
    ))
}

/// Benjamini-Hochberg false discovery rate q-values across candidate tests.
pub fn apply_bh_fdr(p_values: &[Option<f64>]) -> Vec<Option<f64>> {
    let mut indexed: Vec<(usize, f64)> = p_values
        .iter()
        .enumerate()
        .filter_map(|(i, p)| p.filter(|v| v.is_finite()).map(|v| (i, v.clamp(0.0, 1.0))))
        .collect();

    let mut out = vec![None; p_values.len()];
    let m = indexed.len();
    if m == 0 {
        return out;
    }

    indexed.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal));
    let mut q_sorted = vec![1.0_f64; m];
    let mut min_so_far = 1.0_f64;
    for rank_idx in (0..m).rev() {
        let rank = (rank_idx + 1) as f64;
        let adj = (indexed[rank_idx].1 * m as f64 / rank).min(1.0);
        if adj < min_so_far {
            min_so_far = adj;
        }
        q_sorted[rank_idx] = min_so_far;
    }

    for (pos, &(orig_idx, _)) in indexed.iter().enumerate() {
        out[orig_idx] = Some(q_sorted[pos]);
    }
    out
}

/// Match nap sessions against comparable non-nap sessions (+/- 2h time of day,
/// +/- 1.5h prior main sleep duration) and compute residual delta + Hedges' g + CI.
pub fn compare_matched_nap_sessions(
    sessions: &[super::telemetry::ComparableStudySession],
    seed: u64,
) -> NapComparisonResult {
    let nap_sessions: Vec<&super::telemetry::ComparableStudySession> = sessions
        .iter()
        .filter(|s| s.has_recent_nap && s.mean_fsrs_residual.is_some())
        .collect();
    let non_nap_sessions: Vec<&super::telemetry::ComparableStudySession> = sessions
        .iter()
        .filter(|s| !s.has_recent_nap && s.mean_fsrs_residual.is_some())
        .collect();

    if nap_sessions.is_empty() || non_nap_sessions.is_empty() {
        return NapComparisonResult {
            nap_sessions: nap_sessions.len(),
            matched_pairs: 0,
            mean_nap_residual: None,
            mean_non_nap_residual: None,
            residual_delta: None,
            hedges_g: None,
            ci_low: None,
            ci_high: None,
            p_value: None,
            sufficient_matches: false,
        };
    }

    let mut matched_deltas: Vec<(String, f64)> = Vec::new();
    let mut matched_nap_vals: Vec<f64> = Vec::new();
    let mut matched_ctrl_vals: Vec<f64> = Vec::new();

    for nap in &nap_sessions {
        let candidates: Vec<f64> = non_nap_sessions
            .iter()
            .filter(|ctrl| {
                let mut tod_diff = (nap.local_start_hour - ctrl.local_start_hour).abs();
                if tod_diff > 12.0 {
                    tod_diff = 24.0 - tod_diff;
                }
                let sleep_match = match (
                    nap.preceding_main_sleep_hours,
                    ctrl.preceding_main_sleep_hours,
                ) {
                    (Some(a), Some(b)) => (a - b).abs() <= 1.5,
                    _ => true,
                };
                tod_diff <= 2.5 && sleep_match
            })
            .filter_map(|ctrl| ctrl.mean_fsrs_residual)
            .collect();

        if !candidates.is_empty() {
            let ctrl_mean = candidates.iter().sum::<f64>() / candidates.len() as f64;
            let nap_val = nap.mean_fsrs_residual.unwrap();
            matched_nap_vals.push(nap_val);
            matched_ctrl_vals.push(ctrl_mean);
            matched_deltas.push((nap.local_date.clone(), nap_val - ctrl_mean));
        }
    }

    let k = matched_deltas.len();
    if k < 4 {
        return NapComparisonResult {
            nap_sessions: nap_sessions.len(),
            matched_pairs: k,
            mean_nap_residual: if matched_nap_vals.is_empty() {
                None
            } else {
                Some(matched_nap_vals.iter().sum::<f64>() / matched_nap_vals.len() as f64)
            },
            mean_non_nap_residual: if matched_ctrl_vals.is_empty() {
                None
            } else {
                Some(matched_ctrl_vals.iter().sum::<f64>() / matched_ctrl_vals.len() as f64)
            },
            residual_delta: None,
            hedges_g: None,
            ci_low: None,
            ci_high: None,
            p_value: None,
            sufficient_matches: false,
        };
    }

    let mean_nap = matched_nap_vals.iter().sum::<f64>() / k as f64;
    let mean_ctrl = matched_ctrl_vals.iter().sum::<f64>() / k as f64;
    let delta = mean_nap - mean_ctrl;

    let diffs: Vec<f64> = matched_deltas.iter().map(|(_, d)| *d).collect();
    let var_d = diffs.iter().map(|d| (d - delta).powi(2)).sum::<f64>() / (k - 1) as f64;
    let sd_d = var_d.sqrt().max(1e-9);
    let se_d = sd_d / (k as f64).sqrt();
    let t_stat = delta / se_d;
    let p_val = two_sided_student_t_p(t_stat.abs(), (k - 1) as f64);

    // Paired Hedges' g with small-sample J correction
    let df = (k - 1) as f64;
    let j = 1.0 - 3.0 / (4.0 * df - 1.0).max(1.0);
    let hedges_g = (delta / sd_d) * j;

    // Bootstrap delta CI
    let mut rng = StdRng::seed_from_u64(seed);
    let mut boot_means = Vec::with_capacity(400);
    for _ in 0..400 {
        let mut s = 0.0;
        for _ in 0..k {
            s += diffs[rng.gen_range(0..k)];
        }
        boot_means.push(s / k as f64);
    }
    boot_means.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let ci_low = boot_means[(boot_means.len() as f64 * 0.025).floor() as usize];
    let ci_high = boot_means[((boot_means.len() as f64 * 0.975).ceil() as usize)
        .saturating_sub(1)
        .min(boot_means.len() - 1)];

    NapComparisonResult {
        nap_sessions: nap_sessions.len(),
        matched_pairs: k,
        mean_nap_residual: Some(mean_nap),
        mean_non_nap_residual: Some(mean_ctrl),
        residual_delta: Some(delta),
        hedges_g: Some(hedges_g),
        ci_low: Some(ci_low),
        ci_high: Some(ci_high),
        p_value: Some(p_val),
        sufficient_matches: k >= 5,
    }
}

pub fn pearson_correlation(xs: &[f64], ys: &[f64]) -> Option<f64> {
    if xs.len() != ys.len() || xs.len() < 3 {
        return None;
    }
    let n = xs.len() as f64;
    let mx = xs.iter().sum::<f64>() / n;
    let my = ys.iter().sum::<f64>() / n;
    let mut num = 0.0;
    let mut dx2 = 0.0;
    let mut dy2 = 0.0;
    for (&x, &y) in xs.iter().zip(ys.iter()) {
        let dx = x - mx;
        let dy = y - my;
        num += dx * dy;
        dx2 += dx * dx;
        dy2 += dy * dy;
    }
    let denom = (dx2 * dy2).sqrt();
    if denom < 1e-12 {
        return None;
    }
    Some((num / denom).clamp(-1.0, 1.0))
}

/// Approximate two-sided Student's t p-value via continued-fraction regularized
/// incomplete beta I_x(df/2, 0.5) where x = df / (df + t^2).
pub fn two_sided_student_t_p(t_abs: f64, df: f64) -> f64 {
    if !t_abs.is_finite() || !df.is_finite() || df <= 0.0 {
        return 1.0;
    }
    if t_abs == 0.0 {
        return 1.0;
    }
    let x = df / (df + t_abs * t_abs);
    regularized_incomplete_beta(x, 0.5 * df, 0.5).clamp(0.0, 1.0)
}

fn regularized_incomplete_beta(x: f64, a: f64, b: f64) -> f64 {
    if x <= 0.0 {
        return 0.0;
    }
    if x >= 1.0 {
        return 1.0;
    }
    let bt = (ln_gamma(a + b) - ln_gamma(a) - ln_gamma(b) + a * x.ln() + b * (1.0 - x).ln()).exp();
    if x < (a + 1.0) / (a + b + 2.0) {
        bt * betacf(a, b, x) / a
    } else {
        1.0 - bt * betacf(b, a, 1.0 - x) / b
    }
}

fn betacf(a: f64, b: f64, x: f64) -> f64 {
    const MAX_IT: usize = 200;
    const EPS: f64 = 3e-10;
    const FPMIN: f64 = 1e-30;
    let qab = a + b;
    let qap = a + 1.0;
    let qam = a - 1.0;
    let mut c = 1.0;
    let mut d = 1.0 - qab * x / qap;
    if d.abs() < FPMIN {
        d = FPMIN;
    }
    d = 1.0 / d;
    let mut h = d;
    for m in 1..=MAX_IT {
        let mf = m as f64;
        let m2 = 2.0 * mf;
        let aa = mf * (b - mf) * x / ((qam + m2) * (a + m2));
        d = 1.0 + aa * d;
        if d.abs() < FPMIN {
            d = FPMIN;
        }
        c = 1.0 + aa / c;
        if c.abs() < FPMIN {
            c = FPMIN;
        }
        d = 1.0 / d;
        h *= d * c;
        let aa2 = -(a + mf) * (qab + mf) * x / ((a + m2) * (qap + m2));
        d = 1.0 + aa2 * d;
        if d.abs() < FPMIN {
            d = FPMIN;
        }
        c = 1.0 + aa2 / c;
        if c.abs() < FPMIN {
            c = FPMIN;
        }
        d = 1.0 / d;
        let del = d * c;
        h *= del;
        if (del - 1.0).abs() < EPS {
            break;
        }
    }
    h
}

fn ln_gamma(z: f64) -> f64 {
    // Lanczos approximation
    const COEFFS: [f64; 9] = [
        0.9999999999998099,
        676.5203681218851,
        -1259.1392167224028,
        771.3234287776531,
        -176.6150291621406,
        12.507343278686905,
        -0.13857109526572012,
        9.984369578019572e-6,
        1.5056327351493116e-7,
    ];
    let mut x = COEFFS[0];
    let zm1 = z - 1.0;
    for (i, &c) in COEFFS.iter().enumerate().skip(1) {
        x += c / (zm1 + i as f64);
    }
    let t = zm1 + 7.5;
    0.5 * std::f64::consts::TAU.ln() + (zm1 + 0.5) * t.ln() - t + x.ln()
}
