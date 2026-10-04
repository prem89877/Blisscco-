import QRCode from 'qrcode';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n';
import { rupees } from '../lib/format';
import { loadRazorpay, PLAN_ERRORS, UPI_ONLY, type OrderResponse } from '../lib/razorpay';
import { supabase } from '../lib/supabase';
import { Msg } from './ui';

const PLAN_CODE = 'physical_qr';
const TEMPLATE = '/qr-poster-template.jpg';           // 1418 x 2048, the Blisscco poster with an empty white box
const BOX = { x: 470, y: 692, size: 480 };              // white box inside the black frame (template pixels)
const NAME_Y = 440;                                     // shop name sits right under the "blisscco" logo
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i); i.onerror = () => reject(new Error('template'));
    i.src = src;
  });
}

/** Draws the poster: template + shop name under the logo + the shop's own QR in the white box. Returns a PNG data URL. */
async function renderPoster(name: string, link: string): Promise<string> {
  const [img] = await Promise.all([loadImage(TEMPLATE), document.fonts?.load('600 80px Poppins').catch(() => undefined)]);
  const c = document.createElement('canvas');
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const g = c.getContext('2d');
  if (!g) throw new Error('canvas');
  g.drawImage(img, 0, 0);

  const qr = document.createElement('canvas');
  await QRCode.toCanvas(qr, link, { width: BOX.size, margin: 1, errorCorrectionLevel: 'M', color: { dark: '#2D2A2E', light: '#FFFFFF' } });
  g.drawImage(qr, BOX.x, BOX.y, BOX.size, BOX.size);

  // shop name: one line, shrinks to fit, "…" if still too long
  let size = 84; const maxW = 980;
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#2D2A2E';
  const font = (px: number) => `600 ${px}px Poppins, 'Noto Sans Devanagari', system-ui, sans-serif`;
  g.font = font(size);
  while (g.measureText(name).width > maxW && size > 40) { size -= 4; g.font = font(size); }
  let text = name;
  while (g.measureText(text).width > maxW && text.length > 1) text = text.slice(0, -1);
  if (text !== name) text = text.trimEnd() + '…';
  g.fillText(text, c.width / 2, NAME_Y);
  return c.toDataURL('image/png');
}

interface Props { businessId: string; businessName: string; link: string; approved: boolean }

