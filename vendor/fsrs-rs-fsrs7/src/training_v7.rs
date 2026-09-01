use crate::inference::MemoryState;
use crate::model::model_v7::{
    fsrs7_forgetting_curve_and_derivative_scalar, fsrs7_next_interval_scalar_for_state,
    fsrs7_next_state_scalar, init_difficulty_scalar,
};
#[cfg(test)]
use crate::model::{Get, Model, ModelVersion};
use crate::simulation::{S_MAX, S_MIN};
#[cfg(test)]
use burn::tensor::Tensor;
#[cfg(test)]
use burn::tensor::backend::Backend;
#[cfg(test)]
use burn::tensor::cast::ToElement;

pub(crate) const PARAM_LEN: usize = 34;
pub(crate) const PENALTY_W_1: f64 = 0.5;
pub(crate) const PENALTY_W_2: f64 = 0.0015;
pub(crate) const PENALTY_W_L2: f64 = 0.5;
pub(crate) const PENALTY_N_REVIEWS: usize = 10;
pub(crate) const PENALTY_TARGET_DR: f32 = 0.90;
pub(crate) const PENALTY_TARGET_DRS: [f32; 1] = [0.99];
pub(crate) const PENALTY_N_NEWTON: usize = 7;
pub(crate) const MIN_T: f32 = 1.0 / 86400.0;
pub(crate) const MAX_T: f32 = 36500.0;
pub(crate) const ONE_DAY: f32 = 1.0;
pub(crate) const SHORT_C: f32 = 600.0 / 86400.0;
pub(crate) const INV_C: f32 = 1.0 / SHORT_C;
pub(crate) const GRAD_LEN: usize = 34;
pub(crate) const PARAMS_STDDEV: [f32; 34] = [
    9999.0, 9999.0, 9999.0, 9999.0, 0.523, 0.2528, 0.4329, 0.2966, 0.2139, 0.2889, 0.1862, 0.175,
    0.3812, 0.3013, 0.9104, 0.3234, 0.2448, 0.3273, 0.1842, 0.1735, 0.4608, 0.311, 0.864, 0.0418,
    0.2596, 0.0798, 0.0682, 0.1282, 0.1397, 0.1407, 0.1489, 0.2, 0.15, 0.15,
];

pub(crate) fn l2_penalty_value_and_grad(
    w: &[f32],
    init_w: &[f32],
    batch_size: usize,
    total_size: usize,
    l2_weight: f64,
    params_stddev: &[f32],
) -> (f64, Vec<f32>) {
    let mut grad = vec![0.0f32; w.len()];
    if total_size == 0 {
        return (0.0, grad);
    }
    let size = w.len().min(init_w.len()).min(params_stddev.len());
    let scale = l2_weight * batch_size as f64 / total_size as f64;
    let mut penalty_sum = 0.0f64;
    for i in 0..size {
        let sigma = params_stddev[i] as f64;
        let denom = sigma * sigma;
        let diff = w[i] as f64 - init_w[i] as f64;
        penalty_sum += diff * diff / denom;
        grad[i] = (2.0 * diff / denom * scale) as f32;
    }
    let penalty = penalty_sum * scale;
    if !penalty.is_finite() {
        return (0.0, vec![0.0; w.len()]);
    }
    for g in &mut grad {
        if !g.is_finite() {
            *g = 0.0;
        }
    }
    (penalty, grad)
}

// Keep Dual35 local to FSRS-7 training: the penalty objective and its gradients
// are expressed against FSRS-7's fixed 34-parameter layout and index mapping.
#[derive(Clone, Copy, Debug)]
struct Dual35 {
    value: f64,
    grad: [f64; GRAD_LEN],
}

impl Dual35 {
    fn constant(value: f64) -> Self {
        Self {
            value,
            grad: [0.0; GRAD_LEN],
        }
    }

    fn variable(value: f64, idx: usize) -> Self {
        let mut grad = [0.0; GRAD_LEN];
        if idx < GRAD_LEN {
            grad[idx] = 1.0;
        }
        Self { value, grad }
    }

    fn add(self, rhs: Self) -> Self {
        let mut grad = [0.0; GRAD_LEN];
        for (i, item) in grad.iter_mut().enumerate().take(GRAD_LEN) {
            *item = self.grad[i] + rhs.grad[i];
        }
        Self {
            value: self.value + rhs.value,
            grad,
        }
    }

    fn sub(self, rhs: Self) -> Self {
        let mut grad = [0.0; GRAD_LEN];
        for (i, item) in grad.iter_mut().enumerate().take(GRAD_LEN) {
            *item = self.grad[i] - rhs.grad[i];
        }
        Self {
            value: self.value - rhs.value,
            grad,
        }
    }

    fn neg(self) -> Self {
        self.mul_const(-1.0)
    }

    fn mul(self, rhs: Self) -> Self {
        let mut grad = [0.0; GRAD_LEN];
        for (i, item) in grad.iter_mut().enumerate().take(GRAD_LEN) {
            *item = self.grad[i] * rhs.value + rhs.grad[i] * self.value;
        }
        Self {
            value: self.value * rhs.value,
            grad,
        }
    }

    fn div(self, rhs: Self) -> Self {
        let denom = (rhs.value * rhs.value).max(1e-18);
        let mut grad = [0.0; GRAD_LEN];
        for (i, item) in grad.iter_mut().enumerate().take(GRAD_LEN) {
            *item = (self.grad[i] * rhs.value - self.value * rhs.grad[i]) / denom;
        }
        Self {
            value: self.value / rhs.value,
            grad,
        }
    }

    fn add_const(self, rhs: f64) -> Self {
        Self {
            value: self.value + rhs,
            grad: self.grad,
        }
    }

    fn sub_const(self, rhs: f64) -> Self {
        Self {
            value: self.value - rhs,
            grad: self.grad,
        }
    }

    fn const_sub(self, lhs: f64) -> Self {
        self.neg().add_const(lhs)
    }

    fn mul_const(self, rhs: f64) -> Self {
        let mut grad = [0.0; GRAD_LEN];
        for (i, item) in grad.iter_mut().enumerate().take(GRAD_LEN) {
            *item = self.grad[i] * rhs;
        }
        Self {
            value: self.value * rhs,
            grad,
        }
    }

    fn div_const(self, rhs: f64) -> Self {
        self.mul_const(1.0 / rhs)
    }

    fn exp(self) -> Self {
        let value = self.value.exp();
        let mut grad = [0.0; GRAD_LEN];
        for (i, item) in grad.iter_mut().enumerate().take(GRAD_LEN) {
            *item = self.grad[i] * value;
        }
        Self { value, grad }
    }

    fn log(self) -> Self {
        let mut grad = [0.0; GRAD_LEN];
        for (i, item) in grad.iter_mut().enumerate().take(GRAD_LEN) {
            *item = self.grad[i] / self.value;
        }
        Self {
            value: self.value.ln(),
            grad,
        }
    }

    fn powf(self, exp: f64) -> Self {
        let value = self.value.powf(exp);
        let coeff = exp * self.value.powf(exp - 1.0);
        let mut grad = [0.0; GRAD_LEN];
        for (i, item) in grad.iter_mut().enumerate().take(GRAD_LEN) {
            *item = self.grad[i] * coeff;
        }
        Self { value, grad }
    }

    fn powi(self, exp: i32) -> Self {
        let value = self.value.powi(exp);
        let coeff = (exp as f64) * self.value.powi(exp - 1);
        let mut grad = [0.0; GRAD_LEN];
        for (i, item) in grad.iter_mut().enumerate().take(GRAD_LEN) {
            *item = self.grad[i] * coeff;
        }
        Self { value, grad }
    }

