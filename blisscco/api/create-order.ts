// POST /api/create-order  { business_id, plan_code }  + header  Authorization: Bearer <supabase access token>
// The amount is read from the database (public.plans) inside create_payment_txn(). The client never sends a price.
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUS: Record<string, number> = {
  not_owner: 403, business_not_approved: 409, plan_not_found: 404, plan_required: 409,
  verification_required: 409, too_many_orders: 429,
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!url || !anonKey || !serviceKey || !keyId || !keySecret) return res.status(500).json({ error: 'server_config' });

  const token = String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return res.status(401).json({ error: 'unauthorized' });

  let body: { business_id?: unknown; plan_code?: unknown } = {};
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {}); } catch { return res.status(400).json({ error: 'bad_request' }); }
  const businessId = String(body.business_id ?? '');
  const planCode = String(body.plan_code ?? '');
  if (!UUID.test(businessId) || !/^[a-z_]{3,30}$/.test(planCode)) return res.status(400).json({ error: 'bad_request' });

  const opts = { auth: { persistSession: false, autoRefreshToken: false } };
  const { data: u, error: ue } = await createClient(url, anonKey, opts).auth.getUser(token);
  if (ue || !u.user) return res.status(401).json({ error: 'unauthorized' });

  const admin = createClient(url, serviceKey, opts);
  const receipt = 'bc_' + randomUUID().replace(/-/g, '');
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

  let order: { id?: string } = {};
  try {
    const rr = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Basic ' + Buffer.from(`${keyId}:${keySecret}`).toString('base64') },
      body: JSON.stringify({ amount: t.amount_paise, currency: 'INR', receipt, notes: { txn_id: t.txn_id, business_id: businessId, plan_code: planCode } }),
    });
    if (!rr.ok) throw new Error(`razorpay ${rr.status}`);
    order = (await rr.json()) as { id?: string };
    if (!order.id) throw new Error('razorpay no order id');
  } catch (e) {
    console.error('razorpay order failed', e instanceof Error ? e.message : 'unknown');
    await admin.rpc('mark_txn_failed', { p_txn_id: t.txn_id });
    return res.status(502).json({ error: 'gateway_error' });
  }

  const { error: ae } = await admin.rpc('attach_razorpay_order', { p_txn_id: t.txn_id, p_order_id: order.id });
  if (ae) { console.error('attach order failed', ae.code); return res.status(500).json({ error: 'server_error' }); }

  return res.status(200).json({
    order_id: order.id, key_id: keyId, amount: t.amount_paise, currency: 'INR', description: t.plan_name, txn_id: t.txn_id,
  });
}
