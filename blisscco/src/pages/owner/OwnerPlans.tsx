import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { TierChip, VerifiedTick } from '../../components/TierBadge';
import { Msg, Section } from '../../components/ui';
import { useI18n } from '../../i18n';
import { rupees } from '../../lib/format';
import { loadRazorpay, PLAN_ERRORS, type OrderResponse } from '../../lib/razorpay';
import { supabase } from '../../lib/supabase';
import type { Entitlements, PaymentTxn, Plan } from '../../lib/types';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const daysLeft = (iso: string) => Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000);

export default function OwnerPlans() {
  const { id } = useParams();
  const { t, lang } = useI18n();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [ent, setEnt] = useState<Entitlements | null>(null);
  const [txns, setTxns] = useState<PaymentTxn[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [msg, setMsg] = useState({ error: '', ok: '' });
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const day = (iso: string) => new Date(iso).toLocaleDateString(lang === 'en' ? 'en-IN' : lang === 'hi' ? 'hi-IN' : 'mr-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });

  const load = useCallback(async () => {
    if (!id) return;
    const [p, e, x] = await Promise.all([
      supabase.from('plans').select('*').eq('is_active', true).order('sort_order'),
      supabase.rpc('my_entitlements', { p_business_id: id }),
      supabase.from('payment_transactions').select('id,business_id,plan_code,amount_paise,status,refunded_paise,created_at')
        .eq('business_id', id).order('created_at', { ascending: false }).limit(10),
    ]);
    if (!alive.current) return;
    if (p.error || e.error) { console.error(p.error ?? e.error); setMsg({ error: t('err.generic'), ok: '' }); return; }
    setPlans((p.data ?? []) as Plan[]); setEnt(e.data as Entitlements); setTxns((x.data ?? []) as PaymentTxn[]);
  }, [id, t]);
  useEffect(() => { void load(); }, [load]);

  // The browser callback is NOT trusted. We only wait until the server webhook has marked the payment as paid.
  async function waitForActivation(txnId: string) {
    setWaiting(true);
    let paid = false;
    for (let i = 0; i < 20 && alive.current && !paid; i++) {
      await sleep(2000);
      const { data } = await supabase.from('payment_transactions').select('status').eq('id', txnId).maybeSingle();
      paid = data?.status === 'paid';
    }
    if (!alive.current) return;
    setWaiting(false); setBusy(null);
    setMsg(paid ? { error: '', ok: t('p8.activated') } : { error: '', ok: t('p8.activating') });
    await load();
  }

  async function buy(code: string) {
    if (busy || waiting || !id) return;
    setBusy(code); setMsg({ error: '', ok: '' });
    let opened = false;
    try {
      const { data: s } = await supabase.auth.getSession();
      const token = s.session?.access_token;
      if (!token) { setMsg({ error: t('p8.err.unauthorized'), ok: '' }); return; }
      const r = await fetch('/api/create-order', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ business_id: id, plan_code: code }),
      });
      const j = (await r.json().catch(() => ({}))) as Partial<OrderResponse> & { error?: string };
      if (!r.ok || !j.order_id) { setMsg({ error: t(j.error && PLAN_ERRORS.includes(j.error) ? `p8.err.${j.error}` : 'err.generic'), ok: '' }); return; }
      const order = j as OrderResponse;
      if (!(await loadRazorpay()) || !window.Razorpay) { setMsg({ error: t('p8.err.gateway_error'), ok: '' }); return; }
      const rz = new window.Razorpay({
        key: order.key_id, amount: order.amount, currency: order.currency, name: 'Blisscco', description: order.description,
        order_id: order.order_id, theme: { color: '#FF91A4' },
        handler: () => { void waitForActivation(order.txn_id); },
        modal: { ondismiss: () => { if (alive.current) setBusy(null); } },
      });
      rz.on('payment.failed', () => setMsg({ error: t('p8.payFailed'), ok: '' }));
      opened = true;
      rz.open();
    } catch (e) {
      console.error(e); setMsg({ error: t('err.network'), ok: '' });
    } finally {
      if (!opened) setBusy(null);
    }
  }

  const left = ent?.plan_expires_at ? daysLeft(ent.plan_expires_at) : null;
  const main = plans.filter((p) => p.kind === 'plan');
  const addOns = plans.filter((p) => p.kind !== 'plan');
  const price = (p: Plan) => rupees(p.amount_paise / 100);
  const planName = (code: string) => plans.find((p) => p.code === code)?.name ?? code;

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-6">
      <Link to="/owner" className="text-sm link-text">← {t('owner.title')}</Link>
      <h1 className="font-display text-2xl font-semibold">{t('p8.plansTitle')}</h1>
      <Msg error={msg.error} ok={msg.ok} />
      {waiting && <p role="status" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{t('p8.waiting')}</p>}
      {!ent && !msg.error && <div className="h-24 animate-pulse rounded-2xl bg-ink/10" />}

      {ent && (
        <Section title={t('p8.current')}>
          <p className="flex flex-wrap items-center gap-2">
            {ent.tier_rank > 0 ? <><TierChip rank={ent.tier_rank} /><span>{t('p8.activeUntil', { d: ent.plan_expires_at ? day(ent.plan_expires_at) : '' })}</span></> : <span>{t('p8.freePlan')}</span>}
          </p>
          {left !== null && left <= 7 && (
            <p role="alert" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{t('p8.renewSoon', { n: Math.max(left, 0) })}</p>
          )}
          <p className="flex items-center gap-2 text-sm">
            {ent.verified ? <><VerifiedTick /> {t('p8.verifiedUntil', { d: ent.verified_expires_at ? day(ent.verified_expires_at) : '' })}</> : t('p8.notVerified')}
          </p>
          <p className="text-sm">{t('p8.credits', { n: ent.credits })} · <Link to={`/owner/business/${id}/banners`} className="link-text">{t('p8.manageBanners')}</Link></p>
          <p className="text-xs text-ink/60">{t('p8.noAuto')}</p>
        </Section>
      )}

      {main.map((p) => (
        <Section key={p.code} title={p.name}>
          <p className="text-2xl font-semibold">{price(p)} <span className="text-sm font-normal text-ink/70">{t('p8.perDays', { n: p.duration_days })}</span></p>
          <p className="text-sm">{t(`p8.feat.${p.code}`)}</p>
          <button className="btn-primary w-full" disabled={!!busy || waiting} onClick={() => void buy(p.code)}>
            {busy === p.code ? t('common.loading') : ent?.plan_code === p.code ? t('p8.renew') : t('p8.buy')}
          </button>
        </Section>
      ))}

      {addOns.length > 0 && (
        <Section title={t('p8.addons')}>
          {addOns.map((p) => {
            const badgeLocked = p.kind === 'badge' && ent?.verification_status !== 'approved';
            const bannerLocked = p.kind === 'banner_pack' && (ent?.tier_rank ?? 0) < 1;
            return (
              <div key={p.code} className="flex items-center justify-between gap-3 border-t border-ink/10 pt-3 first:border-0 first:pt-0">
                <div className="min-w-0">
                  <p className="font-medium">{p.kind === 'badge' ? t('p8.badgeName') : t('p8.extraBanner')} · {price(p)}</p>
                  <p className="text-xs text-ink/70">{badgeLocked ? t('p8.badgeLocked') : bannerLocked ? t('p8.bannerLocked') : t(`p8.feat.${p.code}`)}</p>
                </div>
                {badgeLocked
                  ? <Link to={`/owner/business/${id}/verify`} className="btn-secondary flex-none">{t('p8.getVerified')}</Link>
                  : <button className="btn-secondary flex-none" disabled={!!busy || waiting || bannerLocked} onClick={() => void buy(p.code)}>{busy === p.code ? t('common.loading') : t('p8.buy')}</button>}
              </div>
            );
          })}
        </Section>
      )}

      {txns.length > 0 && (
        <Section title={t('p8.history')}>
          <ul className="divide-y divide-ink/10 text-sm">
            {txns.map((x) => (
              <li key={x.id} className="flex items-center justify-between gap-2 py-2">
                <span>{planName(x.plan_code)} · {day(x.created_at)}</span>
                <span>{rupees(x.amount_paise / 100)} · {t(`p8.tx.${x.status}`)}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}