    fn pow(self, exp: Self) -> Self {
        let base = self.clamp_min(1e-12);
        exp.mul(base.log()).exp()
    }

    fn clamp_min(self, min: f64) -> Self {
        if self.value < min {
            Self::constant(min)
        } else {
            self
        }
    }

    fn clamp_max(self, max: f64) -> Self {
        if self.value > max {
            Self::constant(max)
        } else {
            self
        }
    }

    fn clamp(self, min: f64, max: f64) -> Self {
        self.clamp_min(min).clamp_max(max)
    }

    fn min(self, rhs: Self) -> Self {
        if self.value <= rhs.value { self } else { rhs }
    }

    fn max(self, rhs: Self) -> Self {
        if self.value >= rhs.value { self } else { rhs }
    }
}

fn dual_weights(w: &[f32]) -> [Dual35; GRAD_LEN] {
    std::array::from_fn(|i| Dual35::variable(w[i] as f64, i))
}

fn fsrs7_fc_r_and_drdt_scalar(t: f64, s: f64, w: &[f32]) -> (f64, f64) {
    let s_safe = s.max(1e-12);
    let decay1 = -(w[27] as f64);
    let decay2 = -(w[28] as f64);
    let base1 = (w[29] as f64).max(1e-4);
    let base2 = (w[30] as f64).max(1e-4);
    let bw1 = (w[31] as f64).max(1e-4);
    let bw2 = (w[32] as f64).max(1e-4);
    let swp1 = w[33] as f64;
    let swp2 = w[30] as f64;

    let c1 = base1.powf(1.0 / decay1) - 1.0;
    let c2 = base2.powf(1.0 / decay2) - 1.0;
    let tos = t / s_safe;
    let inner1 = (1.0 + c1 * tos).max(1e-9);
    let inner2 = (1.0 + c2 * tos).max(1e-9);
    let r1 = inner1.powf(decay1);
    let r2 = inner2.powf(decay2);

    let wt1 = bw1 * s_safe.powf(-swp1);
    let wt2 = bw2 * s_safe.powf(swp2);
    let wt_sum = (wt1 + wt2).max(1e-9);
    let r = ((wt1 * r1 + wt2 * r2) / wt_sum).clamp(0.0, 1.0);

    let dr1_dt = decay1 * inner1.powf(decay1 - 1.0) * (c1 / s_safe);
    let dr2_dt = decay2 * inner2.powf(decay2 - 1.0) * (c2 / s_safe);
    let dr_dt = ((wt1 * dr1_dt + wt2 * dr2_dt) / wt_sum).clamp(-1e9, 0.0);
    (r, dr_dt)
}

fn fsrs7_fc_r_dual(t: Dual35, s: Dual35, w: &[Dual35; GRAD_LEN]) -> Dual35 {
    let decay1 = w[27].neg();
    let decay2 = w[28].neg();
    let base1 = w[29].clamp_min(1e-4);
    let base2 = w[30].clamp_min(1e-4);
    let bw1 = w[31].clamp_min(1e-4);
    let bw2 = w[32].clamp_min(1e-4);
    let swp1 = w[33];
    let swp2 = w[30];

    let c1 = base1.pow(decay1.powi(-1)).sub_const(1.0);
    let c2 = base2.pow(decay2.powi(-1)).sub_const(1.0);
    let tos = t.div(s);
    let inner1 = c1.mul(tos).add_const(1.0).clamp_min(1e-9);
    let inner2 = c2.mul(tos).add_const(1.0).clamp_min(1e-9);

    let r1 = inner1.pow(decay1);
    let r2 = inner2.pow(decay2);

    let wt1 = bw1.mul(s.pow(swp1.neg()));
    let wt2 = bw2.mul(s.pow(swp2));
    let wt_sum = wt1.add(wt2).clamp_min(1e-9);
    wt1.mul(r1).add(wt2.mul(r2)).div(wt_sum).clamp(0.0, 1.0)
}

fn fsrs7_init_d_dual(rating: f64, w: &[Dual35; GRAD_LEN]) -> Dual35 {
    w[4].sub(w[5].mul_const(rating - 1.0).exp())
        .add_const(1.0)
        .clamp(1.0, 10.0)
}

fn fsrs7_next_d_good_dual(d: Dual35, init_d4: Dual35) -> Dual35 {
    init_d4
        .mul_const(0.01)
        .add(d.mul_const(0.99))
        .clamp(1.0, 10.0)
}

fn fsrs7_s_fail_long_dual(s: Dual35, d: Dual35, r: Dual35, w: &[Dual35; GRAD_LEN]) -> Dual35 {
    let raw = w[10]
        .mul(d.pow(w[11].neg()))
        .mul(s.add_const(1.0).pow(w[12]).sub_const(1.0))
        .mul(r.const_sub(1.0).mul(w[13]).exp());
    s.min(raw)
}

fn fsrs7_s_fail_short_dual(s: Dual35, d: Dual35, r: Dual35, w: &[Dual35; GRAD_LEN]) -> Dual35 {
    let raw = w[19]
        .mul(d.pow(w[20].neg()))
        .mul(s.add_const(1.0).pow(w[21]).sub_const(1.0))
        .mul(r.const_sub(1.0).mul(w[22]).exp());
    s.min(raw)
}

fn fsrs7_next_s_good_dual(s: Dual35, d: Dual35, delta_t: Dual35, w: &[Dual35; GRAD_LEN]) -> Dual35 {
    let r = fsrs7_fc_r_dual(delta_t, s, w).clamp(0.0001, 0.9999);

    let sf_l = fsrs7_s_fail_long_dual(s, d, r, w);
    let si_l = w[7]
        .sub_const(1.5)
        .exp()
        .mul(d.const_sub(11.0))
        .mul(s.pow(w[8].neg()))
        .mul(
            r.const_sub(1.0)
                .mul(w[9])
                .clamp_max(30.0)
                .exp()
                .sub_const(1.0),
        )
        .add_const(1.0);
    let s_lng = sf_l.max(s.mul(si_l));

    let sf_sh = fsrs7_s_fail_short_dual(s, d, r, w);
    let si_sh = w[16]
        .sub_const(1.5)
        .exp()
        .mul(d.const_sub(11.0))
        .mul(s.pow(w[17].neg()))
        .mul(
            r.const_sub(1.0)
                .mul(w[18])
                .clamp_max(30.0)
                .exp()
                .sub_const(1.0),
        )
        .add_const(1.0);
    let s_sht = sf_sh.max(s.mul(si_sh));

    let coef = Dual35::constant(1.0)
        .sub(w[26].mul(w[25].neg().mul(delta_t).exp()))
        .clamp(0.0, 1.0);
    coef.mul(s_lng)
        .add(Dual35::constant(1.0).sub(coef).mul(s_sht))
        .clamp(S_MIN as f64, S_MAX as f64)
}

