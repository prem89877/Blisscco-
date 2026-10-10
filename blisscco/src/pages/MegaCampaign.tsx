import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Check, Msg, Section } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../i18n';
import { RETURN_KEY } from '../lib/bookingErrors';
import { fmtDate, rupees, istToday } from '../lib/format';
import { megaErrKey, rewardLabel, istDayOf, type MegaPublic } from '../lib/megaStore';
import { supabase } from '../lib/supabase';

/** The page the Mega Store campaign-entry QR opens: /mega/<store code>. Works before login. */
export default function MegaCampaign() {
  const { code = '' } = useParams();
  const { t, lang } = useI18n();
  const { session } = useAuth();
  const uid = session?.user.id ?? null;
  const [data, setData] = useState<MegaPublic | null | undefined>(undefined);
  const [female, setFemale] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const { data: d, error: e } = await supabase.rpc('get_mega_campaign_public', { p_code: code });
    if (e) { console.error(e); setData(null); return; }
    setData(d as MegaPublic);
  }, [code]);
  useEffect(() => { void load(); }, [load, uid]);

  function rememberReturn() { try { sessionStorage.setItem(RETURN_KEY, `/mega/${code}`); } catch { /* ignore */ } }

  async function join() {
    if (busy) return;
    setBusy(true); setError('');
    const { error: e } = await supabase.rpc('join_mega_campaign', { p_code: code, p_declared_female: female });
    setBusy(false);
    if (e) { setError(t(megaErrKey(e.message))); return; }
    await load();
  }

  if (data === undefined) return <div className="mx-auto h-40 max-w-md animate-pulse rounded-2xl bg-ink/10" />;
  if (data === null || !data.found || !data.store) return <p role="alert" className="p-6 text-center">{t('mg.cp.notFound')}</p>;

  const store = data.store;
  const c = data.campaign;
  const me = data.me;
  const fmt = (iso: string) => fmtDate(istDayOf(iso), lang);

  if (!c) {
    return (
      <section className="mx-auto max-w-md space-y-4 px-4 py-6 text-center">
        <h1 className="font-display text-2xl font-semibold">{store.name}</h1>
        <p>{t('mg.cp.noCampaign')}</p>
        <Link to="/explore" className="btn-secondary">{t('common.backHome')}</Link>
      </section>
    );
  }

  const reward = rewardLabel(c.reward_type, c.reward_value, c.max_discount_inr, t);
  const ended = istDayOf(c.ends_at) < istToday();

  return (
    <section className="mx-auto max-w-lg space-y-4 px-4 py-6">
      <div className="space-y-1 text-center">
        <p className="text-sm text-ink/70">{t('mg.cp.by', { name: store.name })}</p>
        <h1 className="font-display text-2xl font-semibold">{c.title}</h1>
        {c.description && <p className="text-sm text-ink/80">{c.description}</p>}
        <p className="pt-1 font-display text-3xl font-semibold text-ink">{reward}</p>
        <p className="text-sm text-ink/70">{t('mg.cp.valid', { a: fmt(c.starts_at), b: fmt(c.ends_at) })}</p>
      </div>

      {c.status === 'paused' && <p role="status" className="rounded-xl bg-amber-50 p-3 text-sm">{t('mg.cp.paused')}</p>}
      <Msg error={error} />

      {/* Join / progress */}
      {!session && (
        <div className="card space-y-3">
          <Link to="/login" onClick={rememberReturn} className="btn-confirm">{t('mg.cp.login')}</Link>
          <Link to="/register" onClick={rememberReturn} className="btn-secondary w-full">{t('mg.cp.signup')}</Link>
        </div>
      )}
      {session && me && me.role !== 'customer' && <p role="status" className="rounded-xl bg-amber-50 p-3 text-sm">{t('mg.cp.notCustomer')}</p>}
      {session && me?.role === 'customer' && !me.enrolled && c.status === 'active' && !ended && (
        <div className="card space-y-3">
          <Check id="mega-female" label={t('mg.cp.declare')} checked={female} onChange={setFemale} disabled={busy} />
          <button type="button" className="btn-confirm" disabled={busy || !female} onClick={() => void join()}>{t('mg.cp.join')}</button>
        </div>
      )}
      {session && me?.role === 'customer' && me.enrolled && (
        <div className="card space-y-2">
          <p className="font-medium text-green-800">✓ {t('mg.cp.joined')}</p>
          <p className="text-sm">{t('mg.cp.progress', { n: me.earned, max: c.max_rewards })}</p>
          <p className="text-sm text-ink/80">{t('mg.cp.findShop')}</p>
          <Link to="/my-rewards" className="btn-secondary">{t('mg.cp.myRewards')}</Link>
        </div>
      )}

      <Section title={t('mg.cp.howTitle')}>
        <ol className="list-decimal space-y-1.5 pl-5 text-sm">
          <li>{t('mg.cp.how1')}</li>
          <li>{t('mg.cp.how2')}</li>
          <li>{t('mg.cp.how3', { store: store.name })}</li>
          <li>{t('mg.cp.how4', { store: store.name })}</li>
        </ol>
      </Section>

      <Section title={t('mg.cp.rules')}>
        <ul className="list-disc space-y-1.5 pl-5 text-sm">
          <li>{t('mg.cp.ruleWomen')}</li>
          <li>{t('mg.cp.ruleMax', { n: c.max_rewards })}</li>
          <li>{t('mg.cp.ruleExpiry')}</li>
          {c.one_reward_per_shop && <li>{t('mg.cp.ruleOnePerShop')}</li>}
          {c.min_service_price_inr > 0 && <li>{t('mg.cp.ruleMinService', { n: rupees(c.min_service_price_inr) })}</li>}
          {c.min_purchase_inr > 0 && <li>{t('mg.cp.ruleMinBill', { store: store.name, n: rupees(c.min_purchase_inr) })}</li>}
          <li>{t('mg.cp.ruleJoinFirst')}</li>
        </ul>
        <p className="text-xs text-ink/70">{t('mg.cp.funded', { store: store.name })}</p>
      </Section>

      <Section title={t('mg.cp.shops')}>
        <ul className="space-y-2">
          {(data.shops ?? []).map((s) => (
            <li key={s.id}>
              <Link to={`/b/${s.id}`} className="flex items-center justify-between rounded-xl border border-ink/10 p-3 transition hover:bg-blush/20">
                <span className="font-medium">{s.name}</span>
                {s.city && <span className="text-sm text-ink/70">{s.city}</span>}
              </Link>
            </li>
          ))}
        </ul>
      </Section>
    </section>
  );
}
