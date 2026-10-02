import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Msg, StatusBadge } from '../../components/ui';
import { useI18n } from '../../i18n';
import { supabase } from '../../lib/supabase';
import type { Status } from '../../lib/types';

interface Row { id: string; name: string; status: Status; rejection_reason: string | null; city: string | null }

const ICONS: Record<string, string> = {
  manage: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z',
  queue: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  reviews: 'm12 3 2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.8 6.2 20.9l1.1-6.5L2.6 9.8l6.5-.9Z',
  coupons: 'M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8ZM7.5 7.5h.01',
  plans: 'M3 7h18v10H3ZM3 11h18M7 15h3',
  banners: 'M3 5h18v14H3ZM3 15l5-5 4 4 3-3 6 6M9 9.5h.01',
  verify: 'M12 3 4 6v6c0 5 3.4 8 8 9 4.6-1 8-4 8-9V6ZM9 12l2 2 4-4',
  analytics: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  qr: 'M3 3h7v7H3ZM14 3h7v7h-7ZM3 14h7v7H3ZM14 14h3v3h-3ZM20 14v.01M14 20h.01M20 20h1',
  view: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12ZM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z',
  hide: 'M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6A17 17 0 0 0 2 12s3.6 7 10 7a9.7 9.7 0 0 0 4.4-1',
  show: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12ZM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z',
};

function Icon({ name }: { name: string }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={ICONS[name]} />
    </svg>
  );
}

const TILE = 'flex min-h-[84px] flex-col items-center justify-center gap-1.5 rounded-2xl border border-ink/10 bg-cream px-1.5 py-3 text-center text-xs font-medium leading-tight transition hover:bg-blush/20 disabled:cursor-not-allowed disabled:opacity-60';
const ICON_WRAP = 'flex h-9 w-9 items-center justify-center rounded-full bg-blush/30';

function TileLink({ to, icon, label }: { to: string; icon: string; label: ReactNode }) {
  return <Link to={to} className={TILE}><span className={ICON_WRAP}><Icon name={icon} /></span><span>{label}</span></Link>;
}

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
          {r.status === 'approved' || r.status === 'inactive' ? (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              <TileLink to={`/owner/business/${r.id}`} icon="manage" label={t('owner.manage')} />
              <TileLink to={`/owner/business/${r.id}/queue`} icon="queue" label={t('oq.title')} />
              <TileLink to={`/owner/business/${r.id}/reviews`} icon="reviews" label={t('rv.title')} />
              <TileLink to={`/owner/business/${r.id}/coupons`} icon="coupons" label={t('oc.title')} />
              <TileLink to={`/owner/business/${r.id}/plans`} icon="plans" label={t('p8.plansTitle')} />
              <TileLink to={`/owner/business/${r.id}/banners`} icon="banners" label={t('p8.bannersTitle')} />
              <TileLink to={`/owner/business/${r.id}/verify`} icon="verify" label={t('p8.verifyTitle')} />
              <TileLink to={`/owner/business/${r.id}/analytics`} icon="analytics" label={t('p9.title')} />
              {r.status === 'approved' && <TileLink to={`/owner/business/${r.id}/qr`} icon="qr" label={t('p9.qrTitle')} />}
              {r.status === 'approved' && <TileLink to={`/b/${r.id}`} icon="view" label={t('owner.viewPublic')} />}
              <button className={TILE} disabled={busyId === r.id} onClick={() => void toggle(r)}>
                <span className={ICON_WRAP}><Icon name={r.status === 'approved' ? 'hide' : 'show'} /></span>
                <span>{r.status === 'approved' ? t('owner.hide') : t('owner.show')}</span>
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Link to={`/owner/business/${r.id}`} className="btn-secondary">{r.status === 'draft' || r.status === 'rejected' ? t('owner.editApp') : t('owner.manage')}</Link>
            </div>
          )}
        </article>
      ))}
    </section>
  );
}
