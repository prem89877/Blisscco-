import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import Field from '../../components/Field';
import { Msg, Section, Select } from '../../components/ui';
import { useI18n } from '../../i18n';
import { istToday, rupees } from '../../lib/format';
import { offerBadge, offerEndsText, offerState, type OfferState, type ShopOffer } from '../../lib/offers';
import { supabase } from '../../lib/supabase';

const KNOWN = ['not_owner', 'invalid_code', 'invalid_value', 'invalid_dates', 'code_taken', 'too_many_offers'];
const STATE_STYLE: Record<OfferState, string> = {
  live: 'bg-green-100 text-green-900', paused: 'bg-ink/10 text-ink/70', scheduled: 'bg-amber-100 text-amber-900', expired: 'bg-red-100 text-red-800',
};
const num = (s: string) => (s.trim() === '' ? null : Number(s));
const cleanNum = (s: string) => s.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1').slice(0, 9);

export default function OwnerCoupons() {
  const { id } = useParams();
  const { t, lang } = useI18n();
  const [list, setList] = useState<ShopOffer[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState({ error: '', ok: '' });
  const [code, setCode] = useState('');
  const [type, setType] = useState<'percent' | 'flat'>('percent');
  const [value, setValue] = useState('');
  const [maxDisc, setMaxDisc] = useState('');
  const [minSpend, setMinSpend] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const errOf = (m: string | undefined | null) => t(m && KNOWN.includes(m) ? `of.err.${m}` : 'err.generic');

  const load = useCallback(async () => {
    if (!id) return;
    const { data, error } = await supabase.from('shop_offers').select('*').eq('business_id', id).order('created_at', { ascending: false });
    setLoading(false);
    if (error) { console.error(error); setMsg({ error: t('err.generic'), ok: '' }); return; }
    setList((data ?? []) as ShopOffer[]);
  }, [id, t]);

  useEffect(() => { void load(); }, [load]);

  async function create() {
    if (busy || !id) return;
    setMsg({ error: '', ok: '' });
    const v = num(value);
    if (code.length < 3) { setMsg({ error: t('of.err.invalid_code'), ok: '' }); return; }
    if (v === null || !(v > 0) || (type === 'percent' && v > 100)) { setMsg({ error: t('of.err.invalid_value'), ok: '' }); return; }
    const mx = type === 'percent' ? num(maxDisc) : null;
    const mn = num(minSpend);
    if ((mx !== null && !(mx > 0)) || (mn !== null && mn < 0)) { setMsg({ error: t('of.err.invalid_value'), ok: '' }); return; }
    if ((endDate && endDate < istToday()) || (startDate && endDate && endDate < startDate)) { setMsg({ error: t('of.err.invalid_dates'), ok: '' }); return; }
    setBusy(true);
    const { error } = await supabase.rpc('owner_create_offer', {
      p_business_id: id, p_code: code, p_type: type, p_value: v, p_max_discount: mx, p_min_spend: mn,
      p_starts_at: startDate ? new Date(`${startDate}T00:00:00+05:30`).toISOString() : null,
      p_ends_at: endDate ? new Date(`${endDate}T23:59:59+05:30`).toISOString() : null,
    });
    setBusy(false);
    if (error) { setMsg({ error: errOf(error.message), ok: '' }); return; }
    setCode(''); setValue(''); setMaxDisc(''); setMinSpend(''); setStartDate(''); setEndDate('');
    setMsg({ error: '', ok: t('of.created') });
    await load();
  }

  async function toggle(o: ShopOffer) {
    if (busy) return;
    setBusy(true); setMsg({ error: '', ok: '' });
    const { error } = await supabase.rpc('owner_set_offer_active', { p_offer_id: o.id, p_active: !o.is_active });
    setBusy(false);
    if (error) { setMsg({ error: errOf(error.message), ok: '' }); return; }
    await load();
  }

  async function remove(o: ShopOffer) {
    if (busy || !window.confirm(t('of.confirmDelete', { c: o.code }))) return;
    setBusy(true); setMsg({ error: '', ok: '' });
    const { error } = await supabase.rpc('owner_delete_offer', { p_offer_id: o.id });
    setBusy(false);
    if (error) { setMsg({ error: errOf(error.message), ok: '' }); return; }
    await load();
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-6">
      <Link to="/owner" className="text-sm btn-text">← {t('owner.title')}</Link>
      <h1 className="font-display text-2xl font-semibold">{t('of.title')}</h1>
      <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{t('of.fundNote')}</p>

      <Section title={t('of.create')}>
        <Field id="of-code" label={t('of.code')} value={code} onChange={(v) => setCode(v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20))} disabled={busy} />
        <p className="-mt-2 text-xs text-ink/60">{t('of.codeHint')}</p>
        <Select id="of-type" label={t('of.type')} value={type} onChange={(v) => setType(v === 'flat' ? 'flat' : 'percent')} disabled={busy}
          options={[{ value: 'percent', label: t('of.typePercent') }, { value: 'flat', label: t('of.typeFlat') }]} />
        <div className="space-y-1.5">
          <label htmlFor="of-value" className="text-sm font-medium">{type === 'percent' ? t('of.valuePercent') : t('of.valueFlat')}</label>
          <input id="of-value" className="input" inputMode="decimal" value={value} disabled={busy} onChange={(e) => setValue(cleanNum(e.target.value))} />
        </div>
        {type === 'percent' && (
          <div className="space-y-1.5">
            <label htmlFor="of-max" className="text-sm font-medium">{t('of.maxDisc')}</label>
            <input id="of-max" className="input" inputMode="decimal" value={maxDisc} disabled={busy} onChange={(e) => setMaxDisc(cleanNum(e.target.value))} />
          </div>
        )}
        <div className="space-y-1.5">
          <label htmlFor="of-min" className="text-sm font-medium">{t('of.minSpend')}</label>
          <input id="of-min" className="input" inputMode="decimal" value={minSpend} disabled={busy} onChange={(e) => setMinSpend(cleanNum(e.target.value))} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor="of-start" className="text-sm font-medium">{t('of.startDate')}</label>
            <input id="of-start" type="date" className="input" value={startDate} disabled={busy} onChange={(e) => setStartDate(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="of-end" className="text-sm font-medium">{t('of.endDate')}</label>
            <input id="of-end" type="date" className="input" value={endDate} min={istToday()} disabled={busy} onChange={(e) => setEndDate(e.target.value)} />
          </div>
        </div>
        <p className="-mt-2 text-xs text-ink/60">{t('of.tenureHint')}</p>
        <button className="btn-primary w-full" disabled={busy || !code || !value} onClick={() => void create()}>{busy ? t('common.loading') : t('of.createBtn')}</button>
        <Msg error={msg.error} ok={msg.ok} />
      </Section>

      <Section title={t('of.yours')}>
        {loading && <p className="text-sm text-ink/70">{t('common.loading')}</p>}
        {!loading && list.length === 0 && <p className="text-sm text-ink/70">{t('of.none')}</p>}
        <ul className="space-y-2">
          {list.map((o) => {
            const st = offerState(o);
            return (
              <li key={o.id} className="space-y-2 rounded-xl border border-ink/10 p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-display text-lg font-semibold tracking-wide">{o.code}</p>
                  <span className={`rounded-full px-3 py-1 text-xs font-semibold ${STATE_STYLE[st]}`}>{t(`of.state.${st}`)}</span>
                </div>
                <p className="font-medium">
                  {offerBadge(o, t)}
                  {o.discount_type === 'percent' && o.max_discount_inr ? ` · ${t('of.upTo', { n: rupees(o.max_discount_inr) })}` : ''}
                  {Number(o.min_spend_inr) > 0 ? ` · ${t('cp.minSpend', { n: Number(o.min_spend_inr) })}` : ''}
                </p>
                <p className="text-ink/70">{o.ends_at ? offerEndsText(o.ends_at, lang, t) : t('of.noEnd')}</p>
                <div className="flex gap-2">
                  {st !== 'expired' && <button className="btn-secondary" disabled={busy} onClick={() => void toggle(o)}>{o.is_active ? t('of.pause') : t('of.resume')}</button>}
                  <button className="btn-secondary" disabled={busy} onClick={() => void remove(o)}>{t('of.delete')}</button>
                </div>
              </li>
            );
          })}
        </ul>
      </Section>
    </div>
  );
}
