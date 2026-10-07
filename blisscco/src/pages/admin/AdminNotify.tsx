import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Msg, Section } from '../../components/ui';
import { supabase } from '../../lib/supabase';

type Target = 'owners' | 'customers' | 'owner' | 'customer';
interface U { id: string; email: string; full_name: string | null; role: string; is_suspended: boolean }

const TARGETS: { value: Target; label: string }[] = [
  { value: 'owners', label: 'All owners' },
  { value: 'customers', label: 'All customers' },
  { value: 'owner', label: 'One owner' },
  { value: 'customer', label: 'One customer' },
];

const TITLE_MAX = 60;
const BODY_MAX = 300;

export default function AdminNotify() {
  const [target, setTarget] = useState<Target>('owners');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [q, setQ] = useState('');
  const [found, setFound] = useState<U[] | null>(null);
  const [picked, setPicked] = useState<U | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');

  const single = target === 'owner' || target === 'customer';
  const wantedRole = target === 'owner' ? 'owner' : 'customer';

  function changeTarget(t: Target) {
    setTarget(t); setPicked(null); setFound(null); setQ(''); setErr(''); setOk('');
  }

  async function search() {
    setErr(''); setOk('');
    const { data, error } = await supabase.rpc('admin_list_users', { p_search: q.trim() || null, p_limit: 50, p_offset: 0 });
    if (error) { console.error(error); setErr(error.message); return; }
    setFound(((data ?? []) as U[]).filter((u) => u.role === wantedRole && !u.is_suspended));
  }

  async function send() {
    if (busy) return;
    setErr(''); setOk('');
    if (title.trim().length < 2) { setErr('Write a title (at least 2 letters).'); return; }
    if (body.trim().length < 2) { setErr('Write the message.'); return; }
    if (single && !picked) { setErr(`Pick the ${wantedRole} first (search by name, e-mail or phone).`); return; }

    const who = single ? `${picked?.full_name || picked?.email}` : TARGETS.find((x) => x.value === target)?.label.toLowerCase();
    if (!window.confirm(`Send this notification to ${who}? It cannot be taken back.`)) return;

    setBusy(true);
    const { data, error } = await supabase.rpc('admin_send_notification', {
      p_target: target, p_user_id: single ? picked?.id : null, p_title: title.trim(), p_body: body.trim(),
    });
    setBusy(false);
    if (error) {
      console.error(error);
      const m = error.message;
      setErr(m.includes('user_not_found') ? 'That user was not found (or is suspended).'
        : m.includes('title_length') ? `Title must be 2 to ${TITLE_MAX} characters.`
        : m.includes('body_length') ? `Message must be 2 to ${BODY_MAX} characters.`
        : m);
      return;
    }
    const r = (data ?? {}) as { recipients?: number; push_queued?: number };
    setOk(`Sent to ${r.recipients ?? 0} ${r.recipients === 1 ? 'person' : 'people'}. Push is going out to ${r.push_queued ?? 0} of them; the rest (push off or no device) will see it inside the app under Notifications.`);
    setTitle(''); setBody(''); setPicked(null); setFound(null); setQ('');
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-6">
      <Link to="/admin" className="text-sm btn-text">← Admin</Link>
      <h1 className="font-display text-2xl font-semibold">Send notification</h1>
      <p className="text-sm text-ink/70">Goes to the phone as an app (push) notification and in the in-app Notifications list. No e-mail is sent.</p>

      <Section title="Who gets it?">
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Recipients">
          {TARGETS.map((x) => (
            <button key={x.value} type="button" role="radio" aria-checked={target === x.value}
              onClick={() => changeTarget(x.value)}
              className={`min-h-[44px] rounded-2xl border px-3 py-2 text-sm font-medium ${target === x.value ? 'border-blush bg-blush/20' : 'border-ink/15'}`}>
              {x.label}
            </button>
          ))}
        </div>

        {single && (
          <div className="space-y-2">
            {picked ? (
              <div className="flex items-center justify-between gap-2 rounded-2xl bg-ink/5 px-3 py-2 text-sm">
                <span><b>{picked.full_name || '—'}</b><br /><span className="text-ink/70">{picked.email}</span></span>
                <button type="button" className="btn-secondary" onClick={() => setPicked(null)}>Change</button>
              </div>
            ) : (
              <>
                <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void search(); }}>
                  <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${wantedRole} by name, e-mail or phone`} aria-label={`Search ${wantedRole}`} />
                  <button className="btn-secondary" type="submit">Search</button>
                </form>
                {found?.length === 0 && <p className="text-sm text-ink/70">No active {wantedRole} found.</p>}
                <ul className="divide-y divide-ink/10 text-sm">
                  {found?.map((u) => (
                    <li key={u.id}>
                      <button type="button" className="block w-full py-2 text-left" onClick={() => setPicked(u)}>
                        <b>{u.full_name || '—'}</b><br /><span className="text-ink/70">{u.email}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
      </Section>

      <Section title="Message">
        <div className="space-y-1.5">
          <label htmlFor="n-title" className="text-sm font-medium">Title</label>
          <input id="n-title" className="input" maxLength={TITLE_MAX} value={title} onChange={(e) => setTitle(e.target.value)} disabled={busy} />
          <p className="text-xs text-ink/60">{title.length}/{TITLE_MAX}</p>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="n-body" className="text-sm font-medium">Message</label>
          <textarea id="n-body" rows={5} className="input" maxLength={BODY_MAX} value={body} onChange={(e) => setBody(e.target.value)} disabled={busy} />
          <p className="text-xs text-ink/60">{body.length}/{BODY_MAX}</p>
        </div>
        <Msg error={err} ok={ok} />
        <button type="button" className="btn-secondary w-full" disabled={busy} onClick={() => void send()}>
          {busy ? 'Sending…' : 'Send notification'}
        </button>
      </Section>
    </div>
  );
}
