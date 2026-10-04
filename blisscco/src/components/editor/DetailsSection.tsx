import { useState, type FormEvent } from 'react';
import Field from '../Field';
import { Check, Msg, Section, Select, TextArea } from '../ui';
import { useI18n } from '../../i18n';
import { catName } from '../../lib/format';
import { supabase } from '../../lib/supabase';
import type { Loaded } from '../../lib/types';
import { isEmail } from '../../lib/validation';
import { addressErrorKey, checkIndiaCoords, coordErrorKey, stateFromPincode, validateAddress } from '../../lib/india';

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
      (pos) => {
        const la = r6(pos.coords.latitude);
        const lo = r6(pos.coords.longitude);
        const c = checkIndiaCoords(la, lo);
        if (!c.ok) { setGpsMsg(t(coordErrorKey(c.reason))); return; }   // not saved: outside India / invalid
        setLat(la); setLng(lo);
      },
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
    const addr = validateAddress(f, false);   // checks only what was typed; state must match the PIN code
    if (addr.errors.length) return setError(t(addressErrorKey(addr.errors[0])));
    if (lat !== null || lng !== null) {
      const c = checkIndiaCoords(lat, lng);
      if (!c.ok) return setError(t(coordErrorKey(c.reason)));
    }
    const stateName = addr.state ?? f.state.trim();
    setBusy(true);
    const { error: err } = await supabase.from('businesses').update({
      category_id: f.category_id || null, name: f.name.trim(), description: f.description.trim() || null,
      phone: phone || null, email: f.email.trim() || null,
      show_phone_publicly: f.show_phone_publicly, show_email_publicly: f.show_email_publicly,
      address_line: f.address_line.trim() || null, city: f.city.trim() || null, state: stateName || null,
      pincode: f.pincode.trim() || null, latitude: lat, longitude: lng,
    }).eq('id', b.id);
    setBusy(false);
    if (err) {
      console.error(err);
      // the database repeats the India checks, so show a clear message if it refuses
      const m = err.message ?? '';
      setError(m.includes('location_outside_india') ? t('geo.outsideIndia') : m.includes('invalid_pincode') ? t('addr.err.pin_unknown') : t('err.generic'));
      return;
    }
    set('state', stateName);
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
        <Field id="pin" label={t('ed.pincode')} value={f.pincode} disabled={d}
          onChange={(v) => {
            const pin = v.replace(/\D/g, '').slice(0, 6);
            set('pincode', pin);
            if (!f.state.trim()) { const s = stateFromPincode(pin); if (s) set('state', s); }   // fill state when the PIN has only one possible state
          }} />

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
