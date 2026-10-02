import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Stars } from '../../components/Stars';
import { Msg, Section } from '../../components/ui';
import { useI18n } from '../../i18n';
import { supabase } from '../../lib/supabase';

interface Rep { id: string; reason: string; reviews: { id: string; business_name: string; reviewer_name: string | null; rating: number; comment: string | null; status: string } | null }

export default function AdminReviews() {
  const { t } = useI18n();
  const [rows, setRows] = useState<Rep[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [errKey, setErrKey] = useState('');

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('review_reports')
      .select('id,reason,reviews(id,business_name,reviewer_name,rating,comment,status)').eq('status', 'open').order('created_at').limit(50);
    if (error) { console.error(error); setErrKey('err.generic'); return; }
    setRows((data ?? []) as unknown as Rep[]);
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function resolve(id: string, remove: boolean, reason: string) {
    if (busy) return;
    setBusy(true); setErrKey('');
    const { error } = await supabase.rpc('admin_resolve_report', { p_report_id: id, p_remove: remove, p_reason: reason });
    setBusy(false);
    if (error) { console.error(error); setErrKey('err.generic'); }
    await load();
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-6">
      <Link to="/admin" className="text-sm btn-text">← {t('dash.admin')}</Link>
      <h1 className="font-display text-2xl font-semibold">{t('ad.reviews')}</h1>
      <Msg error={errKey ? t(errKey) : ''} />
      {rows === null && !errKey && <div className="h-24 animate-pulse rounded-2xl bg-ink/10" />}
      {rows?.length === 0 && <p className="text-ink/70">{t('admin.noApps')}</p>}
      {rows?.map((r) => (
        <Section key={r.id} title={r.reviews?.business_name ?? '—'}>
          {r.reviews && <p><Stars value={r.reviews.rating} /> {r.reviews.reviewer_name}</p>}
          {r.reviews?.comment && <p className="text-sm">{r.reviews.comment}</p>}
          <p className="rounded-lg bg-cream p-2 text-sm">{t('rv.report')}: {r.reason}</p>
          <div className="flex flex-wrap gap-2">
            <button className="btn-primary" disabled={busy} onClick={() => void resolve(r.id, true, r.reason)}>{t('ad.remove')}</button>
            <button className="btn-secondary" disabled={busy} onClick={() => void resolve(r.id, false, r.reason)}>{t('ad.dismiss')}</button>
          </div>
        </Section>
      ))}
    </div>
  );
}
