import { useCallback, useEffect, useState, type FormEvent } from 'react';
import Field from '../Field';
import { Msg, Section, Select, TextArea } from '../ui';
import { useI18n } from '../../i18n';
import { catName } from '../../lib/format';
import { supabase } from '../../lib/supabase';
import type { ChangeRequest, Loaded } from '../../lib/types';

/** Live shop: change business name / category / description. Goes live only after admin approval. */
export default function ProfileChangeSection({ data, reload }: { data: Loaded; reload: () => Promise<void> }) {
  const { t, lang } = useI18n();
  const b = data.business;
  const [req, setReq] = useState<ChangeRequest | null>(null);
  const [f, setF] = useState({ name: b.name, category_id: b.category_id ?? '', description: b.description ?? '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');

  const loadReq = useCallback(async () => {
    const { data: r } = await supabase.from('business_change_requests').select('*').eq('business_id', b.id)
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    setReq((r as ChangeRequest | null) ?? null);
  }, [b.id]);
  useEffect(() => { void loadReq(); }, [loadReq]);

  const pending = req?.status === 'pending' ? req : null;
  const rejected = req?.status === 'rejected' ? req : null;

  // show the pending request's values (or the live values) and follow the shop after an approval
  useEffect(() => {
    setF(pending
      ? { name: pending.name, category_id: pending.category_id, description: pending.description }
      : { name: b.name, category_id: b.category_id ?? '', description: b.description ?? '' });
  }, [pending, b.name, b.category_id, b.description]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(''); setOk('');
    if (f.name.trim().length < 2) return setError(t('err.nameRequired'));
    if (!f.category_id || !f.description.trim()) return setError(t('ed.required', { field: [!f.category_id ? t('ed.category') : '', !f.description.trim() ? t('ed.description') : ''].filter(Boolean).join(', ') }));
    if (f.name.trim() === b.name && f.category_id === (b.category_id ?? '') && f.description.trim() === (b.description ?? '').trim()) return setError(t('pc.noChange'));
    setBusy(true);
    const { error: err } = await supabase.rpc('owner_request_profile_change', {
      p_business_id: b.id, p_name: f.name.trim(), p_category_id: f.category_id, p_description: f.description.trim(),
    });
    setBusy(false);
    if (err) { console.error(err); setError((err.message ?? '').includes('no_change') ? t('pc.noChange') : t('err.generic')); return; }
    setOk(t('pc.sent'));
    await loadReq();
    await reload();
  }

  return (
    <Section title={t('pc.title')}>
      <p className="rounded-xl bg-cream p-3 text-sm">{t('pc.note')}</p>
      {pending && <p role="status" className="rounded-xl bg-amber-50 p-3 text-sm font-medium">{t('pc.pending')}</p>}
      {rejected && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm"><strong>{t('pc.rejected')}</strong>{rejected.rejection_reason ? `: ${rejected.rejection_reason}` : ''}</p>}
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Field id="pc-name" label={t('ed.name')} value={f.name} onChange={(v) => setF((p) => ({ ...p, name: v }))} disabled={busy} />
        <Select id="pc-cat" label={t('ed.category')} value={f.category_id} onChange={(v) => setF((p) => ({ ...p, category_id: v }))} disabled={busy}
          placeholder={t('common.select')} options={data.categories.map((c) => ({ value: c.id, label: catName(c, lang) }))} />
        <TextArea id="pc-desc" label={t('ed.description')} value={f.description} onChange={(v) => setF((p) => ({ ...p, description: v }))} disabled={busy} />
        <Msg error={error} ok={ok} />
        <button type="submit" className="btn-solid w-full" disabled={busy}>{busy ? t('common.loading') : t('pc.submit')}</button>
      </form>
    </Section>
  );
}
