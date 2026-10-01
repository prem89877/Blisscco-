import { useState, type FormEvent } from 'react';
import Field from '../Field';
import { Msg, Section } from '../ui';
import { useI18n } from '../../i18n';
import { rupees } from '../../lib/format';
import { supabase } from '../../lib/supabase';
import type { Loaded } from '../../lib/types';

const empty = { service: '', price: '' };

export default function ServicesSection({ data, reload }: { data: Loaded; reload: () => Promise<void> }) {
  const { t } = useI18n();
  const [f, setF] = useState(empty);
  const [editId, setEditId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const blocked = data.business.status === 'suspended';

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError('');
    const price = Number(f.price);
    if (f.service.trim().length < 2 || !(price > 0 && price <= 100000)) return setError(t('ed.svcInvalid'));
    setBusy(true);
    const row = { service_category: f.service.trim(), price_inr: price, name: null, duration_minutes: null };
    const { error: err } = editId
      ? await supabase.from('services').update(row).eq('id', editId)
      : await supabase.from('services').insert({ ...row, business_id: data.business.id });
    setBusy(false);
    if (err) { console.error(err); setError(t('err.generic')); return; }
    setF(empty); setEditId(null);
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
        {data.services.map((s) => (
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
          </li>
        ))}
      </ul>
      {!blocked && (
        <form onSubmit={onSubmit} className="space-y-3 rounded-xl bg-cream p-3" noValidate>
          <Field id="sc" label={t('ed.svcCategory')} value={f.service} onChange={(v) => setF({ ...f, service: v })} disabled={busy} />
          <Field id="sp2" label={t('ed.svcPrice')} value={f.price} onChange={(v) => setF({ ...f, price: v })} disabled={busy} />
          <Msg error={error} />
          <div className="flex gap-2">
            <button type="submit" className="btn-primary flex-1" disabled={busy}>{editId ? t('common.save') : t('common.add')}</button>
            {editId && <button type="button" className="btn-secondary" onClick={() => { setEditId(null); setF(empty); }}>{t('common.cancel')}</button>}
          </div>
        </form>
      )}
    </Section>
  );
}
