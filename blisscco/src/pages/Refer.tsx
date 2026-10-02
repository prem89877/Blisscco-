import { useCallback, useEffect, useState } from 'react';
import { Msg, Section } from '../components/ui';
import Field from '../components/Field';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../i18n';
import { fmtDate, rupees } from '../lib/format';
import { couponState, couponText } from '../lib/referral';
import { supabase } from '../lib/supabase';
import type { Coupon } from '../lib/types';

function PhoneVerify() {
  const { t } = useI18n();
  const { refreshProfile } = useAuth();
  const [phone, setPhone] = useState('+91');
  const [token, setToken] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errKey, setErrKey] = useState('');
  const clean = phone.replace(/[\s-]/g, '');
  const valid = /^\+[0-9]{10,15}$/.test(clean);

  async function send() {
    if (busy || !valid) return;
    setBusy(true); setErrKey('');
    const { error } = await supabase.auth.updateUser({ phone: clean });
    setBusy(false);
    if (error) { console.error(error); setErrKey('ref.smsError'); return; }
    setSent(true);
  }
  async function verify() {
    if (busy || !token.trim()) return;
    setBusy(true); setErrKey('');
    const { error } = await supabase.auth.verifyOtp({ phone: clean, token: token.trim(), type: 'phone_change' });
    setBusy(false);
    if (error) { console.error(error); setErrKey('ref.smsError'); return; }
    await refreshProfile();
  }

  return (
    <Section title={t('ref.verifyPhone')}>
      <p className="text-sm text-ink/70">{t('ref.phoneWhy')}</p>
      <Field id="ph" label={t('ref.phone')} value={phone} onChange={setPhone} disabled={busy || sent} />
      {!sent
        ? <button className="btn-primary w-full" disabled={busy || !valid} onClick={() => void send()}>{busy ? t('common.loading') : t('ref.sendCode')}</button>
        : <>
            <Field id="otp" label={t('ref.otp')} value={token} onChange={setToken} disabled={busy} />
            <button className="btn-primary w-full" disabled={busy} onClick={() => void verify()}>{busy ? t('common.loading') : t('ref.verify')}</button>
          </>}
      <Msg error={errKey ? t(errKey) : ''} />
    </Section>
  );
}

export default function Refer() {
  const { t, lang } = useI18n();
  const { profile } = useAuth();
  const [code, setCode] = useState('');
  const [active, setActive] = useState<boolean | null>(null);
  const [stats, setStats] = useState({ pending: 0, rewarded: 0 });
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [copied, setCopied] = useState(false);
  const [errKey, setErrKey] = useState('');

  const load = useCallback(async () => {
    const [c, a, s, cp] = await Promise.all([
      supabase.rpc('get_my_referral_code'), supabase.rpc('referral_campaign_active'), supabase.rpc('my_referral_stats'),
      supabase.from('coupons').select('*').order('created_at', { ascending: false }).limit(50),
    ]);
    if (c.error) { console.error(c.error); setErrKey('err.generic'); return; }
    setCode(c.data as string);
    setActive(a.data === true);
    const row = ((s.data ?? []) as { pending: number; rewarded: number }[])[0];
    if (row) setStats(row);
    setCoupons((cp.data ?? []) as Coupon[]);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const link = `${window.location.origin}/?ref=${code}`;
  const text = `${t('ref.shareText')} ${link}`;
  const canShare = typeof navigator.share === 'function';

  async function copy() {
    try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* clipboard blocked */ }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-6">
      <h1 className="font-display text-2xl font-semibold">{t('ref.title')}</h1>
      <Msg error={errKey ? t(errKey) : ''} />
      {active === false && <p className="text-ink/70">{t('ref.inactive')}</p>}

      {active && code && (
        <Section title={t('ref.code')}>
          <p className="text-sm text-ink/80">{t('ref.how')}</p>
          <p className="rounded-xl bg-cream p-3 text-center font-mono text-2xl font-semibold tracking-widest">{code}</p>
          <p className="break-all text-xs text-ink/60">{link}</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <a className="btn-primary" href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noopener noreferrer">{t('ref.whatsapp')}</a>
            {canShare && <button className="btn-secondary" onClick={() => void navigator.share({ title: 'Blisscco', text: t('ref.shareText'), url: link }).catch(() => undefined)}>{t('ref.share')}</button>}
            <button className="btn-secondary" onClick={() => void copy()}>{copied ? t('ref.copied') : t('ref.copy')}</button>
          </div>
          <p className="text-sm">{t('ref.stats', { p: stats.pending, r: stats.rewarded })}</p>
        </Section>
      )}

      {active && profile && !profile.phone_verified && <PhoneVerify />}

      <Section title={t('ref.coupons')}>
        {coupons.length === 0 && <p className="text-sm text-ink/70">{t('ref.noCoupons')}</p>}
        <ul className="space-y-3">
          {coupons.map((c) => (
            <li key={c.id} className="rounded-xl border border-ink/10 p-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-base font-semibold">{c.code}</span>
                <span className="rounded-full bg-ink/10 px-3 py-1 text-xs font-semibold">{t(`cp.status.${couponState(c)}`)}</span>
              </div>
              <p className="font-medium">{couponText(c, t)}</p>
              <p className="text-ink/70">{t('cp.anyShop')} · {t('cp.minSpend', { n: rupees(c.min_spend_inr).slice(1) })} · {t('cp.expires', { d: fmtDate(c.expires_at.slice(0, 10), lang) })}</p>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
