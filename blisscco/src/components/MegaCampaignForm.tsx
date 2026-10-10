import { useState, type FormEvent } from 'react';
import { Check, Msg, Select } from './ui';
import Field from './Field';
import { useI18n } from '../i18n';
import { addDays, istToday } from '../lib/format';
import { istDayOf, istEndIso, istStartIso, megaErrKey, type MegaCampaign, type MegaRewardType } from '../lib/megaStore';
import { supabase } from '../lib/supabase';

function Num({ id, label, value, onChange, disabled }: { id: string; label: string; value: string; onChange: (v: string) => void; disabled?: boolean }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-medium">{label}</label>
      <input id={id} className="input" inputMode="decimal" value={value} disabled={disabled}
        onChange={(e) => onChange(e.target.value.replace(/[^0-9.]/g, '').slice(0, 10))} />
    </div>
  );
}

/** Create / edit the draft campaign of the Mega Store. Fixed rules (women only, max 5 rewards, 1-month expiry) are enforced by the database. */
export default function MegaCampaignForm({ draft, onSaved }: { draft: MegaCampaign | null; onSaved: () => void }) {
  const { t } = useI18n();
  const today = istToday();
  const [title, setTitle] = useState(draft?.title ?? '');
  const [description, setDescription] = useState(draft?.description ?? '');
  const [startDay, setStartDay] = useState(draft ? istDayOf(draft.starts_at) : today);
  const [endDay, setEndDay] = useState(draft ? istDayOf(draft.ends_at) : addDays(today, 30));
  const [type, setType] = useState<MegaRewardType>(draft?.reward_type ?? 'percent');
  const [value, setValue] = useState(draft ? String(draft.reward_value) : '');
  const [maxDisc, setMaxDisc] = useState(draft?.max_discount_inr ? String(draft.max_discount_inr) : '');
  const [minPurchase, setMinPurchase] = useState(draft && draft.min_purchase_inr > 0 ? String(draft.min_purchase_inr) : '');
  const [minService, setMinService] = useState(draft && draft.min_service_price_inr > 0 ? String(draft.min_service_price_inr) : '');
  const [onePerShop, setOnePerShop] = useState(draft?.one_reward_per_shop ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(''); setOk('');
    const v = Number(value);
    if (!(v > 0)) return setError(t('mg.err.invalid_value'));
    if (!startDay || !endDay || endDay < startDay) return setError(t('mg.err.invalid_dates'));
    setBusy(true);
    const { error: err } = await supabase.rpc('megastore_save_campaign', {
      p_title: title.trim(), p_description: description.trim() || null,
      p_starts_at: istStartIso(startDay), p_ends_at: istEndIso(endDay),
      p_type: type, p_value: v,
      p_max_discount: type === 'percent' && maxDisc ? Number(maxDisc) : null,
      p_min_purchase: minPurchase ? Number(minPurchase) : null,
      p_min_service: minService ? Number(minService) : null,
      p_one_per_shop: onePerShop,
    });
    setBusy(false);
    if (err) { setError(t(megaErrKey(err.message))); return; }
    setOk(t('mg.saved'));
    onSaved();
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <Field id="mg-title" label={t('mg.f.title')} value={title} onChange={setTitle} disabled={busy} />
      <div className="space-y-1.5">
        <label htmlFor="mg-desc" className="text-sm font-medium">{t('mg.f.desc')}</label>
        <textarea id="mg-desc" rows={2} maxLength={500} className="input" value={description} disabled={busy} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label htmlFor="mg-start" className="text-sm font-medium">{t('mg.f.start')}</label>
          <input id="mg-start" type="date" className="input" value={startDay} min={today} disabled={busy} onChange={(e) => setStartDay(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="mg-end" className="text-sm font-medium">{t('mg.f.end')}</label>
          <input id="mg-end" type="date" className="input" value={endDay} min={startDay || today} disabled={busy} onChange={(e) => setEndDay(e.target.value)} />
        </div>
      </div>
      <Select id="mg-type" label={t('mg.f.type')} value={type} onChange={(v) => setType(v as MegaRewardType)} disabled={busy}
        options={[{ value: 'percent', label: t('mg.type.percent') }, { value: 'flat', label: t('mg.type.flat') }]} />
      <Num id="mg-value" label={type === 'percent' ? t('mg.f.valuePct') : t('mg.f.valueFlat')} value={value} onChange={setValue} disabled={busy} />
      {type === 'percent' && <Num id="mg-max" label={t('mg.f.maxDisc')} value={maxDisc} onChange={setMaxDisc} disabled={busy} />}
      <Num id="mg-minbill" label={t('mg.f.minPurchase')} value={minPurchase} onChange={setMinPurchase} disabled={busy} />
      <Num id="mg-minsvc" label={t('mg.f.minService')} value={minService} onChange={setMinService} disabled={busy} />
      <Check id="mg-oneshop" label={t('mg.f.onePerShop')} checked={onePerShop} onChange={setOnePerShop} disabled={busy} />
      <p className="rounded-xl bg-ink/5 p-3 text-xs">{t('mg.fixedRules')}</p>
      <p className="rounded-xl bg-ink/5 p-3 text-xs">{t('mg.fundNote')}</p>
      <Msg error={error} ok={ok} />
      <button type="submit" className="btn-confirm" disabled={busy}>{busy ? t('common.loading') : t('mg.camp.saveDraft')}</button>
    </form>
  );
}
