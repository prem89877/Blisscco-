import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Msg } from '../components/ui';
import { useI18n } from '../i18n';
import { bookingErrKey } from '../lib/bookingErrors';
import { fmtDateTime, rupees } from '../lib/format';
import { supabase } from '../lib/supabase';
import type { Booking } from '../lib/types';

const ACTIVE = ['pending', 'confirmed', 'checked_in', 'in_service'];

export default function MyBookings() {
  const { t, lang } = useI18n();
  const [rows, setRows] = useState<Booking[] | null>(null);
  const [errKey, setErrKey] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('bookings').select('*').order('created_at', { ascending: false }).limit(50);
    if (error) { console.error(error); setErrKey('err.generic'); return; }
    setRows((data ?? []) as Booking[]);
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function cancel(id: string) {
    if (busyId) return;
    setBusyId(id); setErrKey('');
    const { error } = await supabase.rpc('set_booking_status', { p_booking_id: id, p_new: 'cancelled' });
    setBusyId(null);
    if (error) setErrKey(bookingErrKey(error.message));
    await load();
  }

  const card = (b: Booking) => (
    <li key={b.id} className="card space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div>
          <Link to={`/b/${b.business_id}`} className="font-semibold underline">{b.business_name}</Link>
          <p className="text-sm">{b.service_label} · {rupees(b.price_inr)}</p>
        </div>
        <span className="rounded-full bg-ink/10 px-3 py-1 text-xs font-semibold">{t(`bs.${b.status}`)}</span>
      </div>
      <p className="text-sm">{b.type === 'walkin' ? `${t('bk.walkin')} · ${t('my.token', { n: b.token_number ?? 0 })}` : fmtDateTime(b.start_at ?? b.created_at, lang)}</p>
      {ACTIVE.includes(b.status) && <p className="text-xs text-ink/70">{t('my.payAtShop')}</p>}
      {['pending', 'confirmed', 'checked_in'].includes(b.status) && (
        <button className="btn-secondary" disabled={busyId === b.id} onClick={() => void cancel(b.id)}>{t('my.cancel')}</button>
      )}
    </li>
  );

  const active = rows?.filter((b) => ACTIVE.includes(b.status)) ?? [];
  const past = rows?.filter((b) => !ACTIVE.includes(b.status)) ?? [];
  return (
    <section className="mx-auto max-w-2xl space-y-4 px-4 py-6">
      <h1 className="font-display text-2xl font-semibold">{t('my.title')}</h1>
      <Msg error={errKey ? t(errKey) : ''} />
      {rows === null && !errKey && <div className="h-24 animate-pulse rounded-2xl bg-ink/10" />}
      {rows?.length === 0 && <p className="text-ink/70">{t('my.empty')}</p>}
      {active.length > 0 && <><h2 className="font-semibold">{t('my.active')}</h2><ul className="space-y-3">{active.map(card)}</ul></>}
      {past.length > 0 && <><h2 className="font-semibold">{t('my.past')}</h2><ul className="space-y-3">{past.map(card)}</ul></>}
    </section>
  );
}
