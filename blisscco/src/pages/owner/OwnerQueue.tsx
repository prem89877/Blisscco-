import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import Field from '../../components/Field';
import Skeleton from '../../components/Skeleton';
import { Check, Msg, Section, Select } from '../../components/ui';
import { useI18n } from '../../i18n';
import { bookingErrKey } from '../../lib/bookingErrors';
import { fmtDateTime, fmtTime, istDayStartIso, istToday, rupees } from '../../lib/format';
import { supabase } from '../../lib/supabase';
import type { Booking, BookingSettings, BookingStatus, Service } from '../../lib/types';

type Action = { label: string; to: BookingStatus };

function actionsFor(b: Booking): Action[] {
  const apptStarted = b.type === 'walkin' || (b.start_at !== null && new Date(b.start_at) <= new Date());
  const noShow: Action[] = apptStarted ? [{ label: 'act.noShow', to: 'no_show' }] : [];
  const cancel: Action = { label: 'act.cancel', to: 'cancelled' };
  switch (b.status) {
    case 'pending': return [{ label: 'act.confirm', to: 'confirmed' }, cancel];
    case 'confirmed': return [{ label: 'act.checkIn', to: 'checked_in' }, { label: 'act.start', to: 'in_service' }, ...noShow, cancel];
    case 'checked_in': return [{ label: 'act.start', to: 'in_service' }, ...noShow, cancel];
    case 'in_service': return [{ label: 'act.complete', to: 'completed' }];
    default: return [];
  }
}

