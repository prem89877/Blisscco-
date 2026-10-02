import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Msg, Section, Select, StatusBadge, TextArea } from '../../components/ui';
import { useI18n } from '../../i18n';
import { hhmm, mapsPointUrl, rupees } from '../../lib/format';
import { signedUrlMap } from '../../lib/storage';
import { supabase } from '../../lib/supabase';
import type { BizImage, Business, Hour, Service, Status } from '../../lib/types';

const FILTERS: (Status | 'all')[] = ['pending_review', 'approved', 'rejected', 'suspended', 'inactive', 'draft', 'all'];

function Detail({ b, onDone }: { b: Business; onDone: () => Promise<void> }) {
  const { t } = useI18n();
  const [images, setImages] = useState<BizImage[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [hours, setHours] = useState<Hour[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [owner, setOwner] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    void (async () => {
      const [i, h, s, o] = await Promise.all([
        supabase.from('business_images').select('*').eq('business_id', b.id).order('sort_order'),
        supabase.from('business_hours').select('*').eq('business_id', b.id).order('day_of_week'),
        supabase.from('services').select('*').eq('business_id', b.id),
        supabase.from('profiles').select('full_name').eq('id', b.owner_id).maybeSingle(),
      ]);
      if (!alive) return;
      const imgs = (i.data ?? []) as BizImage[];
      setImages(imgs); setHours((h.data ?? []) as Hour[]); setServices((s.data ?? []) as Service[]);
      setOwner((o.data as { full_name: string | null } | null)?.full_name ?? '');
      const m = await signedUrlMap(imgs.map((x) => x.storage_path));
      if (alive) setUrls(m);
    })();
    return () => { alive = false; };
  }, [b.id, b.owner_id]);

  async function act(kind: 'approve' | 'reject' | 'suspend' | 'reactivate') {
    if (busy) return;
    setError('');
    if ((kind === 'reject' || kind === 'suspend') && !reason.trim()) return setError(t('admin.reasonRequired'));
    setBusy(true);
    const res = kind === 'approve' || kind === 'reject'
      ? await supabase.rpc('admin_review_business', { p_business_id: b.id, p_approve: kind === 'approve', p_reason: reason.trim() || null })
      : await supabase.rpc('admin_set_business_status', { p_business_id: b.id, p_target: kind === 'suspend' ? 'suspended' : 'approved', p_reason: reason.trim() || null });
    setBusy(false);
    if (res.error) { console.error(res.error); setError(res.error.message || t('err.generic')); return; }
    await onDone();
  }

  return (
    <div className="space-y-3 border-t border-ink/10 pt-3 text-sm">
      <p><strong>{t('admin.ownerName')}:</strong> {owner || '—'}</p>
      <p>{b.description}</p>
      <p>{b.address_line}, {b.city}, {b.state} {b.pincode}</p>
      <p>{b.phone} · {b.email}</p>
      {b.latitude !== null && b.longitude !== null && (
        <a className="btn-secondary" href={mapsPointUrl(b.latitude, b.longitude)} target="_blank" rel="noopener noreferrer">{t('admin.openMaps')}</a>
      )}
      <div className="grid grid-cols-3 gap-2">
        {images.map((im) => urls[im.storage_path]
          ? <img key={im.id} src={urls[im.storage_path]} alt="" loading="lazy" className="aspect-square w-full rounded-lg object-cover" />
          : <div key={im.id} className="aspect-square animate-pulse rounded-lg bg-ink/10" />)}
      </div>
      <ul>{hours.map((h) => <li key={h.day_of_week}>{t(`day.${h.day_of_week}`)}: {h.is_closed ? t('ed.closed') : `${hhmm(h.opens_at)} – ${hhmm(h.closes_at)}`}</li>)}</ul>
      <ul>{services.map((s) => <li key={s.id}>{s.name || s.service_category} — {rupees(s.price_inr)}</li>)}</ul>

      {(b.status === 'pending_review' || b.status === 'approved') && (
        <TextArea id={`r-${b.id}`} label={t('admin.reason')} value={reason} onChange={setReason} disabled={busy} />
      )}
      <Msg error={error} />
      <div className="flex flex-wrap gap-2">
        {b.status === 'pending_review' && (
          <>
            <button className="btn-primary" disabled={busy} onClick={() => void act('approve')}>{t('admin.approve')}</button>
            <button className="btn-secondary" disabled={busy} onClick={() => void act('reject')}>{t('admin.reject')}</button>
          </>
        )}
        {b.status === 'approved' && <button className="btn-secondary" disabled={busy} onClick={() => void act('suspend')}>{t('admin.suspend')}</button>}
        {b.status === 'suspended' && <button className="btn-primary" disabled={busy} onClick={() => void act('reactivate')}>{t('admin.reactivate')}</button>}
        {b.status === 'approved' && <Link to={`/b/${b.id}`} className="btn-secondary">{t('owner.viewPublic')}</Link>}
      </div>
    </div>
  );
}

export default function Applications() {
  const { t } = useI18n();
  const [filter, setFilter] = useState<Status | 'all'>('pending_review');
  const [rows, setRows] = useState<Business[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setRows(null);
    let q = supabase.from('businesses').select('*').order('submitted_at', { ascending: false, nullsFirst: false }).limit(50);
    if (filter !== 'all') q = q.eq('status', filter);
    const { data, error: e } = await q;
    if (e) { console.error(e); setError(t('err.generic')); return; }
    setRows((data ?? []) as Business[]);
  }, [filter, t]);
  useEffect(() => { void load(); }, [load]);

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 py-6">
      <Link to="/admin" className="text-sm btn-text">← {t('dash.admin')}</Link>
      <h1 className="font-display text-2xl font-semibold">{t('admin.applications')}</h1>
      <Select id="flt" label={t('admin.filter')} value={filter} onChange={(v) => { setOpen(null); setFilter(v as Status | 'all'); }}
        options={FILTERS.map((f) => ({ value: f, label: f === 'all' ? t('admin.all') : t(`status.${f}`) }))} />
      <Msg error={error} />
      {rows === null && !error && <div className="h-24 animate-pulse rounded-2xl bg-ink/10" />}
      {rows?.length === 0 && <p className="text-ink/70">{t('admin.noApps')}</p>}
      {rows?.map((b) => (
        <Section key={b.id} title={b.name}>
          <div className="flex items-center justify-between gap-2">
            <StatusBadge status={b.status} />
            <button className="btn-secondary" aria-expanded={open === b.id} onClick={() => setOpen(open === b.id ? null : b.id)}>{t('admin.review')}</button>
          </div>
          {open === b.id && <Detail b={b} onDone={async () => { setOpen(null); await load(); }} />}
        </Section>
      ))}
    </div>
  );
}