fn fsrs7_interval_differentiable_dual(
    s: Dual35,
    target: f64,
    n_newton: usize,
    w: &[f32],
    w_dual: &[Dual35; GRAD_LEN],
) -> Dual35 {
    let s_f = s.value.max(1e-10);
    let d1 = -(w[27] as f64);
    let d2 = -(w[28] as f64);
    let b1 = (w[29] as f64).max(1e-4);
    let b2 = (w[30] as f64).max(1e-4);
    let bw1 = (w[31] as f64).max(1e-4);
    let bw2 = (w[32] as f64).max(1e-4);
    let sw1 = w[33] as f64;
    let sw2 = w[30] as f64;

    let c1 = b1.powf(1.0 / d1) - 1.0;
    let c2 = b2.powf(1.0 / d2) - 1.0;
    let wt1 = bw1 * s_f.powf(-sw1);
    let wt2 = bw2 * s_f.powf(sw2);
    let wts = (wt1 + wt2).max(1e-9);

    let mut u = s_f.ln();
    for _ in 0..n_newton {
        u = u.clamp((MIN_T as f64).ln(), (MAX_T as f64).ln());
        let t = u.exp().clamp(MIN_T as f64, MAX_T as f64);
        let tos = t / s_f;
        let i1 = (1.0 + c1 * tos).max(1e-9);
        let i2 = (1.0 + c2 * tos).max(1e-9);
        let r = (wt1 * i1.powf(d1) + wt2 * i2.powf(d2)) / wts;
        let dr1 = d1 * i1.powf(d1 - 1.0) * c1 / s_f;
        let dr2 = d2 * i2.powf(d2 - 1.0) * c2 / s_f;
        let drdt = (wt1 * dr1 + wt2 * dr2) / wts;
        let dfdu = (drdt * t).min(-1e-12);
        u -= (r - target) / dfdu;
    }

    let t_star = u.exp().clamp(MIN_T as f64, MAX_T as f64);
    let residual = fsrs7_fc_r_dual(Dual35::constant(t_star), s, w_dual).sub_const(target);
    let (_, drdt_s) = fsrs7_fc_r_and_drdt_scalar(t_star, s.value, w);
    let dfdu_s = (drdt_s * t_star).clamp(-1e9, -1e-9);
    Dual35::constant(t_star.ln())
        .sub(residual.div_const(dfdu_s))
        .clamp((MIN_T as f64).ln(), (MAX_T as f64).ln())
        .exp()
}

fn fsrs7_interval_growth_penalty_dual(
    w: &[f32],
    w_dual: &[Dual35; GRAD_LEN],
    n_reviews: usize,
    target_dr: f64,
    n_newton: usize,
) -> Dual35 {
    let mut s = w_dual[2].clamp(S_MIN as f64, S_MAX as f64);
    let init_d4 = fsrs7_init_d_dual(4.0, w_dual);
    let mut d = fsrs7_init_d_dual(3.0, w_dual);
    let mut prev_interval: Option<Dual35> = None;
    let mut best_ratio: Option<Dual35> = None;
    let mut best_val = f64::NEG_INFINITY;
    for _ in 0..n_reviews {
        let t = fsrs7_interval_differentiable_dual(s, target_dr, n_newton, w, w_dual);
        if let Some(prev) = prev_interval {
            if prev.value >= ONE_DAY as f64 {
                let ratio = t.div(prev);
                if ratio.value > best_val {
                    best_val = ratio.value;
                    best_ratio = Some(ratio);
                }
            }
        }
        prev_interval = Some(t);
        s = fsrs7_next_s_good_dual(s, d, t, w_dual);
        d = fsrs7_next_d_good_dual(d, init_d4);
    }
    if let Some(ratio) = best_ratio {
        ratio.powf(2.0)
    } else {
        Dual35::constant(0.0)
    }
}

fn fsrs7_short_interval_penalty_dual(
    w: &[f32],
    w_dual: &[Dual35; GRAD_LEN],
    n_reviews: usize,
    n_newton: usize,
    target_drs: &[f32],
) -> Dual35 {
    let mut penalty_sum = Dual35::constant(0.0);
    let mut penalty_count = 0usize;
    for &target_dr in target_drs {
        let mut s = w_dual[2].clamp(S_MIN as f64, S_MAX as f64);
        let init_d4 = fsrs7_init_d_dual(4.0, w_dual);
        let mut d = fsrs7_init_d_dual(3.0, w_dual);
        let mut short_sum = Dual35::constant(0.0);
        let mut short_count = 0usize;
        for _ in 0..n_reviews {
            let t = fsrs7_interval_differentiable_dual(s, target_dr as f64, n_newton, w, w_dual);
            if t.value < ONE_DAY as f64 {
                short_sum = short_sum.add(t);
                short_count += 1;
            }
            s = fsrs7_next_s_good_dual(s, d, t, w_dual);
            d = fsrs7_next_d_good_dual(d, init_d4);
        }
        if short_count == 0 {
            continue;
        }
        let avg_t = short_sum
            .div_const(short_count as f64)
            .clamp_min(MIN_T as f64);
        let inv_x = avg_t.powf(-1.0);
        let penalty = inv_x.clamp_min(INV_C as f64).sub_const(INV_C as f64);
        penalty_sum = penalty_sum.add(penalty);
        penalty_count += 1;
    }
    if penalty_count == 0 {
        Dual35::constant(0.0)
    } else {
        penalty_sum.div_const(penalty_count as f64)
    }
}

#[derive(Clone, Copy)]
struct DualState {
    stability: Dual35,
    stability_fast: Dual35,
    difficulty: Dual35,
}

impl DualState {
    fn scalar(self) -> MemoryState {
        MemoryState {
            stability: self.stability.value as f32,
            stability_fast: self.stability_fast.value as f32,
            difficulty: self.difficulty.value as f32,
        }
    }
}

fn init_difficulty_dual(w: &[Dual35; GRAD_LEN], rating: f64) -> Dual35 {
    w[4].sub(w[5].mul_const(rating - 1.0).exp())
        .add_const(1.0)
        .clamp(1.0, 10.0)
}

fn initial_dual_state(w: &[Dual35; GRAD_LEN]) -> DualState {
    let stability = w[2].clamp(S_MIN as f64, S_MAX as f64);
    DualState {
        stability,
        stability_fast: stability.mul_const(0.8).clamp(S_MIN as f64, S_MAX as f64),
        difficulty: init_difficulty_dual(w, 3.0),
    }
}

fn fast_component_recall_dual(w: &[Dual35; GRAD_LEN], t: Dual35, stability_fast: Dual35) -> Dual35 {
    let t = t.clamp_min(0.0);
    let stability_fast = stability_fast.clamp(S_MIN as f64, S_MAX as f64);
    let decay1_mag = w[23]
        .mul(stability_fast.pow(w[33].sub_const(0.3)))
        .clamp(0.01, 0.95);
    let decay1 = decay1_mag.neg();
    let factor1 = w[25].log().div(decay1).clamp_max(60.0).exp().sub_const(1.0);
    t.div(stability_fast)
        .mul(factor1)
        .add_const(1.0)
        .pow(decay1)
}

fn forgetting_curve_dual(w: &[Dual35; GRAD_LEN], t: Dual35, state: DualState) -> Dual35 {
    let t = t.clamp_min(0.0);
    let stability = state.stability.clamp(S_MIN as f64, S_MAX as f64);
    let stability_fast = state.stability_fast.clamp(S_MIN as f64, S_MAX as f64);
    let difficulty = state.difficulty.clamp(1.0, 10.0);

    let decay1_mag = w[23]
        .mul(stability_fast.pow(w[33].sub_const(0.3)))
        .clamp(0.01, 0.95);
    let decay1 = decay1_mag.neg();
    let factor1 = w[25].log().div(decay1).clamp_max(60.0).exp().sub_const(1.0);
    let r1 = t
        .div(stability_fast)
        .mul(factor1)
        .add_const(1.0)
        .pow(decay1);

    let decay2 = w[24].clamp(0.01, 0.95).neg();
    let factor2 = w[26].pow(Dual35::constant(1.0).div(decay2)).sub_const(1.0);
    let d_timescale = difficulty.sub_const(5.0).mul(w[32].sub_const(0.3)).exp();
    let r2 = t
        .div(stability)
        .mul(factor2)
        .mul(d_timescale)
        .add_const(1.0)
        .pow(decay2);

    let weight1 = w[27].mul(stability_fast.pow(w[29].neg()));
    let weight2 = w[28]
        .mul(stability.pow(w[30]))
        .mul(difficulty.sub_const(5.0).mul(w[31].sub_const(0.5)).exp());
    weight1
        .mul(r1)
        .add(weight2.mul(r2))
        .div(weight1.add(weight2).clamp_min(1e-9))
        .mul_const(1.0 - 2e-5)
        .add_const(1e-5)
}

