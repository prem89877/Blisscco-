import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import RankBadge from '../components/RankBadge';
import { Msg, Section } from '../components/ui';
import { useI18n } from '../i18n';
import { fmtDate, fmtDateTime, rupees } from '../lib/format';
import { splitSeconds } from '../lib/shopReferral';
import type { CcLeaderRow, CcMyReferral, CcOverview, PromoBalance, PromoHistoryRow } from '../lib/customerCompetition';
import { supabase } from '../lib/supabase';

function Step({ ok, label }: { ok: boolean; label: string }) {
  return <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${ok ? 'bg-green-100 text-green-900' : 'bg-ink/10 text-ink/70'}`}>{ok ? '✓' : '○'} {label}</span>;
}

export default function CustomerCompetition() {
  const { t, lang } = useI18n();
  const [ov, setOv] = useState<CcOverview | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [rows, setRows] = useState<CcLeaderRow[]>([]);
  const [code, setCode] = useState('');
  const [refs, setRefs] = useState<CcMyReferral[]>([]);
  const [balances, setBalances] = useState<PromoBalance[]>([]);
  const [history, setHistory] = useState<PromoHistoryRow[]>([]);
  const [skew, setSkew] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [copied, setCopied] = useState(false);
  const [errKey, setErrKey] = useState('');

  const load = useCallback(async () => {
    const [o, r, b, h] = await Promise.all([
      supabase.rpc('get_customer_competition_overview'), supabase.rpc('my_customer_comp_referrals'),
      supabase.rpc('my_promo_balances'), supabase.rpc('my_promo_history'),
    ]);
    if (o.error) { console.error(o.error); setErrKey('err.generic'); setLoaded(true); return; }
    const cur = (o.data ?? null) as CcOverview | null;
    setOv(cur);
    if (cur) setSkew(new Date(cur.server_now).getTime() - Date.now());
    setRefs((r.data ?? []) as CcMyReferral[]);
    setBalances((b.data ?? []) as PromoBalance[]);
    setHistory((h.data ?? []) as PromoHistoryRow[]);
    if (cur) {
      const lb = await supabase.rpc('get_customer_competition_leaderboard', { p_competition_id: cur.id, p_limit: 20 });
      setRows((lb.data ?? []) as CcLeaderRow[]);
      if (cur.status === 'active' || cur.status === 'paused') {
        const c = await supabase.rpc('get_my_referral_code');
        if (!c.error) setCode(c.data as string);
      }
    }
    setLoaded(true);
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, []);

  const link = code ? `${window.location.origin}/?ref=${code}` : '';
  const text = `${t('cc.shareText')} ${link}`;
  const canShare = typeof navigator.share === 'function';
  async function copy() {
    try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* clipboard blocked */ }
  }

  const clock = (secs: number) => { const p = splitSeconds(secs); return t('sc.timeFmt', { d: p.d, h: p.h, m: p.m, s: p.s }); };
  const server = now + skew;
  const startMs = ov ? new Date(ov.starts_at).getTime() : 0;
  const endMs = ov ? new Date(ov.ends_at).getTime() : 0;
  const upcoming = !!ov && ov.status === 'active' && server < startMs;
  const finished = !!ov && (ov.status === 'ended' || ov.status === 'pending_verification');
  const stateLabel = !ov ? '' : ov.status === 'ended' ? t('sc.ended') : ov.status === 'pending_verification' ? t('cc.verifying') : ov.status === 'paused' ? t('sc.paused') : upcoming ? t('sc.upcoming') : t('sc.live');
  const countdown = !ov || finished ? '' : upcoming ? `${t('sc.startsIn')}: ${clock((startMs - server) / 1000)}`
    : server >= endMs ? t('sc.timeUp') : `${t('sc.left')}: ${clock((endMs - server) / 1000)}`;
  const live = !!ov && !finished;
  const stateText = (r: CcMyReferral) => t(`cc.state.${r.state}`);

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-6">
      <Link to="/refer" className="text-sm btn-text">← {t('ref.title')}</Link>
      <h1 className="font-display text-2xl font-semibold">{t('cc.title')}</h1>
      <Msg error={errKey ? t(errKey) : ''} />
      {!loaded && !errKey && <div className="h-24 animate-pulse rounded-2xl bg-ink/10" />}
      {loaded && !ov && !errKey && <p className="text-ink/70">{t('cc.none')}</p>}

      {ov && (
        <>
          <Section title={ov.title}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-blush/30 px-3 py-1 text-xs font-semibold">{stateLabel}</span>
              {countdown && <span role="timer" className="text-sm font-semibold">{countdown}</span>}
            </div>
            {ov.description && <p className="text-sm text-ink/80">{ov.description}</p>}
            <p className="rounded-xl bg-cream p-3 text-center font-semibold">🏆 {t('sc.prize')}: {t('cc.prizeValue', { amt: rupees(ov.reward_amount_inr) })}</p>
            <p className="text-xs text-ink/60">{t('cc.prizeNote')}{ov.sponsor_business_name ? ` ${t('cc.sponsorOnly', { shop: ov.sponsor_business_name })}` : ''}</p>
            <p className="text-sm text-ink/70">{t('sc.starts')}: {fmtDateTime(ov.starts_at, lang)} · {t('sc.endsOn')}: {fmtDateTime(ov.ends_at, lang)}</p>
            {ov.status === 'paused' && <p role="status" className="rounded-xl bg-amber-100 p-3 text-sm text-amber-900">{t('cc.pausedNote')}</p>}
          </Section>

          {finished && (
            <Section title={t('cc.winner')}>
              {ov.status === 'pending_verification'
                ? <p role="status" className="rounded-xl bg-amber-100 p-3 text-sm text-amber-900">{t('cc.verifyingNote')}</p>
                : ov.i_won
                  ? <div className="flex items-center gap-3"><RankBadge rank={1} size={72} /><p className="font-medium text-green-800">{t('cc.youWon', { amt: rupees(ov.reward_amount_inr) })}</p></div>
                  : ov.winner_name
                    ? <div className="flex items-center gap-3"><RankBadge rank={1} size={56} /><p>{t('cc.winnerLine', { name: ov.winner_name, n: ov.winner_referral_count ?? 0 })}</p></div>
                    : <p>{t('cc.noWinner')}</p>}
            </Section>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="card text-center"><p className="text-sm text-ink/70">{t('sc.myRank')}</p><p className="font-display text-3xl font-semibold">{ov.my_rank ? `#${ov.my_rank}` : '—'}</p>{!ov.my_rank && <p className="text-xs text-ink/60">{t('sc.notRanked')}</p>}</div>
            <div className="card text-center"><p className="text-sm text-ink/70">{t('cc.myCount')}</p><p className="font-display text-3xl font-semibold">{ov.my_count}</p>{ov.my_in_review > 0 && <p className="text-xs text-ink/60">{t('cc.inReviewN', { n: ov.my_in_review })}</p>}</div>
          </div>

          <Section title={t('sc.leaderboard')}>
            {rows.length === 0 && <p className="text-sm text-ink/70">{t('cc.noEntries')}</p>}
            {rows.length > 0 && (
              <ol className="divide-y divide-ink/10 text-sm">
                <li className="flex items-center gap-3 py-2 text-xs font-semibold text-ink/60"><span className="w-12">{t('sc.rank')}</span><span className="flex-1">{t('cc.customer')}</span><span>{t('sc.referrals')}</span></li>
                {rows.map((r) => (
                  <li key={r.rank} className={`flex items-center gap-3 py-2 ${r.is_me ? 'rounded-xl bg-blush/20 px-2 font-semibold' : ''}`}>
                    <span className="flex w-12 items-center"><RankBadge rank={r.rank} size={34} /></span>
                    <span className="min-w-0 flex-1 truncate">{r.display_name}{r.is_me ? ` (${t('sc.you')})` : ''}</span>
                    <span>{r.referrals}</span>
                  </li>
                ))}
              </ol>
            )}
          </Section>

          {live && (
            <Section title={t('cc.linkTitle')}>
              {code && (
                <>
                  <p className="text-sm text-ink/80">{t('cc.linkHow')}</p>
                  <p className="rounded-xl bg-cream p-3 text-center font-mono text-2xl font-semibold tracking-widest">{code}</p>
                  <p className="break-all text-xs text-ink/60">{link}</p>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                    <a className="btn-primary" href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noopener noreferrer">{t('sc.whatsapp')}</a>
                    {canShare && <button className="btn-secondary" onClick={() => void navigator.share({ title: 'Blisscco', text: t('cc.shareText'), url: link }).catch(() => undefined)}>{t('sc.share')}</button>}
                    <button className="btn-secondary" onClick={() => void copy()}>{copied ? t('sc.copied') : t('sc.copy')}</button>
                  </div>
                </>
              )}
              <p className="text-sm font-semibold">{t('sc.rulesTitle')}:</p>
              <ol className="list-decimal space-y-1 pl-5 text-sm text-ink/80">
                <li>{t('cc.rule1')}</li><li>{t('cc.rule2')}</li>
                <li>{t(ov.eligibility_rule === 'completed_booking' ? 'cc.rule3a' : 'cc.rule3b', { min: rupees(ov.min_booking_value_inr) })}</li>
                <li>{t('cc.rule4')}</li><li>{t('cc.rule5')}</li>
              </ol>
            </Section>
          )}
        </>
      )}

      <Section title={t('cc.myReferrals')}>
        {refs.length === 0 && <p className="text-sm text-ink/70">{t('cc.noReferrals')}</p>}
        <ul className="space-y-3">
          {refs.map((r) => (
            <li key={r.id} className="space-y-2 rounded-xl border border-ink/10 p-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{r.display_name}</span>
                <span className="rounded-full bg-ink/10 px-3 py-1 text-xs font-semibold">{stateText(r)}</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <Step ok label={t('cc.step.signup')} />
                <Step ok={r.email_verified} label={t('cc.step.email')} />
                <Step ok={r.activity_done} label={t('cc.step.activity')} />
              </div>
              {r.reject_reason && <p className="text-xs text-red-700">{t(`cc.reason.${r.reject_reason}`)}</p>}
            </li>
          ))}
        </ul>
      </Section>

      <Section title={t('cc.wallet')}>
        <p className="text-xs text-ink/60">{t('cc.walletNote')}</p>
        {balances.length === 0 && <p className="text-sm text-ink/70">{t('cc.noBalance')}</p>}
        <ul className="space-y-3">
          {balances.map((b) => (
            <li key={b.id} className="space-y-1 rounded-xl border border-ink/10 p-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-base font-semibold">{b.code}</span>
                <span className="rounded-full bg-ink/10 px-3 py-1 text-xs font-semibold">{t(`cc.bal.${b.state}`)}</span>
              </div>
              <p className="font-display text-2xl font-semibold">{rupees(b.remaining_inr)} <span className="text-sm font-normal text-ink/70">{t('cc.remaining')}</span></p>
              <p className="text-ink/70">{t('cc.totalUsed', { total: rupees(b.amount_inr), used: rupees(b.used_inr) })}</p>
              <p className="text-ink/70">{b.sponsor_business_name ? t('cc.onlyAt', { shop: b.sponsor_business_name }) : t('cp.anyShop')} · {t('cp.expires', { d: fmtDate(b.expires_at.slice(0, 10), lang) })}</p>
              {b.state === 'active' && <p className="text-xs text-ink/60">{t('cc.useHow')}</p>}
            </li>
          ))}
        </ul>
        {history.length > 0 && (
          <>
            <p className="text-sm font-semibold">{t('cc.history')}</p>
            <ul className="divide-y divide-ink/10 text-sm">
              {history.map((h) => (
                <li key={h.id} className="flex items-center justify-between gap-2 py-2"><span className="min-w-0 flex-1 truncate">{h.business_name} · {fmtDateTime(h.created_at, lang)}</span><span className="font-semibold">−{rupees(h.amount_inr)}</span></li>
              ))}
            </ul>
          </>
        )}
      </Section>
    </div>
  );
}
