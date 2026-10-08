// POST /api/dispatch-notifications        header:  Authorization: Bearer <NOTIFY_CRON_SECRET>
// Called by the database (pg_net, right after a notification is created, and every minute by pg_cron while anything is due).
// It claims pending deliveries (service_role), sends web-push (VAPID) and e-mail (Resend), and reports the result back.
//
// HONEST STATUS RULE: a delivery is marked 'sent' ONLY after the provider accepted it (push service answered 2xx /
// Resend answered 2xx with an id). Any provider error -> 'retry' (back-off 2/4/8/16 min, max 5 tries) -> 'failed'.
// "sent" means the provider accepted it; it does not prove the person read it or that the mail reached the inbox.
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import * as webpushNs from 'web-push';
import { createHash, timingSafeEqual } from 'node:crypto';
import { composeNotification } from './_lib/notificationText.js';

// web-push is a CommonJS module; this works whether the runtime exposes it as a default or as a namespace.
const webpush = ((webpushNs as unknown as { default?: typeof webpushNs }).default ?? webpushNs) as typeof webpushNs;

interface Sub { endpoint: string; p256dh: string; auth: string }
interface Item {
  delivery_id: string;
  channel: 'push' | 'email';
  attempt: number;
  user_id: string;
  language: string | null;
  notification: { id: string; type: string; category: string; data: Record<string, unknown>; link: string | null; created_at: string };
  email: string | null;
  subscriptions: Sub[];
}
type Result = { result: 'sent' | 'retry' | 'failed' | 'skipped'; error?: string; providerId?: string };

const BATCH = 25;
const CONCURRENCY = 5;

function secretOk(given: string, expected: string): boolean {
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);                              // equal-length digests: no length leak
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const EMAIL_UI: Record<string, { open: string; foot: string }> = {
  en: { open: 'Open Blisscco', foot: 'You can change which emails you get under Notifications > Settings in the app.' },
  hi: { open: 'Blisscco खोलें', foot: 'ऐप में नोटिफ़िकेशन > सेटिंग्स में आप ईमेल बदल सकते हैं।' },
  mr: { open: 'Blisscco उघडा', foot: 'अ‍ॅपमध्ये सूचना > सेटिंग्जमध्ये तुम्ही ईमेल बदलू शकता.' },
};

function siteUrl(): string {
  const raw = process.env.SITE_URL ?? (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : '');
  return raw.replace(/\/+$/, '');
}

function emailHtml(title: string, body: string, url: string, lang: string): string {
  const ui = EMAIL_UI[lang] ?? EMAIL_UI.en;
  const button = url
    ? `<p style="margin:24px 0 0"><a href="${esc(url)}" style="display:inline-block;background:#FF91A4;color:#2D2A2E;text-decoration:none;font-weight:600;padding:12px 28px;border-radius:999px">${esc(ui.open)}</a></p>`
    : '';
  return `<!doctype html><html><body style="margin:0;background:#FDF8F5;padding:24px;font-family:Poppins,Arial,sans-serif;color:#2D2A2E">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="100%" style="max-width:480px;background:#ffffff;border-radius:16px;padding:28px" cellpadding="0" cellspacing="0"><tr><td>
<p style="margin:0 0 16px;font-size:20px;font-weight:700;color:#2D2A2E">Blisscco</p>
<h1 style="margin:0 0 8px;font-size:18px;line-height:1.3">${esc(title)}</h1>
<p style="margin:0;font-size:15px;line-height:1.6">${esc(body)}</p>${button}
<p style="margin:28px 0 0;font-size:12px;line-height:1.5;color:#6b676c">${esc(ui.foot)}</p>
</td></tr></table></td></tr></table></body></html>`;
}

async function sendEmail(item: Item): Promise<Result> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM;
  if (!key || !from) return { result: 'retry', error: 'email_not_configured' };
  if (!item.email) return { result: 'skipped', error: 'no_email_address' };

  const lang = item.language ?? 'en';
  const { title, body } = composeNotification(item.notification.type, item.notification.data, lang);
  const base = siteUrl();
  const url = base && item.notification.link ? base + item.notification.link : '';
  const text = `${title}\n\n${body}${url ? `\n\n${url}` : ''}`;

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      signal: ctl.signal,
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'Idempotency-Key': `bc-${item.delivery_id}` },
      body: JSON.stringify({ from, to: [item.email], subject: title, html: emailHtml(title, body, url, lang), text }),
    });
    if (r.ok) {
      const j = (await r.json().catch(() => ({}))) as { id?: string };
      if (j.id) return { result: 'sent', providerId: j.id };
      return { result: 'retry', error: 'resend_no_id' };      // 2xx without an id: do not claim it was sent
    }
    const retryable = r.status === 429 || r.status >= 500 || r.status === 401 || r.status === 403;
    return { result: retryable ? 'retry' : 'failed', error: `resend_${r.status}` };
  } catch (e) {
    return { result: 'retry', error: e instanceof Error && e.name === 'AbortError' ? 'resend_timeout' : 'resend_network' };
  } finally {
    clearTimeout(timer);
  }
}

