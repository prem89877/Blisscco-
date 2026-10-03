import { useState } from 'react';
import { Msg, TextArea } from './ui';
import { StarInput } from './Stars';
import { useI18n } from '../i18n';
import { supabase } from '../lib/supabase';

const KNOWN = ['not_completed', 'already_reviewed', 'already_reviewed_shop', 'own_business', 'invalid_rating', 'not_found'];

// Pass bookingId to review a booking, or businessId to review a shop directly (no booking needed).
export default function ReviewForm({ bookingId, businessId, onDone }: { bookingId?: string; businessId?: string; onDone: () => Promise<void> }) {
  const { t } = useI18n();
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [errKey, setErrKey] = useState('');
  const [done, setDone] = useState(false);

  async function submit() {
    if (busy) return;
    if (rating < 1) { setErrKey('rv.err.invalid_rating'); return; }
    setBusy(true); setErrKey('');
    const { error } = bookingId
      ? await supabase.rpc('submit_review', { p_booking_id: bookingId, p_rating: rating, p_comment: comment || null })
      : await supabase.rpc('submit_shop_review', { p_business_id: businessId, p_rating: rating, p_comment: comment || null });
    setBusy(false);
    if (error) { setErrKey(KNOWN.includes(error.message) ? `rv.err.${error.message}` : 'err.generic'); return; }
    setDone(true);
    await onDone();
  }

  if (done) return <p role="status" className="text-sm font-medium text-green-800">{t('rv.thanks')}</p>;
  return (
    <div className="space-y-3 rounded-xl bg-cream p-3">
      <p className="text-sm font-medium">{t('rv.rating')}</p>
      <StarInput value={rating} onChange={setRating} />
      <TextArea id={`rv-${bookingId ?? businessId}`} label={t('rv.comment')} value={comment} onChange={setComment} disabled={busy} />
      <Msg error={errKey ? t(errKey) : ''} />
      <button className="btn-primary w-full" disabled={busy} onClick={() => void submit()}>{busy ? t('common.loading') : t('rv.submit')}</button>
    </div>
  );
}
