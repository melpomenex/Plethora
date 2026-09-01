use super::{Fsrs7Ops, Get, MemoryStateTensors, Model, VersionOps, tensor_max, tensor_min};
use crate::error::Result;
use crate::inference::MemoryState;
use burn::tensor::{Tensor, backend::Backend};

pub(super) const PARAM_LEN: usize = 34;
const DR_MIN: f32 = 0.0001;
const DR_MAX: f32 = 0.9999;
const INTERVAL_NEWTON_ITERS: usize = 7;
const BISECTION_ITERS: usize = 50;
const MIN_T: f32 = 1.0 / 86_400.0;

impl<B: Backend> VersionOps<B> for Fsrs7Ops {
    fn apply_freeze_short_term(_initial_params: &mut [f32]) {
        // Final dual-trace FSRS-7 has no single transition-weight parameter to
        // zero. The fast trace is intrinsic to the model.
    }

    fn power_forgetting_curve(
        model: &Model<B>,
        t: Tensor<B, 1>,
        s: Tensor<B, 1>,
        s_fast: Tensor<B, 1>,
        d: Tensor<B, 1>,
    ) -> Tensor<B, 1> {
        power_forgetting_curve(model, t, s, s_fast, d)
    }

    fn next_interval(
        model: &Model<B>,
        stability: Tensor<B, 1>,
        stability_fast: Tensor<B, 1>,
        difficulty: Tensor<B, 1>,
        desired_retention: Tensor<B, 1>,
    ) -> Tensor<B, 1> {
        next_interval(
            model,
            stability,
            stability_fast,
            difficulty,
            desired_retention,
        )
    }

    fn update_state(
        model: &Model<B>,
        delta_t: Tensor<B, 1>,
        rating: Tensor<B, 1>,
        last_s: Tensor<B, 1>,
        last_d: Tensor<B, 1>,
        last_s_fast: Tensor<B, 1>,
    ) -> MemoryStateTensors<B> {
        let delta_t = delta_t.clamp_min(0.0);
        let retrievability = power_forgetting_curve(
            model,
            delta_t.clone(),
            last_s.clone(),
            last_s_fast.clone(),
            last_d.clone(),
        );
        let new_s_slow = stability_for_set(
            model,
            last_s,
            last_d.clone(),
            retrievability.clone(),
            rating.clone(),
            7,
        );
        let r_fast = fast_component_recall(model, delta_t, last_s_fast.clone());
        let new_s_fast = stability_for_set(
            model,
            last_s_fast,
            last_d.clone(),
            r_fast,
            rating.clone(),
            15,
        );
        let relearn_fast = tensor_min(new_s_fast.clone(), new_s_slow.clone().mul_scalar(0.8));
        let new_s_fast = new_s_fast.mask_where(rating.clone().equal_elem(1), relearn_fast);
        let new_d = next_difficulty(model, last_d, rating, retrievability);
        MemoryStateTensors {
            stability: new_s_slow,
            difficulty: new_d,
            stability_fast: new_s_fast,
        }
    }

    fn memory_state_from_sm2_fsrs(
        _model: &Model<B>,
        _ease_factor: f32,
        interval: f32,
        _sm2_retention: f32,
    ) -> Result<MemoryState> {
        let stability = interval.max(super::S_MIN).clamp(super::S_MIN, super::S_MAX);
        Ok(MemoryState {
            stability,
            difficulty: 5.0,
            stability_fast: (stability * 0.8).clamp(super::S_MIN, super::S_MAX),
        })
    }

    fn interval_at_retrievability(
        model: &Model<B>,
        state: MemoryState,
        target_retrievability: f32,
    ) -> f32 {
        let w = model.w.val().to_data().to_vec::<f32>().unwrap();
        fsrs7_next_interval_scalar_for_state(&w, state, target_retrievability)
    }
}

pub(crate) fn fsrs7_forgetting_curve_scalar(w: &[f32], t: f32, s: f32) -> f32 {
    fsrs7_forgetting_curve_scalar_for_state(
        w,
        t,
        MemoryState {
            stability: s,
            difficulty: 5.0,
            stability_fast: s,
        },
    )
}

pub(crate) fn init_difficulty_scalar(w: &[f32], rating: usize) -> f32 {
    w[4] - (w[5] * (rating - 1) as f32).exp() + 1.0
}

