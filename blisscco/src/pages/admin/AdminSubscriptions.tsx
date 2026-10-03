import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Msg, Section, Select } from '../../components/ui';
import { fmtDateTime } from '../../lib/format';
import { useI18n } from '../../i18n';
import { supabase } from '../../lib/supabase';

interface S { id: string; plan_code: string; status: string; source: string; starts_at: string; expires_at: string; businesses: { name: string } | null }
interface B { id: string; name: string; city: string | null }

export default function AdminSubscriptions() {
  const { lang } = useI18n();
  const [rows, setRows] = useState<S[] | null>(null);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [found, setFound] = useState<B[]>([]);
  const [bizId, setBizId] = useState('');
  const [plan, setPlan] = useState('pro');
  const [days, setDays] = useState('30');

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('subscriptions')
      .select('id,plan_code,status,source,starts_at,expires_at,businesses(name)').order('created_at', { ascending: false }).limit(60);
    if (error) { console.error(error); setErr(error.message); return; }
    setRows((data ?? []) as unknown as S[]);
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function search() {
    setErr('');
    const pat = `%${name.trim().replace(/[%_\\]/g, '')}%`;
    const { data, error } = await supabase.from('businesses').select('id,name,city').eq('status', 'approved').ilike('name', pat).limit(8);
    if (error) { setErr(error.message); return; }
    setFound((data ?? []) as B[]); setBizId((data?.[0] as B | undefined)?.id ?? '');
  }

  async function grant() {
    if (busy || !bizId) return;
    const reason = window.prompt('Why are you giving this for free? (saved in the audit log)');
    if (!reason || reason.trim().length < 3) return;
    setBusy(true); setErr(''); setOk('');
    const { error } = await supabase.rpc('admin_grant_subscription', { p_business_id: bizId, p_plan_code: plan, p_days: Number(days), p_reason: reason });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setOk('Free subscription added (not counted in earnings).'); await load();
  }

  async function cancel(s: S) {
    if (busy) return;
    const reason = window.prompt(`Cancel ${s.plan_code} for ${s.businesses?.name ?? 'this shop'}? Reason:${s.source === 'payment' ? '\nNote: this does NOT refund money. Refund from the Razorpay dashboard.' : ''}`);
    if (!reason || reason.trim().length < 3) return;
    setBusy(true); setErr(''); setOk('');
    const { error } = await supabase.rpc('admin_cancel_subscription', { p_subscription_id: s.id, p_reason: reason });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setOk('Subscription cancelled.'); await load();
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 py-6">
      <Link to="/admin" className="text-sm btn-text">← Admin</Link>
      <h1 className="font-display text-2xl font-semibold">Subscriptions</h1>
      <Msg error={err} ok={ok} />
      <Section title="Give a free plan / blue badge">
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void search(); }}>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Shop name" aria-label="Shop name" />
          <button className="btn-secondary" type="submit">Find</button>
        </form>
        {found.length > 0 && (
          <>
            <Select id="sb-biz" label="Shop" value={bizId} onChange={setBizId} options={found.map((b) => ({ value: b.id, label: `${b.name}${b.city ? ` (${b.city})` : ''}` }))} />
            <Select id="sb-plan" label="Product" value={plan} onChange={setPlan} options={[{ value: 'pro', label: 'PRO' }, { value: 'elite', label: 'ELITE' }, { value: 'blue_badge', label: 'Blue badge' }]} />
            <div className="space-y-1.5">
              <label htmlFor="sb-days" className="text-sm font-medium">Days (1–365)</label>
              <input id="sb-days" className="input" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value.replace(/\D/g, ''))} />
            </div>
            <button className="btn-solid" disabled={busy} onClick={() => void grant()}>Give for free</button>
          </>
        )}
      </Section>
      <Section title="Latest subscriptions">
        {rows === null && !err && <div className="h-16 animate-pulse rounded-2xl bg-ink/10" />}
        <ul className="divide-y divide-ink/10 text-sm">
          {rows?.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>
                <b>{s.businesses?.name ?? '—'}</b> · {s.plan_code} · {s.status}{s.source === 'admin_grant' ? ' · FREE' : ''}<br />
                <span className="text-ink/70">till {fmtDateTime(s.expires_at, lang)}</span>
              </span>
              {s.status === 'active' && <button className="btn-secondary" disabled={busy} onClick={() => void cancel(s)}>Cancel</button>}
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
