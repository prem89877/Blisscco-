import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import Field from '../Field';
import { Msg, Section } from '../ui';
import { useI18n } from '../../i18n';
import { rupees } from '../../lib/format';
import { supabase } from '../../lib/supabase';
import { BUCKET, EXT, MAX_BYTES, signedUrlMap } from '../../lib/storage';
import type { Loaded, ServiceImage } from '../../lib/types';

const empty = { service: '', price: '' };
const MAX_SVC_IMG = 3;
const ACCEPT = 'image/jpeg,image/png,image/webp';

export default function ServicesSection({ data, reload }: { data: Loaded; reload: () => Promise<void> }) {
  const { t, lang } = useI18n();
  const [f, setF] = useState(empty);
  const [editId, setEditId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const blocked = data.business.status === 'suspended';
  const [tip, setTip] = useState<{ basic: number; standard: number; premium: number } | null>(null);
  const [tipBusy, setTipBusy] = useState(false);
  const [tipErr, setTipErr] = useState('');
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [staged, setStaged] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const bid = data.business.id;
  const imgPaths = data.serviceImages.map((i) => i.storage_path).join('|');

  useEffect(() => {
    let alive = true;
    void signedUrlMap(imgPaths ? imgPaths.split('|') : []).then((m) => { if (alive) setUrls(m); });
    return () => { alive = false; };
  }, [imgPaths]);

  useEffect(() => {
    const u = staged.map((f) => URL.createObjectURL(f));
    setPreviews(u);
    return () => { u.forEach((x) => URL.revokeObjectURL(x)); };
  }, [staged]);

  const imagesOf = (serviceId: string): ServiceImage[] => data.serviceImages.filter((i) => i.service_id === serviceId);

  /** Uploads one file and saves its row. Returns false on any failure (the uploaded file is cleaned up). */
  async function addImage(serviceId: string, file: File, order: number): Promise<boolean> {
    const path = `${bid}/${crypto.randomUUID()}.${EXT[file.type]}`;
    const up = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false });
    if (up.error) { console.error(up.error); return false; }
    const ins = await supabase.from('service_images').insert({ service_id: serviceId, business_id: bid, storage_path: path, sort_order: order });
    if (ins.error) { console.error(ins.error); await supabase.storage.from(BUCKET).remove([path]); return false; }
    return true;
  }

  function onStage(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (busy || files.length === 0) return;
    setError('');
    if (files.some((f) => !EXT[f.type] || f.size > MAX_BYTES)) return setError(t('ed.fileInvalid'));
    if (staged.length + files.length > MAX_SVC_IMG) setError(t('ed.svcImgMax'));
    setStaged([...staged, ...files].slice(0, MAX_SVC_IMG));
  }

  async function onAddToService(serviceId: string, e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (busy || files.length === 0) return;
    setError('');
    if (files.some((f) => !EXT[f.type] || f.size > MAX_BYTES)) return setError(t('ed.fileInvalid'));
    const have = imagesOf(serviceId);
    if (have.length + files.length > MAX_SVC_IMG) return setError(t('ed.svcImgMax'));
    setBusy(true);
    let order = have.reduce((m, i) => Math.max(m, i.sort_order), -1) + 1;
    for (const f of files) {
      if (!(await addImage(serviceId, f, order++))) { setError(t('err.generic')); break; }
    }
    setBusy(false);
    await reload();
  }

  async function onReplaceImage(img: ServiceImage, e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (busy || !file) return;
    setError('');
    if (!EXT[file.type] || file.size > MAX_BYTES) return setError(t('ed.fileInvalid'));
    setBusy(true);
    const path = `${bid}/${crypto.randomUUID()}.${EXT[file.type]}`;
    const up = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false });
    if (up.error) { console.error(up.error); setError(t('err.generic')); setBusy(false); return; }
    const upd = await supabase.from('service_images').update({ storage_path: path }).eq('id', img.id);
    if (upd.error) { console.error(upd.error); await supabase.storage.from(BUCKET).remove([path]); setError(t('err.generic')); }
    else await supabase.storage.from(BUCKET).remove([img.storage_path]);   // old photo goes only after the new one is saved
    setBusy(false);
    await reload();
  }

  async function onRemoveImage(img: ServiceImage) {
    if (busy) return;
    setBusy(true); setError('');
    const del = await supabase.from('service_images').delete().eq('id', img.id);
    if (del.error) setError(t('err.generic')); else await supabase.storage.from(BUCKET).remove([img.storage_path]);
    setBusy(false);
    await reload();
  }

  const TIP_ERR = ['unauthorized', 'bad_request', 'not_owner', 'rate_limited', 'configuration_required', 'ai_unavailable', 'server_config', 'server_error'];

  async function suggestPrice() {
    if (tipBusy) return;
    setTip(null); setTipErr('');
    const service = f.service.trim();
    if (service.length < 2) { setTipErr(t('ps.needName')); return; }
    setTipBusy(true);
    try {
      const { data: s } = await supabase.auth.getSession();
      const token = s.session?.access_token;
      if (!token) { setTipErr(t('ps.err.unauthorized')); return; }
      const r = await fetch('/api/ai-price-suggest', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ business_id: data.business.id, service, lang }),
      });
      const j = (await r.json().catch(() => ({}))) as { basic?: number; standard?: number; premium?: number; error?: string; detail?: string };
      if (r.ok && j.basic && j.standard && j.premium) setTip({ basic: j.basic, standard: j.standard, premium: j.premium });
      else setTipErr(t(j.error && TIP_ERR.includes(j.error) ? `ps.err.${j.error}` : 'err.generic') + (j.detail ? ` (${j.detail})` : ''));
    } catch { setTipErr(t('err.generic')); }
    finally { setTipBusy(false); }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError('');
    const price = Number(f.price);
    if (f.service.trim().length < 2 || !(price > 0 && price <= 100000)) return setError(t('ed.svcInvalid'));
    setBusy(true);
    const row = { service_category: f.service.trim(), price_inr: price, name: null, duration_minutes: null };
    let err: unknown = null;
    let newId: string | null = null;
    if (editId) {
      err = (await supabase.from('services').update(row).eq('id', editId)).error;
    } else {
      const ins = await supabase.from('services').insert({ ...row, business_id: data.business.id }).select('id').single();
      err = ins.error;
      newId = (ins.data as { id: string } | null)?.id ?? null;
    }
    if (err) { setBusy(false); console.error(err); setError(t('err.generic')); return; }
    let photoFail = false;
    if (newId && staged.length > 0) {
      let order = 0;
      for (const file of staged) {
        if (!(await addImage(newId, file, order++))) { photoFail = true; break; }
      }
    }
    setBusy(false);
    setF(empty); setEditId(null); setStaged([]);
    if (photoFail) setError(t('ed.svcImgPartial'));
    await reload();
  }

  async function toggle(id: string, active: boolean) {
    if (busy) return;
    setBusy(true);
    const { error: err } = await supabase.from('services').update({ is_active: !active }).eq('id', id);
    setBusy(false);
    if (err) setError(t('err.generic'));
    await reload();
  }

  return (
    <Section title={t('ed.services')}>
      {data.services.length === 0 && <p className="text-sm text-ink/70">{t('ed.svcNone')}</p>}
      <ul className="divide-y divide-ink/10">
        {data.services.map((s) => {
          const imgs = imagesOf(s.id);
          return (
          <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
            <div>
              <p className={`font-medium ${s.is_active ? '' : 'text-ink/50 line-through'}`}>{s.name || s.service_category}</p>
              <p className="text-sm text-ink/70">{rupees(s.price_inr)} {s.is_active ? '' : `· ${t('ed.hidden')}`}</p>
            </div>
            {!blocked && (
              <div className="flex gap-2">
                <button className="btn-secondary" onClick={() => { setEditId(s.id); setF({ service: s.name || s.service_category, price: String(s.price_inr) }); }}>{t('common.edit')}</button>
                <button className="btn-secondary" disabled={busy} onClick={() => void toggle(s.id, s.is_active)}>{s.is_active ? t('ed.deactivate') : t('ed.activate')}</button>
              </div>
            )}
            {(imgs.length > 0 || !blocked) && (
              <div className="w-full space-y-2">
                <p className="text-xs font-medium text-ink/60">{t('ed.svcPhotos')} · {t('ed.svcPhotoCount', { n: imgs.length })}</p>
                <div className="grid grid-cols-3 gap-2">
                  {imgs.map((img) => (
                    <figure key={img.id} className="space-y-1">
                      {urls[img.storage_path]
                        ? <img src={urls[img.storage_path]} alt="" loading="lazy" className="aspect-square w-full rounded-xl object-cover" />
                        : <div className="aspect-square w-full animate-pulse rounded-xl bg-ink/10" />}
                      {!blocked && (
                        <div className="grid grid-cols-2 gap-1">
                          <label className={`btn-secondary cursor-pointer px-1 text-xs ${busy ? 'opacity-60' : ''}`}>
                            {t('ed.changePhoto')}
                            <input type="file" accept={ACCEPT} hidden disabled={busy} onChange={(e) => void onReplaceImage(img, e)} />
                          </label>
                          <button type="button" className="btn-secondary px-1 text-xs" disabled={busy} onClick={() => void onRemoveImage(img)}>{t('ed.remove')}</button>
                        </div>
                      )}
                    </figure>
                  ))}
                </div>
                {!blocked && imgs.length < MAX_SVC_IMG && (
                  <label className={`btn-secondary w-full cursor-pointer ${busy ? 'opacity-60' : ''}`}>
                    {t('ed.svcAddPhoto')}
                    <input type="file" accept={ACCEPT} multiple hidden disabled={busy} onChange={(e) => void onAddToService(s.id, e)} />
                  </label>
                )}
              </div>
            )}
          </li>
          );
        })}
      </ul>
      {!blocked && (
        <form onSubmit={onSubmit} className="space-y-3 rounded-xl bg-cream p-3" noValidate>
          <Field id="sc" label={t('ed.svcCategory')} value={f.service} onChange={(v) => setF({ ...f, service: v })} disabled={busy} />
          <Field id="sp2" label={t('ed.svcPrice')} value={f.price} onChange={(v) => setF({ ...f, price: v })} disabled={busy} />
          {!editId && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-ink/60">{t('ed.svcPhotos')} · {t('ed.svcPhotoCount', { n: staged.length })}</p>
              <p className="text-xs text-ink/60">{t('ed.svcPhotosHelp')}</p>
              {previews.length > 0 && (
                <div className="grid grid-cols-3 gap-2">
                  {previews.map((u, k) => (
                    <figure key={u} className="space-y-1">
                      <img src={u} alt="" className="aspect-square w-full rounded-xl object-cover" />
                      <button type="button" className="btn-secondary w-full px-1 text-xs" disabled={busy} onClick={() => setStaged(staged.filter((_, j) => j !== k))}>{t('ed.remove')}</button>
                    </figure>
                  ))}
                </div>
              )}
              {staged.length < MAX_SVC_IMG && (
                <label className={`btn-secondary w-full cursor-pointer ${busy ? 'opacity-60' : ''}`}>
                  {t('ed.svcAddPhoto')}
                  <input type="file" accept={ACCEPT} multiple hidden disabled={busy} onChange={onStage} />
                </label>
              )}
            </div>
          )}
          <button type="button" className="btn-ai" disabled={busy || tipBusy} onClick={() => void suggestPrice()}>
            <span aria-hidden="true">✨</span> {tipBusy ? t('ps.thinking') : t('ps.btn')}
          </button>
          {tip && (
            <div role="status" className="ai-tip">
              <p className="text-xs font-semibold text-ink/60">{t('ps.title')}</p>
              <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                {([['basic', tip.basic], ['standard', tip.standard], ['premium', tip.premium]] as const).map(([k, v]) => (
                  <button key={k} type="button" className="ai-price" onClick={() => setF({ ...f, price: String(v) })}>
                    <span className="block text-[11px] font-medium text-ink/60">{t(`ps.${k}`)}</span>
                    <span className="block text-base font-semibold">{rupees(v)}</span>
                  </button>
                ))}
              </div>
              <p className="mt-2 text-xs text-ink/60">{t('ps.disclaimer')}</p>
            </div>
          )}
          <Msg error={tipErr} />
          <Msg error={error} />
          <div className="flex gap-2">
            <button type="submit" className="btn-primary flex-1" disabled={busy}>{editId ? t('common.save') : t('common.add')}</button>
            {editId && <button type="button" className="btn-secondary" onClick={() => { setEditId(null); setF(empty); setStaged([]); }}>{t('common.cancel')}</button>}
          </div>
        </form>
      )}
    </Section>
  );
}
