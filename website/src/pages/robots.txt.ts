import type { APIRoute } from 'astro';
import { loadLaunchFlags } from '../config/launch.ts';

export const GET: APIRoute = () => {
  const flags = loadLaunchFlags();
  const body =
    flags.indexing === 'noindex'
      ? 'User-agent: *\nDisallow: /\n'
      : 'User-agent: *\nAllow: /\n';

  return new Response(body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
    },
  });
};
