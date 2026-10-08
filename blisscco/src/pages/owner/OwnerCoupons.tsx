import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import Field from '../../components/Field';
import { Msg, Section } from '../../components/ui';
import { useI18n } from '../../i18n';
import { fmtDateTime, rupees } from '../../lib/format';
import { couponText, previewDiscount } from '../../lib/referral';
import { supabase } from '../../lib/supabase';
import type { Coupon } from '../../lib/types';

interface Check { valid: boolean; reason: string | null; discount_type: Coupon['discount_type']; discount_value: number; max_discount_inr: number | null; min_spend_inr: number; expires_at: string }
interface Eligible { booking_id: string; service_label: string; price_inr: number; completed_at: string; customer_name: string | null }
interface PromoCheck { valid: boolean; reason: string | null; remaining_inr: number; expires_at: string }
const KNOWN = ['not_found', 'coupon_not_found', 'expired', 'redeemed', 'revoked', 'not_accepting', 'wrong_business', 'min_spend', 'booking_mismatch',
  'promo_not_found', 'promo_expired', 'promo_used', 'promo_revoked', 'already_redeemed'];
// Refer-a-Customer Competition reward codes start with BP-  (Blisscco Promotional Balance); everything else is a normal coupon
const isPromo = (c: string) => c.trim().toUpperCase().startsWith('BP-');

export default function OwnerCoupons() {
  const { id } = useParams();
  const { t, lang } = useI18n();
  const [code, setCode] = useState('');
  const [check, setCheck] = useState<Check | null>(null);
  const [promo, setPromo] = useState<PromoCheck | null>(null);
  const [list, setList] = useState<Eligible[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState({ error: '', ok: '' });
  const errOf = (m: string | undefined | null) => t(m && KNOWN.includes(m) ? `oc.err.${m}` : 'err.generic');

  async function doCheck() {
    if (busy || !id || !code.trim()) return;
    setBusy(true); setMsg({ error: '', ok: '' }); setCheck(null); setPromo(null); setList([]);
    if (isPromo(code)) {
      const pc = await supabase.rpc('check_promo_balance', { p_code: code, p_business_id: id });
      if (pc.error) { setBusy(false); setMsg({ error: errOf(pc.error.message), ok: '' }); return; }
      const p = pc.data as PromoCheck;
      setPromo(p);
      if (!p.valid) { setBusy(false); setMsg({ error: errOf(p.reason), ok: '' }); return; }
      const pe = await supabase.rpc('promo_eligible_bookings', { p_code: code, p_business_id: id });
      setBusy(false);
      setList((pe.data ?? []) as Eligible[]);
      return;
    }
    const { data, error } = await supabase.rpc('check_coupon', { p_code: code, p_business_id: id });
    if (error) { setBusy(false); setMsg({ error: errOf(error.message), ok: '' }); return; }
    const c = data as Check;
    setCheck(c);
    if (!c.valid) { setBusy(false); setMsg({ error: errOf(c.reason), ok: '' }); return; }
    const el = await supabase.rpc('coupon_eligible_bookings', { p_code: code, p_business_id: id });
    setBusy(false);
    setList((el.data ?? []) as Eligible[]);
  }

  async function redeem(bookingId: string) {
    if (busy) return;
    setBusy(true); setMsg({ error: '', ok: '' });
    const promoMode = isPromo(code);
    const { data, error } = promoMode
      ? await supabase.rpc('redeem_promo_balance', { p_code: code, p_booking_id: bookingId })
      : await supabase.rpc('redeem_coupon', { p_code: code, p_booking_id: bookingId });
    setBusy(false);
    if (error) { setMsg({ error: errOf(error.message), ok: '' }); return; }
    setMsg({ error: '', ok: t('oc.done', { n: (data as { discount: number }).discount }) });
    setCheck(null); setPromo(null); setList([]); setCode('');
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-6">
      <Link to="/owner" className="text-sm btn-text">← {t('owner.title')}</Link>
      <h1 className="font-display text-2xl font-semibold">{t('oc.title')}</h1>
      <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{t('oc.fundNote')}</p>
      <Section title={t('oc.code')}>
        <Field id="cc" label={t('oc.code')} value={code} onChange={setCode} disabled={busy} />
        <button className="btn-primary w-full" disabled={busy || !code.trim()} onClick={() => void doCheck()}>{busy ? t('common.loading') : t('oc.check')}</button>
        <Msg error={msg.error} ok={msg.ok} />
      </Section>

      {promo?.valid && (
        <Section title={t('pb.valid')}>
          <p className="font-medium">{t('pb.remaining', { n: rupees(promo.remaining_inr) })} · {t('cp.expires', { d: fmtDateTime(promo.expires_at, lang) })}</p>
          <p className="text-sm font-medium">{t('oc.pickBooking')}</p>
          {list.length === 0 && <p className="text-sm text-ink/70">{t('oc.noBookings')}</p>}
          <ul className="space-y-2">
            {list.map((b) => (
              <li key={b.booking_id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-ink/10 p-3 text-sm">
                <div>
                  <p className="font-medium">{b.customer_name ?? '—'} · {b.service_label} · {rupees(b.price_inr)}</p>
                  <p className="text-ink/70">{fmtDateTime(b.completed_at, lang)} · {t('oc.off', { n: Math.min(Number(promo.remaining_inr), Number(b.price_inr)) })}</p>
                </div>
                <button className="btn-primary" disabled={busy} onClick={() => void redeem(b.booking_id)}>{t('oc.redeem')}</button>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {check?.valid && (
        <Section title={t('oc.valid')}>
          <p className="font-medium">{couponText(check, t)} · {t('cp.minSpend', { n: Number(check.min_spend_inr) })}</p>
          <p className="text-sm font-medium">{t('oc.pickBooking')}</p>
          {list.length === 0 && <p className="text-sm text-ink/70">{t('oc.noBookings')}</p>}
          <ul className="space-y-2">
            {list.map((b) => (
              <li key={b.booking_id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-ink/10 p-3 text-sm">
                <div>
                  <p className="font-medium">{b.customer_name ?? '—'} · {b.service_label} · {rupees(b.price_inr)}</p>
                  <p className="text-ink/70">{fmtDateTime(b.completed_at, lang)} · {t('oc.off', { n: previewDiscount(check, b.price_inr) })}</p>
                </div>
                <button className="btn-primary" disabled={busy} onClick={() => void redeem(b.booking_id)}>{t('oc.redeem')}</button>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}
