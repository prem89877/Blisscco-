// GET /sitemap.xml  (rewritten to this function in vercel.json)
// Lists only public, indexable pages: the home page, the discovery page, the legal pages and every APPROVED shop page.
// Shops come from the public_businesses view (anon read, approved only), so nothing private can appear here.
// No <lastmod> is written: the database has no "last changed" date for a shop page and a made-up date would mislead crawlers.
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { siteUrl } from './_lib/siteUrl';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATIC_PATHS = ['/', '/explore', '/privacy', '/terms'];
const PAGE = 1000;
const MAX_URLS = 45000;   // sitemap limit is 50,000 URLs per file

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const base = siteUrl(req);
  const paths = [...STATIC_PATHS];

  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
  if (url && key) {
    try {
      const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
      for (let from = 0; paths.length < MAX_URLS; from += PAGE) {
        const { data, error } = await db.from('public_businesses').select('id').order('id').range(from, from + PAGE - 1);
        if (error || !data || data.length === 0) break;
        for (const r of data as { id: string }[]) if (UUID.test(r.id)) paths.push(`/b/${r.id}`);
        if (data.length < PAGE) break;
      }
    } catch { /* fall back to the static pages only */ }
  }

  const body = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    + paths.map((p) => `  <url><loc>${base}${p}</loc></url>`).join('\n') + '\n</urlset>\n';
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
  res.status(200).send(body);
}
