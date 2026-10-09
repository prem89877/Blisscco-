import { useEffect, useState } from 'react';
import { Msg, Section } from './ui';
import { useI18n } from '../i18n';
import { isValidUpi, normalizeUpi } from '../lib/upi';
import { supabase } from '../lib/supabase';

/** Shop owner adds / changes the UPI ID where Blisscco pays them after the promotional balance is fully used. */
export default function UpiIdCard() {
  const { t } = useI18n();
  const [saved, setSaved] = useState<string | null>(null);
  const [value, setValue] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');

  useEffect(() => {
    void (async () => {
      const { data, error } = await supabase.rpc('get_my_upi_id');
      if (error) { console.error(error); setErr(t('err.generic')); }
      else { const v = (data as string | null) ?? null; setSaved(v); setValue(v ?? ''); }
      setLoaded(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save() {
    if (busy) return;
    setErr(''); setOk('');
    if (!isValidUpi(value)) { setErr(t('upi.invalid')); return; }
    setBusy(true);
    const { data, error } = await supabase.rpc('set_my_upi_id', { p_upi: normalizeUpi(value) });
    setBusy(false);
    if (error) { console.error(error); setErr(error.message.includes('invalid_upi') ? t('upi.invalid') : t('err.generic')); return; }
    const v = data as string;
    setSaved(v); setValue(v); setOk(t('upi.saved'));
  }

  async function remove() {
    if (busy || !saved || !window.confirm(t('upi.removeConfirm'))) return;
    setErr(''); setOk(''); setBusy(true);
    const { error } = await supabase.rpc('remove_my_upi_id');
    setBusy(false);
    if (error) { console.error(error); setErr(t('err.generic')); return; }
    setSaved(null); setValue(''); setOk(t('upi.removed'));
  }

  return (
    <Section title={t('upi.title')}>
      <p className="text-sm text-ink/80">{t('upi.note')}</p>
      {!loaded && !err && <div className="h-12 animate-pulse rounded-2xl bg-ink/10" />}
      {loaded && (
        <>
          <div className="space-y-1.5">
            <label htmlFor="upi-id" className="text-sm font-medium">{t('upi.label')}</label>
            <input
              id="upi-id" type="text" inputMode="email" autoComplete="off" autoCapitalize="none" spellCheck={false}
              placeholder="name@okhdfcbank" maxLength={100} value={value} disabled={busy}
              onChange={(e) => { setValue(e.target.value); setOk(''); }} className="input"
            />
          </div>
          <Msg error={err} ok={ok} />
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-primary" disabled={busy || !value.trim() || normalizeUpi(value) === saved} onClick={() => void save()}>
              {saved ? t('upi.update') : t('upi.save')}
            </button>
            {saved && <button type="button" className="btn-secondary" disabled={busy} onClick={() => void remove()}>{t('upi.remove')}</button>}
          </div>
          <p className="text-xs text-ink/60">{t('upi.privacy')}</p>
        </>
      )}
    </Section>
  );
}
