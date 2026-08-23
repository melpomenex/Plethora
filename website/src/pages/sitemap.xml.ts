import type { APIRoute } from 'astro';
import { loadLaunchFlags, siteOrigin } from '../config/launch.ts';
import { SITE_ROUTES } from '../config/routes.ts';

function xmlEscape(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export const GET: APIRoute = () => {
  const flags = loadLaunchFlags();
  const origin = siteOrigin();
  const urls =
    flags.indexing === 'noindex'
      ? []
      : SITE_ROUTES.map((route) => `${origin}${route.path === '/' ? '' : route.path}`);

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((loc) => `  <url><loc>${xmlEscape(loc)}</loc></url>`).join('\n')}
</urlset>
`;

  return new Response(body, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
    },
  });
};
