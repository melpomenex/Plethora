/**
 * Shared procedural jellyfish ambient renderer for ThemeBackdrop.
 *
 * Architecture: one renderer, palette-driven via `JELLYFISH_PALETTES` and
 * `theme.effects.ambientPaletteId`. Static frame when motion is reduced or
 * animations are disabled. Deterministic tests: `window.__plethoraJellyfishFreeze`.
 */

import type { JellyfishPalette } from '../../../themes/jellyfishPalettes';

/** Deterministic PRNG for particle layout (mulberry32). */
function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface JellyfishFreezeState {
  time: number;
  seed: number;
}

declare global {
  interface Window {
    __plethoraJellyfishFreeze?: JellyfishFreezeState;
  }
}

export interface JellyfishAnimOptions {
  cv: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  density: number;
  palette: JellyfishPalette;
  staticOnly: boolean;
  frame: (id: number) => void;
  shouldRender: (timestamp: number) => boolean;
  onResize: (fn: () => void) => void;
}

export interface JellyfishParticle {
  nx: number;
  ny: number;
  z: number;
  speed: number;
  r: number;
  phase: number;
}

export interface JellyfishState {
  nx: number;
  ny: number;
  driftPhase: number;
  pulsePhase: number;
  scale: number;
}

function getFreeze(): JellyfishFreezeState | null {
  if (typeof window === 'undefined') return null;
  return window.__plethoraJellyfishFreeze ?? null;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function rgba(hex: string, a: number): string {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

export function layoutJellyfish(cv: HTMLCanvasElement): JellyfishState {
  const isPhone = cv.width < 600;
  const unit = Math.min(cv.width, cv.height);
  // The original 5.5–7.5% scale produced a small glowing dot. The visual
  // direction calls for one unmistakable scenic subject, so the bell now
  // spans roughly a quarter of the short viewport edge.
  const scale = Math.max(44, Math.min(260, unit * (isPhone ? 0.13 : 0.165)));
  return {
    // Keep the hero centered horizontally. `ny` anchors the bell above the
    // midpoint so the long oral arms center the complete silhouette.
    nx: 0.5,
    ny: isPhone ? 0.24 : 0.28,
    driftPhase: 0.4,
    pulsePhase: 0,
    scale,
  };
}

function initParticles(count: number, rand: () => number): JellyfishParticle[] {
  const particles: JellyfishParticle[] = [];
  for (let i = 0; i < count; i++) {
    particles.push({
      nx: rand(),
      ny: rand(),
      z: rand() * 0.6 + 0.2,
      speed: rand() * 0.15 + 0.05,
      r: rand() * 1.2 + 0.4,
      phase: rand() * Math.PI * 2,
    });
  }
  return particles;
}

function drawOceanGradient(
  ctx: CanvasRenderingContext2D,
  cv: HTMLCanvasElement,
  palette: JellyfishPalette,
): void {
  const grad = ctx.createLinearGradient(0, 0, 0, cv.height);
  grad.addColorStop(0, palette.oceanTop);
  grad.addColorStop(0.45, palette.oceanMid);
  grad.addColorStop(1, palette.oceanBottom);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, cv.width, cv.height);

  const vig = ctx.createLinearGradient(0, cv.height * 0.5, 0, cv.height);
  vig.addColorStop(0, rgba(palette.vignette, 0));
  vig.addColorStop(1, rgba(palette.vignette, 0.65));
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, cv.width, cv.height);
}

