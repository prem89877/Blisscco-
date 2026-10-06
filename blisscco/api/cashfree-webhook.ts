// POST /api/cashfree-webhook   (set this URL in Cashfree Dashboard > Developers > Webhooks; create-order also sends it as notify_url)
// Nothing is activated unless the signature of the RAW body matches:  base64( HMAC-SHA256( x-webhook-timestamp + rawBody, CASHFREE_SECRET_KEY ) ).
// Activation / refund logic runs inside the database function process_cashfree_event() (service_role only),
// which also makes each event id usable exactly once.
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const config = { api: { bodyParser: false } };

async function rawBody(req: VercelRequest): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of req as unknown as AsyncIterable<Buffer | string>) chunks.push(typeof c === 'string' ? Buffer.from(c) : c);
  const streamed = Buffer.concat(chunks);
  if (streamed.length > 0) return streamed;
  // fallback if the platform already buffered the body
  const b = (req as unknown as { body?: unknown }).body;
  if (Buffer.isBuffer(b)) return b;
  if (typeof b === 'string') return Buffer.from(b);
  return streamed;
}

function validSignature(raw: Buffer, timestamp: string, signature: string, secret: string): boolean {
  const expected = createHmac('sha256', secret).update(timestamp).update(raw).digest('base64');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(signature, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

type CfPayload = {
  type?: string;
  data?: {
    payment?: { cf_payment_id?: string | number; payment_status?: string };
    refund?: { cf_refund_id?: string | number; refund_status?: string };
  };
};

/** Cashfree sends no event-id header, so we build a stable one from the payload (same event retried = same id). */
function eventIdOf(p: CfPayload, raw: Buffer): string {
  const type = String(p.type ?? '');
  const pay = p.data?.payment; const ref = p.data?.refund;
  if (type === 'REFUND_STATUS_WEBHOOK' && ref?.cf_refund_id != null) return `refund:${ref.cf_refund_id}:${String(ref.refund_status ?? '')}`;
  if (pay?.cf_payment_id != null) return `payment:${pay.cf_payment_id}:${String(pay.payment_status ?? '')}`;
  return 'raw:' + createHash('sha256').update(raw).digest('hex');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const secret = process.env.CASHFREE_SECRET_KEY;
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret || !url || !serviceKey) return res.status(500).json({ error: 'server_config' });

  const raw = await rawBody(req);
  const signature = String(req.headers['x-webhook-signature'] ?? '');
  const timestamp = String(req.headers['x-webhook-timestamp'] ?? '');
  if (raw.length === 0 || !signature || !timestamp || !validSignature(raw, timestamp, signature, secret)) {
    return res.status(401).json({ error: 'invalid_signature' });
  }

  let payload: CfPayload;
  try { payload = JSON.parse(raw.toString('utf8')); } catch { return res.status(400).json({ error: 'bad_json' }); }

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await admin.rpc('process_cashfree_event', {
    p_event_id: eventIdOf(payload, raw), p_event_type: String(payload.type ?? ''), p_payload: payload,
  });
  if (error) {
    console.error('process_cashfree_event failed', error.code, error.message);
    return res.status(500).json({ error: 'processing_failed' });   // Cashfree will retry
  }
  return res.status(200).json({ result: data });
}
