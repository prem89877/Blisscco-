import { useCallback, useEffect, useState } from 'react';
import { Msg, Section, TextArea } from '../../components/ui';
import { useI18n } from '../../i18n';
import { catName } from '../../lib/format';
import { supabase } from '../../lib/supabase';
import type { Category, ChangeRequest } from '../../lib/types';

interface Row extends ChangeRequest { businesses: { name: string; description: string | null; category_id: string | null } | null }

/** Admin: pending name / category / description change requests of live shops. Renders nothing when there are none. */
export default function ProfileChangeReview() {
  const { t, lang } = useI18n();
  const [rows, setRows] = useState<Row[]>([]);
  const [cats, setCats] = useState<Category[]>([]);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const [r, c] = await Promise.all([
      supabase.from('business_change_requests').select('*, businesses(name, description, category_id)').eq('status', 'pending').order('created_at'),
      supabase.from('business_categories').select('*'),
    ]);
    if (r.error) { console.error(r.error); return; }
    setRows((r.data ?? []) as unknown as Row[]);
    setCats((c.data ?? []) as Category[]);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const cat = (id: string | null) => { const c = cats.find((x) => x.id === id); return c ? catName(c, lang) : '—'; };

  async function act(r: Row, approve: boolean) {
    if (busyId) return;
    setError('');
    const reason = (reasons[r.id] ?? '').trim();
    if (!approve && !reason) return setError(t('admin.reasonRequired'));
    setBusyId(r.id);
    const { error: e } = await supabase.rpc('admin_review_profile_change', { p_request_id: r.id, p_approve: approve, p_reason: reason || null });
    setBusyId(null);
    if (e) { console.error(e); setError(e.message || t('err.generic')); return; }
    await load();
  }

  if (rows.length === 0) return null;
  return (
    <Section title={`${t('pc.adminTitle')} (${rows.length})`}>
      <Msg error={error} />
      {rows.map((r) => (
        <div key={r.id} className="space-y-3 rounded-xl border border-ink/10 p-3 text-sm">
          <div className="space-y-1">
            <p className="font-semibold">{t('pc.current')}</p>
            <p>{r.businesses?.name} · {cat(r.businesses?.category_id ?? null)}</p>
            <p className="text-ink/70">{r.businesses?.description}</p>
          </div>
          <div className="space-y-1">
            <p className="font-semibold">{t('pc.requested')}</p>
            <p>{r.name} · {cat(r.category_id)}</p>
            <p className="text-ink/70">{r.description}</p>
          </div>
          <TextArea id={`pcr-${r.id}`} label={t('admin.reason')} value={reasons[r.id] ?? ''} onChange={(v) => setReasons((p) => ({ ...p, [r.id]: v }))} disabled={busyId === r.id} />
          <div className="flex flex-wrap gap-2">
            <button className="btn-primary" disabled={busyId === r.id} onClick={() => void act(r, true)}>{t('admin.approve')}</button>
            <button className="btn-secondary" disabled={busyId === r.id} onClick={() => void act(r, false)}>{t('admin.reject')}</button>
          </div>
        </div>
      ))}
    </Section>
  );
}
