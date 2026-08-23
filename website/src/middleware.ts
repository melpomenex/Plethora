import { defineMiddleware } from 'astro:middleware';

/**
 * Static output: this runs at prerender time only.
 * F may add header assertions against website/vercel.json; do not duplicate
 * production header policy here.
 */
export const onRequest = defineMiddleware((_context, next) => next());