fn linear_damping_scalar(delta_d: f32, old_d: f32) -> f32 {
    (10.0 - old_d) * delta_d / 9.0
}

fn mean_reversion_scalar(init: f32, current: f32) -> f32 {
    init * 0.01 + current * 0.99
}

pub(crate) fn next_difficulty_scalar(w: &[f32], d: f32, rating: usize) -> f32 {
    next_difficulty_scalar_for_retention(w, d, rating, 1.0)
}

pub(crate) fn next_difficulty_scalar_for_retention(
    w: &[f32],
    d: f32,
    rating: usize,
    retention: f32,
) -> f32 {
    let rating = rating.clamp(1, 4);
    let delta_d = -w[6] * (rating as f32 - 3.0);
    let delta_d = if rating == 1 {
        delta_d * (retention + 0.1)
    } else {
        delta_d
    };
    let new_d = d + linear_damping_scalar(delta_d, d);
    mean_reversion_scalar(init_difficulty_scalar(w, 4), new_d).clamp(super::D_MIN, super::D_MAX)
}

fn stability_for_set_scalar(
    w: &[f32],
    last_s: f32,
    last_d: f32,
    retrievability: f32,
    rating: usize,
    start: usize,
) -> f32 {
    let rating = rating.clamp(1, 4);
    let hard_penalty = if rating == 2 { w[start + 6] } else { 1.0 };
    let easy_bonus = if rating == 4 { w[start + 7] } else { 1.0 };
    let new_s_fail = w[start + 3]
        * ((last_s + 1.0).powf(w[start + 4]) - 1.0)
        * ((1.0 - retrievability) * w[start + 5]).exp();
    let pls = last_s.min(new_s_fail);
    let sinc = (w[start] - 1.5).exp()
        * (11.0 - last_d)
        * last_s.powf(-w[start + 1])
        * (((1.0 - retrievability) * w[start + 2]).exp() - 1.0)
        * hard_penalty
        * easy_bonus
        + 1.0;
    let new_s_success = pls.max(last_s * sinc);
    if rating > 1 { new_s_success } else { pls }.clamp(super::S_MIN, super::S_MAX)
}

pub(crate) fn stability_after_success_scalar(
    w: &[f32],
    s: f32,
    r: f32,
    d: f32,
    rating: usize,
    _delta_t: f32,
) -> f32 {
    stability_for_set_scalar(w, s, d, r, rating, 7)
}

pub(crate) fn stability_after_failure_scalar(
    w: &[f32],
    s: f32,
    r: f32,
    d: f32,
    _delta_t: f32,
) -> f32 {
    stability_for_set_scalar(w, s, d, r, 1, 7)
}

pub(crate) fn stability_short_term_scalar(w: &[f32], s: f32, r: f32, d: f32, rating: usize) -> f32 {
    stability_for_set_scalar(w, s, d, r, rating, 7)
}

fn fast_component_recall_scalar(w: &[f32], t: f32, s_fast: f32) -> f32 {
    let t = t.max(0.0);
    let s_fast = s_fast.clamp(super::S_MIN, super::S_MAX);
    let decay1_mag = (w[23] * s_fast.powf(w[33] - 0.3)).clamp(0.01, 0.95);
    let decay1 = -decay1_mag;
    let factor1 = ((w[25].ln() / decay1).min(60.0)).exp() - 1.0;
    (1.0 + factor1 * (t / s_fast)).powf(decay1)
}

pub(crate) fn fsrs7_next_state_scalar(
    w: &[f32],
    state: MemoryState,
    delta_t: f32,
    rating: usize,
) -> MemoryState {
    let delta_t = delta_t.max(0.0);
    let rating = rating.clamp(1, 4);
    let retrievability = fsrs7_forgetting_curve_scalar_for_state(w, delta_t, state);
    let new_s_slow = stability_for_set_scalar(
        w,
        state.stability,
        state.difficulty,
        retrievability,
        rating,
        7,
    );
    let r_fast = fast_component_recall_scalar(w, delta_t, state.stability_fast);
    let new_s_fast = stability_for_set_scalar(
        w,
        state.stability_fast,
        state.difficulty,
        r_fast,
        rating,
        15,
    );
    let new_s_fast = if rating == 1 {
        new_s_fast.min(new_s_slow * 0.8)
    } else {
        new_s_fast
    };
    let new_d = next_difficulty_scalar_for_retention(w, state.difficulty, rating, retrievability);
    MemoryState {
        stability: new_s_slow,
        difficulty: new_d,
        stability_fast: new_s_fast.clamp(super::S_MIN, super::S_MAX),
    }
}

