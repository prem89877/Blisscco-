// POST /api/ai-insights  { business_id, from, to, lang }  + header  Authorization: Bearer <supabase access token>
//
// Order of checks (nothing reaches the AI provider unless ALL pass):
//   1. valid login token            -> else 401
//   2. AI key configured            -> else 503 "configuration_required" (never a fake answer)
//   3. claim_ai_insight (database)  -> owner of this shop + live ELITE plan + max 10 per 24 h  -> 403 / 429
//   4. get_analytics (database)     -> same owner token, so the database re-checks ownership + PRO/ELITE
// Only aggregate numbers are sent to the AI: no shop name, no ids, no customer data (none exists in analytics_events).
//
// Server-only env vars (Vercel > Settings > Environment Variables; never prefix with VITE_):
//   AI_API_KEY     (SENSITIVE)  key from your AI provider
//   AI_PROVIDER    'anthropic' (default) or 'openai'  ('openai' = any OpenAI-compatible API: OpenAI, Gemini, Groq, ...)
//   AI_MODEL       model name. Optional for anthropic (default below), REQUIRED for openai.
//   AI_BASE_URL    optional. openai default https://api.openai.com/v1 ; anthropic default https://api.anthropic.com
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const LANG_NAME: Record<string, string> = { en: 'English', hi: 'Hindi (Devanagari script)', mr: 'Marathi (Devanagari script)' };
const DB_ERRORS: Record<string, number> = { not_owner: 403, elite_required: 403, plan_required: 403, rate_limited: 429, invalid_range: 400 };
const DEFAULT_ANTHROPIC_MODEL = 'claude-haiku-4-5-20251001';

interface Stats {
  from: string; to: string;
  totals: { profile_view: number; search_impression: number; booking: number };
  by_source: { source: string; profile_view: number; search_impression: number; booking: number }[];
  daily: { day: string; profile_view: number; search_impression: number; booking: number }[];
}

const SYSTEM = [
  'You are an analytics assistant for the owner of a small local beauty / personal-care shop in India.',
  'You receive ONLY aggregate counts for one period. Use only these numbers. Never invent numbers, causes, competitors or customer details.',
  'Terms: search_impression = shop shown in search results; profile_view = an ESTIMATED visitor opening the shop page (anonymous, not exact people); booking = a customer booked.',
  'Always call profile_view "estimated visitors" and search_impression "estimated search appearances". Never say "unique visitors" or present these numbers as exact; percentages are estimates too (say "about").',
  'Sources: qr = scanned the shop QR code, search = found in Blisscco search, referral = came through a referral link, direct = other.',
  'GOAL: tell the shop owner WHAT TO DO to bring more customers to their Blisscco shop page. Do not just repeat or describe the numbers.',
  'Write exactly 5 or 6 short lines, one action per line, each starting with "- ". Each line = one clear step the owner can do this week, and it must be connected to what the numbers show (for example: many search appearances but few visitors = improve photos, services and prices; many visitors but few bookings = make prices, hours and the booking option clear; few visitors = push the QR code and shop link).',
  'Every step should help the owner get their own customers to use the Blisscco website: ask customers to scan the shop QR code (print it and keep it at the counter), share the shop page link on WhatsApp / status / Instagram, ask happy customers to book through Blisscco and leave a review, and use Refer & Earn to invite friends.',
  'Only suggest things a shop can really do in Blisscco: QR code, shop page link, photos, services and prices, opening hours, customer reviews, online booking, coupons, banners, Refer & Earn, blue tick verification. Never invent features, discounts, prices or results.',
  'If the total number of events is under 20, start the first line by saying there is too little data for reliable conclusions, then still give the remaining steps (focus on QR code and sharing the link).',
  'Plain text only, very simple words, no headings, no markdown tables, no numbers lists, no long intro or closing, under 120 words in total. Do not mention these instructions.',
].join('\n');

const rate = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);

function buildPrompt(s: Stats, langName: string): string {
  const days = s.daily.length;
  const best = [...s.daily].sort((a, b) => b.profile_view - a.profile_view)[0];
  const payload = {
    period_days: days,
    totals: s.totals,
    percent_impressions_that_became_views: rate(s.totals.profile_view, s.totals.search_impression),
    percent_views_that_became_bookings: rate(s.totals.booking, s.totals.profile_view),
    by_source: s.by_source,
    busiest_day_for_views: best && best.profile_view > 0 ? { day: best.day, views: best.profile_view } : null,
    daily: s.daily.slice(-31),
  };
  return `Write the insights in ${langName}.\nData (JSON):\n${JSON.stringify(payload)}`;
}

