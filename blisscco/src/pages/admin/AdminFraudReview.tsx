import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Field from '../../components/Field';
import { Msg, Section } from '../../components/ui';
import { useI18n } from '../../i18n';
import { fmtDateTime } from '../../lib/format';
import { supabase } from '../../lib/supabase';

type Risk = 'clear' | 'suspicious' | 'in_review' | 'cleared' | 'rejected' | 'fraudulent';
type Filter = 'needs_review' | 'decided' | 'all';
interface Signal { code: string; weight: number; count?: number }
interface Row {
  id: string; status: 'pending' | 'qualified' | 'rejected' | 'revoked'; created_at: string; qualified_at: string | null;
  referrer_business: string | null; referred_owner_name: string | null; business_name: string | null; business_phone: string | null;
  reject_reason: string | null; risk_status: Risk; risk_score: number; risk_signals: Signal[]; risk_decided_at: string | null;
  risk_decision_note: string | null; risk_decided_by_name: string | null; referrer_fraud_count: number;
}
interface Hist {
  id: string; action: string; from_risk: string | null; to_risk: string | null; note: string | null; actor_name: string | null;
  created_at: string; details: Record<string, unknown>;
}
type Action = 'start_review' | 'approve' | 'reject' | 'fraud' | 'reopen';

const KNOWN_ERRORS = ['competition_closed', 'invalid_state', 'reason_required', 'invalid_action', 'not_found'];
const BADGE: Record<Risk, string> = {
  clear: 'bg-ink/10 text-ink', suspicious: 'bg-amber-100 text-amber-900', in_review: 'bg-blue-100 text-blue-900',
  cleared: 'bg-green-100 text-green-900', rejected: 'bg-red-100 text-red-900', fraudulent: 'bg-red-200 text-red-950',
};

