import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Msg, Section } from '../../components/ui';
import { useI18n } from '../../i18n';
import type { AnalyticsData, Counts } from '../../lib/analytics';
import { addDays, fmtDate, istToday } from '../../lib/format';
import { supabase } from '../../lib/supabase';

const RANGES = [7, 30, 90] as const;
const DB_ERR = ['not_owner', 'invalid_range'];
const AI_ERR = ['unauthorized', 'bad_request', 'configuration_required', 'not_owner', 'rate_limited', 'ai_unavailable', 'invalid_range', 'server_config', 'server_error'];
const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 1000) / 10}%` : '–');
const SRC_COLOR: Record<string, string> = { qr: 'bg-blush', search: 'bg-ink', referral: 'bg-amber-400', direct: 'bg-ink/30' };

function Stat({ label, value, sub }: { label: string; value: number | string; sub?: string }) {
  return (
    <div className="rounded-xl bg-cream p-3">
      <p className="text-xs text-ink/70">{label}</p>
      <p className="font-display text-2xl font-semibold">{value}</p>
      {sub && <p className="text-xs text-ink/60">{sub}</p>}
    </div>
  );
}

export default function OwnerAnalytics() {
  const { id } = useParams();
  const { t, lang } = useI18n();
  const [days, setDays] = useState<(typeof RANGES)[number]>(30);
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [error, setError] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [ai, setAi] = useState({ text: '', error: '' });

  const range = useCallback(() => { const to = istToday(); return { from: addDays(to, -(days - 1)), to }; }, [days]);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    setError(''); setAi({ text: '', error: '' });
    const { from, to } = range();
    void supabase.rpc('get_analytics', { p_business_id: id, p_from: from, p_to: to }).then(({ data: d, error: e }) => {
      if (!alive) return;
      if (e) {
        console.error(e); setError(t(DB_ERR.includes(e.message) ? `p9.err.${e.message}` : 'err.generic')); return;
      }
      setData(d as AnalyticsData);
    });
    return () => { alive = false; };
  }, [id, range, t]);

  async function askAi() {
    if (!id || aiBusy) return;
    setAiBusy(true); setAi({ text: '', error: '' });
    try {
      const { data: s } = await supabase.auth.getSession();
      const token = s.session?.access_token;
      if (!token) { setAi({ text: '', error: t('p9.err.unauthorized') }); return; }
      const { from, to } = range();
      const r = await fetch('/api/ai-insights', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ business_id: id, from, to, lang }),
      });
      const j = (await r.json().catch(() => ({}))) as { insights?: string; error?: string };
      if (r.ok && j.insights) setAi({ text: j.insights, error: '' });
      else setAi({ text: '', error: t(j.error && AI_ERR.includes(j.error) ? `p9.err.${j.error}` : 'err.generic') });
    } catch { setAi({ text: '', error: t('err.generic') }); }
    finally { setAiBusy(false); }
  }

  const tot: Counts | undefined = data?.totals;
  const maxDay = Math.max(1, ...(data?.daily.map((d) => d.profile_view) ?? [1]));
  const srcTotal = Math.max(1, ...(data?.by_source.map((s) => s.profile_view) ?? [1]));
  const empty = !!tot && tot.profile_view + tot.search_impression + tot.booking === 0;

  return (
    <section className="mx-auto max-w-2xl space-y-4 px-4 py-6">
      <Link to="/owner" className="text-sm btn-text">{t('p9.back')}</Link>
      <h1 className="font-display text-2xl font-semibold">{t('p9.title')}</h1>
      <div className="flex gap-2" role="group" aria-label={t('p9.range')}>
        {RANGES.map((n) => (
          <button key={n} aria-pressed={days === n} onClick={() => setDays(n)} className={days === n ? 'btn-primary' : 'btn-text-muted'}>{t('p9.lastDays', { n })}</button>
        ))}
      </div>
      <Msg error={error} />
      {!data && !error && <div className="h-40 animate-pulse rounded-2xl bg-ink/10" />}

      {data && tot && (
        <>
          <Section title={t('p9.summary')}>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Stat label={t('p9.impressions')} value={tot.search_impression} />
              <Stat label={t('p9.views')} value={tot.profile_view} sub={t('p9.ofImpressions', { p: pct(tot.profile_view, tot.search_impression) })} />
              <Stat label={t('p9.bookings')} value={tot.booking} sub={t('p9.ofViews', { p: pct(tot.booking, tot.profile_view) })} />
            </div>
            {empty && <p className="text-sm text-ink/70">{t('p9.empty')}</p>}
          </Section>

          <Section title={t('p9.bySource')}>
            <ul className="space-y-3">
              {data.by_source.map((s) => (
                <li key={s.source}>
                  <div className="flex justify-between text-sm"><span>{t(`p9.src.${s.source}`)}</span><span>{t('p9.srcLine', { v: s.profile_view, b: s.booking })}</span></div>
                  <div className="mt-1 h-2.5 rounded-full bg-ink/10"><div className={`h-2.5 rounded-full ${SRC_COLOR[s.source]}`} style={{ width: `${(s.profile_view / srcTotal) * 100}%` }} /></div>
                </li>
              ))}
            </ul>
            <p className="text-xs text-ink/60">{t('p9.srcHint')}</p>
          </Section>

          <Section title={t('p9.daily')}>
            <div className="flex h-28 items-end gap-px" role="img" aria-label={t('p9.dailyAlt')}>
              {data.daily.map((d) => (
                <div key={d.day} title={`${fmtDate(d.day, lang)}: ${d.profile_view}`} className="min-w-[2px] flex-1 rounded-t bg-blush" style={{ height: `${Math.max(2, (d.profile_view / maxDay) * 100)}%` }} />
              ))}
            </div>
            <div className="flex justify-between text-xs text-ink/60"><span>{fmtDate(data.from, lang)}</span><span>{fmtDate(data.to, lang)}</span></div>
          </Section>

          <Section title={t('p9.aiTitle')}>
            <p className="text-sm text-ink/70">{t('p9.aiHint')}</p>
            <button className="btn-primary" disabled={aiBusy} onClick={() => void askAi()}>{aiBusy ? t('p9.aiWorking') : t('p9.aiButton')}</button>
            <Msg error={ai.error} />
            {ai.text && <p className="whitespace-pre-wrap rounded-xl bg-cream p-4 text-sm" role="status">{ai.text}</p>}
          </Section>
        </>
      )}
    </section>
  );
}