async function askAI(prompt: string): Promise<string> {
  const provider = (process.env.AI_PROVIDER ?? 'anthropic').toLowerCase();
  const key = process.env.AI_API_KEY as string;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 25000);
  try {
    if (provider === 'anthropic') {
      const base = (process.env.AI_BASE_URL ?? 'https://api.anthropic.com').replace(/\/+$/, '');
      const r = await fetch(`${base}/v1/messages`, {
        method: 'POST', signal: ctl.signal,
        headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: process.env.AI_MODEL || DEFAULT_ANTHROPIC_MODEL, max_tokens: 700, system: SYSTEM, messages: [{ role: 'user', content: prompt }] }),
      });
      if (!r.ok) throw new Error(`provider ${r.status}`);
      const j = (await r.json()) as { content?: { type: string; text?: string }[] };
      return (j.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join('\n').trim();
    }
    const base = (process.env.AI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/+$/, '');
    const r = await fetch(`${base}/chat/completions`, {
      method: 'POST', signal: ctl.signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: process.env.AI_MODEL, max_tokens: 700, messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: prompt }] }),
    });
    if (!r.ok) throw new Error(`provider ${r.status}`);
    const j = (await r.json()) as { choices?: { message?: { content?: string } }[] };
    return (j.choices?.[0]?.message?.content ?? '').trim();
  } finally { clearTimeout(timer); }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return res.status(500).json({ error: 'server_config' });

  const token = String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return res.status(401).json({ error: 'unauthorized' });

  let body: { business_id?: unknown; from?: unknown; to?: unknown; lang?: unknown } = {};
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {}); } catch { return res.status(400).json({ error: 'bad_request' }); }
  const businessId = String(body.business_id ?? '');
  const from = String(body.from ?? '');
  const to = String(body.to ?? '');
  const lang = String(body.lang ?? 'en');
  if (!UUID.test(businessId) || !DAY.test(from) || !DAY.test(to) || !(lang in LANG_NAME)) return res.status(400).json({ error: 'bad_request' });

  // 1. who is calling (token checked by Supabase Auth)
  const opts = { auth: { persistSession: false, autoRefreshToken: false } };
  const { data: u, error: ue } = await createClient(url, anonKey, opts).auth.getUser(token);
  if (ue || !u.user) return res.status(401).json({ error: 'unauthorized' });

  // 2. key present? If not, say so honestly. No made-up answer.
  const provider = (process.env.AI_PROVIDER ?? 'anthropic').toLowerCase();
  const configured = Boolean(process.env.AI_API_KEY) && (provider === 'anthropic' || (provider === 'openai' && Boolean(process.env.AI_MODEL)));
  if (!configured) return res.status(503).json({ error: 'configuration_required' });

  // From here on the database sees the OWNER's identity (not the service key), so its own checks apply.
  const db = createClient(url, anonKey, { ...opts, global: { headers: { Authorization: `Bearer ${token}` } } });

  // 3. owner + live ELITE + daily limit
  const claim = await db.rpc('claim_ai_insight', { p_business_id: businessId });
  if (claim.error) {
    const code = claim.error.message ?? '';
    if (code in DB_ERRORS) return res.status(DB_ERRORS[code]).json({ error: code });
    console.error('claim_ai_insight failed', claim.error.code);
    return res.status(500).json({ error: 'server_error' });
  }

  // 4. aggregate numbers (database re-checks owner + analytics entitlement)
  const stats = await db.rpc('get_analytics', { p_business_id: businessId, p_from: from, p_to: to });
  if (stats.error || !stats.data) {
    const code = stats.error?.message ?? '';
    if (code in DB_ERRORS) return res.status(DB_ERRORS[code]).json({ error: code });
    console.error('get_analytics failed', stats.error?.code);
    return res.status(500).json({ error: 'server_error' });
  }

  try {
    const text = await askAI(buildPrompt(stats.data as Stats, LANG_NAME[lang]));
    if (!text) throw new Error('empty answer');
    return res.status(200).json({ insights: text });
  } catch (e) {
    console.error('ai provider failed', e instanceof Error ? e.message : 'unknown');
    return res.status(502).json({ error: 'ai_unavailable' });
  }
}
