import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Msg, Section } from '../../components/ui';
import { fmtDateTime, rupees } from '../../lib/format';
import { useI18n } from '../../i18n';
import { supabase } from '../../lib/supabase';

interface C { id: string; code: string; discount_type: 'percent' | 'flat'; discount_value: number; status: string; expires_at: string; created_at: string; source: string }

export default function AdminPromotions() {
  const { lang } = useI18n();
  const [rows, setRows] = useState<C[] | null>(null);
  const [filter, setFilter] = useState<'active' | 'redeemed' | 'revoked'>('active');
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('coupons')
      .select('id,code,discount_type,discount_value,status,expires_at,created_at,source').eq('status', filter).order('created_at', { ascending: false }).limit(60);
    if (error) { console.error(error); setErr(error.message); return; }
    setRows((data ?? []) as C[]);
  }, [filter]);
  useEffect(() => { setRows(null); void load(); }, [load]);

  async function revoke(c: C) {
    if (busy) return;
    const reason = window.prompt(`Revoke coupon ${c.code}? Reason:`);
    if (!reason || reason.trim().length < 3) return;
    setBusy(true); setErr(''); setOk('');
    const { error } = await supabase.rpc('admin_revoke_coupon', { p_coupon_id: c.id, p_reason: reason });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setOk('Coupon revoked.'); await load();
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 py-6">
      <Link to="/admin" className="text-sm btn-text">← Admin</Link>
      <h1 className="font-display text-2xl font-semibold">Promotions</h1>
      <div className="flex flex-wrap gap-3 text-sm">
        <Link to="/admin/referrals" className="btn-text">Referral campaign & rewards</Link>
        <Link to="/admin/banners" className="btn-text">Banners</Link>
      </div>
      <Msg error={err} ok={ok} />
      <Section title="Coupons">
        <div className="flex gap-2" role="tablist">
          {(['active', 'redeemed', 'revoked'] as const).map((f) => (
            <button key={f} role="tab" aria-selected={filter === f} className={filter === f ? 'btn-solid' : 'btn-secondary'} onClick={() => setFilter(f)}>{f}</button>
          ))}
        </div>
        {rows === null && !err && <div className="h-16 animate-pulse rounded-2xl bg-ink/10" />}
        {rows?.length === 0 && <p className="text-ink/70">No {filter} coupons.</p>}
        <ul className="divide-y divide-ink/10 text-sm">
          {rows?.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>
                <b>{c.code}</b> · {c.discount_type === 'percent' ? `${c.discount_value}%` : rupees(c.discount_value)} · {c.source}<br />
                <span className="text-ink/70">expires {fmtDateTime(c.expires_at, lang)}</span>
              </span>
              {c.status === 'active' && <button className="btn-secondary" disabled={busy} onClick={() => void revoke(c)}>Revoke</button>}
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
