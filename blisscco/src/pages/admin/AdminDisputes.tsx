import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Msg, Section } from '../../components/ui';
import { fmtDateTime, rupees } from '../../lib/format';
import { useI18n } from '../../i18n';
import { supabase } from '../../lib/supabase';

interface D {
  id: string; booking_id: string; raised_by_role: string; reason: string; created_at: string;
  bookings: { business_name: string; service_label: string; price_inr: number; status: string; customer_name: string | null; guest_name: string | null } | null;
}
type Target = 'completed' | 'cancelled' | 'no_show';
const TARGETS: Target[] = ['completed', 'cancelled', 'no_show'];

export default function AdminDisputes() {
  const { lang } = useI18n();
  const [rows, setRows] = useState<D[] | null>(null);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [busy, setBusy] = useState(false);
  const [directId, setDirectId] = useState('');

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('booking_disputes')
      .select('id,booking_id,raised_by_role,reason,created_at,bookings(business_name,service_label,price_inr,status,customer_name,guest_name)')
      .eq('status', 'open').order('created_at', { ascending: true }).limit(50);
    if (error) { console.error(error); setErr(error.message); return; }
    setRows((data ?? []) as unknown as D[]);
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function correct(bookingId: string, target: Target, disputeId: string | null) {
    if (busy) return;
    const reason = window.prompt(`Correct booking to "${target}". Reason (min 10 characters, saved in the audit log):`);
    if (!reason || reason.trim().length < 10) return;
    setBusy(true); setErr(''); setOk('');
    const { error } = await supabase.rpc('admin_correct_booking', { p_booking_id: bookingId, p_new: target, p_reason: reason, p_dispute_id: disputeId });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setOk('Booking corrected and logged.'); await load();
  }

  async function dismiss(id: string) {
    if (busy) return;
    const res = window.prompt('Why is this dispute dismissed? (shown in the audit log)');
    if (!res || res.trim().length < 3) return;
    setBusy(true); setErr(''); setOk('');
    const { error } = await supabase.rpc('admin_dismiss_dispute', { p_dispute_id: id, p_resolution: res });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setOk('Dispute dismissed.'); await load();
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 py-6">
      <Link to="/admin" className="text-sm btn-text">← Admin</Link>
      <h1 className="font-display text-2xl font-semibold">Booking disputes</h1>
      <Msg error={err} ok={ok} />
      <Section title="Open disputes">
        {rows === null && !err && <div className="h-16 animate-pulse rounded-2xl bg-ink/10" />}
        {rows?.length === 0 && <p className="text-ink/70">No open disputes.</p>}
        <ul className="space-y-4">
          {rows?.map((d) => (
            <li key={d.id} className="space-y-2 rounded-xl border border-ink/10 p-3 text-sm">
              <p><b>{d.bookings?.business_name ?? '—'}</b> · {d.bookings?.service_label} · {d.bookings ? rupees(d.bookings.price_inr) : ''} · now: <b>{d.bookings?.status}</b></p>
              <p className="text-ink/70">Customer: {d.bookings?.customer_name || d.bookings?.guest_name || '—'} · raised by {d.raised_by_role} · {fmtDateTime(d.created_at, lang)}</p>
              <p>“{d.reason}”</p>
              <div className="flex flex-wrap gap-2">
                {TARGETS.filter((x) => x !== d.bookings?.status).map((x) => (
                  <button key={x} className="btn-secondary" disabled={busy} onClick={() => void correct(d.booking_id, x, d.id)}>Mark {x}</button>
                ))}
                <button className="btn-text-muted" disabled={busy} onClick={() => void dismiss(d.id)}>Dismiss</button>
              </div>
            </li>
          ))}
        </ul>
      </Section>
      <Section title="Correct a booking directly (no dispute)">
        <input className="input" value={directId} onChange={(e) => setDirectId(e.target.value.trim())} placeholder="Booking ID (uuid)" aria-label="Booking ID" />
        <div className="flex flex-wrap gap-2">
          {TARGETS.map((x) => (
            <button key={x} className="btn-secondary" disabled={busy || directId.length < 30} onClick={() => void correct(directId, x, null)}>Mark {x}</button>
          ))}
        </div>
        <p className="text-xs text-ink/70">Only final states are allowed (completed / cancelled / no_show). A correction never gives a referral reward.</p>
      </Section>
    </div>
  );
}
