import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Field from '../../components/Field';
import { Msg, Section } from '../../components/ui';
import { useI18n } from '../../i18n';
import { VDOC_BUCKET } from '../../lib/storage';
import { supabase } from '../../lib/supabase';

interface Row { id: string; doc_type: string; doc_path: string; businesses: { name: string; city: string | null } | null }

export default function AdminVerifications() {
  const { t } = useI18n();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [errKey, setErrKey] = useState('');

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('verification_requests').select('id,doc_type,doc_path,businesses(name,city)').eq('status', 'pending').order('created_at').limit(50);
    if (error) { console.error(error); setErrKey('err.generic'); return; }
    setRows((data ?? []) as unknown as Row[]);
  }, []);
  useEffect(() => { void load(); }, [load]);

  // Documents are private: create a short-lived link only when the admin clicks
  async function openDoc(path: string) {
    const { data, error } = await supabase.storage.from(VDOC_BUCKET).createSignedUrl(path, 120);
    if (error || !data) { setErrKey('err.generic'); return; }
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
  }

  async function review(id: string, approve: boolean) {
    if (busy) return;
    setBusy(true); setErrKey('');
    const { error } = await supabase.rpc('admin_review_verification', { p_request_id: id, p_approve: approve, p_reason: reasons[id] ?? null });
    setBusy(false);
    if (error) { console.error(error); setErrKey(error.message === 'reason_required' ? 'p8.err.reason_required' : 'err.generic'); }
    await load();
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-6">
      <Link to="/admin" className="text-sm btn-text">← {t('dash.admin')}</Link>
      <h1 className="font-display text-2xl font-semibold">{t('p8.adVerify')}</h1>
      <Msg error={errKey ? t(errKey) : ''} />
      {rows === null && !errKey && <div className="h-24 animate-pulse rounded-2xl bg-ink/10" />}
      {rows?.length === 0 && <p className="text-ink/70">{t('admin.noApps')}</p>}
      {rows?.map((r) => (
        <Section key={r.id} title={r.businesses?.name ?? '—'}>
          <p className="text-sm">{[r.businesses?.city, t(`p8.doc.${r.doc_type}`)].filter(Boolean).join(' · ')}</p>
          <button className="btn-secondary" onClick={() => void openDoc(r.doc_path)}>{t('p8.openDoc')}</button>
          <Field id={`v-${r.id}`} label={t('p8.rejectReason')} value={reasons[r.id] ?? ''} onChange={(v) => setReasons((p) => ({ ...p, [r.id]: v }))} disabled={busy} />
          <div className="flex gap-2">
            <button className="btn-primary" disabled={busy} onClick={() => void review(r.id, true)}>{t('p8.approve')}</button>
            <button className="btn-secondary" disabled={busy} onClick={() => void review(r.id, false)}>{t('p8.reject')}</button>
          </div>
        </Section>
      ))}
    </div>
  );
}
