// GET /robots.txt  (rewritten to this function in vercel.json so the Sitemap line can hold your real domain)
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { siteUrl } from './_lib/siteUrl.js';

export default function handler(req: VercelRequest, res: VercelResponse) {
  const base = siteUrl(req);
  const lines = [
    'User-agent: *',
    'Allow: /',
    '',
    '# Private dashboards, account pages and server routes: never crawled',
    'Disallow: /admin',
    'Disallow: /owner/business/',
    'Disallow: /owner$',
    'Disallow: /my-bookings',
    'Disallow: /my-rewards',
    'Disallow: /mega/',
    'Disallow: /notifications',
    'Disallow: /refer',
    'Disallow: /post-login',
    'Disallow: /auth/',
    'Disallow: /reset-password',
    'Disallow: /api/',
    '',
    ...(base ? [`Sitemap: ${base}/sitemap.xml`] : []),
    '',
  ];
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
  res.status(200).send(lines.join('\n'));
}
