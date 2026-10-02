import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Msg, StatusBadge } from '../../components/ui';
import { useI18n } from '../../i18n';
import { supabase } from '../../lib/supabase';
import type { Status } from '../../lib/types';

interface Row { id: string; name: string; status: Status; rejection_reason: string | null; city: string | null }

export default function OwnerDashboard() {
  const { t } = useI18n();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error: e } = await supabase.from('businesses').select('id,name,status,rejection_reason,city').order('created_at', { ascending: false });
    if (e) { console.error(e); setError(t('err.generic')); return; }
    setRows((data ?? []) as Row[]);
  }, [t]);
  useEffect(() => { void load(); }, [load]);

  async function toggle(r: Row) {
    if (busyId) return;
    setBusyId(r.id); setError('');
    const { error: e } = await supabase.rpc('owner_set_business_active', { p_business_id: r.id, p_active: r.status === 'inactive' });
    setBusyId(null);
    if (e) setError(t('err.generic'));
    await load();
  }

  return (
    <section className="mx-auto max-w-3xl space-y-4 px-4 py-6">
      <div className="flex items-center justify-between gap-2">
        <h1 className="font-display text-2xl font-semibold">{t('owner.title')}</h1>
        <Link to="/owner/business/new" className="btn-primary">{t('owner.add')}</Link>
      </div>
      <Msg error={error} />
      {rows === null && !error && <div className="h-24 animate-pulse rounded-2xl bg-ink/10" />}
      {rows?.length === 0 && <p className="text-ink/70">{t('owner.empty')}</p>}
      {rows?.map((r) => (
        <article key={r.id} className="card space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div><h2 className="font-semibold">{r.name}</h2>{r.city && <p className="text-sm text-ink/70">{r.city}</p>}</div>
            <StatusBadge status={r.status} />
          </div>
          {r.status === 'pending_review' && <p className="text-sm">{t('owner.pendingNote')}</p>}
          {(r.status === 'rejected' || r.status === 'suspended') && r.rejection_reason && (
            <p className="rounded-xl bg-red-50 p-3 text-sm"><strong>{t('owner.reason')}:</strong> {r.rejection_reason}</p>
          )}
          <div className="flex flex-wrap gap-2">
            <Link to={`/owner/business/${r.id}`} className="btn-secondary">{r.status === 'draft' || r.status === 'rejected' ? t('owner.editApp') : t('owner.manage')}</Link>
            {(r.status === 'approved' || r.status === 'inactive') && (
              <>
                <Link to={`/owner/business/${r.id}/queue`} className="btn-primary">{t('oq.title')}</Link>
                <Link to={`/owner/business/${r.id}/reviews`} className="btn-secondary">{t('rv.title')}</Link>
                <Link to={`/owner/business/${r.id}/coupons`} className="btn-secondary">{t('oc.title')}</Link>
                <Link to={`/owner/business/${r.id}/plans`} className="btn-secondary">{t('p8.plansTitle')}</Link>
                <Link to={`/owner/business/${r.id}/banners`} className="btn-secondary">{t('p8.bannersTitle')}</Link>
                <Link to={`/owner/business/${r.id}/verify`} className="btn-secondary">{t('p8.verifyTitle')}</Link>
                <Link to={`/owner/business/${r.id}/analytics`} className="btn-secondary">{t('p9.title')}</Link>
                {r.status === 'approved' && <Link to={`/owner/business/${r.id}/qr`} className="btn-secondary">{t('p9.qrTitle')}</Link>}
                {r.status === 'approved' && <Link to={`/b/${r.id}`} className="btn-secondary">{t('owner.viewPublic')}</Link>}
                <button className="btn-secondary" disabled={busyId === r.id} onClick={() => void toggle(r)}>{r.status === 'approved' ? t('owner.hide') : t('owner.show')}</button>
              </>
            )}
          </div>
        </article>
      ))}
    </section>
  );
}
