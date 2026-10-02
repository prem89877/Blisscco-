// POST /api/razorpay-webhook   (set this URL in Razorpay Dashboard > Webhooks)
// Nothing is activated unless the HMAC-SHA256 signature of the RAW body matches RAZORPAY_WEBHOOK_SECRET.
// Activation / refund logic runs inside the database function process_razorpay_event() (service_role only),
// which also makes each Razorpay event id usable exactly once.
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { createHmac, timingSafeEqual } from 'node:crypto';

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

function validSignature(raw: Buffer, signature: string, secret: string): boolean {
  const expected = createHmac('sha256', secret).update(raw).digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(signature, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret || !url || !serviceKey) return res.status(500).json({ error: 'server_config' });

  const raw = await rawBody(req);
  const signature = String(req.headers['x-razorpay-signature'] ?? '');
  const eventId = String(req.headers['x-razorpay-event-id'] ?? '');
  if (raw.length === 0 || !signature || !validSignature(raw, signature, secret)) return res.status(401).json({ error: 'invalid_signature' });
  if (!eventId) return res.status(400).json({ error: 'missing_event_id' });

  let payload: { event?: string };
  try { payload = JSON.parse(raw.toString('utf8')); } catch { return res.status(400).json({ error: 'bad_json' }); }

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await admin.rpc('process_razorpay_event', {
    p_event_id: eventId, p_event_type: String(payload.event ?? ''), p_payload: payload,
  });
  if (error) {
    console.error('process_razorpay_event failed', eventId, error.code, error.message);
    return res.status(500).json({ error: 'processing_failed' });   // Razorpay will retry
  }
  return res.status(200).json({ result: data });
}
