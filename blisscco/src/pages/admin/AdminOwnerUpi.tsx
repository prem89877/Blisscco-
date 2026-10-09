import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Msg, Section } from '../../components/ui';
import { useI18n } from '../../i18n';
import { fmtDateTime, rupees } from '../../lib/format';
import { supabase } from '../../lib/supabase';

interface R {
  owner_id: string; full_name: string | null; email: string; phone: string | null; shops: string | null;
  upi_id: string | null; balance: number | string; total_earned: number | string; upi_updated_at: string | null;
}

/** Admin: shop owners' UPI IDs next to their promotional balance, so you can pay them once the credit is used up. */
export default function AdminOwnerUpi() {
  const { t, lang } = useI18n();
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<R[] | null>(null);
  const [err, setErr] = useState('');
  const [copied, setCopied] = useState('');

  const load = useCallback(async (search: string) => {
    setErr('');
    const { data, error } = await supabase.rpc('admin_list_owner_upi', { p_search: search || null, p_limit: 100, p_offset: 0 });
    if (error) { console.error(error); setErr(error.message); return; }
    setRows((data ?? []) as R[]);
  }, []);
  useEffect(() => { void load(''); }, [load]);

  async function copy(v: string) {
    try { await navigator.clipboard.writeText(v); setCopied(v); setTimeout(() => setCopied(''), 2000); } catch { /* clipboard blocked */ }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 py-6">
      <Link to="/admin" className="text-sm btn-text">← {t('dash.admin')}</Link>
      <h1 className="font-display text-2xl font-semibold">{t('upi.adminTitle')}</h1>
      <p className="text-sm text-ink/70">{t('upi.adminNote')}</p>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void load(q); }}>
        <input className="input" type="search" placeholder={t('upi.adminSearch')} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t('upi.adminSearch')} />
        <button className="btn-secondary" type="submit">{t('upi.adminGo')}</button>
      </form>
      <Msg error={err} />
      <Section title={t('upi.adminList')}>
        {rows === null && !err && <div className="h-16 animate-pulse rounded-2xl bg-ink/10" />}
        {rows?.length === 0 && <p className="text-sm text-ink/70">{t('upi.adminEmpty')}</p>}
        <ul className="space-y-3">
          {rows?.map((r) => {
            const bal = Number(r.balance); const earned = Number(r.total_earned);
            const used = earned > 0 && bal <= 0;
            return (
              <li key={r.owner_id} className="space-y-2 rounded-xl border border-ink/10 p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{r.full_name ?? r.email}</span>
                  {used && <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-900">{t('upi.adminUsed')}</span>}
                </div>
                <p className="break-all text-xs text-ink/70">{r.email}{r.phone ? ` · ${r.phone}` : ''}{r.shops ? ` · ${r.shops}` : ''}</p>
                <p>{t('upi.adminBalance')}: <b>{rupees(bal)}</b> <span className="text-xs text-ink/60">({t('upi.adminEarned')}: {rupees(earned)})</span></p>
                {r.upi_id ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-xl bg-cream px-3 py-2 font-mono text-sm font-semibold">{r.upi_id}</span>
                    <button type="button" className="btn-secondary" onClick={() => void copy(r.upi_id!)}>{copied === r.upi_id ? t('sc.copied') : t('sc.copy')}</button>
                    {r.upi_updated_at && <span className="text-xs text-ink/60">{fmtDateTime(r.upi_updated_at, lang)}</span>}
                  </div>
                ) : <p className="text-xs text-ink/60">{t('upi.adminNoUpi')}</p>}
              </li>
            );
          })}
        </ul>
      </Section>
    </div>
  );
}