fn stability_for_set_dual(
    w: &[Dual35; GRAD_LEN],
    last_s: Dual35,
    last_d: Dual35,
    retrievability: Dual35,
    rating: usize,
    start: usize,
) -> Dual35 {
    let hard_penalty = if rating == 2 {
        w[start + 6]
    } else {
        Dual35::constant(1.0)
    };
    let easy_bonus = if rating == 4 {
        w[start + 7]
    } else {
        Dual35::constant(1.0)
    };
    let new_s_fail = w[start + 3]
        .mul(last_s.add_const(1.0).pow(w[start + 4]).sub_const(1.0))
        .mul(retrievability.const_sub(1.0).mul(w[start + 5]).exp());
    let pls = last_s.min(new_s_fail);
    if rating <= 1 {
        return pls.clamp(S_MIN as f64, S_MAX as f64);
    }
    let sinc = w[start]
        .sub_const(1.5)
        .exp()
        .mul(last_d.const_sub(11.0))
        .mul(last_s.pow(w[start + 1].neg()))
        .mul(
            retrievability
                .const_sub(1.0)
                .mul(w[start + 2])
                .exp()
                .sub_const(1.0),
        )
        .mul(hard_penalty)
        .mul(easy_bonus)
        .add_const(1.0);
    pls.max(last_s.mul(sinc)).clamp(S_MIN as f64, S_MAX as f64)
}

fn next_difficulty_dual(
    w: &[Dual35; GRAD_LEN],
    difficulty: Dual35,
    rating: usize,
    retention: Dual35,
) -> Dual35 {
    let rating_f = rating.clamp(1, 4) as f64;
    let delta_d = w[6].neg().mul_const(rating_f - 3.0);
    let delta_d = if rating == 1 {
        delta_d.mul(retention.add_const(0.1))
    } else {
        delta_d
    };
    let new_d = difficulty.add(difficulty.const_sub(10.0).mul(delta_d).div_const(9.0));
    init_difficulty_dual(w, 4.0)
        .mul_const(0.01)
        .add(new_d.mul_const(0.99))
        .clamp(1.0, 10.0)
}

fn next_state_dual(
    w: &[Dual35; GRAD_LEN],
    state: DualState,
    delta_t: Dual35,
    rating: usize,
) -> DualState {
    let rating = rating.clamp(1, 4);
    let retrievability = forgetting_curve_dual(w, delta_t, state);
    let new_s_slow = stability_for_set_dual(
        w,
        state.stability,
        state.difficulty,
        retrievability,
        rating,
        7,
    );
    let r_fast = fast_component_recall_dual(w, delta_t, state.stability_fast);
    let new_s_fast = stability_for_set_dual(
        w,
        state.stability_fast,
        state.difficulty,
        r_fast,
        rating,
        15,
    );
    let new_s_fast = if rating == 1 {
        new_s_fast.min(new_s_slow.mul_const(0.8))
    } else {
        new_s_fast
    };
    DualState {
        stability: new_s_slow,
        stability_fast: new_s_fast.clamp(S_MIN as f64, S_MAX as f64),
        difficulty: next_difficulty_dual(w, state.difficulty, rating, retrievability),
    }
}

fn next_interval_dual(
    w: &[f32],
    w_dual: &[Dual35; GRAD_LEN],
    state: DualState,
    desired_retention: f32,
) -> Dual35 {
    let scalar_state = state.scalar();
    let interval = fsrs7_next_interval_scalar_for_state(w, scalar_state, desired_retention)
        .clamp(MIN_T, S_MAX);
    let interval_dual = Dual35::constant(interval as f64);
    let residual =
        forgetting_curve_dual(w_dual, interval_dual, state).sub_const(desired_retention as f64);
    let (_, drdt) = fsrs7_forgetting_curve_and_derivative_scalar(w, interval, scalar_state);
    let dfdu = ((drdt * interval) as f64).clamp(-1e9, -1e-9);
    let mut lifted = Dual35::constant((interval as f64).ln())
        .sub(residual.div_const(dfdu))
        .clamp((MIN_T as f64).ln(), (S_MAX as f64).ln())
        .exp();
    lifted.value = interval as f64;
    lifted
}

fn interval_growth_penalty_dual(
    w: &[f32],
    w_dual: &[Dual35; GRAD_LEN],
    n_reviews: usize,
    target_dr: f32,
) -> Dual35 {
    let mut state = initial_dual_state(w_dual);
    let mut prev_interval: Option<Dual35> = None;
    let mut best_ratio: Option<Dual35> = None;
    let mut best_value = f64::NEG_INFINITY;
    for _ in 0..n_reviews {
        let interval = next_interval_dual(w, w_dual, state, target_dr);
        if let Some(prev) = prev_interval {
            if prev.value >= ONE_DAY as f64 {
                let ratio = interval.div(prev);
                if ratio.value > best_value {
                    best_value = ratio.value;
                    best_ratio = Some(ratio);
                }
            }
        }
        prev_interval = Some(interval);
        state = next_state_dual(w_dual, state, interval, 3);
    }
    best_ratio.map_or(Dual35::constant(0.0), |ratio| ratio.powf(2.0))
}

fn short_interval_penalty_dual(
    w: &[f32],
    w_dual: &[Dual35; GRAD_LEN],
    n_reviews: usize,
    target_drs: &[f32],
) -> Dual35 {
    let mut penalty_sum = Dual35::constant(0.0);
    let mut penalty_count = 0usize;
    for &target_dr in target_drs {
        let mut state = initial_dual_state(w_dual);
        let mut short_sum = Dual35::constant(0.0);
        let mut short_count = 0usize;
        for _ in 0..n_reviews {
            let interval = next_interval_dual(w, w_dual, state, target_dr);
            if interval.value < ONE_DAY as f64 {
                short_sum = short_sum.add(interval);
                short_count += 1;
            }
            state = next_state_dual(w_dual, state, interval, 3);
        }
        if short_count == 0 {
            continue;
        }
        let avg_interval = short_sum
            .div_const(short_count as f64)
            .clamp_min(MIN_T as f64);
        let penalty = avg_interval
            .powf(-1.0)
            .clamp_min(INV_C as f64)
            .sub_const(INV_C as f64);
        penalty_sum = penalty_sum.add(penalty);
        penalty_count += 1;
    }
    if penalty_count == 0 {
        Dual35::constant(0.0)
    } else {
        penalty_sum.div_const(penalty_count as f64)
    }
}

fn schedule_penalty_dual(w: &[f32]) -> Dual35 {
    let w_dual = dual_weights(w);
    let p1 = interval_growth_penalty_dual(
        &w[..PARAM_LEN],
        &w_dual,
        PENALTY_N_REVIEWS,
        PENALTY_TARGET_DR,
    );
    let p2 = short_interval_penalty_dual(
        &w[..PARAM_LEN],
        &w_dual,
        PENALTY_N_REVIEWS,
        &PENALTY_TARGET_DRS,
    );
    p1.mul_const(PENALTY_W_1).add(p2.mul_const(PENALTY_W_2))
}

