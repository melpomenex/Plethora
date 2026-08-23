import react from '@astrojs/react';
import { defineConfig } from 'astro/config';

const site =
  (typeof process.env.PUBLIC_SITE_ORIGIN === 'string' && process.env.PUBLIC_SITE_ORIGIN) ||
  'https://useplethora.com';

export default defineConfig({
  output: 'static',
  site,
  trailingSlash: 'never',
  integrations: [react()],
});
