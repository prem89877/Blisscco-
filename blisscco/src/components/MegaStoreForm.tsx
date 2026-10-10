import { useState, type FormEvent } from 'react';
import Field from './Field';
import { Msg } from './ui';
import { useI18n } from '../i18n';
import { megaErrKey, type MegaStore } from '../lib/megaStore';
import { supabase } from '../lib/supabase';

/** Mega Store profile: used for the first registration (business type "Mega Store") and for later edits. Admin approval follows. */
export default function MegaStoreForm({ store, onDone }: { store: MegaStore | null; onDone: () => void }) {
  const { t } = useI18n();
  const [name, setName] = useState(store?.name ?? '');
  const [description, setDescription] = useState(store?.description ?? '');
  const [phone, setPhone] = useState(store?.phone ?? '');
  const [city, setCity] = useState(store?.city ?? '');
  const [address, setAddress] = useState(store?.address_line ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(''); setOk('');
    if (name.trim().length < 2) return setError(t('mg.err.invalid_name'));
    setBusy(true);
    const args = { p_name: name.trim(), p_description: description.trim() || null, p_phone: phone.trim() || null, p_city: city.trim() || null, p_address: address.trim() || null };
    const { error: err } = await supabase.rpc(store ? 'megastore_update' : 'megastore_create', args);
    setBusy(false);
    if (err) { setError(t(megaErrKey(err.message))); return; }
    setOk(t('mg.saved'));
    onDone();
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <Field id="ms-name" label={t('mg.f.name')} value={name} onChange={setName} disabled={busy || store?.status === 'approved'} />
      <div className="space-y-1.5">
        <label htmlFor="ms-desc" className="text-sm font-medium">{t('mg.f.desc')}</label>
        <textarea id="ms-desc" rows={3} maxLength={500} className="input" value={description} disabled={busy} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <Field id="ms-phone" label={t('mg.f.phone')} value={phone} onChange={setPhone} disabled={busy} autoComplete="tel" />
      <Field id="ms-city" label={t('mg.f.city')} value={city} onChange={setCity} disabled={busy} />
      <Field id="ms-address" label={t('mg.f.address')} value={address} onChange={setAddress} disabled={busy} />
      <Msg error={error} ok={ok} />
      <button type="submit" className="btn-confirm" disabled={busy}>{busy ? t('common.loading') : store ? t('mg.save') : t('mg.create.btn')}</button>
    </form>
  );
}
