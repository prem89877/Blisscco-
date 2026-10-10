import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Msg, Section } from './ui';
import { useI18n } from '../i18n';
import { megaErrKey, type MegaLimits } from '../lib/megaStore';
import { supabase } from '../lib/supabase';

type Key = 'min_discount_pct' | 'max_discount_pct' | 'min_flat_inr' | 'max_flat_inr' | 'max_partner_shops' | 'min_budget_inr' | 'max_budget_inr';
const FIELDS: Key[] = ['min_discount_pct', 'max_discount_pct', 'min_flat_inr', 'max_flat_inr', 'max_partner_shops', 'min_budget_inr', 'max_budget_inr'];

/** Blisscco's minimum / maximum for Mega Store campaigns. Applies to campaigns saved from now on; running campaigns keep their terms. */
export default function AdminMegaLimits() {
  const { t } = useI18n();
  const [v, setV] = useState<Record<Key, string> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');

  const load = useCallback(async () => {
    const { data, error: e } = await supabase.rpc('get_mega_limits');
    if (e || !data) { console.error(e); setError(t('err.generic')); return; }
    const l = data as MegaLimits;
    setV(Object.fromEntries(FIELDS.map((k) => [k, String(l[k])])) as Record<Key, string>);
  }, [t]);
  useEffect(() => { void load(); }, [load]);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (busy || !v) return;
    setError(''); setOk('');
    const n = (k: Key) => Number(v[k]);
    setBusy(true);
    const { error: err } = await supabase.rpc('admin_set_mega_limits', {
      p_min_pct: n('min_discount_pct'), p_max_pct: n('max_discount_pct'), p_min_flat: n('min_flat_inr'), p_max_flat: n('max_flat_inr'),
      p_max_shops: Math.round(n('max_partner_shops')), p_min_budget: n('min_budget_inr'), p_max_budget: n('max_budget_inr'),
    });
    setBusy(false);
    if (err) { setError(t(megaErrKey(err.message))); return; }
    setOk(t('mg.saved'));
    await load();
  }

  return (
    <Section title={t('mg.ad.limitsTitle')}>
      <p className="text-sm text-ink/80">{t('mg.ad.limitsHint')}</p>
      {v === null ? <div className="h-24 animate-pulse rounded-2xl bg-ink/10" /> : (
        <form onSubmit={save} className="space-y-3" noValidate>
          <div className="grid grid-cols-2 gap-3">
            {FIELDS.map((k) => (
              <div key={k} className="space-y-1.5">
                <label htmlFor={`lim-${k}`} className="text-sm font-medium">{t(`mg.ad.lim.${k}`)}</label>
                <input id={`lim-${k}`} className="input" inputMode="decimal" value={v[k]} disabled={busy}
                  onChange={(e) => setV({ ...v, [k]: e.target.value.replace(/[^0-9.]/g, '').slice(0, 10) })} />
              </div>
            ))}
          </div>
          <Msg error={error} ok={ok} />
          <button type="submit" className="btn-solid" disabled={busy}>{busy ? t('common.loading') : t('mg.save')}</button>
        </form>
      )}
    </Section>
  );
}