pub(crate) fn schedule_penalty_value_and_grad(
    w: &[f32],
    batch_size: usize,
) -> (f64, [f64; GRAD_LEN]) {
    if w.len() < PARAM_LEN || batch_size == 0 {
        return (0.0, [0.0; GRAD_LEN]);
    }
    let value = schedule_penalty_value(w);
    if !value.is_finite() {
        return (0.0, [0.0; GRAD_LEN]);
    }
    let penalty = schedule_penalty_dual(w);
    if !penalty.value.is_finite() {
        return (0.0, [0.0; GRAD_LEN]);
    }
    let scale = batch_size as f64;
    let mut grad = [0.0; GRAD_LEN];
    for (dst, src) in grad.iter_mut().zip(penalty.grad) {
        if src.is_finite() {
            *dst = src * scale;
        }
    }
    (value * scale, grad)
}

pub(crate) fn maybe_schedule_penalty_value_and_grad(
    w: &[f32],
    batch_size: usize,
    enable_sched_penalties: bool,
) -> (f64, [f64; GRAD_LEN]) {
    if enable_sched_penalties {
        schedule_penalty_value_and_grad(w, batch_size)
    } else {
        (0.0, [0.0; GRAD_LEN])
    }
}

fn initial_penalty_state(w: &[f32]) -> MemoryState {
    let stability = w[2].clamp(S_MIN, S_MAX);
    MemoryState {
        stability,
        difficulty: init_difficulty_scalar(w, 3),
        stability_fast: (stability * 0.8).clamp(S_MIN, S_MAX),
    }
}

fn schedule_penalty_value(w: &[f32]) -> f64 {
    if w.len() < PARAM_LEN {
        return 0.0;
    }
    let p1 = interval_growth_penalty_value(w, PENALTY_N_REVIEWS, PENALTY_TARGET_DR);
    let p2 = short_interval_penalty_value(w, PENALTY_N_REVIEWS, &PENALTY_TARGET_DRS);
    let penalty = p1 * PENALTY_W_1 + p2 * PENALTY_W_2;
    if penalty.is_finite() { penalty } else { 0.0 }
}

fn interval_growth_penalty_value(w: &[f32], n_reviews: usize, target_dr: f32) -> f64 {
    let mut state = initial_penalty_state(w);
    let mut prev_interval: Option<f32> = None;
    let mut best_ratio = 0.0_f64;
    for _ in 0..n_reviews {
        let interval = fsrs7_next_interval_scalar_for_state(w, state, target_dr);
        if let Some(prev) = prev_interval {
            if prev >= ONE_DAY && interval.is_finite() && prev.is_finite() {
                best_ratio = best_ratio.max((interval / prev) as f64);
            }
        }
        prev_interval = Some(interval);
        state = fsrs7_next_state_scalar(w, state, interval, 3);
    }
    best_ratio * best_ratio
}

fn short_interval_penalty_value(w: &[f32], n_reviews: usize, target_drs: &[f32]) -> f64 {
    let mut penalty_sum = 0.0_f64;
    let mut penalty_count = 0_usize;
    for &target_dr in target_drs {
        let mut state = initial_penalty_state(w);
        let mut short_sum = 0.0_f64;
        let mut short_count = 0_usize;
        for _ in 0..n_reviews {
            let interval = fsrs7_next_interval_scalar_for_state(w, state, target_dr);
            if interval.is_finite() && interval < ONE_DAY {
                short_sum += interval as f64;
                short_count += 1;
            }
            state = fsrs7_next_state_scalar(w, state, interval, 3);
        }
        if short_count > 0 {
            let avg_t = (short_sum / short_count as f64).max(MIN_T as f64);
            penalty_sum += avg_t.recip().max(INV_C as f64) - INV_C as f64;
            penalty_count += 1;
        }
    }
    if penalty_count == 0 {
        0.0
    } else {
        penalty_sum / penalty_count as f64
    }
}

#[cfg(test)]
impl<B: Backend> Model<B> {
    fn fsrs7_fc_r_and_drdt(
        &self,
        t: Tensor<B, 1>,
        s: Tensor<B, 1>,
    ) -> (Tensor<B, 1>, Tensor<B, 1>) {
        let w = self.w.val();
        let decay1 = -w.get(27);
        let decay2 = -w.get(28);
        let base1 = w.get(29).clamp_min(1e-4);
        let base2 = w.get(30).clamp_min(1e-4);
        let bw1 = w.get(31).clamp_min(1e-4);
        let bw2 = w.get(32).clamp_min(1e-4);
        let swp1 = w.get(33);
        let swp2 = w.get(34);

        let c1 = base1.powf(decay1.clone().powi_scalar(-1)) - 1.0;
        let c2 = base2.powf(decay2.clone().powi_scalar(-1)) - 1.0;
        let tos = t / s.clone();
        let inner1 = (c1.clone() * tos.clone() + 1.0).clamp_min(1e-9);
        let inner2 = (c2.clone() * tos + 1.0).clamp_min(1e-9);

        let r1 = inner1.clone().powf(decay1.clone());
        let r2 = inner2.clone().powf(decay2.clone());

        let wt1 = bw1 * s.clone().powf(-swp1);
        let wt2 = bw2 * s.clone().powf(swp2);
        let wt_sum = (wt1.clone() + wt2.clone()).clamp_min(1e-9);

        let r = ((wt1.clone() * r1 + wt2.clone() * r2) / wt_sum.clone()).clamp(0.0, 1.0);

        let dr1_dt = decay1.clone() * inner1.powf(decay1 - 1.0) * (c1 / s.clone());
        let dr2_dt = decay2.clone() * inner2.powf(decay2 - 1.0) * (c2 / s);
        let dr_dt = ((wt1 * dr1_dt + wt2 * dr2_dt) / wt_sum).clamp(-1e9, 0.0);
        (r, dr_dt)
    }

    fn fsrs7_init_d(&self, rating: f32) -> Tensor<B, 1> {
        let w = self.w.val();
        (w.get(4) - (w.get(5) * (rating - 1.0)).exp() + 1.0).clamp(1.0, 10.0)
    }

    fn fsrs7_next_d_good(&self, d: Tensor<B, 1>, init_d4: Tensor<B, 1>) -> Tensor<B, 1> {
        (init_d4.mul_scalar(0.01) + d.mul_scalar(0.99)).clamp(1.0, 10.0)
    }

    fn fsrs7_s_fail_long(&self, s: Tensor<B, 1>, d: Tensor<B, 1>, r: Tensor<B, 1>) -> Tensor<B, 1> {
        let w = self.w.val();
        let raw = w.get(10)
            * d.powf(-w.get(11))
            * ((s.clone() + 1.0).powf(w.get(12)) - 1.0)
            * ((r.neg() + 1.0) * w.get(13)).exp();
        s.clone().mask_where(s.clone().greater(raw.clone()), raw)
    }

    fn fsrs7_s_fail_short(
        &self,
        s: Tensor<B, 1>,
        d: Tensor<B, 1>,
        r: Tensor<B, 1>,
    ) -> Tensor<B, 1> {
        let w = self.w.val();
        let raw = w.get(19)
            * d.powf(-w.get(20))
            * ((s.clone() + 1.0).powf(w.get(21)) - 1.0)
            * ((r.neg() + 1.0) * w.get(22)).exp();
        s.clone().mask_where(s.clone().greater(raw.clone()), raw)
    }

