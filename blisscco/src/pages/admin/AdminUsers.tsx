import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Msg, Section } from '../../components/ui';
import { fmtDateTime } from '../../lib/format';
import { useI18n } from '../../i18n';
import { supabase } from '../../lib/supabase';

interface U { id: string; email: string; full_name: string | null; role: string; is_suspended: boolean; created_at: string }

export default function AdminUsers() {
  const { lang } = useI18n();
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<U[] | null>(null);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async (search: string) => {
    setErr('');
    const { data, error } = await supabase.rpc('admin_list_users', { p_search: search || null, p_limit: 50, p_offset: 0 });
    if (error) { console.error(error); setErr(error.message); return; }
    setRows((data ?? []) as U[]);
  }, []);
  useEffect(() => { void load(''); }, [load]);

  async function toggle(u: U) {
    if (busy) return;
    const suspend = !u.is_suspended;
    const reason = window.prompt(suspend
      ? `Reason for suspending ${u.email}?${u.role === 'owner' ? '\nTheir approved shops will also be suspended.' : ''}`
      : `Reason for un-suspending ${u.email}?`);
    if (!reason || reason.trim().length < 3) return;
    setBusy(u.id); setErr(''); setOk('');
    const { error } = await supabase.rpc('admin_set_user_suspended', { p_user_id: u.id, p_suspend: suspend, p_reason: reason });
    setBusy(null);
    if (error) { setErr(error.message); return; }
    setOk(suspend ? 'User suspended.' : 'User un-suspended. If this was an owner, reactivate their shops from Applications.');
    await load(q);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 py-6">
      <Link to="/admin" className="text-sm btn-text">← Admin</Link>
      <h1 className="font-display text-2xl font-semibold">Users</h1>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void load(q); }}>
        <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search email or name" aria-label="Search users" />
        <button className="btn-secondary" type="submit">Search</button>
      </form>
      <Msg error={err} ok={ok} />
      <Section title="Accounts">
        {rows === null && !err && <div className="h-16 animate-pulse rounded-2xl bg-ink/10" />}
        {rows?.length === 0 && <p className="text-ink/70">No users found.</p>}
        <ul className="divide-y divide-ink/10 text-sm">
          {rows?.map((u) => (
            <li key={u.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>
                <b>{u.full_name || '—'}</b> · {u.role}{u.is_suspended ? ' · SUSPENDED' : ''}<br />
                <span className="text-ink/70">{u.email} · {fmtDateTime(u.created_at, lang)}</span>
              </span>
              {u.role !== 'admin' && (
                <button className="btn-secondary" disabled={busy === u.id} onClick={() => void toggle(u)}>{u.is_suspended ? 'Un-suspend' : 'Suspend'}</button>
              )}
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
