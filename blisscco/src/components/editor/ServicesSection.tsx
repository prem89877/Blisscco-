import { useState, type FormEvent } from 'react';
import Field from '../Field';
import { Msg, Section } from '../ui';
import { useI18n } from '../../i18n';
import { rupees } from '../../lib/format';
import { supabase } from '../../lib/supabase';
import type { Loaded } from '../../lib/types';

const empty = { service: '', price: '' };

export default function ServicesSection({ data, reload }: { data: Loaded; reload: () => Promise<void> }) {
  const { t, lang } = useI18n();
  const [f, setF] = useState(empty);
  const [editId, setEditId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const blocked = data.business.status === 'suspended';
  const [tip, setTip] = useState<{ basic: number; standard: number; premium: number } | null>(null);
  const [tipBusy, setTipBusy] = useState(false);
  const [tipErr, setTipErr] = useState('');

  const TIP_ERR = ['unauthorized', 'bad_request', 'not_owner', 'rate_limited', 'configuration_required', 'ai_unavailable', 'server_config', 'server_error'];

  async function suggestPrice() {
    if (tipBusy) return;
    setTip(null); setTipErr('');
    const service = f.service.trim();
    if (service.length < 2) { setTipErr(t('ps.needName')); return; }
    setTipBusy(true);
    try {
      const { data: s } = await supabase.auth.getSession();
      const token = s.session?.access_token;
      if (!token) { setTipErr(t('ps.err.unauthorized')); return; }
      const r = await fetch('/api/ai-price-suggest', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ business_id: data.business.id, service, lang }),
      });
      const j = (await r.json().catch(() => ({}))) as { basic?: number; standard?: number; premium?: number; error?: string };
      if (r.ok && j.basic && j.standard && j.premium) setTip({ basic: j.basic, standard: j.standard, premium: j.premium });
      else setTipErr(t(j.error && TIP_ERR.includes(j.error) ? `ps.err.${j.error}` : 'err.generic'));
    } catch { setTipErr(t('err.generic')); }
    finally { setTipBusy(false); }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError('');
    const price = Number(f.price);
    if (f.service.trim().length < 2 || !(price > 0 && price <= 100000)) return setError(t('ed.svcInvalid'));
    setBusy(true);
    const row = { service_category: f.service.trim(), price_inr: price, name: null, duration_minutes: null };
    const { error: err } = editId
      ? await supabase.from('services').update(row).eq('id', editId)
      : await supabase.from('services').insert({ ...row, business_id: data.business.id });
    setBusy(false);
    if (err) { console.error(err); setError(t('err.generic')); return; }
    setF(empty); setEditId(null);
    await reload();
  }

  async function toggle(id: string, active: boolean) {
    if (busy) return;
    setBusy(true);
    const { error: err } = await supabase.from('services').update({ is_active: !active }).eq('id', id);
    setBusy(false);
    if (err) setError(t('err.generic'));
    await reload();
  }

  return (
    <Section title={t('ed.services')}>
      {data.services.length === 0 && <p className="text-sm text-ink/70">{t('ed.svcNone')}</p>}
      <ul className="divide-y divide-ink/10">
        {data.services.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
            <div>
              <p className={`font-medium ${s.is_active ? '' : 'text-ink/50 line-through'}`}>{s.name || s.service_category}</p>
              <p className="text-sm text-ink/70">{rupees(s.price_inr)} {s.is_active ? '' : `· ${t('ed.hidden')}`}</p>
            </div>
            {!blocked && (
              <div className="flex gap-2">
                <button className="btn-secondary" onClick={() => { setEditId(s.id); setF({ service: s.name || s.service_category, price: String(s.price_inr) }); }}>{t('common.edit')}</button>
                <button className="btn-secondary" disabled={busy} onClick={() => void toggle(s.id, s.is_active)}>{s.is_active ? t('ed.deactivate') : t('ed.activate')}</button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {!blocked && (
        <form onSubmit={onSubmit} className="space-y-3 rounded-xl bg-cream p-3" noValidate>
          <Field id="sc" label={t('ed.svcCategory')} value={f.service} onChange={(v) => setF({ ...f, service: v })} disabled={busy} />
          <Field id="sp2" label={t('ed.svcPrice')} value={f.price} onChange={(v) => setF({ ...f, price: v })} disabled={busy} />
          <button type="button" className="btn-ai" disabled={busy || tipBusy} onClick={() => void suggestPrice()}>
            <span aria-hidden="true">✨</span> {tipBusy ? t('ps.thinking') : t('ps.btn')}
          </button>
          {tip && (
            <div role="status" className="ai-tip">
              <p className="text-xs font-semibold text-ink/60">{t('ps.title')}</p>
              <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                {([['basic', tip.basic], ['standard', tip.standard], ['premium', tip.premium]] as const).map(([k, v]) => (
                  <button key={k} type="button" className="ai-price" onClick={() => setF({ ...f, price: String(v) })}>
                    <span className="block text-[11px] font-medium text-ink/60">{t(`ps.${k}`)}</span>
                    <span className="block text-base font-semibold">{rupees(v)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          <Msg error={tipErr} />
          <Msg error={error} />
          <div className="flex gap-2">
            <button type="submit" className="btn-primary flex-1" disabled={busy}>{editId ? t('common.save') : t('common.add')}</button>
            {editId && <button type="button" className="btn-secondary" onClick={() => { setEditId(null); setF(empty); }}>{t('common.cancel')}</button>}
          </div>
        </form>
      )}
    </Section>
  );
}
