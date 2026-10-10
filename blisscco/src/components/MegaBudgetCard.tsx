import { useState, type FormEvent } from 'react';
import { Msg } from './ui';
import { useI18n } from '../i18n';
import { inr, megaErrKey, spentPct, type MegaBudget, type MegaLimits } from '../lib/megaStore';
import { supabase } from '../lib/supabase';

/** Budget, what is left, what usable rewards could still cost, and (primary owner only) a way to ADD to the budget. */
export default function MegaBudgetCard({ budget, limits, canIncrease, onChanged }: {
  budget: MegaBudget | null | undefined; limits: MegaLimits | null | undefined; canIncrease: boolean; onChanged: () => void;
}) {
  const { t } = useI18n();
  const [add, setAdd] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(''); setOk('');
    const n = Number(add);
    if (!(n > 0)) return setError(t('mg.err.invalid_budget'));
    if (!window.confirm(t('mg.budget.confirm', { n: inr(n) }))) return;
    setBusy(true);
    const { error: err } = await supabase.rpc('megastore_increase_budget', { p_add: n });
    setBusy(false);
    if (err) { setError(t(megaErrKey(err.message))); return; }
    setAdd(''); setOk(t('mg.budget.done'));
    onChanged();
  }

  const b = budget;
  const pct = spentPct(b);
  const low = !!b && b.budget_inr !== null && (pct >= 80 || b.shortfall_inr > 0);
  return (
    <div className="space-y-3">
      {!b || b.budget_inr === null ? (
        <p className="rounded-xl bg-amber-50 p-3 text-sm">{t('mg.budget.notSet')}</p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl bg-ink/5 p-2"><p className="font-semibold">{inr(b.budget_inr)}</p><p className="text-xs text-ink/70">{t('mg.budget.total')}</p></div>
            <div className="rounded-xl bg-ink/5 p-2"><p className="font-semibold">{inr(b.spent_inr)}</p><p className="text-xs text-ink/70">{t('mg.budget.spent')}</p></div>
            <div className="rounded-xl bg-green-50 p-2"><p className="font-semibold">{inr(b.remaining_inr)}</p><p className="text-xs text-ink/70">{t('mg.budget.left')}</p></div>
          </div>
          <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={t('mg.budget.spent')} className="h-3 w-full overflow-hidden rounded-full bg-ink/10">
            <div className={`h-full ${low ? 'bg-amber-500' : 'bg-green-600'}`} style={{ width: `${pct}%` }} />
          </div>
          <p className="text-xs text-ink/70">{t('mg.budget.exposure', { n: inr(b.outstanding_exposure_inr) })}</p>
          {b.uncapped_outstanding > 0 && <p className="text-xs text-ink/70">{t('mg.budget.uncapped', { n: b.uncapped_outstanding })}</p>}
          {low && <p role="status" className="rounded-xl bg-amber-50 p-3 text-sm">{b.shortfall_inr > 0 ? t('mg.budget.shortfall', { n: inr(b.shortfall_inr) }) : t('mg.budget.low')}</p>}
        </>
      )}
      {canIncrease ? (
        <form onSubmit={submit} className="space-y-2" noValidate>
          <label htmlFor="mg-budget-add" className="text-sm font-medium">{t('mg.budget.addLabel')}</label>
          <div className="flex gap-2">
            <input id="mg-budget-add" className="input flex-1" inputMode="decimal" placeholder="₹" value={add} disabled={busy}
              onChange={(e) => setAdd(e.target.value.replace(/[^0-9.]/g, '').slice(0, 10))} />
            <button type="submit" className="btn-solid" disabled={busy || !add}>{t('mg.budget.addBtn')}</button>
          </div>
          <p className="text-xs text-ink/70">{t('mg.budget.addHint')}{limits ? ` ${t('mg.limits.budgetMax', { b: inr(limits.max_budget_inr) })}` : ''}</p>
          <Msg error={error} ok={ok} />
        </form>
      ) : (
        <p className="text-xs text-ink/70">{t('mg.budget.ownerOnly')}</p>
      )}
    </div>
  );
}
