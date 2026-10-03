import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Msg, Section } from '../../components/ui';
import { addDays, istToday, rupees } from '../../lib/format';
import { supabase } from '../../lib/supabase';

interface Report {
  from: string; to: string; gross_paise: number; refunds_paise: number; payments_count: number; free_grants: number;
  by_plan: { plan_code: string; payments: number; gross_paise: number; refunds_paise: number }[];
  by_day: { day: string; gross_paise: number; refunds_paise: number }[];
}
const inr = (paise: number) => rupees(paise / 100);

export default function AdminReports() {
  const [to, setTo] = useState(istToday());
  const [from, setFrom] = useState(addDays(istToday(), -29));
  const [r, setR] = useState<Report | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function run(f = from, t = to) {
    setBusy(true); setErr('');
    const { data, error } = await supabase.rpc('admin_earnings_report', { p_from: f, p_to: t });
    setBusy(false);
    if (error) { setErr(error.message === 'invalid_range' ? 'Pick a valid range (max 366 days).' : error.message); return; }
    setR(data as Report);
  }
  useEffect(() => { void run(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const net = r ? r.gross_paise - r.refunds_paise : 0;
  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 py-6">
      <Link to="/admin" className="text-sm btn-text">← Admin</Link>
      <h1 className="font-display text-2xl font-semibold">Blisscco earnings</h1>
      <p className="text-sm text-ink/70">Only Blisscco&apos;s own income: blue badge and banner payments received through Razorpay, minus refunds. Shop bookings and prices are never counted.</p>
      <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); void run(); }}>
        <div className="space-y-1.5"><label htmlFor="rp-from" className="text-sm font-medium">From</label><input id="rp-from" type="date" className="input" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></div>
        <div className="space-y-1.5"><label htmlFor="rp-to" className="text-sm font-medium">To</label><input id="rp-to" type="date" className="input" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></div>
        <button className="btn-solid" type="submit" disabled={busy}>Show</button>
      </form>
      <Msg error={err} />
      {!r && !err && <div className="h-24 animate-pulse rounded-2xl bg-ink/10" />}
      {r && (
        <>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="card"><p className="text-xs text-ink/70">Received</p><p className="text-lg font-semibold">{inr(r.gross_paise)}</p></div>
            <div className="card"><p className="text-xs text-ink/70">Refunded</p><p className="text-lg font-semibold">{inr(r.refunds_paise)}</p></div>
            <div className="card"><p className="text-xs text-ink/70">Net earnings</p><p className="text-lg font-semibold">{inr(net)}</p></div>
          </div>
          <p className="text-xs text-ink/70">{r.payments_count} paid orders · {r.free_grants} free plans given by admin (not counted). Razorpay fees and GST are not deducted; see your Razorpay settlement report.</p>
          <Section title="By product">
            {r.by_plan.length === 0 && <p className="text-ink/70">No payments in this range.</p>}
            <ul className="divide-y divide-ink/10 text-sm">
              {r.by_plan.map((p) => <li key={p.plan_code} className="flex justify-between gap-2 py-2"><span>{p.plan_code} · {p.payments} orders</span><span>{inr(p.gross_paise - p.refunds_paise)}</span></li>)}
            </ul>
          </Section>
          <Section title="By day">
            <ul className="divide-y divide-ink/10 text-sm">
              {[...r.by_day].reverse().map((d) => <li key={d.day} className="flex justify-between gap-2 py-1.5"><span>{d.day}</span><span>{inr(d.gross_paise - d.refunds_paise)}</span></li>)}
            </ul>
          </Section>
        </>
      )}
    </div>
  );
}
