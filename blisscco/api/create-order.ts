// POST /api/create-order  { business_id, plan_code, upi_only?, return_path? }  + header  Authorization: Bearer <supabase access token>
// The amount is read from the database (public.plans) inside create_payment_txn(). The client never sends a price.
// Gateway: Cashfree Payments (PG). Returns a payment_session_id that the browser hands to the Cashfree JS SDK.
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { siteUrl } from './_lib/siteUrl.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUS: Record<string, number> = {
  not_owner: 403, business_not_approved: 409, plan_not_found: 404, plan_required: 409,
  verification_required: 409, too_many_orders: 429,
};

// CASHFREE_ENV=production switches to live. Anything else (or unset) = sandbox, so test keys can never hit the live API by accident.
const isProd = (process.env.CASHFREE_ENV ?? '').trim().toLowerCase() === 'production';
const CF_BASE = isProd ? 'https://api.cashfree.com/pg' : 'https://sandbox.cashfree.com/pg';
const CF_VERSION = '2023-08-01';

/** Cashfree needs a 10-digit phone. Use the shop phone if it has one, otherwise a neutral placeholder. */
function tenDigits(raw: unknown): string {
  const d = String(raw ?? '').replace(/\D/g, '');
  return d.length >= 10 ? d.slice(-10) : '9999999999';
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const appId = process.env.CASHFREE_APP_ID;
  const secretKey = process.env.CASHFREE_SECRET_KEY;
  if (!url || !anonKey || !serviceKey || !appId || !secretKey) return res.status(500).json({ error: 'server_config' });

  const token = String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return res.status(401).json({ error: 'unauthorized' });

  let body: { business_id?: unknown; plan_code?: unknown; upi_only?: unknown; return_path?: unknown } = {};
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {}); } catch { return res.status(400).json({ error: 'bad_request' }); }
  const businessId = String(body.business_id ?? '');
  const planCode = String(body.plan_code ?? '');
  if (!UUID.test(businessId) || !/^[a-z_]{3,30}$/.test(planCode)) return res.status(400).json({ error: 'bad_request' });
  const upiOnly = body.upi_only === true;
  // Only same-site paths are allowed as the return target (no open redirect).
  const rp = String(body.return_path ?? '');
  const returnPath = /^\/[A-Za-z0-9\-._~/]*$/.test(rp) && !rp.startsWith('//') ? rp : '/';

  const opts = { auth: { persistSession: false, autoRefreshToken: false } };
  const { data: u, error: ue } = await createClient(url, anonKey, opts).auth.getUser(token);
  if (ue || !u.user) return res.status(401).json({ error: 'unauthorized' });

  const admin = createClient(url, serviceKey, opts);
  const receipt = 'bc_' + randomUUID().replace(/-/g, '');      // 35 chars; also used as the Cashfree order_id
  const { data: txn, error: te } = await admin.rpc('create_payment_txn', {
    p_user_id: u.user.id, p_business_id: businessId, p_plan_code: planCode, p_receipt: receipt,
  });
  if (te || !txn) {
    const code = te?.message ?? '';
    if (code in STATUS) return res.status(STATUS[code]).json({ error: code });
    console.error('create_payment_txn failed', te?.code);
    return res.status(500).json({ error: 'server_error' });
  }
  const t = txn as { txn_id: string; amount_paise: number; plan_name: string };

  const { data: biz } = await admin.from('businesses').select('phone').eq('id', businessId).maybeSingle();
  const base = siteUrl(req);
  const orderMeta: Record<string, string> = {};
  if (base) {
    orderMeta.return_url = `${base}${returnPath}?cf_order_id={order_id}`;
    if (base.startsWith('https://')) orderMeta.notify_url = `${base}/api/cashfree-webhook`;
  }
  if (upiOnly) orderMeta.payment_methods = 'upi';

  let order: { order_id?: string; payment_session_id?: string } = {};
  try {
    const rr = await fetch(`${CF_BASE}/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-version': CF_VERSION, 'x-client-id': appId, 'x-client-secret': secretKey },
      body: JSON.stringify({
        order_id: receipt,
        order_amount: Number((t.amount_paise / 100).toFixed(2)),   // Cashfree uses rupees, our DB uses paise
        order_currency: 'INR',
        customer_details: {
          customer_id: u.user.id,
          customer_phone: tenDigits((biz as { phone?: string } | null)?.phone),
          ...(u.user.email ? { customer_email: u.user.email } : {}),
        },
        order_meta: orderMeta,
        order_note: t.plan_name.slice(0, 200),
        order_tags: { txn_id: t.txn_id, business_id: businessId, plan_code: planCode },
      }),
    });
    if (!rr.ok) throw new Error(`cashfree ${rr.status}`);
    order = (await rr.json()) as { order_id?: string; payment_session_id?: string };
    if (!order.order_id || !order.payment_session_id) throw new Error('cashfree no session id');
  } catch (e) {
    console.error('cashfree order failed', e instanceof Error ? e.message : 'unknown');
    await admin.rpc('mark_txn_failed', { p_txn_id: t.txn_id });
    return res.status(502).json({ error: 'gateway_error' });
  }

  const { error: ae } = await admin.rpc('attach_gateway_order', { p_txn_id: t.txn_id, p_order_id: order.order_id });
  if (ae) { console.error('attach order failed', ae.code); return res.status(500).json({ error: 'server_error' }); }

  return res.status(200).json({
    order_id: order.order_id, payment_session_id: order.payment_session_id, mode: isProd ? 'production' : 'sandbox',
    amount: t.amount_paise, currency: 'INR', description: t.plan_name, txn_id: t.txn_id,
  });
}