    fn fsrs7_next_s_good(
        &self,
        s: Tensor<B, 1>,
        d: Tensor<B, 1>,
        delta_t: Tensor<B, 1>,
    ) -> Tensor<B, 1> {
        let w = self.w.val();
        let r = self
            .fsrs7_fc_r_and_drdt(delta_t.clone(), s.clone())
            .0
            .clamp(0.0001, 0.9999);

        let sf_l = self.fsrs7_s_fail_long(s.clone(), d.clone(), r.clone());
        let si_l = (w.get(7) - 1.5).exp()
            * (d.clone().neg() + 11.0)
            * s.clone().powf(-w.get(8))
            * (((r.clone().neg() + 1.0) * w.get(9)).clamp(-1e9, 30.0).exp() - 1.0)
            + 1.0;
        let s_lng = sf_l.clone().mask_where(
            sf_l.clone().lower((s.clone() * si_l.clone()).clone()),
            s.clone() * si_l,
        );

        let sf_sh = self.fsrs7_s_fail_short(s.clone(), d.clone(), r.clone());
        let si_sh = (w.get(16) - 1.5).exp()
            * (d.clone().neg() + 11.0)
            * s.clone().powf(-w.get(17))
            * (((r.neg() + 1.0) * w.get(18)).clamp(-1e9, 30.0).exp() - 1.0)
            + 1.0;
        let s_sht = sf_sh.clone().mask_where(
            sf_sh.clone().lower((s.clone() * si_sh.clone()).clone()),
            s.clone() * si_sh,
        );

        let coef = ((w.get(26) * (-w.get(25) * delta_t).exp()).neg() + 1.0).clamp(0.0, 1.0);
        (coef.clone() * s_lng + (coef.neg() + 1.0) * s_sht).clamp(S_MIN, S_MAX)
    }

    fn fsrs7_interval_differentiable(
        &self,
        s: Tensor<B, 1>,
        target: f32,
        n_newton: usize,
        w_vec: &[f32],
    ) -> Tensor<B, 1> {
        let s_f = s.clone().into_scalar().to_f32() as f64;
        let d1 = -w_vec[27] as f64;
        let d2 = -w_vec[28] as f64;
        let b1 = (w_vec[29].max(1e-4)) as f64;
        let b2 = (w_vec[30].max(1e-4)) as f64;
        let bw1 = (w_vec[31].max(1e-4)) as f64;
        let bw2 = (w_vec[32].max(1e-4)) as f64;
        let sw1 = w_vec[33] as f64;
        let sw2 = w_vec[30] as f64;

        let c1 = b1.powf(1.0 / d1) - 1.0;
        let c2 = b2.powf(1.0 / d2) - 1.0;
        let wt1 = bw1 * s_f.powf(-sw1);
        let wt2 = bw2 * s_f.powf(sw2);
        let wts = (wt1 + wt2).max(1e-9);

        let mut u = s_f.max(1e-10).ln();
        for _ in 0..n_newton {
            u = u.clamp((MIN_T as f64).ln(), (MAX_T as f64).ln());
            let t = u.exp().clamp(MIN_T as f64, MAX_T as f64);
            let tos = t / s_f.max(1e-10);
            let i1 = (1.0 + c1 * tos).max(1e-9);
            let i2 = (1.0 + c2 * tos).max(1e-9);
            let r = (wt1 * i1.powf(d1) + wt2 * i2.powf(d2)) / wts;
            let dr1 = d1 * i1.powf(d1 - 1.0) * c1 / s_f.max(1e-10);
            let dr2 = d2 * i2.powf(d2 - 1.0) * c2 / s_f.max(1e-10);
            let drdt = (wt1 * dr1 + wt2 * dr2) / wts;
            let dfdu = (drdt * t).min(-1e-12);
            u -= (r - target as f64) / dfdu;
        }

        let t_star = u.exp().clamp(MIN_T as f64, MAX_T as f64) as f32;
        let device = self.w.val().device();
        let t_d = Tensor::from_floats([t_star], &device).detach();
        let (r_s, drdt_s) = self.fsrs7_fc_r_and_drdt(t_d.clone(), s);
        let residual = r_s - target;
        let dfdu_s = (drdt_s * t_d.clone()).detach().clamp(-1e9, -1e-9);
        let u_lifted = t_d.log() - residual / dfdu_s;
        u_lifted.clamp(MIN_T.ln(), MAX_T.ln()).exp()
    }

    fn fsrs7_interval_growth_penalty(
        &self,
        n_reviews: usize,
        target_dr: f32,
        n_newton: usize,
        w_vec: &[f32],
    ) -> Tensor<B, 1> {
        let mut s = self.w.val().get(2).clamp(S_MIN, S_MAX);
        let init_d4 = self.fsrs7_init_d(4.0);
        let mut d = self.fsrs7_init_d(3.0);
        let mut prev_interval: Option<Tensor<B, 1>> = None;
        let mut best_ratio: Option<Tensor<B, 1>> = None;
        let mut best_val = f32::NEG_INFINITY;
        for _ in 0..n_reviews {
            let t = self.fsrs7_interval_differentiable(s.clone(), target_dr, n_newton, w_vec);
            if let Some(prev) = &prev_interval {
                let prev_val = prev.clone().detach().into_scalar().to_f32();
                if prev_val >= ONE_DAY {
                    let ratio = t.clone() / prev.clone();
                    let ratio_val = ratio.clone().detach().into_scalar().to_f32();
                    if ratio_val > best_val {
                        best_val = ratio_val;
                        best_ratio = Some(ratio);
                    }
                }
            }
            prev_interval = Some(t.clone());
            s = self.fsrs7_next_s_good(s, d.clone(), t);
            d = self.fsrs7_next_d_good(d, init_d4.clone());
        }
        if let Some(ratio) = best_ratio {
            ratio.powi_scalar(2)
        } else {
            Tensor::zeros([1], &self.w.device())
        }
    }

    fn fsrs7_short_interval_penalty(
        &self,
        n_reviews: usize,
        n_newton: usize,
        target_drs: &[f32],
        w_vec: &[f32],
    ) -> Tensor<B, 1> {
        let device = self.w.val().device();
        let mut penalties: Vec<Tensor<B, 1>> = Vec::with_capacity(target_drs.len());

        for &target_dr in target_drs {
            let mut s = self.w.val().get(2).clamp(S_MIN, S_MAX);
            let init_d4 = self.fsrs7_init_d(4.0);
            let mut d = self.fsrs7_init_d(3.0);
            let mut short_sum: Option<Tensor<B, 1>> = None;
            let mut short_count = 0usize;

            for _ in 0..n_reviews {
                let t = self.fsrs7_interval_differentiable(s.clone(), target_dr, n_newton, w_vec);
                if t.clone().detach().into_scalar().to_f32() < ONE_DAY {
                    short_sum = Some(match short_sum {
                        Some(current) => current + t.clone(),
                        None => t.clone(),
                    });
                    short_count += 1;
                }
                s = self.fsrs7_next_s_good(s, d.clone(), t);
                d = self.fsrs7_next_d_good(d, init_d4.clone());
            }

            if short_count == 0 {
                continue;
            }

            let avg_t = short_sum
                .expect("short_sum must exist when short_count > 0")
                .div_scalar(short_count as f64)
                .clamp_min(MIN_T);
            let inv_x = avg_t.powi_scalar(-1);
            penalties.push(inv_x.clamp_min(INV_C) - INV_C);
        }

        if penalties.is_empty() {
            Tensor::zeros([1], &device)
        } else {
            Tensor::cat(penalties, 0).mean()
        }
    }

