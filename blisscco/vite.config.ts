import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// Fills the absolute site address into the preview image tags of index.html (link previews need a full URL).
// Set SITE_URL (or VITE_SITE_URL) in Vercel to your real domain. On Vercel the production domain is used if neither is set.
// If no address is known at all, those tags are removed instead of shipping a broken value.
function siteUrlPlugin(env: Record<string, string>): Plugin {
  const vercel = env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}` : '';
  const site = (env.VITE_SITE_URL || env.SITE_URL || vercel || '').trim().replace(/\/+$/, '');
  return {
    name: 'blisscco-site-url',
    transformIndexHtml(html) {
      if (site) return html.split('__SITE_URL__').join(site);
      return html.split('\n').filter((l) => !l.includes('__SITE_URL__')).join('\n');
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), siteUrlPlugin(loadEnv(mode, '.', ''))],
}));