function drawCaustics(
  ctx: CanvasRenderingContext2D,
  cv: HTMLCanvasElement,
  palette: JellyfishPalette,
  time: number,
  animate: boolean,
): void {
  const t = animate ? time * 0.00015 : 0.3;
  for (let band = 0; band < 2; band++) {
    ctx.beginPath();
    const baseY = cv.height * (0.35 + band * 0.12);
    ctx.moveTo(0, baseY);
    for (let x = 0; x <= cv.width; x += 6) {
      const y =
        baseY +
        Math.sin(x * 0.004 + t + band * 1.2) * 12 +
        Math.sin(x * 0.009 + t * 1.3) * 6;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(cv.width, cv.height);
    ctx.lineTo(0, cv.height);
    ctx.closePath();
    ctx.fillStyle = rgba(palette.caustic, 0.03 + band * 0.01);
    ctx.fill();
  }
}

function drawParticles(
  ctx: CanvasRenderingContext2D,
  cv: HTMLCanvasElement,
  particles: JellyfishParticle[],
  palette: JellyfishPalette,
  time: number,
  animate: boolean,
): void {
  for (const p of particles) {
    const drift = animate ? time * 0.00002 * p.speed : 0;
    let ny = (p.ny - drift * p.z) % 1;
    if (ny < 0) ny += 1;
    const nx = p.nx + Math.sin(time * 0.0003 + p.phase) * 0.01 * p.z;
    const x = nx * cv.width;
    const y = ny * cv.height;
    const alpha = 0.08 + p.z * 0.12;
    const r = p.r * (0.6 + p.z * 0.8);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = rgba(palette.particle, alpha);
    ctx.fill();
  }
}

function drawTentacles(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  bellRx: number,
  bellRy: number,
  scale: number,
  palette: JellyfishPalette,
  time: number,
  animate: boolean,
): void {
  const count = 12;
  for (let i = 0; i < count; i++) {
    const spread = (i / (count - 1) - 0.5) * bellRx * 1.55;
    const startX = x + spread;
    const startY = y + bellRy * 0.32;
    const phase = (animate ? time * 0.00105 : 0.65) + i * 0.62;
    const tentacleLen = scale * (2.35 + (i % 4) * 0.2);
    const sway = Math.sin(phase) * scale * 0.2;
    const counterSway = Math.sin(phase * 0.72 + 1.4) * scale * 0.24;
    const endY = startY + tentacleLen;

    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.bezierCurveTo(
      startX + sway,
      startY + tentacleLen * 0.28,
      startX + counterSway,
      startY + tentacleLen * 0.68,
      startX + sway * 0.5 + counterSway * 0.65,
      endY,
    );
    ctx.strokeStyle = rgba(palette.tentacle, 0.42 + (i % 3) * 0.05);
    ctx.lineWidth = Math.max(0.9, scale * 0.015);
    ctx.lineCap = 'round';
    ctx.stroke();
  }
}

function drawOralArms(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  bellRx: number,
  bellRy: number,
  scale: number,
  palette: JellyfishPalette,
  time: number,
  animate: boolean,
): void {
  const count = 5;
  for (let i = 0; i < count; i++) {
    const offset = (i / (count - 1) - 0.5) * bellRx * 0.88;
    const startX = x + offset;
    const startY = y + bellRy * 0.26;
    const phase = (animate ? time * 0.00082 : 0.9) + i * 0.92;
    const armLen = scale * (2.05 + (i % 3) * 0.22);
    const firstSway = Math.sin(phase) * scale * 0.34;
    const secondSway = -Math.sin(phase * 1.18 + 0.65) * scale * 0.45;
    const endX = startX + firstSway * 0.35 + secondSway * 0.72;
    const endY = startY + armLen;

    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.bezierCurveTo(
      startX + firstSway,
      startY + armLen * 0.28,
      startX + secondSway,
      startY + armLen * 0.7,
      endX,
      endY,
    );
    ctx.strokeStyle = rgba(i % 2 === 0 ? palette.jellySecondary : palette.jellyPrimary, 0.34);
    ctx.lineWidth = Math.max(4, scale * (0.085 + (i % 2) * 0.02));
    ctx.lineCap = 'round';
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.bezierCurveTo(
      startX + firstSway,
      startY + armLen * 0.28,
      startX + secondSway,
      startY + armLen * 0.7,
      endX,
      endY,
    );
    ctx.strokeStyle = rgba(palette.jellyCore, 0.58);
    ctx.lineWidth = Math.max(1.2, scale * 0.018);
    ctx.stroke();
  }
}

function traceBellPath(
  ctx: CanvasRenderingContext2D,
  bellRx: number,
  bellRy: number,
): void {
  const rimY = bellRy * 0.34;
  ctx.beginPath();
  ctx.moveTo(-bellRx, rimY);
  ctx.bezierCurveTo(
    -bellRx * 0.98,
    -bellRy * 0.42,
    -bellRx * 0.58,
    -bellRy * 0.92,
    0,
    -bellRy,
  );
  ctx.bezierCurveTo(
    bellRx * 0.58,
    -bellRy * 0.92,
    bellRx * 0.98,
    -bellRy * 0.42,
    bellRx,
    rimY,
  );

  const scallops = 6;
  for (let i = 0; i < scallops; i++) {
    const segment = (bellRx * 2) / scallops;
    const endX = bellRx - segment * (i + 1);
    const controlX = bellRx - segment * (i + 0.5);
    const controlY = rimY + bellRy * (i % 2 === 0 ? 0.18 : 0.08);
    ctx.quadraticCurveTo(controlX, controlY, endX, rimY);
  }
  ctx.closePath();
}

function drawBell(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  bellRx: number,
  bellRy: number,
  scale: number,
  palette: JellyfishPalette,
): void {
  ctx.save();
  ctx.translate(x, y);

  const bodyGrad = ctx.createRadialGradient(
    -bellRx * 0.2,
    -bellRy * 0.48,
    bellRx * 0.04,
    0,
    -bellRy * 0.08,
    bellRx * 1.08,
  );
  bodyGrad.addColorStop(0, rgba(palette.jellyCore, 0.9));
  bodyGrad.addColorStop(0.42, rgba(palette.jellyPrimary, 0.68));
  bodyGrad.addColorStop(0.78, rgba(palette.jellySecondary, 0.4));
  bodyGrad.addColorStop(1, rgba(palette.jellySecondary, 0.12));
  traceBellPath(ctx, bellRx, bellRy);
  ctx.fillStyle = bodyGrad;
  ctx.fill();
  ctx.strokeStyle = rgba(palette.jellyCore, 0.82);
  ctx.lineWidth = Math.max(1.2, scale * 0.018);
  ctx.stroke();

  // Radial bell ribs give the hero the luminous anatomical structure visible
  // in the concept instead of reading as an undifferentiated oval.
  for (let i = -3; i <= 3; i++) {
    const endX = (i / 3) * bellRx * 0.78;
    ctx.beginPath();
    ctx.moveTo(i * bellRx * 0.035, -bellRy * 0.88);
    ctx.quadraticCurveTo(endX * 0.72, -bellRy * 0.2, endX, bellRy * 0.32);
    ctx.strokeStyle = rgba(palette.jellyCore, i === 0 ? 0.58 : 0.34);
    ctx.lineWidth = Math.max(0.75, scale * 0.009);
    ctx.stroke();
  }

  ctx.beginPath();
  ctx.moveTo(-bellRx * 0.88, bellRy * 0.28);
  ctx.bezierCurveTo(
    -bellRx * 0.45,
    bellRy * 0.5,
    bellRx * 0.45,
    bellRy * 0.5,
    bellRx * 0.88,
    bellRy * 0.28,
  );
  ctx.strokeStyle = rgba(palette.jellyCore, 0.72);
  ctx.lineWidth = Math.max(1.2, scale * 0.017);
  ctx.stroke();

  ctx.beginPath();
  ctx.ellipse(0, -bellRy * 0.28, bellRx * 0.3, bellRy * 0.28, 0, 0, Math.PI * 2);
  ctx.fillStyle = rgba(palette.jellyCore, 0.32);
  ctx.fill();
  ctx.restore();
}

function drawJellyfish(
  ctx: CanvasRenderingContext2D,
  jelly: JellyfishState,
  cv: HTMLCanvasElement,
  palette: JellyfishPalette,
  time: number,
  animate: boolean,
): void {
  const driftT = (time / 24000) * Math.PI * 2;
  const pulseT = (time / 5800) * Math.PI * 2 + jelly.pulsePhase;
  const nx = jelly.nx + (animate
    ? Math.sin(driftT + jelly.driftPhase) * 0.025 + Math.sin(driftT * 1.8) * 0.005
    : 0);
  const ny = jelly.ny + (animate
    ? Math.cos(driftT * 0.82 + jelly.driftPhase) * 0.024 + Math.sin(pulseT) * 0.008
    : 0);
  const x = nx * cv.width;
  const y = ny * cv.height - (animate ? Math.sin(pulseT) * jelly.scale * 0.045 : 0);
  const scale = jelly.scale;

  const contraction = Math.sin(pulseT);
  const bellRy = scale * (0.82 + contraction * 0.1);
  const bellRx = scale * (1.04 - contraction * 0.045);

  const glowR = scale * 3.25;
  const glow = ctx.createRadialGradient(x, y, 0, x, y, glowR);
  glow.addColorStop(0, rgba(palette.glowPrimary, 0.34));
  glow.addColorStop(0.42, rgba(palette.glowSecondary, 0.14));
  glow.addColorStop(1, rgba(palette.glowSecondary, 0));
  ctx.beginPath();
  ctx.arc(x, y, glowR, 0, Math.PI * 2);
  ctx.fillStyle = glow;
  ctx.fill();

  drawTentacles(ctx, x, y, bellRx, bellRy, scale, palette, time, animate);
  drawOralArms(ctx, x, y, bellRx, bellRy, scale, palette, time, animate);
  drawBell(ctx, x, y, bellRx, bellRy, scale, palette);
}

export function drawJellyfishFrame(
  ctx: CanvasRenderingContext2D,
  cv: HTMLCanvasElement,
  palette: JellyfishPalette,
  jelly: JellyfishState,
  particles: JellyfishParticle[],
  time: number,
  animate: boolean,
): void {
  ctx.clearRect(0, 0, cv.width, cv.height);
  drawOceanGradient(ctx, cv, palette);
  drawCaustics(ctx, cv, palette, time, animate);
  drawParticles(ctx, cv, particles, palette, time, animate);
  drawJellyfish(ctx, jelly, cv, palette, time, animate);
}

export function runJellyfishAnimation(options: JellyfishAnimOptions): void {
  const { cv, ctx, density, palette, staticOnly, frame, shouldRender, onResize } = options;
  const freeze = getFreeze();
  const seed = freeze?.seed ?? 42;
  const rand = seededRandom(seed);
  const particleCount = Math.max(6, Math.round(12 * density));

  let jelly = layoutJellyfish(cv);
  let particles = initParticles(particleCount, rand);

  const remapLayout = () => {
    jelly = layoutJellyfish(cv);
    particles = initParticles(particleCount, rand);
  };
  onResize(remapLayout);

  const drawFrame = (timestamp: number, animate: boolean) => {
    const time = freeze ? freeze.time : timestamp;
    drawJellyfishFrame(ctx, cv, palette, jelly, particles, time, animate);
  };

  if (staticOnly) {
    drawFrame(freeze?.time ?? 1200, false);
    return;
  }

  (function loop(timestamp: number) {
    if (!shouldRender(timestamp)) {
      frame(requestAnimationFrame(loop));
      return;
    }
    drawFrame(timestamp, true);
    frame(requestAnimationFrame(loop));
  })(0);
}
