import { describe, expect, it, vi } from 'vitest';
import { resolveJellyfishPalette } from '../../../themes/jellyfishPalettes';
import {
  drawJellyfishFrame,
  layoutJellyfish,
  runJellyfishAnimation,
} from '../ambient/jellyfishRenderer';

function createMockContext(): CanvasRenderingContext2D {
  const gradient = { addColorStop: vi.fn() };
  return {
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    createLinearGradient: vi.fn(() => gradient),
    createRadialGradient: vi.fn(() => gradient),
    beginPath: vi.fn(),
    arc: vi.fn(),
    ellipse: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    quadraticCurveTo: vi.fn(),
    bezierCurveTo: vi.fn(),
    closePath: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineCap: 'round',
  } as unknown as CanvasRenderingContext2D;
}

describe('jellyfishRenderer', () => {
  it('lays out a large hero jellyfish on the horizontal centerline', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 1200;
    canvas.height = 800;

    const jelly = layoutJellyfish(canvas);

    expect(jelly.nx).toBe(0.5);
    expect(jelly.scale).toBeGreaterThanOrEqual(100);
    expect(jelly.scale * 2).toBeGreaterThanOrEqual(canvas.height * 0.25);
  });

  it('drawJellyfishFrame invokes canvas draw calls', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 800;
    canvas.height = 600;
    const ctx = createMockContext();
    const palette = resolveJellyfishPalette('deep-ocean-glow');
    const jelly = {
      nx: 0.72,
      ny: 0.28,
      driftPhase: 0.4,
      pulsePhase: 0,
      scale: 40,
    };
    const particles = [
      { nx: 0.2, ny: 0.5, z: 0.5, speed: 0.1, r: 1, phase: 0 },
    ];
    drawJellyfishFrame(ctx, canvas, palette, jelly, particles, 1500, false);
    expect(ctx.clearRect).toHaveBeenCalled();
    expect(ctx.fillRect).toHaveBeenCalled();
    expect(ctx.bezierCurveTo).toHaveBeenCalledTimes(25);
  });

  it('keeps the static hero centered and makes animated swimming perceptible', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 1200;
    canvas.height = 800;
    const palette = resolveJellyfishPalette('deep-ocean-glow');
    const jelly = layoutJellyfish(canvas);

    const staticCtx = createMockContext();
    drawJellyfishFrame(staticCtx, canvas, palette, jelly, [], 0, false);
    const staticX = vi.mocked(staticCtx.translate).mock.calls[0][0];
    expect(staticX).toBe(canvas.width / 2);

    const firstCtx = createMockContext();
    const laterCtx = createMockContext();
    drawJellyfishFrame(firstCtx, canvas, palette, jelly, [], 0, true);
    drawJellyfishFrame(laterCtx, canvas, palette, jelly, [], 6000, true);
    const firstX = vi.mocked(firstCtx.translate).mock.calls[0][0];
    const laterX = vi.mocked(laterCtx.translate).mock.calls[0][0];

    expect(Math.abs(firstX - canvas.width / 2)).toBeLessThan(canvas.width * 0.06);
    expect(Math.abs(laterX - canvas.width / 2)).toBeLessThan(canvas.width * 0.06);
    expect(Math.abs(laterX - firstX)).toBeGreaterThan(15);
  });

  it('staticOnly mode does not schedule RAF', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 800;
    canvas.height = 600;
    const ctx = createMockContext();
    const palette = resolveJellyfishPalette('bioluminescent-flow');
    let rafCalled = false;
    const originalRaf = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = () => {
      rafCalled = true;
      return 1;
    };

    runJellyfishAnimation({
      cv: canvas,
      ctx,
      density: 1,
      palette,
      staticOnly: true,
      frame: () => {},
      shouldRender: () => true,
      onResize: () => {},
    });

    globalThis.requestAnimationFrame = originalRaf;
    expect(rafCalled).toBe(false);
  });

  it('respects freeze hook for deterministic draw path', () => {
    window.__plethoraJellyfishFreeze = { time: 2000, seed: 99 };
    const canvas = document.createElement('canvas');
    canvas.width = 800;
    canvas.height = 600;
    const ctx = createMockContext();
    const palette = resolveJellyfishPalette('abyssal-dream');

    runJellyfishAnimation({
      cv: canvas,
      ctx,
      density: 1,
      palette,
      staticOnly: true,
      frame: () => {},
      shouldRender: () => true,
      onResize: () => {},
    });

    delete window.__plethoraJellyfishFreeze;
    expect(ctx.fillRect).toHaveBeenCalled();
  });
});
