import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { VerifiedTick } from '../../components/TierBadge';
import { Msg, Section, Select } from '../../components/ui';
import { useI18n } from '../../i18n';
import { MAX_BYTES, VDOC_BUCKET } from '../../lib/storage';
import { supabase } from '../../lib/supabase';
import type { Entitlements, VerificationRow } from '../../lib/types';

const DOC_TYPES = ['gst', 'shop_licence', 'udyam', 'other'];
const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' };
const KNOWN = ['not_owner', 'business_not_approved', 'invalid_doc_type', 'invalid_doc', 'already_pending'];

export default function OwnerVerify() {
  const { id } = useParams();
  const { t } = useI18n();
  const [ent, setEnt] = useState<Entitlements | null>(null);
  const [last, setLast] = useState<VerificationRow | null>(null);
  const [docType, setDocType] = useState('gst');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState({ error: '', ok: '' });

  const load = useCallback(async () => {
    if (!id) return;
    const [e, v] = await Promise.all([
      supabase.rpc('my_entitlements', { p_business_id: id }),
      supabase.from('verification_requests').select('*').eq('business_id', id).order('created_at', { ascending: false }).limit(1),
    ]);
    if (e.error || v.error) { setMsg({ error: t('err.generic'), ok: '' }); return; }
    setEnt(e.data as Entitlements); setLast(((v.data ?? [])[0] as VerificationRow | undefined) ?? null);
  }, [id, t]);
  useEffect(() => { void load(); }, [load]);

  async function submit() {
    if (busy || !id || !file) return;
    const ext = EXT[file.type];
    if (!ext) { setMsg({ error: t('p8.err.doc_type'), ok: '' }); return; }
    if (file.size > MAX_BYTES) { setMsg({ error: t('p8.err.file_size'), ok: '' }); return; }
    setBusy(true); setMsg({ error: '', ok: '' });
    const path = `${id}/${crypto.randomUUID()}.${ext}`;
    const up = await supabase.storage.from(VDOC_BUCKET).upload(path, file, { contentType: file.type, upsert: false });
    if (up.error) { console.error(up.error); setBusy(false); setMsg({ error: t('err.generic'), ok: '' }); return; }
    const { error } = await supabase.rpc('submit_verification', { p_business_id: id, p_doc_type: docType, p_doc_path: path });
    setBusy(false);
    if (error) { setMsg({ error: t(KNOWN.includes(error.message) ? `p8.err.${error.message}` : 'err.generic'), ok: '' }); return; }
    setFile(null); setMsg({ error: '', ok: t('p8.verifySent') });
    await load();
  }

  const pending = last?.status === 'pending';
  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-6">
      <Link to="/owner" className="text-sm underline">← {t('owner.title')}</Link>
      <h1 className="flex items-center gap-2 font-display text-2xl font-semibold">{t('p8.verifyTitle')} <VerifiedTick size={24} /></h1>
      <p className="text-sm text-ink/80">{t('p8.verifyHow')}</p>
      <Msg error={msg.error} ok={msg.ok} />
      {ent?.verified && <p role="status" className="rounded-xl bg-green-50 p-3 text-sm text-green-900">{t('p8.verifiedNow')}</p>}
      {last && (
        <Section title={t('p8.verifyStatus')}>
          <p className="font-medium">{t(`p8.vs.${last.status}`)}</p>
          {last.status === 'rejected' && last.rejection_reason && <p className="rounded-xl bg-red-50 p-3 text-sm"><strong>{t('owner.reason')}:</strong> {last.rejection_reason}</p>}
          {last.status === 'approved' && !ent?.verified && (
            <><p className="text-sm">{t('p8.payBadgeNote')}</p><Link to={`/owner/business/${id}/plans`} className="btn-primary">{t('p8.payBadge')}</Link></>
          )}
        </Section>
      )}
      {!pending && (
        <Section title={t('p8.sendDoc')}>
          <Select id="dt" label={t('p8.docType')} value={docType} onChange={setDocType} options={DOC_TYPES.map((d) => ({ value: d, label: t(`p8.doc.${d}`) }))} disabled={busy} />
          <div className="space-y-1.5">
            <label htmlFor="df" className="text-sm font-medium">{t('p8.docFile')}</label>
            <input id="df" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" disabled={busy} onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="input" />
            <p className="text-xs text-ink/60">{t('p8.docHint')}</p>
          </div>
          <button className="btn-primary w-full" disabled={busy || !file} onClick={() => void submit()}>{busy ? t('common.loading') : t('p8.submitDoc')}</button>
        </Section>
      )}
    </div>
  );
}
