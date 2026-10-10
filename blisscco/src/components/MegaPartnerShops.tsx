import { useEffect, useState } from 'react';
import { Msg } from './ui';
import { useI18n } from '../i18n';
import { megaErrKey, type MegaPartnerStatus, type MegaShop } from '../lib/megaStore';
import { supabase } from '../lib/supabase';

const BADGE: Record<MegaPartnerStatus, string> = {
  invited: 'bg-amber-100 text-amber-900', accepted: 'bg-green-100 text-green-900',
  declined: 'bg-red-100 text-red-900', withdrawn: 'bg-red-100 text-red-900', removed: 'bg-ink/10 text-ink',
};

/** Partner shop picker of the Mega Store campaign. Search = approved Blisscco shops (public facts only). Up to `max` shops. */
export default function MegaPartnerShops({ shops, max, canEdit, onChanged }: { shops: MegaShop[]; max: number; canEdit: boolean; onChanged: () => void }) {
  const { t } = useI18n();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<MegaShop[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const term = q.trim();
    if (!canEdit || term.length < 2) { setResults(null); return; }
    let alive = true;
    const id = setTimeout(() => {
      void supabase.rpc('megastore_search_shops', { p_q: term }).then(({ data, error: e }) => {
        if (!alive) return;
        if (e) { setError(t(megaErrKey(e.message))); setResults([]); return; }
        setResults((data ?? []) as MegaShop[]);
      });
    }, 300);
    return () => { alive = false; clearTimeout(id); };
  }, [q, t, canEdit]);

  async function act(fn: 'megastore_add_shop' | 'megastore_remove_shop', id: string) {
    if (busyId) return;
    setBusyId(id); setError('');
    const { error: e } = await supabase.rpc(fn, { p_business_id: id });
    setBusyId(null);
    if (e) { setError(t(megaErrKey(e.message))); return; }
    onChanged();
  }

  const selected = new Set(shops.map((s) => s.id));
  const full = shops.length >= max;
  return (
    <div className="space-y-3">
      {canEdit && <p className="text-sm text-ink/80">{t('mg.shops.hint', { max })}</p>}
      <p className="text-sm font-medium">{t('mg.shops.countMax', { n: shops.length, max })}</p>
      {shops.length === 0 && <p className="text-sm text-ink/70">{t('mg.shops.none')}</p>}
      <ul className="space-y-2">
        {shops.map((s) => (
          <li key={s.id} className="space-y-2 rounded-xl border border-ink/10 p-3">
            <div className="flex items-start justify-between gap-2">
              <span><span className="font-medium">{s.name}</span>{s.city && <span className="text-sm text-ink/70"> · {s.city}</span>}</span>
              {s.partner_status && <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${BADGE[s.partner_status]}`}>{t(`mg.partner.${s.partner_status}`)}</span>}
            </div>
            {s.verified_services !== undefined && (
              <p className="text-xs text-ink/70">{t('mg.shops.row', { v: s.verified_services ?? 0, i: s.rewards_issued ?? 0, r: s.rewards_redeemed ?? 0 })}</p>
            )}
            {canEdit && (
              <button type="button" className="btn-text-muted min-h-[44px]" disabled={busyId === s.id} onClick={() => void act('megastore_remove_shop', s.id)}>{t('mg.shops.remove')}</button>
            )}
          </li>
        ))}
      </ul>
      {canEdit && (
        <>
          {full && <p className="rounded-xl bg-amber-50 p-3 text-sm">{t('mg.shops.full', { max })}</p>}
          <div className="space-y-1.5">
            <label htmlFor="mg-shop-search" className="text-sm font-medium">{t('mg.shops.search')}</label>
            <input id="mg-shop-search" className="input" value={q} maxLength={60} disabled={full} onChange={(e) => setQ(e.target.value)} />
          </div>
          <Msg error={error} />
          {results && results.length === 0 && <p className="text-sm text-ink/70">{t('mg.shops.noResults')}</p>}
          <ul className="space-y-2">
            {results?.filter((r) => !selected.has(r.id)).map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-2 rounded-xl border border-ink/10 p-3">
                <span><span className="font-medium">{r.name}</span>{r.city && <span className="text-sm text-ink/70"> · {r.city}</span>}</span>
                <button type="button" className="btn-solid" disabled={busyId === r.id || full} onClick={() => void act('megastore_add_shop', r.id)}>{t('mg.shops.add')}</button>
              </li>
            ))}
          </ul>
        </>
      )}
      {!canEdit && <Msg error={error} />}
    </div>
  );
}
