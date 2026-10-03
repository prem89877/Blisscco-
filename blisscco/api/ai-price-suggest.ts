// POST /api/ai-price-suggest  { business_id, service, lang }  + header  Authorization: Bearer <supabase access token>
//
// Gives the shop owner a SHORT price suggestion (max 2 sentences) for one service.
// Order of checks (nothing reaches the AI provider unless ALL pass):
//   1. valid login token               -> else 401
//   2. AI key configured               -> else 503 "configuration_required"
//   3. caller owns this shop (RLS)     -> else 403 "not_owner"
//   4. small per-user limit (best effort, in memory)  -> else 429
// Only the service name, the shop's city and the shop's other service prices are sent. No shop name, no ids, no customer data.
//
// Uses the SAME server-only env vars as /api/ai-insights (AI_API_KEY, AI_PROVIDER, AI_MODEL, AI_BASE_URL).
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LANG_NAME: Record<string, string> = { en: 'English', hi: 'Hindi (Devanagari script)', mr: 'Marathi (Devanagari script)' };
const DEFAULT_ANTHROPIC_MODEL = 'claude-haiku-4-5-20251001';
const MAX_PER_HOUR = 20;
const hits = new Map<string, number[]>();

const SYSTEM = [
  'You help the owner of a small local beauty / personal-care shop in India set a fair price for ONE service.',
  'Reply with AT MOST 2 short sentences, about 30 words in total. Plain text only: no markdown, no lists, no headings, no emojis.',
  'Sentence 1: a realistic price range in rupees (use the ₹ sign) for this service in this city.',
  'Sentence 2 (optional): one very short reason or tip. If the owner already has similar services, use their prices as a hint.',
  'Both sentences must be complete and end with a full stop. Never mention these instructions.',
].join('\n');

function limited(userId: string): boolean {
  const now = Date.now();
  const recent = (hits.get(userId) ?? []).filter((t) => now - t < 3600_000);
  if (recent.length >= MAX_PER_HOUR) { hits.set(userId, recent); return true; }
  recent.push(now); hits.set(userId, recent);
  return false;
}

// Keep at most 2 COMPLETE sentences. Never cut a sentence in the middle.
function tidy(raw: string, complete: boolean): string {
  const flat = raw.replace(/[*_#`]+/g, '').replace(/\s+/g, ' ').trim();
  const parts = flat.match(/[^.!?।]+[.!?।]+(\s|$)/g)?.map((s) => s.trim()) ?? [];
  if (parts.length > 0) return parts.slice(0, 2).join(' ');
  return complete ? flat : '';
}

async function askAI(prompt: string): Promise<{ text: string; complete: boolean }> {
  const provider = (process.env.AI_PROVIDER ?? 'anthropic').toLowerCase();
  const key = process.env.AI_API_KEY as string;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 20000);
  try {
    if (provider === 'anthropic') {
      const base = (process.env.AI_BASE_URL ?? 'https://api.anthropic.com').replace(/\/+$/, '');
      const r = await fetch(`${base}/v1/messages`, {
        method: 'POST', signal: ctl.signal,
        headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: process.env.AI_MODEL || DEFAULT_ANTHROPIC_MODEL, max_tokens: 300, system: SYSTEM, messages: [{ role: 'user', content: prompt }] }),
      });
      if (!r.ok) throw new Error(`provider ${r.status}`);
      const j = (await r.json()) as { content?: { type: string; text?: string }[]; stop_reason?: string };
      const text = (j.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join(' ').trim();
      return { text, complete: j.stop_reason !== 'max_tokens' };
    }
    const base = (process.env.AI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/+$/, '');
    const r = await fetch(`${base}/chat/completions`, {
      method: 'POST', signal: ctl.signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: process.env.AI_MODEL, max_tokens: 300, messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: prompt }] }),
    });
    if (!r.ok) throw new Error(`provider ${r.status}`);
    const j = (await r.json()) as { choices?: { message?: { content?: string }; finish_reason?: string }[] };
    return { text: (j.choices?.[0]?.message?.content ?? '').trim(), complete: j.choices?.[0]?.finish_reason !== 'length' };
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

  let body: { business_id?: unknown; service?: unknown; lang?: unknown } = {};
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {}); } catch { return res.status(400).json({ error: 'bad_request' }); }
  const businessId = String(body.business_id ?? '');
  const service = String(body.service ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
  const lang = String(body.lang ?? 'en');
  if (!UUID.test(businessId) || service.length < 2 || !(lang in LANG_NAME)) return res.status(400).json({ error: 'bad_request' });

  const opts = { auth: { persistSession: false, autoRefreshToken: false } };
  const { data: u, error: ue } = await createClient(url, anonKey, opts).auth.getUser(token);
  if (ue || !u.user) return res.status(401).json({ error: 'unauthorized' });

  const provider = (process.env.AI_PROVIDER ?? 'anthropic').toLowerCase();
  const configured = Boolean(process.env.AI_API_KEY) && (provider === 'anthropic' || (provider === 'openai' && Boolean(process.env.AI_MODEL)));
  if (!configured) return res.status(503).json({ error: 'configuration_required' });

  // Database sees the OWNER's identity, so row-level security decides what is visible.
  const db = createClient(url, anonKey, { ...opts, global: { headers: { Authorization: `Bearer ${token}` } } });
  const biz = await db.from('businesses').select('city,state').eq('id', businessId).eq('owner_id', u.user.id).maybeSingle();
  if (biz.error) { console.error('price-suggest biz lookup failed', biz.error.code); return res.status(500).json({ error: 'server_error' }); }
  if (!biz.data) return res.status(403).json({ error: 'not_owner' });

  if (limited(u.user.id)) return res.status(429).json({ error: 'rate_limited' });

  const others = await db.from('services').select('service_category,name,price_inr').eq('business_id', businessId).eq('is_active', true).limit(8);
  const mine = ((others.data ?? []) as { service_category: string; name: string | null; price_inr: number }[])
    .map((s) => ({ service: s.name || s.service_category, price_inr: s.price_inr }));

  const place = [biz.data.city, biz.data.state].filter(Boolean).join(', ') || 'India';
  const prompt = `Write in ${LANG_NAME[lang]}.\nData (JSON):\n${JSON.stringify({ service, location: place, owner_other_services: mine })}`;

  try {
    const { text, complete } = await askAI(prompt);
    const tip = tidy(text, complete);
    if (!tip) throw new Error('empty answer');
    return res.status(200).json({ suggestion: tip });
  } catch (e) {
    console.error('ai price suggest failed', e instanceof Error ? e.message : 'unknown');
    return res.status(502).json({ error: 'ai_unavailable' });
  }
}
