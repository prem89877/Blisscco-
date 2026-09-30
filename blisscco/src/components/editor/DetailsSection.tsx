import { useState, type FormEvent } from 'react';
import Field from '../Field';
import { Check, Msg, Section, Select, TextArea } from '../ui';
import { useI18n } from '../../i18n';
import { catName } from '../../lib/format';
import { supabase } from '../../lib/supabase';
import type { Loaded } from '../../lib/types';
import { isEmail } from '../../lib/validation';

const r6 = (n: number) => Math.round(n * 1e6) / 1e6;

export default function DetailsSection({ data, editable, reload }: { data: Loaded; editable: boolean; reload: () => Promise<void> }) {
  const { t, lang } = useI18n();
  const b = data.business;
  const [f, setF] = useState({
    category_id: b.category_id ?? '', name: b.name, description: b.description ?? '', phone: b.phone ?? '', email: b.email ?? '',
    show_phone_publicly: b.show_phone_publicly, show_email_publicly: b.show_email_publicly,
    address_line: b.address_line ?? '', city: b.city ?? '', state: b.state ?? '', pincode: b.pincode ?? '',
  });
  const [lat, setLat] = useState<number | null>(b.latitude);
  const [lng, setLng] = useState<number | null>(b.longitude);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [gpsMsg, setGpsMsg] = useState('');
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }));

  function useGps() {
    setGpsMsg('');
    if (!navigator.geolocation) { setGpsMsg(t('err.generic')); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => { setLat(r6(pos.coords.latitude)); setLng(r6(pos.coords.longitude)); },
      (err) => setGpsMsg(err.code === err.PERMISSION_DENIED ? t('ed.gpsDenied') : t('err.generic')),
      { enableHighAccuracy: true, timeout: 20000 },
    );
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(''); setOk('');
    const phone = f.phone.replace(/[\s-]/g, '');
    if (f.name.trim().length < 2) return setError(t('err.nameRequired'));
    if (phone && !/^\+?[0-9]{10,13}$/.test(phone)) return setError(t('ed.invalidPhone'));
    if (f.email.trim() && !isEmail(f.email)) return setError(t('err.invalidEmail'));
    if (f.pincode.trim() && !/^[0-9]{6}$/.test(f.pincode.trim())) return setError(t('ed.invalidPin'));
    setBusy(true);
    const { error: err } = await supabase.from('businesses').update({
      category_id: f.category_id || null, name: f.name.trim(), description: f.description.trim() || null,
      phone: phone || null, email: f.email.trim() || null,
      show_phone_publicly: f.show_phone_publicly, show_email_publicly: f.show_email_publicly,
      address_line: f.address_line.trim() || null, city: f.city.trim() || null, state: f.state.trim() || null,
      pincode: f.pincode.trim() || null, latitude: lat, longitude: lng,
    }).eq('id', b.id);
    setBusy(false);
    if (err) { console.error(err); setError(t('err.generic')); return; }
    setOk(t('common.saved'));
    await reload();
  }

  const d = !editable || busy;
  return (
    <Section title={t('ed.details')}>
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Field id="name" label={t('ed.name')} value={f.name} onChange={(v) => set('name', v)} disabled={d} />
        <Select id="cat" label={t('ed.category')} value={f.category_id} onChange={(v) => set('category_id', v)} disabled={d}
          placeholder={t('common.select')} options={data.categories.map((c) => ({ value: c.id, label: catName(c, lang) }))} />
        <TextArea id="desc" label={t('ed.description')} value={f.description} onChange={(v) => set('description', v)} disabled={d} />
        <Field id="phone" label={t('ed.phone')} autoComplete="tel" value={f.phone} onChange={(v) => set('phone', v)} disabled={d} />
        <Check id="sp" label={t('ed.showPhone')} checked={f.show_phone_publicly} onChange={(v) => set('show_phone_publicly', v)} disabled={d} />
        <Field id="bemail" label={t('ed.email')} type="email" value={f.email} onChange={(v) => set('email', v)} disabled={d} />
        <Check id="se" label={t('ed.showEmail')} checked={f.show_email_publicly} onChange={(v) => set('show_email_publicly', v)} disabled={d} />
        <Field id="addr" label={t('ed.address')} value={f.address_line} onChange={(v) => set('address_line', v)} disabled={d} />
        <div className="grid grid-cols-2 gap-3">
          <Field id="city" label={t('ed.city')} value={f.city} onChange={(v) => set('city', v)} disabled={d} />
          <Field id="state" label={t('ed.state')} value={f.state} onChange={(v) => set('state', v)} disabled={d} />
        </div>
        <Field id="pin" label={t('ed.pincode')} value={f.pincode} onChange={(v) => set('pincode', v)} disabled={d} />

        <div className="space-y-2 rounded-xl bg-cream p-3">
          <p className="text-sm font-medium">{t('ed.location')}</p>
          <p className="text-sm text-ink/70">{t('ed.gpsWhy')}</p>
          <p className="text-sm">{lat !== null && lng !== null ? t('ed.gpsSet', { lat, lng }) : t('ed.noLocation')}</p>
          {editable && <button type="button" className="btn-secondary" onClick={useGps}>{t('ed.useGps')}</button>}
          <Msg error={gpsMsg} />
        </div>

        <Msg error={error} ok={ok} />
        {editable && <button type="submit" className="btn-primary w-full" disabled={busy}>{busy ? t('common.loading') : t('common.save')}</button>}
      </form>
    </Section>
  );
}
