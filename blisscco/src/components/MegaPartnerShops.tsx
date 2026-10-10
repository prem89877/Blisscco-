import { useEffect, useState } from 'react';
import { Msg } from './ui';
import { useI18n } from '../i18n';
import { megaErrKey, type MegaShop } from '../lib/megaStore';
import { supabase } from '../lib/supabase';

/** Partner shop picker of the Mega Store campaign. Search = approved Blisscco shops (public facts only). */
export default function MegaPartnerShops({ shops, onChanged }: { shops: MegaShop[]; onChanged: () => void }) {
  const { t } = useI18n();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<MegaShop[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setResults(null); return; }
    let alive = true;
    const id = setTimeout(() => {
      void supabase.rpc('megastore_search_shops', { p_q: term }).then(({ data, error: e }) => {
        if (!alive) return;
        if (e) { setError(t(megaErrKey(e.message))); setResults([]); return; }
        setResults((data ?? []) as MegaShop[]);
      });
    }, 300);
    return () => { alive = false; clearTimeout(id); };
  }, [q, t]);

  async function act(fn: 'megastore_add_shop' | 'megastore_remove_shop', id: string) {
    if (busyId) return;
    setBusyId(id); setError('');
    const { error: e } = await supabase.rpc(fn, { p_business_id: id });
    setBusyId(null);
    if (e) { setError(t(megaErrKey(e.message))); return; }
    onChanged();
  }

  const selected = new Set(shops.map((s) => s.id));
  return (
    <div className="space-y-3">
      <p className="text-sm text-ink/80">{t('mg.shops.hint')}</p>
      <p className="text-sm font-medium">{t('mg.shops.count', { n: shops.length })}</p>
      {shops.length === 0 && <p className="text-sm text-ink/70">{t('mg.shops.none')}</p>}
      <ul className="space-y-2">
        {shops.map((s) => (
          <li key={s.id} className="flex items-center justify-between gap-2 rounded-xl border border-ink/10 p-3">
            <span><span className="font-medium">{s.name}</span>{s.city && <span className="text-sm text-ink/70"> · {s.city}</span>}</span>
            <button type="button" className="btn-text-muted" disabled={busyId === s.id} onClick={() => void act('megastore_remove_shop', s.id)}>{t('mg.shops.remove')}</button>
          </li>
        ))}
      </ul>
      <div className="space-y-1.5">
        <label htmlFor="mg-shop-search" className="text-sm font-medium">{t('mg.shops.search')}</label>
        <input id="mg-shop-search" className="input" value={q} maxLength={60} onChange={(e) => setQ(e.target.value)} />
      </div>
      <Msg error={error} />
      {results && results.length === 0 && <p className="text-sm text-ink/70">{t('mg.shops.noResults')}</p>}
      <ul className="space-y-2">
        {results?.filter((r) => !selected.has(r.id)).map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-2 rounded-xl border border-ink/10 p-3">
            <span><span className="font-medium">{r.name}</span>{r.city && <span className="text-sm text-ink/70"> · {r.city}</span>}</span>
            <button type="button" className="btn-solid" disabled={busyId === r.id} onClick={() => void act('megastore_add_shop', r.id)}>{t('mg.shops.add')}</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
