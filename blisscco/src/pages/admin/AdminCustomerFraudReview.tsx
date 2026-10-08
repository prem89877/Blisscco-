import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Field from '../../components/Field';
import { Msg, Section, Select } from '../../components/ui';
import { useI18n } from '../../i18n';
import { ccActionsFor, type CcAction, type CcAdminReferral, type CcEligibility, type CcHistoryRow, type CcReviewStatus, type CcStatus } from '../../lib/customerCompetition';
import { fmtDateTime, rupees } from '../../lib/format';
import { supabase } from '../../lib/supabase';

type Filter = 'needs_review' | 'counted' | 'not_counted' | 'waiting' | 'all';
interface CompLite { id: string; title: string; status: CcStatus }

const KNOWN_ERRORS = ['competition_closed', 'invalid_state', 'reason_required', 'invalid_action', 'not_found', 'cannot_restore', 'account_not_eligible',
  'no_qualifying_activity', 'duplicate_identity'];
const RISK_BADGE: Record<CcReviewStatus, string> = {
  clear: 'bg-ink/10 text-ink', suspicious: 'bg-amber-100 text-amber-900', in_review: 'bg-blue-100 text-blue-900',
  approved: 'bg-green-100 text-green-900', rejected: 'bg-red-100 text-red-900', fraudulent: 'bg-red-200 text-red-950',
};
const ELIG_BADGE: Record<CcEligibility, string> = {
  counted: 'bg-green-100 text-green-900', on_hold: 'bg-amber-100 text-amber-900', rejected: 'bg-red-100 text-red-900', fraudulent: 'bg-red-200 text-red-950',
  booking_invalid: 'bg-red-100 text-red-900', account_invalid: 'bg-red-100 text-red-900', waiting: 'bg-ink/10 text-ink',
};

