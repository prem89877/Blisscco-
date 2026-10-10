import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Msg, Section } from '../../components/ui';
import { useI18n } from '../../i18n';
import { fmtDate, rupees } from '../../lib/format';
import { istDayOf, megaErrKey, type AdminMegaStore } from '../../lib/megaStore';
import { supabase } from '../../lib/supabase';

export default function AdminMegaStores() {
  const { t, lang } = useI18n();
  const [rows, setRows] = useState<AdminMegaStore[] | null>(null);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [code, setCode] = useState('');

  const load = useCallback(async () => {
    const { data, error: e } = await supabase.rpc('admin_list_megastores');
    if (e) { console.error(e); setError(t('err.generic')); setRows([]); return; }
    setRows((data ?? []) as AdminMegaStore[]);
  }, [t]);
  useEffect(() => { void load(); }, [load]);

  async function setStatus(id: string, status: 'approved' | 'rejected' | 'suspended') {
    if (busyId) return;
    setBusyId(id); setError(''); setOk('');
    const { error: e } = await supabase.rpc('admin_megastore_set_status', { p_id: id, p_status: status, p_reason: reasons[id]?.trim() || null });
    setBusyId(null);
    if (e) setError(t(megaErrKey(e.message)));
    await load();
  }

  async function revoke() {
    const c = code.trim().toUpperCase();
    if (!c) return;
    setError(''); setOk('');
    const { error: e } = await supabase.rpc('admin_megastore_revoke_reward', { p_code: c, p_note: null });
    if (e) { setError(t(megaErrKey(e.message))); return; }
    setOk(t('mg.ad.revoked')); setCode('');
  }

  return (
    <section className="mx-auto max-w-2xl space-y-4 px-4 py-6">
      <Link to="/admin" className="text-sm btn-text">{t('mg.back')}</Link>
      <h1 className="font-display text-2xl font-semibold">{t('mg.ad.title')}</h1>
      <p className="rounded-xl bg-ink/5 p-3 text-sm">{t('mg.ad.fundNote')}</p>
      <Msg error={error} ok={ok} />
      {rows === null && <div className="h-24 animate-pulse rounded-2xl bg-ink/10" />}
      {rows?.length === 0 && <p className="text-ink/70">{t('mg.ad.none')}</p>}
      {rows?.map((m) => (
        <article key={m.id} className="card space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h2 className="font-semibold">{m.name}</h2>
              <p className="text-sm text-ink/70">{[m.city, `${t('mg.ad.owner')}: ${m.owner_name || '—'}`, m.owner_email].filter(Boolean).join(' · ')}</p>
            </div>
            <span className="inline-block rounded-full bg-ink/10 px-3 py-1 text-xs font-semibold">{t(`mg.status.${m.status}`)}</span>
          </div>
          {m.campaign_title && (
            <p className="text-sm">{t('mg.ad.campaign')}: {m.campaign_title}{m.campaign_status ? ` (${t(`mg.camp.status.${m.campaign_status}`)})` : ''}{m.campaign_ends_at ? ` · ${fmtDate(istDayOf(m.campaign_ends_at), lang)}` : ''}</p>
          )}
          <p className="text-xs text-ink/70">{t('mg.ad.stats', { shops: m.shops, enrolled: m.enrolled, issued: m.issued, redeemed: m.redeemed, disc: rupees(m.discount_given_inr) })}</p>
          {m.status !== 'approved' && m.status !== 'suspended' && (
            <input className="input" placeholder={t('mg.ad.reason')} aria-label={t('mg.ad.reason')} maxLength={300} value={reasons[m.id] ?? ''}
              onChange={(e) => setReasons((x) => ({ ...x, [m.id]: e.target.value }))} />
          )}
          <div className="flex flex-wrap gap-2">
            {m.status !== 'approved' && <button type="button" className="btn-solid" disabled={busyId === m.id} onClick={() => void setStatus(m.id, 'approved')}>{t('mg.ad.approve')}</button>}
            {m.status === 'pending_review' && <button type="button" className="btn-secondary" disabled={busyId === m.id} onClick={() => void setStatus(m.id, 'rejected')}>{t('mg.ad.reject')}</button>}
            {m.status === 'approved' && <button type="button" className="btn-secondary" disabled={busyId === m.id} onClick={() => void setStatus(m.id, 'suspended')}>{t('mg.ad.suspend')}</button>}
          </div>
        </article>
      ))}
      <Section title={t('mg.ad.revokeTitle')}>
        <p className="text-sm text-ink/80">{t('mg.ad.revokeHint')}</p>
        <div className="flex gap-2">
          <input aria-label={t('mg.redeem.code')} placeholder="MS-XXXXXXXX" className="input flex-1 font-mono uppercase" value={code} maxLength={16} onChange={(e) => setCode(e.target.value)} />
          <button type="button" className="btn-secondary" disabled={!code.trim()} onClick={() => void revoke()}>{t('mg.ad.revokeBtn')}</button>
        </div>
      </Section>
    </section>
  );
}
