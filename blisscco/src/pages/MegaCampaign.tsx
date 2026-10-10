import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Check, Msg, Section } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../i18n';
import { fmtDate, rupees, istToday } from '../lib/format';
import { megaErrKey, rewardLabel, istDayOf, type MegaJoinResult, type MegaPublic, type MegaTermsPayload } from '../lib/megaStore';
import { rememberReturnTo } from '../lib/returnTo';
import { supabase } from '../lib/supabase';

/**
 * The page the Mega Store campaign-entry QR opens: /mega/<store code>. Works before login.
 * The QR holds only the random store code. Every rule (running campaign, customer account, verified e-mail, one entry per
 * account, terms) is checked again by the database in join_mega_campaign(); this page only decides what to show.
 * Scanning or joining never creates a reward: rewards come only after a completed service at a partner shop.
 */
export default function MegaCampaign() {
  const { code = '' } = useParams();
  const { t, lang } = useI18n();
  const { session } = useAuth();
  const uid = session?.user.id ?? null;
  const [data, setData] = useState<MegaPublic | null | undefined>(undefined);
  const [female, setFemale] = useState(false);
  const [terms, setTerms] = useState<MegaTermsPayload | null>(null);
  const [termsOk, setTermsOk] = useState(false);
  const [outcome, setOutcome] = useState<MegaJoinResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const { data: d, error: e } = await supabase.rpc('get_mega_campaign_public', { p_code: code });
    if (e) { console.error(e); setData(null); return; }
    setData(d as MegaPublic);
  }, [code]);
  useEffect(() => { void load(); }, [load, uid]);

  // Customer terms (only when this customer can still join and the campaign has published terms)
  const campaignId = data?.campaign?.id;
  const needTerms = !!session && data?.me?.role === 'customer' && !data.me.enrolled && !!campaignId;
  useEffect(() => {
    if (!needTerms || !campaignId) { setTerms(null); return; }
    let alive = true;
    void supabase.rpc('get_mega_terms', { p_campaign_id: campaignId, p_scope: 'customer' }).then(({ data: d, error: e }) => {
      if (!alive) return;
      if (e) { console.error(e); setTerms(null); return; }
      setTerms(d as MegaTermsPayload);
    });
    return () => { alive = false; };
  }, [needTerms, campaignId]);

  function rememberReturn() { rememberReturnTo(`/mega/${code}`); }

  async function join() {
    if (busy) return;
    setBusy(true); setError('');
    const { data: res, error: e } = await supabase.rpc('join_mega_campaign', { p_code: code, p_declared_female: female, p_accept_terms: termsOk });
    setBusy(false);
    if (e) { setError(t(megaErrKey(e.message))); await load(); return; }   // reload: the campaign may have been paused meanwhile
    setOutcome(res === 'joined' ? 'joined' : 'already_joined');
    await load();
  }

  if (data === undefined) return <div className="mx-auto h-40 max-w-md animate-pulse rounded-2xl bg-ink/10" />;
  if (data === null || !data.found || !data.store) return <p role="alert" className="p-6 text-center">{t('mg.cp.notFound')}</p>;

  const store = data.store;
  const c = data.campaign;
  const me = data.me;

  if (!c) {
    return (
      <section className="mx-auto max-w-md space-y-4 px-4 py-6 text-center">
        <h1 className="font-display text-2xl font-semibold">{store.name}</h1>
        <p role="status" className="rounded-xl bg-amber-50 p-3 text-sm">{data.closed ? t('mg.cp.closed') : t('mg.cp.noCampaign')}</p>
        <Link to="/explore" className="btn-secondary">{t('common.backHome')}</Link>
      </section>
    );
  }

  const reward = rewardLabel(c.reward_type, c.reward_value, c.max_discount_inr, t);
  const expired = c.state === 'expired' || istDayOf(c.ends_at) < istToday();
  const paused = !expired && c.status === 'paused';
  // The server decides (join_mega_campaign); this only hides the button when the answer would be "no".
  const canJoin = (c.registrations_open ?? c.status === 'active') && !expired;
  const fmt = (iso: string) => fmtDate(istDayOf(iso), lang);
  const isCustomer = session && me?.role === 'customer';
  const enrolled = !!(isCustomer && me?.enrolled);
  const justJoined = enrolled && outcome === 'joined';
  const needsAccept = !!terms?.terms && !terms.accepted;
  const verified = me?.email_verified !== false;

  const shopsSection = (
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
  );

  const howSection = (
    <Section title={t('mg.cp.howTitle')}>
      <ol className="list-decimal space-y-1.5 pl-5 text-sm">
        <li>{t('mg.cp.how1')}</li>
        <li>{t('mg.cp.how2')}</li>
        <li>{t('mg.cp.how3', { store: store.name })}</li>
        <li>{t('mg.cp.how4', { store: store.name })}</li>
      </ol>
      <p className="text-sm text-ink/80">{t('mg.cp.scanNoReward')}</p>
    </Section>
  );

  return (
    <section className="mx-auto max-w-lg space-y-4 px-4 py-6">
      <div className="space-y-1 text-center">
        <p className="text-sm text-ink/70">{t('mg.cp.by', { name: store.name })}</p>
        <h1 className="font-display text-2xl font-semibold">{c.title}</h1>
        {c.description && <p className="text-sm text-ink/80">{c.description}</p>}
        <p className="pt-1 font-display text-3xl font-semibold text-ink">{reward}</p>
        <p className="text-sm text-ink/70">{t('mg.cp.valid', { a: fmt(c.starts_at), b: fmt(c.ends_at) })}</p>
      </div>

      {expired && <p role="status" className="rounded-xl bg-amber-50 p-3 text-sm">{t('mg.cp.expired')}</p>}
      {paused && <p role="status" className="rounded-xl bg-amber-50 p-3 text-sm">{canJoin ? t('mg.cp.paused') : t('mg.cp.pausedNoEntry')}</p>}
      <Msg error={error} />

      {/* 1. Not logged in: Blisscco login / registration; the page comes back here afterwards */}
      {!session && (
        <div className="card space-y-3">
          <p className="text-sm">{t('mg.cp.loginFirst')}</p>
          <Link to="/login" onClick={rememberReturn} className="btn-confirm">{t('mg.cp.login')}</Link>
          <Link to="/register" onClick={rememberReturn} className="btn-secondary w-full">{t('mg.cp.signup')}</Link>
          <p className="text-xs text-ink/70">{t('mg.cp.verifyNote')}</p>
        </div>
      )}
      {session && me && me.role !== 'customer' && <p role="status" className="rounded-xl bg-amber-50 p-3 text-sm">{t('mg.cp.notCustomer')}</p>}

      {/* 2. Logged-in customer who has not joined yet */}
      {isCustomer && !enrolled && !verified && <p role="status" className="rounded-xl bg-amber-50 p-3 text-sm">{t('mg.err.email_not_verified')}</p>}
      {isCustomer && !enrolled && verified && canJoin && (
        <div className="card space-y-3">
          <Check id="mega-female" label={t('mg.cp.declare')} checked={female} onChange={setFemale} disabled={busy} />
          {terms?.terms && needsAccept && (
            <>
              <details className="rounded-xl border border-ink/10 p-3 text-sm">
                <summary className="cursor-pointer font-medium">{terms.terms.title}</summary>
                <p className="mt-2 max-h-60 overflow-y-auto whitespace-pre-wrap text-ink/80">{terms.terms.body_md}</p>
              </details>
              <Check id="mega-terms" label={t('mg.cp.acceptTerms')} checked={termsOk} onChange={setTermsOk} disabled={busy} />
            </>
          )}
          <button type="button" className="btn-confirm" disabled={busy || !female || (needsAccept && !termsOk)} onClick={() => void join()}>
            {busy ? t('common.loading') : t('mg.cp.join')}
          </button>
        </div>
      )}

      {/* 3. Joined: confirmation (just now) or the friendly "already joined" (scanned again) */}
      {enrolled && (
        <div className="card space-y-2">
          {justJoined ? (
            <>
              <p className="font-display text-xl font-semibold text-green-800">🎉 {t('mg.cp.enteredTitle')}</p>
              <p className="text-sm">{t('mg.cp.enteredBody', { store: store.name })}</p>
            </>
          ) : (
            <p role="status" className="font-medium text-green-800">✓ {t('mg.cp.alreadyJoined')}</p>
          )}
          <p className="text-sm">{t('mg.cp.progress', { n: me?.earned ?? 0, max: c.max_rewards })}</p>
          <p className="text-sm text-ink/80">{t('mg.cp.findShop')}</p>
          <Link to="/my-rewards" className="btn-secondary">{t('mg.cp.myRewards')}</Link>
        </div>
      )}

      {/* Once joined, the partner shops come first: that is the next step */}
      {enrolled && shopsSection}
      {howSection}

      <Section title={t('mg.cp.rules')}>
        <ul className="list-disc space-y-1.5 pl-5 text-sm">
          <li>{t('mg.cp.ruleWomen')}</li>
          <li>{t('mg.cp.ruleOneEntry')}</li>
          <li>{t('mg.cp.ruleMax', { n: c.max_rewards })}</li>
          <li>{t('mg.cp.ruleExpiry')}</li>
          {c.one_reward_per_shop && <li>{t('mg.cp.ruleOnePerShop')}</li>}
          {c.min_service_price_inr > 0 && <li>{t('mg.cp.ruleMinService', { n: rupees(c.min_service_price_inr) })}</li>}
          {c.min_purchase_inr > 0 && <li>{t('mg.cp.ruleMinBill', { store: store.name, n: rupees(c.min_purchase_inr) })}</li>}
          <li>{t('mg.cp.ruleJoinFirst')}</li>
        </ul>
        <p className="text-xs text-ink/70">{t('mg.cp.funded', { store: store.name })}</p>
      </Section>

      {!enrolled && shopsSection}
    </section>
  );
}
