import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Field from '../../components/Field';
import { Msg, Section } from '../../components/ui';
import { useI18n } from '../../i18n';
import { BANNER_BUCKET, signedUrlMap } from '../../lib/storage';
import { supabase } from '../../lib/supabase';

interface Row { id: string; title: string; image_path: string; businesses: { name: string } | null }

export default function AdminBanners() {
  const { t } = useI18n();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [errKey, setErrKey] = useState('');

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('banners').select('id,title,image_path,businesses(name)').eq('status', 'pending').order('created_at').limit(50);
    if (error) { console.error(error); setErrKey('err.generic'); return; }
    const list = (data ?? []) as unknown as Row[];
    setRows(list);
    setUrls(await signedUrlMap(list.map((r) => r.image_path), BANNER_BUCKET));
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function review(id: string, approve: boolean) {
    if (busy) return;
    setBusy(true); setErrKey('');
    const { error } = await supabase.rpc('admin_review_banner', { p_banner_id: id, p_approve: approve, p_reason: reasons[id] ?? null });
    setBusy(false);
    if (error) { console.error(error); setErrKey(error.message === 'reason_required' ? 'p8.err.reason_required' : 'err.generic'); }
    await load();
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-6">
      <Link to="/admin" className="text-sm underline">← {t('dash.admin')}</Link>
      <h1 className="font-display text-2xl font-semibold">{t('p8.adBanners')}</h1>
      <Msg error={errKey ? t(errKey) : ''} />
      {rows === null && !errKey && <div className="h-24 animate-pulse rounded-2xl bg-ink/10" />}
      {rows?.length === 0 && <p className="text-ink/70">{t('admin.noApps')}</p>}
      {rows?.map((r) => (
        <Section key={r.id} title={r.businesses?.name ?? '—'}>
          {urls[r.image_path] && <img src={urls[r.image_path]} alt={r.title} className="h-40 w-full rounded-xl object-cover" />}
          <p className="font-medium">{r.title}</p>
          <Field id={`r-${r.id}`} label={t('p8.rejectReason')} value={reasons[r.id] ?? ''} onChange={(v) => setReasons((p) => ({ ...p, [r.id]: v }))} disabled={busy} />
          <div className="flex gap-2">
            <button className="btn-primary" disabled={busy} onClick={() => void review(r.id, true)}>{t('p8.approve')}</button>
            <button className="btn-secondary" disabled={busy} onClick={() => void review(r.id, false)}>{t('p8.reject')}</button>
          </div>
        </Section>
      ))}
    </div>
  );
}
