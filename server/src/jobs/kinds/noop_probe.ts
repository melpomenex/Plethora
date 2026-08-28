import { z } from 'zod';
import { registerJobKind } from '../registry.js';

const NoopProbeSchema = z.object({
  steps: z.number().int().min(1).max(20).default(3),
  delayMs: z.number().int().min(10).max(5000).default(100),
});

registerJobKind({
  kind: 'noop_probe',
  paramsSchema: NoopProbeSchema,
  timeoutMs: 60_000,
  maxAttempts: 2,
  capability: 'cloud_jobs',
  async handler(ctx) {
    const params = NoopProbeSchema.parse(ctx.params);
    for (let i = 1; i <= params.steps; i++) {
      if (await ctx.isCancelled()) {
        throw new Error('Job cancelled');
      }
      await ctx.updateProgress(i, params.steps, 'steps');
      await new Promise((r) => setTimeout(r, params.delayMs));
    }
    return { result: { ok: true, steps: params.steps } };
  },
});