pub(crate) fn fsrs7_forgetting_curve_scalar_for_state(
    w: &[f32],
    t: f32,
    state: MemoryState,
) -> f32 {
    let t = t.max(0.0);
    let s = state.stability.max(super::S_MIN);
    let s_fast = state.stability_fast.max(super::S_MIN);
    let d = state.difficulty.clamp(super::D_MIN, super::D_MAX);

    let decay1_mag = (w[23] * s_fast.powf(w[33] - 0.3)).clamp(0.01, 0.95);
    let decay1 = -decay1_mag;
    let factor1 = ((w[25].ln() / decay1).min(60.0)).exp() - 1.0;
    let r1 = (1.0 + factor1 * (t / s_fast)).powf(decay1);

    let decay2 = -w[24].clamp(0.01, 0.95);
    let factor2 = w[26].powf(1.0 / decay2) - 1.0;
    let d_timescale = ((d - 5.0) * (w[32] - 0.3)).exp();
    let r2 = (1.0 + factor2 * d_timescale * (t / s)).powf(decay2);

    let weight1 = w[27] * s_fast.powf(-w[29]);
    let weight2 = w[28] * s.powf(w[30]) * ((d - 5.0) * (w[31] - 0.5)).exp();
    let retention = (weight1 * r1 + weight2 * r2) / (weight1 + weight2);
    retention.mul_add(1.0 - 2e-5, 1e-5)
}

pub(crate) fn fsrs7_forgetting_curve_and_derivative_scalar(
    w: &[f32],
    t: f32,
    state: MemoryState,
) -> (f32, f32) {
    let t = t.max(0.0);
    let s = state.stability.max(super::S_MIN);
    let s_fast = state.stability_fast.max(super::S_MIN);
    let d = state.difficulty.clamp(super::D_MIN, super::D_MAX);

    let decay1_mag = (w[23] * s_fast.powf(w[33] - 0.3)).clamp(0.01, 0.95);
    let decay1 = -decay1_mag;
    let factor1 = ((w[25].ln() / decay1).min(60.0)).exp() - 1.0;
    let b1 = 1.0 + factor1 * (t / s_fast);
    let r1 = b1.powf(decay1);
    let dr1_dt = decay1 * b1.powf(decay1 - 1.0) * factor1 / s_fast;

    let decay2 = -w[24].clamp(0.01, 0.95);
    let factor2 = w[26].powf(1.0 / decay2) - 1.0;
    let d_timescale = ((d - 5.0) * (w[32] - 0.3)).exp();
    let b2 = 1.0 + factor2 * d_timescale * (t / s);
    let r2 = b2.powf(decay2);
    let dr2_dt = decay2 * b2.powf(decay2 - 1.0) * factor2 * d_timescale / s;

    let weight1 = w[27] * s_fast.powf(-w[29]);
    let weight2 = w[28] * s.powf(w[30]) * ((d - 5.0) * (w[31] - 0.5)).exp();
    let weight_sum = (weight1 + weight2).max(1e-9);
    let retention = (weight1 * r1 + weight2 * r2) / weight_sum;
    let derivative = (weight1 * dr1_dt + weight2 * dr2_dt) / weight_sum;
    (
        retention.mul_add(1.0 - 2e-5, 1e-5),
        derivative * (1.0 - 2e-5),
    )
}

pub(super) fn fsrs7_next_interval_bisection_scalar(
    w: &[f32],
    stability: f32,
    desired_retention: f32,
    _high_hint: Option<f32>,
) -> f32 {
    fsrs7_next_interval_bisection_scalar_for_state(
        w,
        MemoryState {
            stability,
            difficulty: 5.0,
            stability_fast: stability,
        },
        desired_retention,
    )
}

