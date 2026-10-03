// POST /api/ai-price-suggest  { business_id, service, lang }  + header  Authorization: Bearer <supabase access token>
//
// Gives the shop owner price suggestions as NUMBERS ONLY for one service: basic, standard, premium (in rupees).
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
  'You help the owner of a small local beauty / personal-care shop in India set prices for ONE service.',
  'Reply with ONLY a JSON object and nothing else, in exactly this shape: {"basic":0,"standard":0,"premium":0}',
  'Each value is a whole number in Indian rupees (no symbols, no text, no ranges). basic < standard < premium.',
  'basic = simple / budget version of the service, standard = usual version, premium = high-end version.',
  'Make the numbers realistic for the given location. If the owner already has similar services, use their prices as a hint.',
].join('\n');

function limited(userId: string): boolean {
  const now = Date.now();
  const recent = (hits.get(userId) ?? []).filter((t) => now - t < 3600_000);
  if (recent.length >= MAX_PER_HOUR) { hits.set(userId, recent); return true; }
  recent.push(now); hits.set(userId, recent);
  return false;
}

// Accept only three sane, ascending whole numbers. Anything else is rejected (no half answers).
type Prices = { basic: number; standard: number; premium: number };
function valid(a: number, b: number, c: number): Prices | null {
  const ok = [a, b, c].every((n) => Number.isFinite(n) && n > 0 && n <= 100000);
  return ok && a <= b && b <= c ? { basic: a, standard: b, premium: c } : null;
}
function parsePrices(raw: string): Prices | null {
  const text = raw.replace(/```(?:json)?/gi, '');
  const m = text.match(/\{[\s\S]*\}/);
  if (m) {
    try {
      const j = JSON.parse(m[0]) as Record<string, unknown>;
      const r = valid(...([j.basic, j.standard, j.premium].map((v) => Math.round(Number(v))) as [number, number, number]));
      if (r) return r;
    } catch { /* fall through to number scan */ }
  }
  // Fallback: the first three numbers in the reply (e.g. "Basic 400, Standard 700, Premium 1200")
  const nums = (text.replace(/(\d),(\d)/g, '$1$2').match(/\d+(?:\.\d+)?/g) ?? []).map((n) => Math.round(Number(n)));
  return nums.length >= 3 ? valid(nums[0], nums[1], nums[2]) : null;
}

async function askAI(prompt: string): Promise<string> {
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
        body: JSON.stringify({ model: process.env.AI_MODEL || DEFAULT_ANTHROPIC_MODEL, max_tokens: 700, system: SYSTEM, messages: [{ role: 'user', content: prompt }] }),
      });
      if (!r.ok) throw new Error(`provider ${r.status} ${(await r.text().catch(() => '')).slice(0, 300)}`);
      const j = (await r.json()) as { content?: { type: string; text?: string }[] };
      return (j.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join(' ').trim();
    }
    const base = (process.env.AI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/+$/, '');
    const r = await fetch(`${base}/chat/completions`, {
      method: 'POST', signal: ctl.signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: process.env.AI_MODEL, max_tokens: 700, messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: prompt }] }),
    });
    if (!r.ok) throw new Error(`provider ${r.status} ${(await r.text().catch(() => '')).slice(0, 300)}`);
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
  const prompt = `Data (JSON):\n${JSON.stringify({ service, location: place, owner_other_services: mine })}`;

  try {
    const raw = await askAI(prompt);
    const prices = parsePrices(raw);
    if (!prices) throw new Error(`bad answer: ${raw.slice(0, 200)}`);
    return res.status(200).json(prices);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown';
    console.error('ai price suggest failed', msg);   // full reason is in Vercel > Logs
    const detail = /^provider (\d+)/.exec(msg)?.[1] ? `provider ${/^provider (\d+)/.exec(msg)?.[1]}` : msg.startsWith('bad answer') ? 'bad answer' : /abort/i.test(msg) ? 'timeout' : 'network';
    return res.status(502).json({ error: 'ai_unavailable', detail });
  }
}
