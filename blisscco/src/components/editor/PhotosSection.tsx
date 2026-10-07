import { useEffect, useState, type ChangeEvent } from 'react';
import { Msg, Section } from '../ui';
import { useI18n } from '../../i18n';
import { supabase } from '../../lib/supabase';
import { BUCKET, EXT, MAX_BYTES, signedUrlMap } from '../../lib/storage';
import type { Loaded } from '../../lib/types';

/** minKeep: a live shop must keep at least this many photos (the owner can still Change a photo, or add first and then remove). */
export default function PhotosSection({ data, editable, reload, minKeep = 0 }: { data: Loaded; editable: boolean; reload: () => Promise<void>; minKeep?: number }) {
  const { t } = useI18n();
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const bid = data.business.id;
  const paths = data.images.map((i) => i.storage_path).join('|');

  useEffect(() => {
    let alive = true;
    void signedUrlMap(paths ? paths.split('|') : []).then((m) => { if (alive) setUrls(m); });
    return () => { alive = false; };
  }, [paths]);

  async function onFiles(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (busy || files.length === 0) return;
    setError('');
    if (files.some((f) => !EXT[f.type] || f.size > MAX_BYTES)) return setError(t('ed.fileInvalid'));
    setBusy(true);
    let order = data.images.length;
    for (const file of files) {
      const path = `${bid}/${crypto.randomUUID()}.${EXT[file.type]}`;
      const up = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false });
      if (up.error) { console.error(up.error); setError(t('err.generic')); break; }
      const ins = await supabase.from('business_images').insert({ business_id: bid, storage_path: path, sort_order: order++ });
      if (ins.error) { console.error(ins.error); await supabase.storage.from(BUCKET).remove([path]); setError(t('err.generic')); break; }
    }
    setBusy(false);
    await reload();
  }

  async function replace(img: { id: string; storage_path: string; sort_order: number }, e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (busy || !file) return;
    setError('');
    if (!EXT[file.type] || file.size > MAX_BYTES) return setError(t('ed.fileInvalid'));
    setBusy(true);
    const path = `${bid}/${crypto.randomUUID()}.${EXT[file.type]}`;
    const up = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false });
    if (up.error) { console.error(up.error); setError(t('err.generic')); setBusy(false); return; }
    const ins = await supabase.from('business_images').insert({ business_id: bid, storage_path: path, sort_order: img.sort_order });
    if (ins.error) { console.error(ins.error); await supabase.storage.from(BUCKET).remove([path]); setError(t('err.generic')); setBusy(false); return; }
    const del = await supabase.from('business_images').delete().eq('id', img.id);   // old photo goes only after the new one is saved
    if (del.error) setError(t('err.generic')); else await supabase.storage.from(BUCKET).remove([img.storage_path]);
    setBusy(false);
    await reload();
  }

  async function remove(id: string, path: string) {
    if (busy) return;
    setBusy(true); setError('');
    const del = await supabase.from('business_images').delete().eq('id', id);
    if (del.error) setError(t('err.generic')); else await supabase.storage.from(BUCKET).remove([path]);
    setBusy(false);
    await reload();
  }

  return (
    <Section title={t('ed.photos')}>
      <p className="text-sm text-ink/70">{t('ed.photosHelp')}</p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {data.images.map((img) => (
          <figure key={img.id} className="space-y-1">
            {urls[img.storage_path]
              ? <img src={urls[img.storage_path]} alt="" loading="lazy" className="aspect-square w-full rounded-xl object-cover" />
              : <div className="aspect-square w-full animate-pulse rounded-xl bg-ink/10" />}
            {editable && (
              <div className="grid grid-cols-2 gap-1.5">
                <label className={`btn-secondary cursor-pointer px-2 ${busy ? 'opacity-60' : ''}`}>
                  {t('ed.changePhoto')}
                  <input type="file" accept="image/jpeg,image/png,image/webp" hidden disabled={busy} onChange={(e) => void replace(img, e)} />
                </label>
                <button className="btn-secondary px-2" disabled={busy || data.images.length <= minKeep} onClick={() => void remove(img.id, img.storage_path)}>{t('ed.remove')}</button>
              </div>
            )}
          </figure>
        ))}
      </div>
      {editable && (
        <label className={`btn-primary w-full cursor-pointer ${busy ? 'opacity-60' : ''}`}>
          {busy ? t('common.loading') : t('ed.upload')}
          <input type="file" accept="image/jpeg,image/png,image/webp" multiple hidden disabled={busy} onChange={(e) => void onFiles(e)} />
        </label>
      )}
      {editable && minKeep > 0 && <p className="text-xs text-ink/60">{t('ed.photosMin', { n: minKeep })}</p>}
      <Msg error={error} />
    </Section>
  );
}
