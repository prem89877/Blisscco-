import { useState } from 'react';
import { Msg, TextArea } from './ui';
import { useI18n } from '../i18n';
import { supabase } from '../lib/supabase';

const KNOWN = ['already_open', 'reason_required', 'too_old', 'not_finished'];

export default function DisputeButton({ bookingId }: { bookingId: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [errKey, setErrKey] = useState('');
  const [done, setDone] = useState(false);

  async function send() {
    if (busy) return;
    setBusy(true); setErrKey('');
    const { error } = await supabase.rpc('raise_booking_dispute', { p_booking_id: bookingId, p_reason: reason });
    setBusy(false);
    if (error) { setErrKey(KNOWN.includes(error.message) ? `p11.err.${error.message}` : 'err.generic'); return; }
    setDone(true);
  }

  if (done) return <p className="text-sm text-green-800">{t('p11.reportSent')}</p>;
  if (!open) return <button className="btn-text-muted" onClick={() => setOpen(true)}>{t('p11.report')}</button>;
  return (
    <div className="space-y-2">
      <TextArea id={`dp-${bookingId}`} label={t('p11.reportWhy')} value={reason} onChange={setReason} disabled={busy} />
      <Msg error={errKey ? t(errKey) : ''} />
      <button className="btn-secondary" disabled={busy} onClick={() => void send()}>{t('p11.reportSend')}</button>
    </div>
  );
}
