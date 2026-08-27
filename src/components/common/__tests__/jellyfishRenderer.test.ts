import { describe, expect, it, vi } from 'vitest';
import { resolveJellyfishPalette } from '../../../themes/jellyfishPalettes';
import { drawJellyfishFrame, runJellyfishAnimation } from '../ambient/jellyfishRenderer';

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
