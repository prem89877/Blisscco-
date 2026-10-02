import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Stars } from '../../components/Stars';
import { Msg, Section, TextArea } from '../../components/ui';
import { useI18n } from '../../i18n';
import { fmtDate } from '../../lib/format';
import { supabase } from '../../lib/supabase';
import type { Review } from '../../lib/types';

export default function OwnerReviews() {
  const { id } = useParams();
  const { t, lang } = useI18n();
  const [rows, setRows] = useState<Review[] | null>(null);
  const [reply, setReply] = useState<Record<string, string>>({});
  const [reportFor, setReportFor] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState({ error: '', ok: '' });

  const load = useCallback(async () => {
    if (!id) return;
    const { data, error } = await supabase.from('reviews').select('*').eq('business_id', id).order('created_at', { ascending: false }).limit(50);
    if (error) { console.error(error); setMsg({ error: t('err.generic'), ok: '' }); return; }
    const list = (data ?? []) as Review[];
    setRows(list);
    setReply(Object.fromEntries(list.map((r) => [r.id, r.owner_response ?? ''])));
  }, [id, t]);
  useEffect(() => { void load(); }, [load]);

  async function run(fn: () => PromiseLike<{ error: { message: string } | null }>, ok: string) {
    if (busy) return;
    setBusy(true); setMsg({ error: '', ok: '' });
    const { error } = await fn();
    setBusy(false);
    if (error) { console.error(error); setMsg({ error: t('err.generic'), ok: '' }); return; }
    setMsg({ error: '', ok });
    setReportFor(null); setReason('');
    await load();
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-6">
      <Link to="/owner" className="text-sm btn-text">← {t('owner.title')}</Link>
      <h1 className="font-display text-2xl font-semibold">{t('rv.title')}</h1>
      <Msg error={msg.error} ok={msg.ok} />
      {rows === null && <div className="h-24 animate-pulse rounded-2xl bg-ink/10" />}
      {rows?.length === 0 && <p className="text-ink/70">{t('biz.noReviews')}</p>}
      {rows?.map((r) => (
        <Section key={r.id} title={r.reviewer_name ?? '—'}>
          <p><Stars value={r.rating} /> <span className="text-sm text-ink/60">{fmtDate(r.created_at.slice(0, 10), lang)}</span> {r.status === 'removed' && <span className="text-sm font-semibold text-red-700">· {t('status.rejected')}</span>}</p>
          {r.comment && <p className="text-sm">{r.comment}</p>}
          {r.status === 'published' && (
            <>
              <TextArea id={`re-${r.id}`} label={t('rv.ownerReply')} value={reply[r.id] ?? ''} onChange={(v) => setReply({ ...reply, [r.id]: v })} disabled={busy} />
              <div className="flex flex-wrap gap-2">
                <button className="btn-primary" disabled={busy} onClick={() => void run(() => supabase.rpc('owner_respond_review', { p_review_id: r.id, p_response: reply[r.id] ?? '' }), t('common.saved'))}>{t('rv.reply')}</button>
                <button className="btn-secondary" onClick={() => setReportFor(reportFor === r.id ? null : r.id)}>{t('rv.report')}</button>
              </div>
              {reportFor === r.id && (
                <div className="space-y-2 rounded-xl bg-cream p-3">
                  <TextArea id={`rp-${r.id}`} label={t('rv.reportReason')} value={reason} onChange={setReason} disabled={busy} />
                  <button className="btn-primary w-full" disabled={busy || reason.trim().length < 3} onClick={() => void run(() => supabase.rpc('report_review', { p_review_id: r.id, p_reason: reason }), t('rv.reported'))}>{t('rv.report')}</button>
                </div>
              )}
            </>
          )}
        </Section>
      ))}
    </div>
  );
}