fn fsrs7_next_interval_bisection_scalar_for_state(
    w: &[f32],
    state: MemoryState,
    desired_retention: f32,
) -> f32 {
    let desired_retention = desired_retention.clamp(DR_MIN, DR_MAX);
    if desired_retention >= DR_MAX {
        return 0.0;
    }
    let mut low = 0.0;
    let mut high = state.stability.max(state.stability_fast).max(1.0);
    while fsrs7_forgetting_curve_scalar_for_state(w, high, state) > desired_retention
        && high < super::S_MAX
    {
        high = (high * 2.0).min(super::S_MAX);
    }
    for _ in 0..BISECTION_ITERS {
        let mid = (low + high) * 0.5;
        if fsrs7_forgetting_curve_scalar_for_state(w, mid, state) > desired_retention {
            low = mid;
        } else {
            high = mid;
        }
    }
    ((low + high) * 0.5).clamp(0.0, super::S_MAX)
}

pub(super) struct Fsrs7S90Lut;

pub(super) fn fsrs7_s90_lut(_w: &[f32]) -> Option<Fsrs7S90Lut> {
    Some(Fsrs7S90Lut)
}

pub(crate) struct Fsrs7Runtime {
    w: Vec<f32>,
}

impl Fsrs7Runtime {
    pub(crate) fn new(w: &[f32]) -> Self {
        Self { w: w.to_vec() }
    }

    pub(crate) fn forgetting_curve(&self, t: f32, stability: f32) -> f32 {
        fsrs7_forgetting_curve_scalar(&self.w, t, stability)
    }

    pub(crate) fn next_interval(&self, stability: f32, desired_retention: f32) -> f32 {
        fsrs7_next_interval_scalar_for_state(
            &self.w,
            MemoryState {
                stability,
                difficulty: 5.0,
                stability_fast: stability,
            },
            desired_retention,
        )
    }
}

pub(super) fn fsrs7_next_interval_scalar(
    w: &[f32],
    stability: f32,
    desired_retention: f32,
    _lut: &Fsrs7S90Lut,
) -> f32 {
    fsrs7_next_interval_scalar_for_state(
        w,
        MemoryState {
            stability,
            difficulty: 5.0,
            stability_fast: stability,
        },
        desired_retention,
    )
}

pub(crate) fn fsrs7_next_interval_scalar_for_state(
    w: &[f32],
    state: MemoryState,
    desired_retention: f32,
) -> f32 {
    let desired_retention = desired_retention.clamp(DR_MIN, DR_MAX);
    if desired_retention >= DR_MAX {
        return 0.0;
    }

    let state = MemoryState {
        stability: state.stability.clamp(super::S_MIN, super::S_MAX),
        difficulty: state.difficulty.clamp(super::D_MIN, super::D_MAX),
        stability_fast: state.stability_fast.clamp(super::S_MIN, super::S_MAX),
    };
    let min_log_t = MIN_T.ln();
    let max_log_t = super::S_MAX.ln();
    let mut log_t = state.stability.max(state.stability_fast).max(MIN_T).ln();
    for _ in 0..INTERVAL_NEWTON_ITERS {
        log_t = log_t.clamp(min_log_t, max_log_t);
        let t = log_t.exp().clamp(MIN_T, super::S_MAX);
        let (retrievability, derivative) =
            fsrs7_forgetting_curve_and_derivative_scalar(w, t, state);
        let df_du = (derivative * t).min(-1e-12);
        let step = ((retrievability - desired_retention) / df_du).clamp(-4.0, 4.0);
        log_t -= step;
        if !log_t.is_finite() {
            return fsrs7_next_interval_bisection_scalar_for_state(w, state, desired_retention);
        }
    }
    let interval = log_t.exp().clamp(0.0, super::S_MAX);
    let retrievability = fsrs7_forgetting_curve_scalar_for_state(w, interval, state);
    if retrievability.is_finite() && (retrievability - desired_retention).abs() <= 1e-3 {
        interval
    } else {
        fsrs7_next_interval_bisection_scalar_for_state(w, state, desired_retention)
    }
}