export default function AdminFraudReview() {
  const { t, lang } = useI18n();
  const [filter, setFilter] = useState<Filter>('needs_review');
  const [rows, setRows] = useState<Row[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [history, setHistory] = useState<Record<string, Hist[] | undefined>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState({ error: '', ok: '' });

  const load = useCallback(async (f: Filter) => {
    const { data, error } = await supabase.rpc('admin_shop_referral_overview', { p_limit: 100, p_filter: f });
    if (error) { console.error(error); setMsg({ error: t('err.generic'), ok: '' }); }
    setRows((data ?? []) as Row[]);
    setLoaded(true);
  }, [t]);
  useEffect(() => { void load(filter); }, [filter, load]);

  async function loadHistory(id: string) {
    const { data, error } = await supabase.rpc('admin_shop_referral_history', { p_referral_id: id });
    if (error) { console.error(error); return; }
    setHistory((h) => ({ ...h, [id]: (data ?? []) as Hist[] }));
  }

  async function run(id: string, fn: () => PromiseLike<{ error: { message: string } | null }>) {
    if (busy) return;
    setBusy(true); setMsg({ error: '', ok: '' });
    const { error } = await fn();
    setBusy(false);
    if (error) {
      console.error(error);
      const k = KNOWN_ERRORS.find((e) => error.message.includes(e));
      setMsg({ error: t(k ? `sa.err.${k}` : 'err.generic'), ok: '' });
    } else {
      setMsg({ error: '', ok: t('admin.done') });
      setNotes((n) => ({ ...n, [id]: '' }));
    }
    await load(filter);
    if (history[id]) await loadHistory(id);
  }

  function decide(r: Row, action: Action) {
    if (action === 'reject' && !window.confirm(t('fr.confirm.reject'))) return;
    if (action === 'fraud' && !window.confirm(t('fr.confirm.fraud'))) return;
    void run(r.id, () => supabase.rpc('admin_review_shop_referral', { p_id: r.id, p_action: action, p_note: notes[r.id] ?? '' }));
  }
  const recheck = (r: Row) => void run(r.id, () => supabase.rpc('admin_recheck_shop_referral_risk', { p_id: r.id }));

  const actionsFor = (r: Row): Action[] => {
    if (r.status === 'qualified') {
      if (r.risk_status === 'suspicious') return ['start_review', 'approve', 'reject', 'fraud'];
      if (r.risk_status === 'in_review') return ['approve', 'reject', 'fraud'];
      return ['reject', 'fraud'];   // clear or already approved: admin can still remove it
    }
    if (r.status === 'revoked' && (r.risk_status === 'rejected' || r.risk_status === 'fraudulent')) return ['reopen'];
    return [];
  };
  const needsNote = (a: Action) => a !== 'start_review';
  const tabCls = (f: Filter) => (filter === f ? 'btn-solid' : 'btn-secondary');

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-6">
      <Link to="/admin/competition" className="text-sm btn-text">← {t('sa.title')}</Link>
      <h1 className="font-display text-2xl font-semibold">{t('fr.title')}</h1>
      <p className="text-sm text-ink/70">{t('fr.help')}</p>
      <Msg error={msg.error} ok={msg.ok} />

      <div className="flex flex-wrap gap-2">
        <button className={tabCls('needs_review')} onClick={() => setFilter('needs_review')}>{t('fr.tab.needs')}</button>
        <button className={tabCls('decided')} onClick={() => setFilter('decided')}>{t('fr.tab.decided')}</button>
        <button className={tabCls('all')} onClick={() => setFilter('all')}>{t('fr.tab.all')}</button>
      </div>

      <Section title={t(filter === 'needs_review' ? 'fr.tab.needs' : filter === 'decided' ? 'fr.tab.decided' : 'fr.tab.all')}>
        {!loaded && <div className="h-16 animate-pulse rounded-2xl bg-ink/10" />}
        {loaded && rows.length === 0 && <p className="text-sm text-ink/70">{t('fr.none')}</p>}
        <ul className="space-y-3">
          {rows.map((r) => {
            const acts = actionsFor(r);
            const note = notes[r.id] ?? '';
            const h = history[r.id];
            return (
              <li key={r.id} className="space-y-2 rounded-xl border border-ink/10 p-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{r.business_name ?? t('sa.noBusiness')}</span>
                  <span className={`rounded-full px-3 py-1 text-xs font-semibold ${BADGE[r.risk_status]}`}>{t(`fr.risk.${r.risk_status}`)}</span>
                </div>
                <p className="text-xs text-ink/70">
                  {t('sa.owner')}: {r.referred_owner_name ?? '—'} · {t('sa.referredBy', { name: r.referrer_business ?? '—' })} · {fmtDateTime(r.created_at, lang)}
                </p>
                {r.business_phone && <p className="text-xs">{r.business_phone}</p>}
                {r.referrer_fraud_count > 0 && <p className="text-xs font-medium text-red-700">{t('fr.refFlagged', { n: r.referrer_fraud_count })}</p>}

                {r.risk_signals.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-xs font-semibold">{t('fr.signals')} · {t('fr.score', { n: r.risk_score })}</p>
                    <ul className="list-disc space-y-0.5 pl-5 text-xs text-ink/80">
                      {r.risk_signals.map((s, i) => <li key={`${s.code}-${i}`}>{t(`fr.sig.${s.code}`)}{s.count && s.count > 1 ? ` (×${s.count})` : ''}</li>)}
                    </ul>
                  </div>
                )}
                {r.risk_decided_at && (r.risk_status === 'cleared' || r.risk_status === 'rejected' || r.risk_status === 'fraudulent') && (
                  <p className="text-xs text-ink/70">{t('fr.decidedBy', { name: r.risk_decided_by_name ?? '—', date: fmtDateTime(r.risk_decided_at, lang) })}{r.risk_decision_note ? ` — ${r.risk_decision_note}` : ''}</p>
                )}
                {r.reject_reason && <p className="text-xs text-red-700">{t(`sc.reason.${r.reject_reason}`)}</p>}

                {acts.length > 0 && (
                  <>
                    {acts.some(needsNote) && <Field id={`n-${r.id}`} label={t('fr.note')} value={note} onChange={(v) => setNotes((n) => ({ ...n, [r.id]: v }))} disabled={busy} />}
                    <div className="flex flex-wrap gap-2">
                      {acts.map((a) => (
                        <button key={a} className={a === 'approve' ? 'btn-solid' : 'btn-secondary'} disabled={busy || (needsNote(a) && note.trim().length < 3)} onClick={() => decide(r, a)}>{t(`fr.act.${a}`)}</button>
                      ))}
                    </div>
                  </>
                )}
                <div className="flex flex-wrap gap-2">
                  {r.status === 'qualified' && (r.risk_status === 'clear' || r.risk_status === 'suspicious') && (
                    <button className="btn-secondary" disabled={busy} onClick={() => recheck(r)}>{t('fr.act.recheck')}</button>
                  )}
                  <button className="btn-secondary" onClick={() => (h ? setHistory((x) => ({ ...x, [r.id]: undefined })) : void loadHistory(r.id))}>{h ? t('fr.hideHistory') : t('fr.history')}</button>
                </div>

                {h && (
                  <ol className="space-y-1.5 border-t border-ink/10 pt-2 text-xs">
                    {h.length === 0 && <li className="text-ink/60">{t('fr.noHistory')}</li>}
                    {h.map((e) => (
                      <li key={e.id}>
                        <span className="font-semibold">{t(`fr.hist.${e.action}`)}</span>
                        {e.from_risk && e.to_risk && e.from_risk !== e.to_risk ? ` (${t(`fr.risk.${e.from_risk}`)} → ${t(`fr.risk.${e.to_risk}`)})` : ''}
                        {' · '}{e.actor_name ?? t('fr.system')} · {fmtDateTime(e.created_at, lang)}
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
