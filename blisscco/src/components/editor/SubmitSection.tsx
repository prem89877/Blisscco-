import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Msg, Section } from '../ui';
import { useI18n } from '../../i18n';
import { supabase } from '../../lib/supabase';
import type { Loaded } from '../../lib/types';
import { addressErrorKey, checkIndiaCoords, coordErrorKey, validateAddress, type AddressError } from '../../lib/india';

export default function SubmitSection({ data, reload }: { data: Loaded; reload: () => Promise<void> }) {
  const { t } = useI18n();
  const b = data.business;
  const [terms, setTerms] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');

  useEffect(() => {
    void supabase.from('terms_versions').select('body_md').eq('is_current', true).maybeSingle()
      .then(({ data: d }) => setTerms((d as { body_md: string } | null)?.body_md ?? ''));
  }, []);

  const addr = validateAddress({ address_line: b.address_line ?? '', city: b.city ?? '', state: b.state ?? '', pincode: b.pincode ?? '' }, true);
  const addrOk = !addr.errors.some((e: AddressError) => !e.startsWith('pin'));
  const pinOk = !addr.errors.some((e: AddressError) => e.startsWith('pin'));
  const geo = checkIndiaCoords(b.latitude, b.longitude);
  // only explain the "wrong" cases here; a plain missing value is already shown by the checklist
  const hints: string[] = [];
  if (b.pincode && !pinOk) hints.push(t(addressErrorKey(addr.errors.find((e) => e.startsWith('pin')) as AddressError)));
  if (b.latitude !== null && b.longitude !== null && !geo.ok) hints.push(t(coordErrorKey(geo.reason)));

  const checks: [string, boolean][] = [
    ['ck.category', !!b.category_id],
    ['ck.description', !!b.description?.trim()],
    ['ck.contact', !!b.phone && !!b.email],
    ['ck.address', addrOk],
    ['ck.pincode', pinOk],
    ['ck.location', geo.ok],
    ['ck.photos', data.images.length >= 3],
    ['ck.hours', data.hours.some((h) => !h.is_closed)],
    ['ck.service', data.services.some((s) => s.is_active)],
    ['ck.terms', accepted],
  ];
  const ready = checks.every(([, v]) => v);

  async function submit() {
    if (busy || !ready) return;
    setBusy(true); setError(''); setOk('');
    const a = await supabase.rpc('accept_business_terms', { p_business_id: b.id });
    const s = a.error ? a : await supabase.rpc('submit_business_application', { p_business_id: b.id });
    setBusy(false);
    if (s.error) { console.error(s.error); setError(s.error.message || t('err.generic')); return; }
    setOk(t('ed.submitted'));
    await reload();
  }

  return (
    <Section title={t('ed.submitTitle')}>
      <p className="text-sm font-medium">{t('ck.title')}</p>
      <ul className="space-y-1 text-sm">
        {checks.map(([k, v]) => <li key={k} className={v ? 'text-green-800' : 'text-ink/60'}>{v ? '✓' : '○'} {t(k)}</li>)}
      </ul>
      {hints.map((h) => <p key={h} role="alert" className="text-sm text-red-700">{h}</p>)}
      <h3 className="text-sm font-medium">{t('ed.terms')}</h3>
      <div className="max-h-40 overflow-y-auto rounded-xl bg-cream p-3 text-sm whitespace-pre-wrap">{terms}</div>
      <p className="text-xs text-ink/60">
        <Link to="/terms" target="_blank" className="link-text">{t('footer.terms')}</Link>{' · '}
        <Link to="/privacy" target="_blank" className="link-text">{t('footer.privacy')}</Link>
      </p>
      <Check id="terms" label={t('ed.acceptTerms')} checked={accepted} onChange={setAccepted} disabled={busy} />
      <Msg error={error} ok={ok} />
      <button className="btn-primary w-full" disabled={!ready || busy} onClick={() => void submit()}>{busy ? t('common.loading') : t('ed.submit')}</button>
    </Section>
  );
}
