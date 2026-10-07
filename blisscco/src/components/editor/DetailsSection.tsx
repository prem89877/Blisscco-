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

type Part = 'all' | 'basic' | 'contact';

/** part: which fields to show (the wizard shows 'basic' then 'contact'; all values stay in one form state).
 *  live: the shop is approved/hidden, so only description / phone / e-mail can be changed (name, category, address, location are locked). */
export default function DetailsSection({ data, editable, reload, part = 'all', live = false, onSaved }: {
  data: Loaded; editable: boolean; reload: () => Promise<void>; part?: Part; live?: boolean; onSaved?: () => void;
}) {
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
    if (live) {
      if (phone && !/^\+?[0-9]{10,13}$/.test(phone)) return setError(t('ed.invalidPhone'));
      if (f.email.trim() && !isEmail(f.email)) return setError(t('err.invalidEmail'));
      setBusy(true);
      const { error: lerr } = await supabase.rpc('owner_update_live_details', {
        p_business_id: b.id, p_description: f.description, p_phone: phone, p_email: f.email,
        p_show_phone: f.show_phone_publicly, p_show_email: f.show_email_publicly,
      });
      setBusy(false);
      if (lerr) { console.error(lerr); setError(t('err.generic')); return; }
      setOk(t('common.saved'));
      await reload();
      onSaved?.();
      return;
    }
    // Every box of the step must be filled before "Save & next" moves on.
    const needBasic = part === 'all' || part === 'basic';
    const needContact = part === 'all' || part === 'contact';
    const missing: string[] = [];
    if (needBasic) {
      if (f.name.trim().length < 2) missing.push(t('ed.name'));
      if (!f.category_id) missing.push(t('ed.category'));
      if (!f.description.trim()) missing.push(t('ed.description'));
    } else if (f.name.trim().length < 2) return setError(t('err.nameRequired'));
    if (needContact) {
      if (!phone) missing.push(t('ed.phone'));
      if (!f.email.trim()) missing.push(t('ed.email'));
      if (!f.address_line.trim()) missing.push(t('ed.address'));
      if (!f.city.trim()) missing.push(t('ed.city'));
      if (!f.state.trim()) missing.push(t('ed.state'));
      if (!f.pincode.trim()) missing.push(t('ed.pincode'));
      if (lat === null || lng === null) missing.push(t('ed.location'));
    }
    if (missing.length) return setError(t('ed.required', { field: missing.join(', ') }));
    if (phone && !/^\+?[0-9]{10,13}$/.test(phone)) return setError(t('ed.invalidPhone'));
    if (f.email.trim() && !isEmail(f.email)) return setError(t('err.invalidEmail'));
    const addr = validateAddress(f, needContact);   // contact step: everything required; state must match the PIN code
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
    onSaved?.();
  }

  const d = !editable || busy;
  const lockedD = d || live;                 // name / category / address / location are locked on a live shop
  const showBasic = part === 'all' || part === 'basic';
  const showContact = part === 'all' || part === 'contact';
  const canSave = editable || live;
  return (
    <Section title={part === 'basic' ? t('step.basic') : part === 'contact' ? t('step.contact') : t('ed.details')}>
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {live && <p className="rounded-xl bg-cream p-3 text-sm">{t('ed.liveNote')}</p>}
        {showBasic && <>
          <Field id="name" label={t('ed.name')} value={f.name} onChange={(v) => set('name', v)} disabled={lockedD} />
          <Select id="cat" label={t('ed.category')} value={f.category_id} onChange={(v) => set('category_id', v)} disabled={lockedD}
            placeholder={t('common.select')} options={data.categories.map((c) => ({ value: c.id, label: catName(c, lang) }))} />
          <TextArea id="desc" label={t('ed.description')} value={f.description} onChange={(v) => set('description', v)} disabled={d} />
        </>}
        {showContact && <>
          <Field id="phone" label={t('ed.phone')} autoComplete="tel" value={f.phone} onChange={(v) => set('phone', v)} disabled={d} />
          <Check id="sp" label={t('ed.showPhone')} checked={f.show_phone_publicly} onChange={(v) => set('show_phone_publicly', v)} disabled={d} />
          <Field id="bemail" label={t('ed.email')} type="email" value={f.email} onChange={(v) => set('email', v)} disabled={d} />
          <Check id="se" label={t('ed.showEmail')} checked={f.show_email_publicly} onChange={(v) => set('show_email_publicly', v)} disabled={d} />
          <Field id="addr" label={t('ed.address')} value={f.address_line} onChange={(v) => set('address_line', v)} disabled={lockedD} />
          <div className="grid grid-cols-2 gap-3">
            <Field id="city" label={t('ed.city')} value={f.city} onChange={(v) => set('city', v)} disabled={lockedD} />
            <Field id="state" label={t('ed.state')} value={f.state} onChange={(v) => set('state', v)} disabled={lockedD} />
          </div>
          <Field id="pin" label={t('ed.pincode')} value={f.pincode} disabled={lockedD}
            onChange={(v) => {
              const pin = v.replace(/\D/g, '').slice(0, 6);
              set('pincode', pin);
              if (!f.state.trim()) { const s = stateFromPincode(pin); if (s) set('state', s); }   // fill state when the PIN has only one possible state
            }} />

          <div className="space-y-2 rounded-xl bg-cream p-3">
            <p className="text-sm font-medium">{t('ed.location')}</p>
            {!live && <p className="text-sm text-ink/70">{t('ed.gpsWhy')}</p>}
            <p className="text-sm">{lat !== null && lng !== null ? t('ed.gpsSet', { lat, lng }) : t('ed.noLocation')}</p>
            {editable && !live && <button type="button" className="btn-secondary" onClick={useGps}>{t('ed.useGps')}</button>}
            <Msg error={gpsMsg} />
          </div>
        </>}

        <Msg error={error} ok={ok} />
        {canSave && <button type="submit" className="btn-solid w-full" disabled={busy}>{busy ? t('common.loading') : onSaved && !live ? t('step.saveNext') : t('common.save')}</button>}
      </form>
    </Section>
  );
}