export default function OwnerQueue() {
  const { id } = useParams();
  const { t, lang } = useI18n();
  const [name, setName] = useState('');
  const [st, setSt] = useState<BookingSettings | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [missing, setMissing] = useState(false);
  const [errKey, setErrKey] = useState('');
  const [ok, setOk] = useState('');
  const [busy, setBusy] = useState(false);
  const [ctl, setCtl] = useState({ queue_status: 'open', est: '', unavailable: false });
  const [cfg, setCfg] = useState({ slot: '30', capacity: '1', days: '14', appt: true, walkin: true });
  const [issue, setIssue] = useState({ service: '', guest: '' });

  const load = useCallback(async (initial = false) => {
    if (!id) return;
    const today = istToday();
    const [b, s, sv, bk] = await Promise.all([
      supabase.from('businesses').select('name').eq('id', id).maybeSingle(),
      supabase.from('business_booking_settings').select('*').eq('business_id', id).maybeSingle(),
      supabase.from('services').select('*').eq('business_id', id).eq('is_active', true).order('created_at'),
      supabase.from('bookings').select('*').eq('business_id', id)
        .or(`queue_date.eq.${today},start_at.gte.${istDayStartIso(today)}`).order('created_at').limit(300),
    ]);
    if (!b.data || !s.data) { setMissing(true); return; }
    const settings = s.data as BookingSettings;
    setName((b.data as { name: string }).name);
    setSt(settings);
    setServices((sv.data ?? []) as Service[]);
    setBookings((bk.data ?? []) as Booking[]);
    if (initial) {
      setCtl({ queue_status: settings.queue_status, est: settings.est_wait_minutes === null ? '' : String(settings.est_wait_minutes), unavailable: settings.temporarily_unavailable });
      setCfg({ slot: String(settings.slot_minutes), capacity: String(settings.capacity), days: String(settings.max_days_ahead), appt: settings.appointments_enabled, walkin: settings.walkin_enabled });
      setIssue((p) => ({ ...p, service: p.service || ((sv.data ?? []) as Service[])[0]?.id || '' }));
    }
  }, [id]);

  useEffect(() => { void load(true); const iv = setInterval(() => void load(), 20000); return () => clearInterval(iv); }, [load]);

  async function saveSettings(patch: Record<string, unknown>) {
    if (busy || !id) return;
    setBusy(true); setErrKey(''); setOk('');
    const { error } = await supabase.from('business_booking_settings').update(patch).eq('business_id', id);
    setBusy(false);
    if (error) { console.error(error); setErrKey('err.generic'); return; }
    setOk(t('common.saved'));
    await load();
  }

  function saveControls(e: FormEvent) {
    e.preventDefault();
    const est = ctl.est.trim() === '' ? null : Number(ctl.est);
    if (est !== null && (!Number.isInteger(est) || est < 0 || est > 600)) { setErrKey('oq.invalid'); return; }
    void saveSettings({ queue_status: ctl.queue_status, est_wait_minutes: est, temporarily_unavailable: ctl.unavailable });
  }

  function saveCfg(e: FormEvent) {
    e.preventDefault();
    const slot = Number(cfg.slot), cap = Number(cfg.capacity), days = Number(cfg.days);
    if (![slot, cap, days].every(Number.isInteger) || slot < 10 || slot > 240 || cap < 1 || cap > 50 || days < 1 || days > 60) { setErrKey('oq.invalid'); return; }
    void saveSettings({ slot_minutes: slot, capacity: cap, max_days_ahead: days, appointments_enabled: cfg.appt, walkin_enabled: cfg.walkin });
  }

  async function setStatus(bid: string, to: BookingStatus) {
    if (busy) return;
    setBusy(true); setErrKey('');
    const { error } = await supabase.rpc('set_booking_status', { p_booking_id: bid, p_new: to });
    setBusy(false);
    if (error) setErrKey(bookingErrKey(error.message));
    await load();
  }

  async function issueToken() {
    if (busy || !issue.service) return;
    setBusy(true); setErrKey('');
    const { error } = await supabase.rpc('owner_issue_token', { p_service_id: issue.service, p_guest_name: issue.guest || null });
    setBusy(false);
    if (error) setErrKey(bookingErrKey(error.message)); else setIssue((p) => ({ ...p, guest: '' }));
    await load();
  }

  if (missing) return <p role="alert" className="p-6 text-center">{t('owner.notFound')}</p>;
  if (!st) return <Skeleton />;

  const today = istToday();
  const tokens = bookings.filter((b) => b.type === 'walkin' && b.queue_date === today).sort((a, b) => (a.token_number ?? 0) - (b.token_number ?? 0));
  const appts = bookings.filter((b) => b.type === 'appointment').sort((a, b) => (a.start_at ?? '').localeCompare(b.start_at ?? ''));
  const waiting = tokens.filter((b) => b.status === 'confirmed' || b.status === 'checked_in');
  const serving = tokens.filter((b) => b.status === 'in_service');

  const row = (b: Booking) => (
    <li key={b.id} className="space-y-2 py-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-medium">{b.type === 'walkin' ? `#${b.token_number}` : fmtDateTime(b.start_at ?? b.created_at, lang)} · {b.customer_name || b.guest_name || '—'}</p>
          <p className="text-sm text-ink/70">{b.service_label} · {rupees(b.price_inr)}</p>
        </div>
        <span className="rounded-full bg-ink/10 px-3 py-1 text-xs font-semibold">{t(`bs.${b.status}`)}</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {actionsFor(b).map((a) => <button key={a.to} className="btn-secondary" disabled={busy} onClick={() => void setStatus(b.id, a.to)}>{t(a.label)}</button>)}
      </div>
    </li>
  );

  const stat = (label: string, v: string | number) => (
    <div className="rounded-xl bg-cream p-3 text-center"><p className="text-xs text-ink/70">{label}</p><p className="text-lg font-semibold">{v}</p></div>
  );

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-6">
      <Link to="/owner" className="text-sm underline">← {t('owner.title')}</Link>
      <div className="flex items-center justify-between gap-2">
        <h1 className="font-display text-2xl font-semibold">{t('oq.title')} · {name}</h1>
        <button className="btn-secondary" onClick={() => void load()}>{t('oq.refresh')}</button>
      </div>
      <Msg error={errKey ? t(errKey) : ''} ok={ok} />

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {stat(t('q.waiting'), waiting.length)}
        {stat(t('q.serving'), serving[0]?.token_number ?? '—')}
        {stat(t('q.next'), waiting[0]?.token_number ?? '—')}
        {stat(t('q.wait'), st.est_wait_minutes === null ? '—' : t('q.minutes', { n: st.est_wait_minutes }))}
      </div>
      <p className="text-xs text-ink/70">{t('q.updated', { time: fmtTime(st.queue_updated_at, lang) })} · {t('oq.auto')}</p>

      <Section title={t('oq.controls')}>
        <form onSubmit={saveControls} className="space-y-3" noValidate>
          <Select id="qs" label={t('oq.queueStatus')} value={ctl.queue_status} onChange={(v) => setCtl({ ...ctl, queue_status: v })}
            options={['open', 'paused', 'closed'].map((v) => ({ value: v, label: t(`q.status.${v}`) }))} />
          <Field id="est" label={t('oq.estWait')} value={ctl.est} onChange={(v) => setCtl({ ...ctl, est: v })} disabled={busy} />
          <Check id="un" label={t('oq.unavailable')} checked={ctl.unavailable} onChange={(v) => setCtl({ ...ctl, unavailable: v })} disabled={busy} />
          <button type="submit" className="btn-primary w-full" disabled={busy}>{t('common.save')}</button>
        </form>
      </Section>

      <Section title={t('oq.issue')}>
        <Select id="is" label={t('bk.chooseService')} value={issue.service} onChange={(v) => setIssue({ ...issue, service: v })}
          options={services.map((s) => ({ value: s.id, label: `${s.name || s.service_category} · ${rupees(s.price_inr)}` }))} />
        <Field id="gn" label={t('oq.guest')} value={issue.guest} onChange={(v) => setIssue({ ...issue, guest: v })} disabled={busy} />
        <button className="btn-primary w-full" disabled={busy || !issue.service} onClick={() => void issueToken()}>{t('oq.issue')}</button>
      </Section>

      <Section title={t('oq.today')}>
        {tokens.length === 0 ? <p className="text-sm text-ink/70">{t('oq.empty')}</p> : <ul className="divide-y divide-ink/10">{tokens.map(row)}</ul>}
      </Section>

      <Section title={t('oq.appointments')}>
        {appts.length === 0 ? <p className="text-sm text-ink/70">{t('oq.empty')}</p> : <ul className="divide-y divide-ink/10">{appts.map(row)}</ul>}
      </Section>

      <Section title={t('oq.settings')}>
        <form onSubmit={saveCfg} className="space-y-3" noValidate>
          <Field id="sl" label={t('oq.slot')} value={cfg.slot} onChange={(v) => setCfg({ ...cfg, slot: v })} disabled={busy} />
          <Field id="cp" label={t('oq.capacity')} value={cfg.capacity} onChange={(v) => setCfg({ ...cfg, capacity: v })} disabled={busy} />
          <Field id="dy" label={t('oq.daysAhead')} value={cfg.days} onChange={(v) => setCfg({ ...cfg, days: v })} disabled={busy} />
          <Check id="ap" label={t('oq.apptOn')} checked={cfg.appt} onChange={(v) => setCfg({ ...cfg, appt: v })} disabled={busy} />
          <Check id="wk" label={t('oq.walkinOn')} checked={cfg.walkin} onChange={(v) => setCfg({ ...cfg, walkin: v })} disabled={busy} />
          <button type="submit" className="btn-primary w-full" disabled={busy}>{t('common.save')}</button>
        </form>
      </Section>
    </div>
  );
}