pub(super) fn power_forgetting_curve<B: Backend>(
    model: &Model<B>,
    t: Tensor<B, 1>,
    s: Tensor<B, 1>,
    s_fast: Tensor<B, 1>,
    d: Tensor<B, 1>,
) -> Tensor<B, 1> {
    let t = t.clamp_min(0.0);
    let s = s.clamp(super::S_MIN, super::S_MAX);
    let s_fast = s_fast.clamp(super::S_MIN, super::S_MAX);
    let d = d.clamp(super::D_MIN, super::D_MAX);

    let t_over_s_fast = t.clone() / s_fast.clone();
    let decay1_mag =
        (model.w.get(23) * s_fast.clone().powf(model.w.get(33).sub_scalar(0.3))).clamp(0.01, 0.95);
    let decay1 = -decay1_mag;
    let factor1 = (model.w.get(25).log() * decay1.clone().powi_scalar(-1))
        .clamp_max(60.0)
        .exp()
        - 1.0;
    let r1 = (t_over_s_fast * factor1 + 1.0).powf(decay1);

    let t_over_s = t / s.clone();
    let decay2 = -model.w.get(24).clamp(0.01, 0.95);
    let factor2 = model.w.get(26).powf(decay2.clone().powi_scalar(-1)) - 1.0;
    let d_timescale = (d.clone().add_scalar(-5.0) * model.w.get(32).sub_scalar(0.3)).exp();
    let r2 = (t_over_s * factor2 * d_timescale + 1.0).powf(decay2);

    let weight1 = model.w.get(27) * s_fast.powf(-model.w.get(29));
    let weight2 = model.w.get(28)
        * s.powf(model.w.get(30))
        * (d.add_scalar(-5.0) * model.w.get(31).sub_scalar(0.5)).exp();
    let retention = (weight1.clone() * r1 + weight2.clone() * r2) / (weight1 + weight2);
    retention.mul_scalar(1.0 - 2e-5).add_scalar(1e-5)
}

fn next_interval<B: Backend>(
    model: &Model<B>,
    stability: Tensor<B, 1>,
    stability_fast: Tensor<B, 1>,
    difficulty: Tensor<B, 1>,
    desired_retention: Tensor<B, 1>,
) -> Tensor<B, 1> {
    let mut log_t = tensor_max(stability.clone(), stability_fast.clone())
        .clamp(MIN_T, super::S_MAX)
        .log();
    let target = desired_retention.clamp(DR_MIN, DR_MAX);
    for _ in 0..INTERVAL_NEWTON_ITERS {
        log_t = log_t.clone().clamp(MIN_T.ln(), super::S_MAX.ln());
        let t = log_t.clone().exp().clamp(MIN_T, super::S_MAX);
        let (retrievability, derivative) = power_forgetting_curve_with_derivative(
            model,
            t.clone(),
            stability.clone(),
            stability_fast.clone(),
            difficulty.clone(),
        );
        let df_du = (derivative * t).clamp_max(-1e-12);
        log_t = log_t - ((retrievability - target.clone()) / df_du).clamp(-4.0, 4.0);
    }
    log_t.exp().clamp(0.0, super::S_MAX)
}

fn power_forgetting_curve_with_derivative<B: Backend>(
    model: &Model<B>,
    t: Tensor<B, 1>,
    s: Tensor<B, 1>,
    s_fast: Tensor<B, 1>,
    d: Tensor<B, 1>,
) -> (Tensor<B, 1>, Tensor<B, 1>) {
    let t = t.clamp_min(0.0);
    let s = s.clamp(super::S_MIN, super::S_MAX);
    let s_fast = s_fast.clamp(super::S_MIN, super::S_MAX);
    let d = d.clamp(super::D_MIN, super::D_MAX);

    let decay1_mag =
        (model.w.get(23) * s_fast.clone().powf(model.w.get(33).sub_scalar(0.3))).clamp(0.01, 0.95);
    let decay1 = -decay1_mag;
    let factor1 = (model.w.get(25).log() * decay1.clone().powi_scalar(-1))
        .clamp_max(60.0)
        .exp()
        - 1.0;
    let b1 = t.clone() / s_fast.clone() * factor1.clone() + 1.0;
    let r1 = b1.clone().powf(decay1.clone());
    let dr1_dt = decay1.clone() * b1.powf(decay1 - 1.0) * factor1 / s_fast.clone();

    let decay2 = -model.w.get(24).clamp(0.01, 0.95);
    let factor2 = model.w.get(26).powf(decay2.clone().powi_scalar(-1)) - 1.0;
    let d_timescale = (d.clone().add_scalar(-5.0) * model.w.get(32).sub_scalar(0.3)).exp();
    let b2 = t / s.clone() * factor2.clone() * d_timescale.clone() + 1.0;
    let r2 = b2.clone().powf(decay2.clone());
    let dr2_dt = decay2.clone() * b2.powf(decay2 - 1.0) * factor2 * d_timescale / s.clone();

    let weight1 = model.w.get(27) * s_fast.powf(-model.w.get(29));
    let weight2 = model.w.get(28)
        * s.powf(model.w.get(30))
        * (d.add_scalar(-5.0) * model.w.get(31).sub_scalar(0.5)).exp();
    let weight_sum = weight1.clone() + weight2.clone();
    let retention = (weight1.clone() * r1 + weight2.clone() * r2) / weight_sum.clone();
    let derivative = (weight1 * dr1_dt + weight2 * dr2_dt) / weight_sum;
    (
        retention.mul_scalar(1.0 - 2e-5).add_scalar(1e-5),
        derivative.mul_scalar(1.0 - 2e-5),
    )
}