export default function AdminCustomerFraudReview() {
  const { t, lang } = useI18n();
  const [comps, setComps] = useState<CompLite[]>([]);
  const [compId, setCompId] = useState('');
  const [filter, setFilter] = useState<Filter>('needs_review');
  const [rows, setRows] = useState<CcAdminReferral[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [history, setHistory] = useState<Record<string, CcHistoryRow[] | undefined>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState({ error: '', ok: '' });

  // the competitions (newest first): pick the live one, else the latest
  useEffect(() => {
    void (async () => {
      const { data, error } = await supabase.rpc('admin_list_customer_competitions');
      if (error) { console.error(error); setMsg({ error: t('err.generic'), ok: '' }); setLoaded(true); return; }
      const list = ((data ?? []) as CompLite[]).filter((c) => c.status !== 'draft');
      setComps(list);
      const pick = list.find((c) => c.status === 'active' || c.status === 'paused' || c.status === 'pending_verification') ?? list[0];
      setCompId(pick?.id ?? '');
      if (!pick) setLoaded(true);
    })();
  }, [t]);

  const load = useCallback(async (id: string, f: Filter) => {
    if (!id) return;
    const { data, error } = await supabase.rpc('admin_customer_referral_overview', { p_competition_id: id, p_filter: f, p_limit: 150 });
    if (error) { console.error(error); setMsg({ error: t('err.generic'), ok: '' }); }
    setRows((data ?? []) as CcAdminReferral[]);
    setLoaded(true);
  }, [t]);
  useEffect(() => { setLoaded(false); void load(compId, filter); }, [compId, filter, load]);

  async function loadHistory(id: string) {
    const { data, error } = await supabase.rpc('admin_customer_referral_history', { p_id: id });
    if (error) { console.error(error); return; }
    setHistory((h) => ({ ...h, [id]: (data ?? []) as CcHistoryRow[] }));
  }

  async function run(id: string, fn: () => PromiseLike<{ error: { message: string } | null }>) {
    if (busy) return;
    setBusy(true); setMsg({ error: '', ok: '' });
    const { error } = await fn();
    setBusy(false);
    if (error) {
      console.error(error);
      const k = KNOWN_ERRORS.find((e) => error.message.includes(e));
      setMsg({ error: t(k ? `cf.err.${k}` : 'err.generic'), ok: '' });
    } else {
      setMsg({ error: '', ok: t('admin.done') });
      setNotes((n) => ({ ...n, [id]: '' }));
    }
    await load(compId, filter);
    if (history[id]) await loadHistory(id);
  }

  function decide(r: CcAdminReferral, action: CcAction) {
    if (!r.id) return;
    if (action === 'reject' && !window.confirm(t('cf.confirm.reject'))) return;
    if (action === 'fraud' && !window.confirm(t('cf.confirm.fraud'))) return;
    if (action === 'restore' && !window.confirm(t('cf.confirm.restore'))) return;
    void run(r.id, () => supabase.rpc('admin_review_customer_referral', { p_id: r.id, p_action: action, p_note: notes[r.id] ?? '' }));
  }
  const recheck = (r: CcAdminReferral) => { if (r.id) void run(r.id, () => supabase.rpc('admin_recheck_customer_referral_risk', { p_id: r.id })); };

  const comp = comps.find((c) => c.id === compId) ?? null;
  const closed = comp?.status === 'ended';
  const needsNote = (a: CcAction) => a !== 'start_review';
  const tabCls = (f: Filter) => (filter === f ? 'btn-solid' : 'btn-secondary');
  const tabs: Filter[] = ['needs_review', 'counted', 'not_counted', 'waiting', 'all'];

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-6">
      <Link to="/admin/customer-competition" className="text-sm btn-text">← {t('cc.adminTitle')}</Link>
      <h1 className="font-display text-2xl font-semibold">{t('cf.title')}</h1>
      <p className="text-sm text-ink/70">{t('cf.help')}</p>
      <Msg error={msg.error} ok={msg.ok} />

      {comps.length > 1 && (
        <Select id="cfc" label={t('cf.competition')} value={compId} onChange={setCompId}
          options={comps.map((c) => ({ value: c.id, label: c.title }))} />
      )}
      {closed && <p role="status" className="rounded-xl bg-ink/5 p-3 text-sm">{t('cf.closedNote')}</p>}

      <div className="flex flex-wrap gap-2">
        {tabs.map((f) => <button key={f} className={tabCls(f)} onClick={() => setFilter(f)}>{t(`cf.tab.${f}`)}</button>)}
      </div>

      <Section title={t(`cf.tab.${filter}`)}>
        {!loaded && <div className="h-16 animate-pulse rounded-2xl bg-ink/10" />}
        {loaded && rows.length === 0 && <p className="text-sm text-ink/70">{t('cf.none')}</p>}
        <ul className="space-y-3">
          {rows.map((r) => {
            const key = r.id ?? r.referral_id;
            const acts = closed || !r.id ? [] : ccActionsFor(r);
            const note = notes[key] ?? '';
            const h = r.id ? history[r.id] : undefined;
            return (
              <li key={key} className="space-y-2 rounded-xl border border-ink/10 p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{r.referred_name}</span>
                  <span className={`rounded-full px-3 py-1 text-xs font-semibold ${ELIG_BADGE[r.eligibility]}`}>{t(`cf.elig.${r.eligibility}`)}</span>
                </div>
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
                  <dt className="text-ink/60">{t('cf.referrer')}</dt><dd>{r.referrer_name}</dd>
                  <dt className="text-ink/60">{t('cf.referred')}</dt><dd>{r.referred_name}</dd>
                  <dt className="text-ink/60">{t('cf.date')}</dt><dd>{fmtDateTime(r.referral_date, lang)}</dd>
                  {r.review_status && (
                    <>
                      <dt className="text-ink/60">{t('cf.risk')}</dt>
                      <dd><span className={`rounded-full px-2.5 py-0.5 font-semibold ${RISK_BADGE[r.review_status]}`}>{t(`cf.risk.${r.review_status}`)}</span>{r.risk_score > 0 ? ` · ${t('cf.score', { n: r.risk_score })}` : ''}</dd>
                    </>
                  )}
                  <dt className="text-ink/60">{t('cf.booking')}</dt>
                  <dd>
                    {r.booking_id
                      ? `${r.business_name ?? '—'} · ${r.booking_price != null ? rupees(r.booking_price) : '—'} · ${r.booking_status ? t(`cf.bk.${r.booking_status}`) : ''}${r.booking_date ? ` · ${fmtDateTime(r.booking_date, lang)}` : ''}`
                      : t('cf.noBooking')}
                  </dd>
                </dl>
                {r.referrer_fraud_count > 0 && <p className="text-xs font-medium text-red-700">{t('cf.refFlagged', { n: r.referrer_fraud_count })}</p>}

                {r.risk_signals.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-xs font-semibold">{t('cf.signals')}</p>
                    <ul className="list-disc space-y-0.5 pl-5 text-xs text-ink/80">
                      {r.risk_signals.map((s, i) => <li key={`${s.code}-${i}`}>{t(`cf.sig.${s.code}`)}{s.count && s.count > 1 ? ` (×${s.count})` : ''}</li>)}
                    </ul>
                  </div>
                )}
                {r.reject_reason && <p className="text-xs text-red-700">{t(`cc.reason.${r.reject_reason}`)}</p>}
                {r.reviewed_at && r.review_status && ['approved', 'rejected', 'fraudulent', 'in_review'].includes(r.review_status) && (
                  <p className="text-xs text-ink/70">{t('cf.decidedBy', { name: r.reviewed_by_name ?? '—', date: fmtDateTime(r.reviewed_at, lang) })}{r.review_note ? ` — ${r.review_note}` : ''}</p>
                )}

                {acts.length > 0 && (
                  <>
                    {acts.some(needsNote) && <Field id={`n-${key}`} label={t('cf.note')} value={note} onChange={(v) => setNotes((n) => ({ ...n, [key]: v }))} disabled={busy} />}
                    <div className="flex flex-wrap gap-2">
                      {acts.map((a) => (
                        <button key={a} className={a === 'approve' || a === 'restore' ? 'btn-solid' : 'btn-secondary'}
                          disabled={busy || (needsNote(a) && note.trim().length < 3)} onClick={() => decide(r, a)}>{t(`cf.act.${a}`)}</button>
                      ))}
                    </div>
                  </>
                )}
                {r.id && (
                  <div className="flex flex-wrap gap-2">
                    {!closed && r.status === 'qualified' && (r.review_status === 'clear' || r.review_status === 'suspicious') && (
                      <button className="btn-secondary" disabled={busy} onClick={() => recheck(r)}>{t('cf.act.recheck')}</button>
                    )}
                    <button className="btn-secondary" onClick={() => (h ? setHistory((x) => ({ ...x, [r.id as string]: undefined })) : void loadHistory(r.id as string))}>{h ? t('cf.hideHistory') : t('cf.history')}</button>
                  </div>
                )}

                {h && (
                  <ol className="space-y-1.5 border-t border-ink/10 pt-2 text-xs">
                    {h.length === 0 && <li className="text-ink/60">{t('cf.noHistory')}</li>}
                    {h.map((e) => (
                      <li key={e.id}>
                        <span className="font-semibold">{t(`cf.audit.${e.action}`)}</span>
                        {e.from_state && e.to_state && e.from_state !== e.to_state ? ` (${t(`cf.risk.${e.from_state}`)} → ${t(`cf.risk.${e.to_state}`)})` : ''}
                        {' · '}{e.actor_name ?? t('cf.system')} · {fmtDateTime(e.created_at, lang)}
                        {e.note ? <span className="block text-ink/70">{e.note}</span> : null}
                      </li>
                    ))}
                  </ol>
                )}
              </li>
            );
          })}
        </ul>
      </Section>
    </div>
  );
}
