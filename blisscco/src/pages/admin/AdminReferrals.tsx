import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Field from '../../components/Field';
import { Check, Msg, Section, Select } from '../../components/ui';
import { useI18n } from '../../i18n';
import { fmtDateTime } from '../../lib/format';
import { supabase } from '../../lib/supabase';

interface Opt { id: string; discount_type: 'percent' | 'flat'; discount_value: number; max_discount_inr: number | null; min_spend_inr: number; weight: number; is_active: boolean }
interface Ref { id: string; status: string; code: string; created_at: string; email_verified: boolean; reject_reason: string | null }

export default function AdminReferrals() {
  const { t, lang } = useI18n();
  const [active, setActive] = useState(false);
  const [days, setDays] = useState('30');
  const [opts, setOpts] = useState<Opt[]>([]);
  const [refs, setRefs] = useState<Ref[]>([]);
  const [f, setF] = useState({ type: 'percent', value: '', max: '', min: '0', weight: '1' });
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState({ error: '', ok: '' });

  const load = useCallback(async () => {
    const [c, o, r] = await Promise.all([
      supabase.from('referral_config').select('*').eq('id', 1).maybeSingle(),
      supabase.from('referral_reward_options').select('*').order('created_at'),
      supabase.from('referrals').select('id,status,code,created_at,email_verified,reject_reason').order('created_at', { ascending: false }).limit(50),
    ]);
    const cfg = c.data as { is_active: boolean; coupon_valid_days: number } | null;
    if (cfg) { setActive(cfg.is_active); setDays(String(cfg.coupon_valid_days)); }
    setOpts((o.data ?? []) as Opt[]);
    setRefs((r.data ?? []) as Ref[]);
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function run(fn: () => PromiseLike<{ error: { message: string } | null }>) {
    if (busy) return;
    setBusy(true); setMsg({ error: '', ok: '' });
    const { error } = await fn();
    setBusy(false);
    if (error) { console.error(error); setMsg({ error: t(error.message === 'no_options' ? 'ad.err.no_options' : 'err.generic'), ok: '' }); }
    else setMsg({ error: '', ok: t('admin.done') });
    await load();
  }

  const addOption = () => {
    const value = Number(f.value), max = f.max.trim() === '' ? null : Number(f.max), min = Number(f.min), weight = Number(f.weight);
    if (!(value > 0) || (f.type === 'percent' && (value > 100 || max === null || !(max > 0))) || min < 0 || !Number.isInteger(weight) || weight < 1 || weight > 100) {
      setMsg({ error: t('oq.invalid'), ok: '' }); return;
    }
    void run(() => supabase.rpc('admin_add_reward_option', { p_type: f.type, p_value: value, p_max: max, p_min_spend: min, p_weight: weight })).then(() => setF({ ...f, value: '', max: '' }));
  };

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-6">
      <Link to="/admin" className="text-sm btn-text">← {t('dash.admin')}</Link>
      <h1 className="font-display text-2xl font-semibold">{t('ad.referrals')}</h1>
      <Msg error={msg.error} ok={msg.ok} />

      <Section title={t('ad.campaignOn')}>
        <Check id="act" label={t('ad.campaignOn')} checked={active} onChange={setActive} disabled={busy} />
        <Field id="days" label={t('ad.validDays')} value={days} onChange={setDays} disabled={busy} />
        <button className="btn-primary w-full" disabled={busy} onClick={() => void run(() => supabase.rpc('admin_save_referral_config', { p_active: active, p_valid_days: Number(days) }))}>{t('common.save')}</button>
      </Section>

      <Section title={t('ad.options')}>
        <ul className="divide-y divide-ink/10 text-sm">
          {opts.map((o) => (
            <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className={o.is_active ? '' : 'text-ink/50 line-through'}>
                {o.discount_type === 'percent' ? `${o.discount_value}% (≤ ₹${o.max_discount_inr})` : `₹${o.discount_value}`} · min ₹{o.min_spend_inr} · w{o.weight}
              </span>
              <Check id={`o-${o.id}`} label={t('admin.catActive')} checked={o.is_active} disabled={busy}
                onChange={(v) => void run(() => supabase.rpc('admin_toggle_reward_option', { p_id: o.id, p_active: v }))} />
            </li>
          ))}
        </ul>
        <Select id="ot" label={t('ad.addOption')} value={f.type} onChange={(v) => setF({ ...f, type: v })} options={[{ value: 'percent', label: t('ad.percent') }, { value: 'flat', label: t('ad.flat') }]} />
        <div className="grid grid-cols-2 gap-3">
          <Field id="ov" label={t('ad.value')} value={f.value} onChange={(v) => setF({ ...f, value: v })} disabled={busy} />
          <Field id="om" label={t('ad.maxDiscount')} value={f.max} onChange={(v) => setF({ ...f, max: v })} disabled={busy} />
          <Field id="on" label={t('ad.minSpend')} value={f.min} onChange={(v) => setF({ ...f, min: v })} disabled={busy} />
          <Field id="ow" label={t('ad.weight')} value={f.weight} onChange={(v) => setF({ ...f, weight: v })} disabled={busy} />
        </div>
        <button className="btn-secondary w-full" disabled={busy} onClick={addOption}>{t('ad.addOption')}</button>
      </Section>

      <Section title={t('ad.refList')}>
        <Field id="rr" label={t('admin.reason')} value={reason} onChange={setReason} disabled={busy} />
        <ul className="divide-y divide-ink/10 text-sm">
          {refs.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>{r.code} · {t(`rs.${r.status}`)}{r.reject_reason ? ` (${r.reject_reason})` : ''} · {fmtDateTime(r.created_at, lang)}</span>
              {r.status === 'rewarded' && (
                <button className="btn-secondary" disabled={busy || reason.trim().length < 3} onClick={() => void run(() => supabase.rpc('admin_revoke_referral', { p_referral_id: r.id, p_reason: reason }))}>{t('ad.revoke')}</button>
              )}
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
