import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Msg, Section, Select } from './ui';
import QueueCard from './QueueCard';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../i18n';
import { bookingErrKey, RETURN_KEY } from '../lib/bookingErrors';
import { addDays, dowOf, fmtDate, istToday, rupees } from '../lib/format';
import { trackBooking } from '../lib/analytics';
import { supabase } from '../lib/supabase';
import type { Hour, QueueInfo, Service } from '../lib/types';

interface Slot { slot_time: string; remaining: number }
type Done = { kind: 'token'; n: number } | { kind: 'appt' } | null;

export default function BookingPanel({ businessId, services, hours }: { businessId: string; services: Service[]; hours: Hour[] }) {
  const { t, lang } = useI18n();
  const { session } = useAuth();
  const loc = useLocation();
  const [info, setInfo] = useState<QueueInfo | null | undefined>(undefined);
  const [tab, setTab] = useState<'appointment' | 'walkin'>('appointment');
  const [serviceId, setServiceId] = useState('');
  const [date, setDate] = useState('');
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [time, setTime] = useState('');
  const [busy, setBusy] = useState(false);
  const [errKey, setErrKey] = useState('');
  const [done, setDone] = useState<Done>(null);

  useEffect(() => {
    void supabase.rpc('get_queue_info', { p_business_id: businessId }).then(({ data }) => {
      const row = ((data ?? []) as QueueInfo[])[0];
      setInfo(row ?? null);
      if (row && !row.appointments_enabled && row.walkin_enabled) setTab('walkin');
    });
  }, [businessId]);

  useEffect(() => { if (!serviceId && services.length > 0) setServiceId(services[0].id); }, [services, serviceId]);

  const dates = useMemo(() => {
    if (!info) return [];
    const openDays = new Set(hours.filter((h) => !h.is_closed).map((h) => h.day_of_week));
    const today = istToday();
    return Array.from({ length: info.max_days_ahead + 1 }, (_, i) => addDays(today, i)).filter((d) => openDays.has(dowOf(d)));
  }, [info, hours]);

  useEffect(() => { if (!date && dates.length > 0) setDate(dates[0]); }, [dates, date]);

  useEffect(() => {
    if (!date) return;
    let alive = true;
    setSlots(null); setTime('');
    void supabase.rpc('get_available_slots', { p_business_id: businessId, p_date: date })
      .then(({ data }) => { if (alive) setSlots((data ?? []) as Slot[]); });
    return () => { alive = false; };
  }, [businessId, date]);

  if (info === undefined || services.length === 0) return null;
  if (info === null) return null;
  const apptOk = info.appointments_enabled && !info.temporarily_unavailable;
  const walkinOk = info.walkin_enabled && !info.temporarily_unavailable && info.queue_status === 'open';

  async function book() {
    if (busy) return;
    setBusy(true); setErrKey('');
    if (tab === 'appointment') {
      const { error } = await supabase.rpc('book_appointment', { p_service_id: serviceId, p_date: date, p_time: time });
      setBusy(false);
      if (error) { setErrKey(bookingErrKey(error.message)); return; }
      trackBooking(businessId);
      setDone({ kind: 'appt' });
    } else {
      const { data, error } = await supabase.rpc('book_walkin', { p_service_id: serviceId });
      setBusy(false);
      if (error) { setErrKey(bookingErrKey(error.message)); return; }
      trackBooking(businessId);
      setDone({ kind: 'token', n: (data as { token: number }).token });
    }
  }

  if (done) {
    return (
      <Section title={t('bk.done')}>
        <p role="status">{done.kind === 'token' ? t('bk.doneToken', { n: done.n }) : t('bk.doneAppt')}</p>
        <p className="text-sm text-ink/70">{t('my.payAtShop')}</p>
        <Link to="/my-bookings" className="btn-primary w-full">{t('bk.viewMy')}</Link>
      </Section>
    );
  }

  const canConfirm = tab === 'appointment' ? !!time : true;
  return (
    <Section title={t('bk.title')}>
      <p className="text-sm text-ink/70">{t('bk.free')}</p>
      {info.walkin_enabled && <QueueCard info={info} />}

      <Select id="svc" label={t('bk.chooseService')} value={serviceId} onChange={setServiceId}
        options={services.map((s) => ({ value: s.id, label: `${s.name || s.service_category} · ${rupees(s.price_inr)}` }))} />

      <div className="flex gap-2" role="tablist">
        {info.appointments_enabled && <button role="tab" aria-selected={tab === 'appointment'} className={tab === 'appointment' ? 'btn-primary flex-1' : 'btn-text-muted flex-1'} onClick={() => { setTab('appointment'); setErrKey(''); }}>{t('bk.appointment')}</button>}
        {info.walkin_enabled && <button role="tab" aria-selected={tab === 'walkin'} className={tab === 'walkin' ? 'btn-primary flex-1' : 'btn-text-muted flex-1'} onClick={() => { setTab('walkin'); setErrKey(''); }}>{t('bk.walkin')}</button>}
      </div>

      {tab === 'appointment' && (apptOk ? (
        <>
          <Select id="date" label={t('bk.chooseDate')} value={date} onChange={setDate} options={dates.map((d) => ({ value: d, label: fmtDate(d, lang) }))} />
          <p className="text-sm font-medium">{t('bk.chooseTime')}</p>
          {slots === null && <div className="h-12 animate-pulse rounded-xl bg-ink/10" />}
          {slots?.length === 0 && <p className="text-sm text-ink/70">{t('bk.noSlots')}</p>}
          <div className="grid grid-cols-4 gap-2">
            {slots?.map((s) => {
              const hhmm = s.slot_time.slice(0, 5);
              return (
                <button key={hhmm} disabled={s.remaining === 0} aria-pressed={time === hhmm} onClick={() => setTime(hhmm)}
                  className={`min-h-[44px] rounded-xl border text-sm font-medium disabled:opacity-40 ${time === hhmm ? 'border-blush bg-blush' : 'border-ink/20 bg-white'}`}>{hhmm}</button>
              );
            })}
          </div>
        </>
      ) : <Msg error={t('bk.err.not_available')} />)}

      {tab === 'walkin' && (walkinOk ? <p className="text-sm">{t('bk.tokenInfo')}</p> : <Msg error={t(info.queue_status === 'open' ? 'bk.err.not_available' : 'bk.err.queue_closed')} />)}

      <Msg error={errKey ? t(errKey) : ''} />
      {session ? (
        <button className="btn-primary w-full" disabled={busy || !canConfirm || (tab === 'appointment' ? !apptOk : !walkinOk)} onClick={() => void book()}>
          {busy ? t('common.loading') : tab === 'appointment' ? t('bk.confirm') : t('bk.getToken')}
        </button>
      ) : (
        <Link to="/login" className="btn-primary w-full" onClick={() => { try { sessionStorage.setItem(RETURN_KEY, loc.pathname); } catch { /* ignore */ } }}>{t('bk.loginToBook')}</Link>
      )}
    </Section>
  );
}
