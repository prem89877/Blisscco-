import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import DisputeButton from '../components/DisputeButton';
import ReviewForm from '../components/ReviewForm';
import { Msg } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../i18n';
import { bookingErrKey } from '../lib/bookingErrors';
import { fmtDate, fmtDateTime, fmtTime, rupees } from '../lib/format';
import { readCache, useOnline, writeCache } from '../lib/offlineCache';
import { enablePush, pushSupport } from '../lib/push';
import { supabase } from '../lib/supabase';
import type { Booking, QueuePosition } from '../lib/types';

const ACTIVE = ['pending', 'confirmed', 'checked_in', 'in_service'];
interface BookingsCache { rows: Booking[]; reviewed: string[] }

export default function MyBookings() {
  const { t, lang } = useI18n();
  const { session } = useAuth();
  const [rows, setRows] = useState<Booking[] | null>(null);
  const [reviewed, setReviewed] = useState<Set<string>>(new Set());
  const [openReview, setOpenReview] = useState<string | null>(null);
  const [errKey, setErrKey] = useState('');
  const [note, setNote] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [positions, setPositions] = useState<Record<string, QueuePosition>>({});   // walk-in booking id -> live position
  const uid = session?.user.id;
  const online = useOnline();
  const [savedAt, setSavedAt] = useState<number | null>(null);   // set while we are showing the copy saved on this device
  const showSaved = !online || savedAt !== null;

  const load = useCallback(async () => {
    if (!uid) return;
    const [b, r] = await Promise.all([
      supabase.from('bookings').select('*').eq('customer_id', uid).order('created_at', { ascending: false }).limit(50),
      supabase.from('reviews').select('booking_id').eq('customer_id', uid),
    ]);
    if (b.error) {
      // no connection: keep showing the copy saved on this device (live data needs internet)
      const c = readCache<BookingsCache>(uid, 'my-bookings');
      if (c) { setRows(c.data.rows); setReviewed(new Set(c.data.reviewed)); setSavedAt(c.savedAt); setErrKey(''); return; }
      console.error(b.error); setErrKey('err.generic'); return;
    }
    const list = (b.data ?? []) as Booking[];
    const done = ((r.data ?? []) as { booking_id: string }[]).map((x) => x.booking_id);
    setRows(list);
    setReviewed(new Set(done));
    setSavedAt(null);
    writeCache(uid, 'my-bookings', { rows: list, reviewed: done } satisfies BookingsCache);
  }, [uid]);
  // show the saved copy immediately (also while offline); the fresh data replaces it as soon as it arrives
  useEffect(() => {
    if (!uid) return;
    const c = readCache<BookingsCache>(uid, 'my-bookings');
    if (c) { setRows((cur) => cur ?? c.data.rows); setReviewed((cur) => (cur.size ? cur : new Set(c.data.reviewed))); }
  }, [uid]);
  useEffect(() => { void load(); const iv = setInterval(() => void load(), 30000); return () => clearInterval(iv); }, [load]);

  // Live queue position: computed by the database from the tokens ahead of mine (nothing is set by hand).
  const hasLiveWalkin = rows?.some((b) => b.type === 'walkin' && ACTIVE.includes(b.status)) ?? false;
  const loadPositions = useCallback(async () => {
    if (!uid) return;
    const { data, error } = await supabase.rpc('get_my_queue_positions');
    if (error) {   // offline: last saved positions stay on screen, marked as saved
      const c = readCache<QueuePosition[]>(uid, 'my-positions');
      if (c) { setPositions(Object.fromEntries(c.data.map((p) => [p.id, p]))); setSavedAt((cur) => cur ?? c.savedAt); }
      return;
    }
    const list = (data ?? []) as QueuePosition[];
    setPositions(Object.fromEntries(list.map((p) => [p.id, p])));
    writeCache(uid, 'my-positions', list);
  }, [uid]);
  useEffect(() => {
    if (!hasLiveWalkin) { setPositions({}); return; }
    void loadPositions();
    const iv = setInterval(() => { if (document.visibilityState === 'visible' && navigator.onLine) void loadPositions(); }, 5000);
    return () => clearInterval(iv);
  }, [hasLiveWalkin, loadPositions]);
  // back online: fetch fresh data right away
  useEffect(() => { if (online) { void load(); void loadPositions(); } }, [online, load, loadPositions]);
  // Instant update when the shop starts / skips / completes MY token (realtime; the 5 s refresh above covers the rest).
  useEffect(() => {
    if (!uid) return;
    const ch = supabase.channel(`my-bookings-${uid}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings', filter: `customer_id=eq.${uid}` }, () => { void load(); void loadPositions(); })
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [uid, load, loadPositions]);

  async function cancel(id: string) {
    if (busyId || !navigator.onLine) return;
    setBusyId(id); setErrKey(''); setNote('');
    const { error } = await supabase.rpc('set_booking_status', { p_booking_id: id, p_new: 'cancelled' });
    setBusyId(null);
    if (error) setErrKey(bookingErrKey(error.message));
    await load();
  }

  /** "Get notified": make sure this phone can receive push (asks permission once), then switch the reminder on. E-mail always works. */
  async function setReminder(id: string, on: boolean) {
    if (busyId || !navigator.onLine) return;
    setBusyId(id); setErrKey(''); setNote('');
    let pushMsg = '';
    if (on && pushSupport() === 'ok') {
      const res = await enablePush();
      if (res === 'denied') pushMsg = t('my.notifyPushDenied');
      else if (res === 'error') pushMsg = t('my.notifyPushError');
    } else if (on && pushSupport() === 'needs_install') {
      pushMsg = t('my.notifyInstall');
    }
    const { error } = await supabase.rpc('set_booking_reminder', { p_booking_id: id, p_on: on });
    setBusyId(null);
    if (error) { setErrKey(bookingErrKey(error.message)); return; }
    if (on) setNote(pushMsg || t('my.notifyOn'));
    await load();
  }

  const card = (b: Booking) => {
    const isAppt = b.type === 'appointment';
    const waitingForTime = isAppt && b.start_at === null && ACTIVE.includes(b.status);
    const expired = isAppt && b.status === 'cancelled' && b.cancelled_by === 'system';   // shop did not answer within 1 hour
    const pos = !isAppt && ACTIVE.includes(b.status) ? positions[b.id] : undefined;
    const canNotify = isAppt && b.start_at !== null && ['pending', 'confirmed'].includes(b.status) && new Date(b.start_at) > new Date();
    return (
      <li key={b.id} className="card space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <Link to={`/b/${b.business_id}`} className="font-semibold btn-text">{b.business_name}</Link>
            <p className="text-sm">{b.service_label} · {rupees(b.price_inr)}</p>
          </div>
          <span className="rounded-full bg-ink/10 px-3 py-1 text-xs font-semibold">{t(expired ? 'bs.expired' : waitingForTime ? 'bs.awaiting_time' : `bs.${b.status}`)}</span>
        </div>
        <p className="text-sm">
          {!isAppt
            ? `${t('bk.walkin')} · ${t('my.token', { n: b.token_number ?? 0 })}`
            : b.start_at
              ? fmtDateTime(b.start_at, lang)
              : `${b.requested_date ? fmtDate(b.requested_date, lang) : ''}${waitingForTime ? ` · ${t('my.timePending')}` : ''}`}
        </p>
        {pos && (
          <div role="status" aria-live="polite" className="rounded-xl bg-cream p-3">
            <p className="text-lg font-semibold">
              {pos.status === 'in_service' ? t('q.yourTurn') : t('q.youAre', { n: pos.position ?? 1 })}
            </p>
            {pos.status !== 'in_service' && pos.position === 1 && <p className="text-sm font-medium text-green-800">{t('q.upNext')}</p>}
            <p className="text-sm text-ink/80">{pos.serving_token === null ? t('q.noOneServing') : t('q.nowServing', { n: pos.serving_token })}</p>
            <p className="text-xs text-ink/70">{showSaved ? t('off.queueSaved') : t('q.live')}</p>
          </div>
        )}
        {waitingForTime && <p className="text-xs text-ink/70">{t('my.timePendingHelp')}</p>}
        {expired && (
          <>
            <p className="text-sm text-ink/80">{t('my.expiredHelp')}</p>
            <div className="flex flex-wrap gap-2">
              <Link to="/explore" className="btn-primary !w-auto px-5">{t('my.visitOtherShops')}</Link>
              <Link to={`/b/${b.business_id}`} className="btn-secondary !w-auto px-5">{t('my.viewShop')}</Link>
            </div>
          </>
        )}
        {ACTIVE.includes(b.status) && <p className="text-xs text-ink/70">{t('my.payAtShop')}</p>}

        {canNotify && (b.remind_me
          ? (
            <div className="flex flex-wrap items-center gap-2">
              <span role="status" className="text-sm font-medium text-green-800">✓ {t('my.notifyIsOn')}</span>
              <button className="btn-text-muted" disabled={busyId === b.id || showSaved} onClick={() => void setReminder(b.id, false)}>{t('my.notifyOff')}</button>
            </div>
          )
          : <button className="btn-confirm" disabled={busyId === b.id || showSaved} onClick={() => void setReminder(b.id, true)}>🔔 {t('my.getNotified')}</button>)}

        {['pending', 'confirmed', 'checked_in'].includes(b.status) && (
          <button className="btn-secondary" disabled={busyId === b.id || showSaved} onClick={() => void cancel(b.id)}>{t('my.cancel')}</button>
        )}
        {(reviewed.has(b.id)
          ? <p className="text-sm text-green-800">{t('rv.reviewed')}</p>
          : showSaved ? null
          : openReview === b.id
            ? <ReviewForm bookingId={b.id} onDone={load} />
            : <button className="btn-secondary" onClick={() => setOpenReview(b.id)}>{t('rv.write')}</button>)}
        {!showSaved && ['completed', 'cancelled', 'no_show'].includes(b.status) && <DisputeButton bookingId={b.id} />}
      </li>
    );
  };

  const active = rows?.filter((b) => ACTIVE.includes(b.status)) ?? [];
  const past = rows?.filter((b) => !ACTIVE.includes(b.status)) ?? [];
  return (
    <section className="mx-auto max-w-2xl space-y-4 px-4 py-6">
      <h1 className="font-display text-2xl font-semibold">{t('my.title')}</h1>
      {showSaved && rows !== null && (
        <p role="status" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
          {t('off.saved', { time: savedAt ? fmtTime(new Date(savedAt).toISOString(), lang) : '' })} {t('off.needOnline')}
        </p>
      )}
      <Msg error={errKey ? t(errKey) : ''} ok={note} />
      {rows === null && !errKey && <div className="h-24 animate-pulse rounded-2xl bg-ink/10" />}
      {rows?.length === 0 && <p className="text-ink/70">{t('my.empty')}</p>}
      {active.length > 0 && <><h2 className="font-semibold">{t('my.active')}</h2><ul className="space-y-3">{active.map(card)}</ul></>}
      {past.length > 0 && <><h2 className="font-semibold">{t('my.past')}</h2><ul className="space-y-3">{past.map(card)}</ul></>}
    </section>
  );
}
