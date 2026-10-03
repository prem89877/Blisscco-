import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Msg, Section } from '../../components/ui';
import { fmtDateTime } from '../../lib/format';
import { useI18n } from '../../i18n';
import { supabase } from '../../lib/supabase';

interface L { id: string; action: string; entity_type: string; details: Record<string, unknown>; created_at: string; profiles: { full_name: string | null } | null }

export default function AdminAudit() {
  const { lang } = useI18n();
  const [rows, setRows] = useState<L[] | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    void (async () => {
      const { data, error } = await supabase.from('admin_audit_logs')
        .select('id,action,entity_type,details,created_at,profiles(full_name)').order('created_at', { ascending: false }).limit(100);
      if (error) { console.error(error); setErr(error.message); return; }
      setRows((data ?? []) as unknown as L[]);
    })();
  }, []);
  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 py-6">
      <Link to="/admin" className="text-sm btn-text">← Admin</Link>
      <h1 className="font-display text-2xl font-semibold">Audit log</h1>
      <Msg error={err} />
      <Section title="Last 100 admin actions">
        {rows === null && !err && <div className="h-16 animate-pulse rounded-2xl bg-ink/10" />}
        <ul className="divide-y divide-ink/10 text-xs">
          {rows?.map((l) => (
            <li key={l.id} className="space-y-0.5 py-2">
              <p><b>{l.action}</b> · {l.entity_type} · {l.profiles?.full_name ?? 'admin'} · {fmtDateTime(l.created_at, lang)}</p>
              <p className="break-words text-ink/70">{JSON.stringify(l.details)}</p>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
