import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Msg, Section } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import { useI18n } from '../../i18n';
import { RETURN_KEY } from '../../lib/bookingErrors';
import { fmtDate, rupees } from '../../lib/format';
import { istDayOf, megaErrKey, rewardLabel, type MegaLookup } from '../../lib/megaStore';
import { supabase } from '../../lib/supabase';
import Skeleton from '../../components/Skeleton';

/** Opened by scanning the customer's reward QR (/mega/redeem/<code>) or from the Mega Store dashboard. Only the Mega Store owner can redeem. */
export default function MegaStoreRedeem() {
  const { code = '' } = useParams();
  const { t, lang } = useI18n();
  const { session, profile, loading } = useAuth();
  const [r, setR] = useState<MegaLookup | null | undefined>(undefined);
  const [bill, setBill] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ discount_inr: number; payable_inr: number; bill_inr: number } | null>(null);
  const isOwner = !!session && profile?.role === 'owner' && !profile.is_suspended;

  const load = useCallback(async () => {
    const { data, error: e } = await supabase.rpc('megastore_lookup_reward', { p_code: code });
    if (e) { setR(null); return; }
    setR(data as MegaLookup);
  }, [code]);
  useEffect(() => { if (isOwner) void load(); }, [isOwner, load]);

  async function redeem(e: FormEvent) {
    e.preventDefault();
    if (busy || !r) return;
    const n = Number(bill);
    if (!(n > 0)) return setError(t('mg.err.invalid_bill'));
    setBusy(true); setError('');
    const { data, error: err } = await supabase.rpc('megastore_redeem_reward', { p_code: r.code, p_bill_inr: n });
    setBusy(false);
    if (err) { setError(t(megaErrKey(err.message))); await load(); return; }
    setResult(data as { discount_inr: number; payable_inr: number; bill_inr: number });
    await load();
  }

  if (loading) return <Skeleton />;
  if (!session) {
    return (
      <section className="mx-auto max-w-md space-y-4 px-4 py-6 text-center">
        <h1 className="font-display text-2xl font-semibold">{t('mg.rp.title')}</h1>
        <p>{t('mg.rp.login')}</p>
        <Link to="/owner/login" className="btn-confirm" onClick={() => { try { sessionStorage.setItem(RETURN_KEY, `/mega/redeem/${code}`); } catch { /* ignore */ } }}>{t('mg.rp.loginBtn')}</Link>
      </section>
    );
  }
  if (!isOwner) return <p role="alert" className="p-6 text-center">{t('mg.rp.notOwner')}</p>;
  if (r === undefined) return <div className="mx-auto mt-6 h-40 max-w-md animate-pulse rounded-2xl bg-ink/10" />;
  if (r === null) {
    return (
      <section className="mx-auto max-w-md space-y-4 px-4 py-6 text-center">
        <p role="alert">{t('mg.rp.notFound')}</p>
        <Link to="/owner/megastore" className="btn-secondary">{t('mg.back')}</Link>
      </section>
    );
  }

  const usable = r.state === 'active';
  return (
    <section className="mx-auto max-w-md space-y-4 px-4 py-6">
      <Link to="/owner/megastore" className="text-sm btn-text">{t('mg.back')}</Link>
      <h1 className="font-display text-2xl font-semibold">{t('mg.rp.title')}</h1>
      <Section title={r.code}>
        <div className="space-y-1.5 text-sm">
          <p><span className="text-ink/70">{t('mg.rp.customer')}:</span> <strong>{r.customer_name || '—'}</strong></p>
          <p><span className="text-ink/70">{t('mg.rp.earnedAt')}:</span> {r.business_name}</p>
          <p><span className="text-ink/70">{t('mg.rp.reward')}:</span> <strong>{rewardLabel(r.reward_type, r.reward_value, r.max_discount_inr, t)}</strong></p>
          {r.min_purchase_inr > 0 && <p>{t('mg.rp.minPurchase', { n: rupees(r.min_purchase_inr) })}</p>}
          {r.expires_at && <p>{t('mg.rp.expires', { d: fmtDate(istDayOf(r.expires_at), lang) })}</p>}
        </div>
        <span className={`inline-block rounded-full px-3 py-1 text-xs font-semibold ${usable ? 'bg-green-100 text-green-900' : 'bg-red-100 text-red-900'}`}>{t(`mg.state.${r.state}`)}</span>
      </Section>

      {result && (
        <div role="status" className="card space-y-1 border-green-300 bg-green-50 text-center">
          <p className="font-semibold text-green-900">✓ {t('mg.rp.done')}</p>
          <p>{t('mg.rp.discount')}: <strong>{rupees(result.discount_inr)}</strong></p>
          <p>{t('mg.rp.payable')}: <strong>{rupees(result.payable_inr)}</strong></p>
          <Link to="/owner/megastore" className="btn-secondary mt-2">{t('mg.rp.another')}</Link>
        </div>
      )}

      {!result && usable && (
        <form onSubmit={redeem} className="card space-y-3" noValidate>
          <div className="space-y-1.5">
            <label htmlFor="mg-bill" className="text-sm font-medium">{t('mg.rp.bill')}</label>
            <input id="mg-bill" className="input" inputMode="decimal" value={bill} disabled={busy}
              onChange={(e) => setBill(e.target.value.replace(/[^0-9.]/g, '').slice(0, 10))} />
          </div>
          <p className="text-xs text-ink/70">{t('mg.rp.fund')}</p>
          <Msg error={error} />
          <button type="submit" className="btn-confirm" disabled={busy || !bill}>{busy ? t('common.loading') : t('mg.rp.confirm')}</button>
        </form>
      )}
      {!result && !usable && (
        <>
          <Msg error={error} />
          {r.state === 'redeemed' && <p className="text-sm">{t('mg.err.already_redeemed')}</p>}
          {r.state === 'expired' && <p className="text-sm">{t('mg.err.expired')}</p>}
          {(r.state === 'on_hold' || r.state === 'revoked' || r.state === 'rejected') && <p className="text-sm">{t('mg.err.not_usable')}</p>}
        </>
      )}
    </section>
  );
}