pub(super) fn fast_component_recall<B: Backend>(
    model: &Model<B>,
    t: Tensor<B, 1>,
    s_fast: Tensor<B, 1>,
) -> Tensor<B, 1> {
    let t = t.clamp_min(0.0);
    let s_fast = s_fast.clamp(super::S_MIN, super::S_MAX);
    let decay1_mag =
        (model.w.get(23) * s_fast.clone().powf(model.w.get(33).sub_scalar(0.3))).clamp(0.01, 0.95);
    let decay1 = -decay1_mag;
    let factor1 = (model.w.get(25).log() * decay1.clone().powi_scalar(-1))
        .clamp_max(60.0)
        .exp()
        - 1.0;
    (t / s_fast * factor1 + 1.0).powf(decay1)
}

pub(super) fn stability_for_set<B: Backend>(
    model: &Model<B>,
    last_s: Tensor<B, 1>,
    last_d: Tensor<B, 1>,
    r: Tensor<B, 1>,
    rating: Tensor<B, 1>,
    start: usize,
) -> Tensor<B, 1> {
    let batch_size = rating.dims()[0];
    let device = rating.device();
    let hard_penalty = Tensor::ones([batch_size], &device)
        .mask_where(rating.clone().equal_elem(2), model.w.get(start + 6));
    let easy_bonus = Tensor::ones([batch_size], &device)
        .mask_where(rating.clone().equal_elem(4), model.w.get(start + 7));

    let new_s_fail = model.w.get(start + 3)
        * ((last_s.clone() + 1).powf(model.w.get(start + 4)) - 1)
        * ((-r.clone() + 1) * model.w.get(start + 5)).exp();
    let pls = tensor_min(last_s.clone(), new_s_fail);
    let sinc = model.w.get(start).add_scalar(-1.5).exp()
        * last_d.neg().add_scalar(11.0)
        * last_s.clone().powf(-model.w.get(start + 1))
        * (((-r + 1) * model.w.get(start + 2)).exp() - 1)
        * hard_penalty
        * easy_bonus
        + 1;
    let new_s_success = tensor_max(pls.clone(), last_s * sinc);
    pls.mask_where(rating.greater_elem(1), new_s_success)
}

pub(super) fn mean_reversion<B: Backend>(
    init: Tensor<B, 1>,
    current: Tensor<B, 1>,
) -> Tensor<B, 1> {
    init.mul_scalar(0.01) + current.mul_scalar(0.99)
}

pub(super) fn next_difficulty<B: Backend>(
    model: &Model<B>,
    difficulty: Tensor<B, 1>,
    rating: Tensor<B, 1>,
    retention: Tensor<B, 1>,
) -> Tensor<B, 1> {
    let delta_d = -model.w.get(6) * (rating.clone() - 3);
    let surprise = retention.add_scalar(0.1);
    let delta_d_lapse = delta_d.clone() * surprise;
    let delta_d = delta_d.mask_where(rating.equal_elem(1), delta_d_lapse);
    let new_d = difficulty.clone() + model.linear_damping(delta_d, difficulty);
    let device = new_d.device();
    let init = model.init_difficulty(Tensor::from_floats([4.0], &device));
    mean_reversion(init, new_d).clamp(super::D_MIN, super::D_MAX)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::DEFAULT_PARAMETERS;

    #[test]
    fn interval_solver_hits_target() {
        let state = MemoryState {
            stability: 10.0,
            difficulty: 5.0,
            stability_fast: 8.0,
        };
        let interval = fsrs7_next_interval_scalar_for_state(&DEFAULT_PARAMETERS, state, 0.9);
        let r = fsrs7_forgetting_curve_scalar_for_state(&DEFAULT_PARAMETERS, interval, state);
        assert!((r - 0.9).abs() <= 1e-3);
    }
}