export default function PhysicalQrOrder({ businessId, businessName, link, approved }: Props) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [poster, setPoster] = useState('');
  const [amount, setAmount] = useState<number | null | undefined>(undefined);   // paise; null = product missing
  const [booked, setBooked] = useState(0);
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [msg, setMsg] = useState({ error: '', ok: '' });
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const loadInfo = useCallback(async () => {
    const [p, x] = await Promise.all([
      supabase.from('plans').select('amount_paise').eq('code', PLAN_CODE).eq('is_active', true).maybeSingle(),
      supabase.from('payment_transactions').select('id', { count: 'exact', head: true }).eq('business_id', businessId).eq('plan_code', PLAN_CODE).eq('status', 'paid'),
    ]);
    if (!alive.current) return;
    setAmount(p.error || !p.data ? null : (p.data as { amount_paise: number }).amount_paise);
    setBooked(x.count ?? 0);
  }, [businessId]);
  useEffect(() => { void loadInfo(); }, [loadInfo]);

  useEffect(() => {
    if (!open || poster) return;
    let live = true;
    renderPoster(businessName, link)
      .then((u) => { if (live) setPoster(u); })
      .catch((e) => { console.error(e); if (live) setMsg({ error: t('err.generic'), ok: '' }); });
    return () => { live = false; };
  }, [open, poster, businessName, link, t]);

  function close() { if (busy || waiting) return; setOpen(false); setMsg({ error: '', ok: '' }); }

  // The browser callback is NOT trusted: we only wait until the server webhook marks the payment as paid.
  async function waitForPaid(txnId: string) {
    setWaiting(true);
    let paid = false;
    for (let i = 0; i < 20 && alive.current && !paid; i++) {
      await sleep(2000);
      const { data } = await supabase.from('payment_transactions').select('status').eq('id', txnId).maybeSingle();
      paid = data?.status === 'paid';
    }
    if (!alive.current) return;
    setWaiting(false); setBusy(false);
    setMsg(paid ? { error: '', ok: t('pq.done') } : { error: '', ok: t('pq.pending') });
    await loadInfo();
  }

  async function pay() {
    if (busy || waiting) return;
    setBusy(true); setMsg({ error: '', ok: '' });
    let opened = false;
    try {
      const { data: s } = await supabase.auth.getSession();
      const token = s.session?.access_token;
      if (!token) { setMsg({ error: t('p8.err.unauthorized'), ok: '' }); return; }
      const r = await fetch('/api/create-order', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ business_id: businessId, plan_code: PLAN_CODE }),
      });
      const j = (await r.json().catch(() => ({}))) as Partial<OrderResponse> & { error?: string };
      if (!r.ok || !j.order_id) { setMsg({ error: t(j.error && PLAN_ERRORS.includes(j.error) ? `p8.err.${j.error}` : 'err.generic'), ok: '' }); return; }
      const order = j as OrderResponse;
      if (!(await loadRazorpay()) || !window.Razorpay) { setMsg({ error: t('p8.err.gateway_error'), ok: '' }); return; }
      const rz = new window.Razorpay({
        key: order.key_id, amount: order.amount, currency: order.currency, name: 'Blisscco', description: order.description,
        order_id: order.order_id, theme: { color: '#FF91A4' }, config: UPI_ONLY,
        handler: () => { void waitForPaid(order.txn_id); },
        modal: { ondismiss: () => { if (alive.current) setBusy(false); } },
      });
      rz.on('payment.failed', () => setMsg({ error: t('pq.failed'), ok: '' }));
      opened = true;
      rz.open();
    } catch (e) {
      console.error(e); setMsg({ error: t('err.network'), ok: '' });
    } finally {
      if (!opened) setBusy(false);
    }
  }

  const price = amount ? rupees(amount / 100) : '';

  return (
    <>
      <button className="btn-primary" disabled={!approved} onClick={() => setOpen(true)}>{t('pq.btn')}</button>
      {!approved && <p className="w-full text-xs text-ink/70">{t('pq.notLive')}</p>}
      {booked > 0 && <p className="w-full text-xs text-green-800">{t('pq.booked', { n: booked })}</p>}

      {open && (
        <div role="dialog" aria-modal="true" aria-label={t('pq.title')}
          className="fixed inset-0 z-50 flex items-end justify-center bg-ink/60 p-0 sm:items-center sm:p-4" onClick={close}>
          <div className="max-h-[95vh] w-full max-w-md space-y-3 overflow-y-auto rounded-t-3xl bg-white p-5 sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <h2 className="font-display text-xl font-semibold">{t('pq.title')}</h2>
              <button className="btn-text text-sm" onClick={close} disabled={busy || waiting}>{t('pq.close')}</button>
            </div>
            <p className="text-sm text-ink/70">{t('pq.sub')}</p>
            {poster
              ? <img src={poster} alt={t('pq.alt', { name: businessName })} className="mx-auto w-full max-w-[280px] rounded-2xl shadow-card ring-1 ring-ink/10" />
              : <div className="mx-auto aspect-[1418/2048] w-full max-w-[280px] animate-pulse rounded-2xl bg-ink/10" />}
            <Msg error={msg.error} ok={msg.ok} />
            {waiting && <p role="status" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{t('pq.waiting')}</p>}
            {amount === null
              ? <p role="alert" className="text-sm text-red-700">{t('pq.unavailable')}</p>
              : (
                <>
                  <p className="text-center font-medium">{price && t('pq.price', { p: price })}</p>
                  <button className="btn-primary w-full" disabled={!poster || !price || busy || waiting || !approved} onClick={() => void pay()}>
                    {busy || waiting ? t('common.loading') : t('pq.pay', { p: price || '' })}
                  </button>
                  <p className="text-center text-xs text-ink/60">{t('pq.upiOnly')}</p>
                  <p className="text-center text-xs text-ink/60">{t('pq.deliver')}</p>
                </>
              )}
          </div>
        </div>
      )}
    </>
  );
}