    pub(crate) fn fsrs7_schedule_penalty(&self, batch_size: usize) -> Tensor<B, 1> {
        let device = self.w.val().device();
        if !matches!(
            ModelVersion::from_param_count(self.w.val().dims()[0]),
            ModelVersion::Fsrs7
        ) {
            return Tensor::zeros([1], &device);
        }
        let w_vec = self.w.val().to_data().to_vec::<f32>().unwrap();
        let p1 = self.fsrs7_interval_growth_penalty(
            PENALTY_N_REVIEWS,
            PENALTY_TARGET_DR,
            PENALTY_N_NEWTON,
            &w_vec,
        );
        let p1 = if p1.clone().detach().into_scalar().to_f32().is_finite() {
            p1
        } else {
            Tensor::zeros([1], &device)
        };
        let p2 = self.fsrs7_short_interval_penalty(
            PENALTY_N_REVIEWS,
            PENALTY_N_NEWTON,
            &PENALTY_TARGET_DRS,
            &w_vec,
        );
        let p2 = if p2.clone().detach().into_scalar().to_f32().is_finite() {
            p2
        } else {
            Tensor::zeros([1], &device)
        };
        (p1.mul_scalar(PENALTY_W_1) + p2.mul_scalar(PENALTY_W_2)).mul_scalar(batch_size as f64)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::DEFAULT_PARAMETERS;
    use crate::dataset::FSRSBatch;
    use crate::model::{Get, Model, ModelConfig};
    use burn::backend::Autodiff;
    use burn::backend::NdArray;
    use burn::backend::ndarray::NdArrayDevice;
    use burn::nn::loss::Reduction;
    use burn::tensor::Tensor;
    use burn::tensor::TensorData;
    use burn::tensor::cast::ToElement;

    #[test]
    fn test_fsrs7_schedule_penalty_toggle() {
        let w = DEFAULT_PARAMETERS.to_vec();
        let batch_size = 512;

        let (enabled_value, enabled_grad) =
            maybe_schedule_penalty_value_and_grad(&w, batch_size, true);
        assert!(enabled_value.is_finite());
        assert!(enabled_value >= 0.0);
        assert!(enabled_grad.iter().any(|g| g.abs() > 0.0));

        let (disabled_value, disabled_grad) =
            maybe_schedule_penalty_value_and_grad(&w, batch_size, false);
        assert_eq!(disabled_value, 0.0);
        assert!(disabled_grad.iter().all(|g| *g == 0.0));
    }

    #[test]
    fn test_fsrs7_schedule_penalty_is_finite() {
        let w = DEFAULT_PARAMETERS.to_vec();
        let (penalty, _grad) = schedule_penalty_value_and_grad(&w, 512);
        let expected = schedule_penalty_value(&w) * 512.0;
        assert!(penalty.is_finite());
        assert!(penalty >= 0.0);
        assert!(
            (penalty - expected).abs() < 1e-6,
            "penalty {penalty}, expected {expected}"
        );
    }

    #[test]
    fn test_fsrs7_schedule_penalty_has_finite_gradients() {
        let w = DEFAULT_PARAMETERS.to_vec();
        let (value, grads) = schedule_penalty_value_and_grad(&w, 512);
        assert!(value.is_finite());
        assert!(grads.iter().all(|v| v.is_finite()));
        assert!(grads.iter().any(|v| v.abs() > 0.0));
    }

    #[test]
    #[ignore = "legacy autodiff FSRS-7 schedule-penalty test for the removed 35-parameter path"]
    fn test_manual_schedule_penalty_matches_autodiff_gradient() {
        type B = Autodiff<NdArray<f32>>;
        let config = ModelConfig::default();
        let model: Model<B> = config.init();
        let w_vec = model.w.val().to_data().to_vec::<f32>().unwrap();

        let (actual_value, actual_grad) = schedule_penalty_value_and_grad(&w_vec, 512);
        let penalty = model.fsrs7_schedule_penalty(512);
        let expected_value = penalty.clone().into_scalar().to_f64();
        assert!(
            (actual_value - expected_value).abs() < 5e-3,
            "schedule value mismatch actual={} expected={}",
            actual_value,
            expected_value
        );

        let gradients = penalty.backward();
        let expected_grad = model
            .w
            .grad(&gradients)
            .unwrap()
            .to_data()
            .to_vec::<f32>()
            .unwrap();
        let mut max_abs_diff = 0.0f32;
        let mut max_index = 0usize;
        let mut expected_norm2 = 0.0f64;
        let mut diff_norm2 = 0.0f64;
        for (idx, (actual, expected)) in actual_grad.iter().zip(expected_grad.iter()).enumerate() {
            let diff = ((*actual as f32) - *expected).abs();
            expected_norm2 += (*expected as f64) * (*expected as f64);
            diff_norm2 += (diff as f64) * (diff as f64);
            if diff > max_abs_diff {
                max_abs_diff = diff;
                max_index = idx;
            }
        }
        let relative_l2 = (diff_norm2.sqrt() / expected_norm2.sqrt().max(1e-12)) as f32;
        assert!(
            max_abs_diff < 0.2 && relative_l2 < 2e-3,
            "schedule grad mismatch max_abs_diff={} at index={} actual={} expected={} relative_l2={}",
            max_abs_diff,
            max_index,
            actual_grad[max_index],
            expected_grad[max_index],
            relative_l2
        );
    }

    #[test]
    #[ignore = "legacy autodiff FSRS-7 schedule-penalty test for the removed 35-parameter path"]
    fn test_manual_penalty_gradient_matches_autodiff_combined_objective() {
        type B = Autodiff<NdArray<f32>>;
        let config = ModelConfig::default();
        let model: Model<B> = config.init();
        let device = NdArrayDevice::Cpu;
        let total_size = 1000usize;
        let batch_size = 512usize;

        let w_vec = model.w.val().to_data().to_vec::<f32>().unwrap();
        let mut init_w_vec = w_vec.clone();
        for (i, init) in init_w_vec.iter_mut().enumerate() {
            *init -= 0.05 * ((i + 1) as f32) / (GRAD_LEN as f32);
        }

        let build_batch = || FSRSBatch {
            t_historys: Tensor::from_floats(
                TensorData::from([
                    [0.0, 0.0, 0.0, 0.0],
                    [0.0, 0.0, 0.0, 0.0],
                    [0.0, 0.0, 0.0, 1.0],
                    [0.0, 1.0, 1.0, 3.0],
                    [1.0, 3.0, 3.0, 5.0],
                    [3.0, 6.0, 6.0, 12.0],
                ]),
                &device,
            ),
            r_historys: Tensor::from_floats(
                TensorData::from([
                    [1.0, 2.0, 3.0, 4.0],
                    [3.0, 4.0, 2.0, 4.0],
                    [1.0, 4.0, 4.0, 3.0],
                    [4.0, 3.0, 3.0, 3.0],
                    [3.0, 1.0, 3.0, 3.0],
                    [2.0, 3.0, 3.0, 4.0],
                ]),
                &device,
            ),
            delta_ts: Tensor::from_floats([4.0, 11.0, 12.0, 23.0], &device),
            labels: Tensor::from_ints([1, 1, 1, 0], &device),
            weights: Tensor::from_floats([1.0, 1.0, 1.0, 1.0], &device),
        };

        let batch = build_batch();
        let loss_ref = model.forward_classification(
            batch.t_historys,
            batch.r_historys,
            batch.delta_ts,
            batch.labels,
            batch.weights,
            Reduction::Sum,
        );
        let init_w_tensor = Tensor::from_floats(init_w_vec.as_slice(), &device);
        let params_stddev = Tensor::from_floats(PARAMS_STDDEV, &device);
        let l2_ref = (model.w.val() - init_w_tensor)
            .powi_scalar(2)
            .div(params_stddev.powi_scalar(2))
            .sum()
            .mul_scalar(PENALTY_W_L2 * batch_size as f64 / total_size as f64);
        let schedule_ref = model
            .fsrs7_schedule_penalty(batch_size)
            .div_scalar(total_size as f64);
        let grad_ref = (loss_ref + l2_ref + schedule_ref).backward();
        let expected_grad = model
            .w
            .grad(&grad_ref)
            .unwrap()
            .to_data()
            .to_vec::<f32>()
            .unwrap();

        let batch = build_batch();
        let loss_new = model.forward_classification(
            batch.t_historys,
            batch.r_historys,
            batch.delta_ts,
            batch.labels,
            batch.weights,
            Reduction::Sum,
        );
        let mut grad_new = loss_new.backward();
        let mut manual_grad = vec![0.0f32; w_vec.len()];
        let (_l2_value, l2_grad) = l2_penalty_value_and_grad(
            &w_vec,
            &init_w_vec,
            batch_size,
            total_size,
            PENALTY_W_L2,
            &PARAMS_STDDEV,
        );
        for (g, l2) in manual_grad.iter_mut().zip(l2_grad.iter()) {
            *g += *l2;
        }
        let (_schedule_value, schedule_grad) = schedule_penalty_value_and_grad(&w_vec, batch_size);
        let inv_total = 1.0 / total_size as f64;
        for i in 0..manual_grad.len().min(schedule_grad.len()) {
            manual_grad[i] += (schedule_grad[i] * inv_total) as f32;
        }
        grad_new = model.add_manual_weight_gradient(grad_new, &manual_grad);
        let actual_grad = model
            .w
            .grad(&grad_new)
            .unwrap()
            .to_data()
            .to_vec::<f32>()
            .unwrap();

        let mut expected_norm2 = 0.0f64;
        let mut diff_norm2 = 0.0f64;
        let mut max_abs_diff = 0.0f32;
        let mut max_index = 0usize;
        for (idx, (expected, actual)) in expected_grad.iter().zip(actual_grad.iter()).enumerate() {
            let diff = (actual - expected).abs();
            expected_norm2 += (*expected as f64) * (*expected as f64);
            diff_norm2 += (diff as f64) * (diff as f64);
            if diff > max_abs_diff {
                max_abs_diff = diff;
                max_index = idx;
            }
        }
        let relative_l2 = (diff_norm2.sqrt() / expected_norm2.sqrt().max(1e-12)) as f32;
        assert!(
            max_abs_diff < 0.2 && relative_l2 < 2e-3,
            "combined grad mismatch max_abs_diff={} at index={} expected={} actual={} relative_l2={}",
            max_abs_diff,
            max_index,
            expected_grad[max_index],
            actual_grad[max_index],
            relative_l2
        );
    }

    fn fsrs7_interval_growth_penalty_reference(
        model: &Model<NdArray<f32>>,
        n_reviews: usize,
        target_dr: f32,
        n_newton: usize,
        w_vec: &[f32],
    ) -> Tensor<NdArray<f32>, 1> {
        let mut s = model.w.val().get(2).clamp(S_MIN, S_MAX);
        let init_d4 = model.fsrs7_init_d(4.0);
        let mut d = model.fsrs7_init_d(3.0);
        let mut intervals: Vec<Tensor<NdArray<f32>, 1>> = Vec::with_capacity(n_reviews);
        for _ in 0..n_reviews {
            let t = model.fsrs7_interval_differentiable(s.clone(), target_dr, n_newton, w_vec);
            intervals.push(t.clone());
            s = model.fsrs7_next_s_good(s, d.clone(), t);
            d = model.fsrs7_next_d_good(d, init_d4.clone());
        }

        let device = model.w.device();
        let mut best_ratio: Option<Tensor<NdArray<f32>, 1>> = None;
        let mut best_val = f32::NEG_INFINITY;
        for i in 0..intervals.len().saturating_sub(1) {
            let prev = intervals[i].clone().detach().into_scalar().to_f32();
            if prev < ONE_DAY {
                continue;
            }
            let ratio = intervals[i + 1].clone() / intervals[i].clone();
            let ratio_val = ratio.clone().detach().into_scalar().to_f32();
            if ratio_val > best_val {
                best_val = ratio_val;
                best_ratio = Some(ratio);
            }
        }
        if let Some(ratio) = best_ratio {
            ratio.powi_scalar(2)
        } else {
            Tensor::zeros([1], &device)
        }
    }

    fn fsrs7_short_interval_penalty_reference(
        model: &Model<NdArray<f32>>,
        n_reviews: usize,
        n_newton: usize,
        target_drs: &[f32],
        w_vec: &[f32],
    ) -> Tensor<NdArray<f32>, 1> {
        let device = model.w.val().device();
        let mut penalties: Vec<Tensor<NdArray<f32>, 1>> = Vec::with_capacity(target_drs.len());

        for &target_dr in target_drs {
            let mut s = model.w.val().get(2).clamp(S_MIN, S_MAX);
            let init_d4 = model.fsrs7_init_d(4.0);
            let mut d = model.fsrs7_init_d(3.0);
            let mut intervals: Vec<Tensor<NdArray<f32>, 1>> = Vec::with_capacity(n_reviews);

            for _ in 0..n_reviews {
                let t = model.fsrs7_interval_differentiable(s.clone(), target_dr, n_newton, w_vec);
                intervals.push(t.clone());
                s = model.fsrs7_next_s_good(s, d.clone(), t);
                d = model.fsrs7_next_d_good(d, init_d4.clone());
            }

            let mut sum: Option<Tensor<NdArray<f32>, 1>> = None;
            let mut count = 0usize;
            for interval in intervals {
                let value = interval.clone().detach().into_scalar().to_f32();
                if value >= ONE_DAY {
                    continue;
                }
                sum = Some(match sum {
                    Some(current) => current + interval,
                    None => interval,
                });
                count += 1;
            }

            if count == 0 {
                continue;
            }

            let avg_t = sum.unwrap().div_scalar(count as f64).clamp_min(MIN_T);
            let inv_x = avg_t.powi_scalar(-1);
            penalties.push(inv_x.clamp_min(INV_C) - INV_C);
        }

        if penalties.is_empty() {
            Tensor::zeros([1], &device)
        } else {
            Tensor::cat(penalties, 0).mean()
        }
    }

    #[test]
    #[ignore = "legacy autodiff FSRS-7 schedule-penalty test for the removed 35-parameter path"]
    fn test_fsrs7_schedule_penalty_matches_reference_rollout() {
        let config = ModelConfig::default();
        let model: Model<NdArray<f32>> = config.init();
        let batch_size = 512usize;
        let w_vec = model.w.val().to_data().to_vec::<f32>().unwrap();

        let p1 = fsrs7_interval_growth_penalty_reference(
            &model,
            PENALTY_N_REVIEWS,
            PENALTY_TARGET_DR,
            PENALTY_N_NEWTON,
            &w_vec,
        );
        let p2 = fsrs7_short_interval_penalty_reference(
            &model,
            PENALTY_N_REVIEWS,
            PENALTY_N_NEWTON,
            &PENALTY_TARGET_DRS,
            &w_vec,
        );
        let expected = (p1.mul_scalar(PENALTY_W_1) + p2.mul_scalar(PENALTY_W_2))
            .mul_scalar(batch_size as f64)
            .into_scalar()
            .to_f32();

        let actual = model
            .fsrs7_schedule_penalty(batch_size)
            .into_scalar()
            .to_f32();

        assert!((actual - expected).abs() < 1e-6);
    }
}