async function sendPush(item: Item, report: (endpoint: string, outcome: 'ok' | 'gone' | 'error') => Promise<void>): Promise<Result> {
  if (!item.subscriptions.length) return { result: 'skipped', error: 'no_subscription' };
  const { title, body } = composeNotification(item.notification.type, item.notification.data, item.language ?? 'en');
  const payload = JSON.stringify({ title, body, url: item.notification.link ?? '/', tag: item.notification.id });
  const type = item.notification.type;
  // 'normal' urgency lets Android hold the message while the phone is idle (minutes of delay). Everything the person is waiting
  // for goes 'high' so it arrives right away; only the slow daily reminders stay 'normal'.
  const urgency = type === 'coupon_expiring' || type === 'subscription_expiring' ? 'normal' : 'high';
  const ttl = type === 'appointment_remind_20' ? 900 : 86400;      // a 20-minute reminder is useless if it arrives late: drop it after 15 min

  let ok = 0; let gone = 0; let retryable = 0; let fatal = 0; const codes: number[] = [];
  for (const s of item.subscriptions) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: ttl, urgency, timeout: 8000 });
      ok += 1;
      await report(s.endpoint, 'ok');
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode ?? 0;
      codes.push(code);
      if (code === 404 || code === 410) { gone += 1; await report(s.endpoint, 'gone'); }
      else if (code === 0 || code === 429 || code >= 500) { retryable += 1; await report(s.endpoint, 'error'); }
      else { fatal += 1; await report(s.endpoint, 'error'); }   // 400/401/403/413: this subscription will not work (e.g. VAPID key changed)
    }
  }
  if (ok > 0) return { result: 'sent' };                       // at least one device accepted it
  if (retryable > 0) return { result: 'retry', error: `push_${codes.join(',')}` };
  if (gone > 0 && fatal === 0) return { result: 'skipped', error: 'subscription_gone' };
  return { result: 'failed', error: `push_${codes.join(',')}` };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const secret = process.env.NOTIFY_CRON_SECRET;
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret || !url || !serviceKey) return res.status(500).json({ error: 'server_config' });

  const given = String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!given || !secretOk(given, secret)) return res.status(401).json({ error: 'unauthorized' });

  const vapidPublic = process.env.VAPID_PUBLIC_KEY ?? process.env.VITE_VAPID_PUBLIC_KEY;
  const vapidPrivate = process.env.VAPID_PRIVATE_KEY;
  const pushReady = Boolean(vapidPublic && vapidPrivate);
  if (pushReady) {
    try {
      webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:support@example.com', vapidPublic as string, vapidPrivate as string);
    } catch (e) {
      console.error('VAPID setup failed (check the keys)', e instanceof Error ? e.message : 'unknown');
      return res.status(500).json({ error: 'vapid_config' });
    }
  }

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const stats = { claimed: 0, sent: 0, retry: 0, failed: 0, skipped: 0 };
  const report = async (endpoint: string, outcome: 'ok' | 'gone' | 'error') => {
    const { error: e } = await admin.rpc('record_push_result', { p_endpoint: endpoint, p_outcome: outcome });
    if (e) console.error('record_push_result failed', e.code);
  };

  async function one(item: Item) {
    let r: Result;
    try {
      if (item.channel === 'push') r = pushReady ? await sendPush(item, report) : { result: 'retry', error: 'push_not_configured' };
      else r = await sendEmail(item);
    } catch (e) {
      console.error('delivery crashed', item.delivery_id, e instanceof Error ? e.message : 'unknown');
      r = { result: 'retry', error: 'dispatcher_error' };
    }
    stats[r.result] += 1;
    const { error: fe } = await admin.rpc('finish_delivery', {
      p_id: item.delivery_id, p_result: r.result, p_error: r.error ?? null, p_provider_id: r.providerId ?? null,
    });
    // If this report fails the row stays 'sending' and is re-claimed after 5 minutes; it is never silently marked sent.
    if (fe) console.error('finish_delivery failed', item.delivery_id, fe.code);
  }

  const started = Date.now();
  for (let round = 0; round < 3; round += 1) {          // a burst larger than one batch is drained in the same call
    const { data, error } = await admin.rpc('claim_deliveries', { p_limit: BATCH });
    if (error) {
      console.error('claim_deliveries failed', error.code, error.message);
      return res.status(500).json({ error: 'claim_failed', ...stats });
    }
    const items = (data ?? []) as Item[];
    stats.claimed += items.length;

    let next = 0;
    const workers = Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
      while (next < items.length) { const i = next; next += 1; await one(items[i]); }
    });
    await Promise.all(workers);

    if (items.length < BATCH || Date.now() - started > 15000) break;
  }

  return res.status(200).json(stats);
}
