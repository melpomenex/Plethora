/**
 * Shared procedural jellyfish ambient renderer for ThemeBackdrop.
 *
 * Architecture: one renderer, palette-driven via `JELLYFISH_PALETTES` and
 * `theme.effects.ambientPaletteId`. Static frame when motion is reduced or
 * animations are disabled. Deterministic tests: `window.__plethoraJellyfishFreeze`.
 */

import type { JellyfishPalette } from '../../themes/jellyfishPalettes';

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

interface Particle {
  nx: number;
  ny: number;
  z: number;
  speed: number;
  r: number;
  phase: number;
}

interface JellyfishState {
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

function layoutJellyfish(cv: HTMLCanvasElement): JellyfishState {
  const isPhone = cv.width < 600;
  const isLandscape = cv.width > cv.height;
  const unit = Math.min(cv.width, cv.height);
  const scale = unit * (isPhone ? 0.055 : 0.075);
  let nx = isPhone ? 0.68 : 0.74;
  let ny = isPhone ? 0.22 : 0.28;
  if (isLandscape && cv.width < 900) {
    nx = 0.78;
    ny = 0.35;
  }
  return {
    nx,
    ny,
    driftPhase: 0.4,
    pulsePhase: 0,
    scale,
  };
}

function initParticles(count: number, rand: () => number): Particle[] {
  const particles: Particle[] = [];
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
  particles: Particle[],
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
  const count = 7;
  const tentacleLen = scale * 1.8;
  for (let i = 0; i < count; i++) {
    const spread = (i / (count - 1) - 0.5) * bellRx * 1.4;
    const startX = x + spread;
    const startY = y + bellRy * 0.55;
    const phase = time * 0.001 + i * 0.7;
    const sway = animate ? Math.sin(phase) * scale * 0.15 : Math.sin(i) * scale * 0.05;
    const midX = startX + sway;
    const midY = startY + tentacleLen * 0.45;
    const endX = startX + sway * 1.4 + Math.sin(phase * 0.8) * scale * 0.08;
    const endY = startY + tentacleLen;

    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.quadraticCurveTo(midX, midY, endX, endY);
    ctx.strokeStyle = rgba(palette.tentacle, 0.22 + (i % 3) * 0.04);
    ctx.lineWidth = Math.max(0.6, scale * 0.018);
    ctx.lineCap = 'round';
    ctx.stroke();
  }
}

function drawJellyfish(
  ctx: CanvasRenderingContext2D,
  jelly: JellyfishState,
  cv: HTMLCanvasElement,
  palette: JellyfishPalette,
  time: number,
  animate: boolean,
): void {
  const driftT = animate ? time * 0.00008 : 0;
  const pulseT = animate ? time * 0.001 : 0.5;
  const nx =
    jelly.nx +
    Math.sin(driftT + jelly.driftPhase) * 0.04 +
    Math.sin(driftT * 0.6 + 1.2) * 0.02;
  const ny =
    jelly.ny +
    Math.cos(driftT * 0.7 + jelly.driftPhase) * 0.025 +
    Math.sin(driftT * 0.4) * 0.015;
  const x = nx * cv.width;
  const y = ny * cv.height;
  const scale = jelly.scale;

  const pulse =
    1 +
    Math.sin(pulseT * 0.9) * 0.1 +
    Math.sin(pulseT * 1.7 + 0.5) * 0.04;
  const bellRy = scale * 0.9 * pulse;
  const bellRx = scale * (1.02 + Math.sin(pulseT * 0.7) * 0.04);

  const glowR = scale * 2.8;
  const glow = ctx.createRadialGradient(x, y, 0, x, y, glowR);
  glow.addColorStop(0, rgba(palette.glowPrimary, 0.14));
  glow.addColorStop(0.45, rgba(palette.glowSecondary, 0.06));
  glow.addColorStop(1, rgba(palette.glowSecondary, 0));
  ctx.beginPath();
  ctx.arc(x, y, glowR, 0, Math.PI * 2);
  ctx.fillStyle = glow;
  ctx.fill();

  drawTentacles(ctx, x, y, bellRx, bellRy, scale, palette, time, animate);

  ctx.save();
  ctx.translate(x, y);
  const bodyGrad = ctx.createRadialGradient(0, -bellRy * 0.2, 0, 0, 0, bellRx);
  bodyGrad.addColorStop(0, rgba(palette.jellyCore, 0.55));
  bodyGrad.addColorStop(0.5, rgba(palette.jellyPrimary, 0.35));
  bodyGrad.addColorStop(1, rgba(palette.jellySecondary, 0.12));
  ctx.beginPath();
  ctx.ellipse(0, 0, bellRx, bellRy, 0, 0, Math.PI * 2);
  ctx.fillStyle = bodyGrad;
  ctx.fill();

  ctx.beginPath();
  ctx.ellipse(0, bellRy * 0.15, bellRx * 0.55, bellRy * 0.35, 0, 0, Math.PI);
  ctx.fillStyle = rgba(palette.jellySecondary, 0.25);
  ctx.fill();

  ctx.beginPath();
  ctx.ellipse(0, -bellRy * 0.25, bellRx * 0.35, bellRy * 0.25, 0, 0, Math.PI * 2);
  ctx.fillStyle = rgba(palette.jellyCore, 0.35);
  ctx.fill();
  ctx.restore();
}

export function drawJellyfishFrame(
  ctx: CanvasRenderingContext2D,
  cv: HTMLCanvasElement,
  palette: JellyfishPalette,
  jelly: JellyfishState,
  particles: Particle[],
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
