import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import Field from '../../components/Field';
import { Msg, Section } from '../../components/ui';
import { useI18n } from '../../i18n';
import { fmtDateTime } from '../../lib/format';
import { BANNER_BUCKET, EXT, MAX_BYTES, signedUrlMap } from '../../lib/storage';
import { supabase } from '../../lib/supabase';
import type { BannerRow, Entitlements } from '../../lib/types';

const KNOWN = ['not_owner', 'business_not_approved', 'invalid_title', 'invalid_image', 'no_credits', 'invalid_state', 'not_found'];

export default function OwnerBanners() {
  const { id } = useParams();
  const { t, lang } = useI18n();
  const [ent, setEnt] = useState<Entitlements | null>(null);
  const [rows, setRows] = useState<BannerRow[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [title, setTitle] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState({ error: '', ok: '' });
  const errOf = (m?: string | null) => t(m && KNOWN.includes(m) ? `p8.err.${m}` : 'err.generic');

  const load = useCallback(async () => {
    if (!id) return;
    const [e, b] = await Promise.all([
      supabase.rpc('my_entitlements', { p_business_id: id }),
      supabase.from('banners').select('*').eq('business_id', id).order('created_at', { ascending: false }).limit(30),
    ]);
    if (e.error || b.error) { setMsg({ error: t('err.generic'), ok: '' }); return; }
    setEnt(e.data as Entitlements);
    const list = (b.data ?? []) as BannerRow[];
    setRows(list);
    setUrls(await signedUrlMap(list.map((x) => x.image_path), BANNER_BUCKET));
  }, [id, t]);
  useEffect(() => { void load(); }, [load]);

  async function create() {
    if (busy || !id || !file) return;
    const ext = EXT[file.type];
    if (!ext) { setMsg({ error: t('p8.err.file_type'), ok: '' }); return; }
    if (file.size > MAX_BYTES) { setMsg({ error: t('p8.err.file_size'), ok: '' }); return; }
    setBusy(true); setMsg({ error: '', ok: '' });
    const path = `${id}/${crypto.randomUUID()}.${ext}`;
    const up = await supabase.storage.from(BANNER_BUCKET).upload(path, file, { contentType: file.type, upsert: false });
    if (up.error) { console.error(up.error); setBusy(false); setMsg({ error: t('err.generic'), ok: '' }); return; }
    const { error } = await supabase.rpc('create_banner', { p_business_id: id, p_title: title, p_image_path: path });
    if (error) {
      await supabase.storage.from(BANNER_BUCKET).remove([path]);
      setBusy(false); setMsg({ error: errOf(error.message), ok: '' }); return;
    }
    setBusy(false); setTitle(''); setFile(null); setMsg({ error: '', ok: t('p8.bannerSent') });
    await load();
  }

  async function cancel(bid: string) {
    if (busy) return;
    setBusy(true); setMsg({ error: '', ok: '' });
    const { error } = await supabase.rpc('owner_cancel_banner', { p_banner_id: bid });
    setBusy(false);
    if (error) setMsg({ error: errOf(error.message), ok: '' });
    await load();
  }

  const canCreate = (ent?.credits ?? 0) > 0;
  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-6">
      <Link to="/owner" className="text-sm link-text">← {t('owner.title')}</Link>
      <h1 className="font-display text-2xl font-semibold">{t('p8.bannersTitle')}</h1>
      <Msg error={msg.error} ok={msg.ok} />
      {ent && (
        <Section title={t('p8.newBanner')}>
          <p className="text-sm">{t('p8.credits', { n: ent.credits })}</p>
          {ent.credits < 1 && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{t('p8.err.no_credits')} <Link to={`/owner/business/${id}/plans`} className="link-text">{t('p8.extraBanner')}</Link></p>}
          <Field id="bt" label={t('p8.bannerTitle')} value={title} onChange={setTitle} disabled={busy || !canCreate} />
          <div className="space-y-1.5">
            <label htmlFor="bf" className="text-sm font-medium">{t('p8.bannerImage')}</label>
            <input id="bf" type="file" accept="image/jpeg,image/png,image/webp" disabled={busy || !canCreate} onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="input" />
            <p className="text-xs text-ink/60">{t('p8.bannerHint')}</p>
          </div>
          <button className="btn-primary w-full" disabled={busy || !canCreate || !file || title.trim().length < 2} onClick={() => void create()}>{busy ? t('common.loading') : t('p8.submitBanner')}</button>
        </Section>
      )}
      {rows.map((b) => (
        <article key={b.id} className="card space-y-2">
          {urls[b.image_path] && <img src={urls[b.image_path]} alt={b.title} className="h-32 w-full rounded-xl object-cover" />}
          <div className="flex items-start justify-between gap-2">
            <p className="font-medium">{b.title}</p>
            <span className="rounded-full bg-ink/10 px-3 py-1 text-xs font-semibold">{t(`p8.bs.${b.status}`)}</span>
          </div>
          {b.status === 'approved' && b.ends_at && <p className="text-xs text-ink/70">{t('p8.liveUntil', { d: fmtDateTime(b.ends_at, lang) })}</p>}
          {b.status === 'rejected' && b.rejection_reason && <p className="rounded-xl bg-red-50 p-3 text-sm"><strong>{t('owner.reason')}:</strong> {b.rejection_reason}</p>}
          {b.status === 'pending' && <button className="btn-secondary" disabled={busy} onClick={() => void cancel(b.id)}>{t('p8.cancelBanner')}</button>}
        </article>
      ))}
    </div>
  );
}
