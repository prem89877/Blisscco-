import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import Field from '../components/Field';
import ReferralBanner from '../components/ReferralBanner';
import { Stars } from '../components/Stars';
import { Check, Msg, Select } from '../components/ui';
import { useGeo } from '../context/LocationContext';
import { useI18n } from '../i18n';
import { distanceLabel, localName, rupees } from '../lib/format';
import { signedUrlMap } from '../lib/storage';
import { supabase } from '../lib/supabase';
import type { Category } from '../lib/types';

const PAGE = 20;

interface Row {
  bid: string; key: string; to: string; title: string; business: string | null; catEn: string; catHi: string | null; catMr: string | null;
  city: string | null; services: number | null; price: number | null; isFrom: boolean; distance: number; open: boolean; cover: string | null;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const fromBiz = (r: any): Row => ({
  bid: r.business_id, key: r.business_id, to: `/b/${r.business_id}`, title: r.name, business: null, catEn: r.category_name_en, catHi: r.category_name_hi,
  catMr: r.category_name_mr, city: r.city, services: r.service_count, price: r.min_price, isFrom: true, distance: r.distance_m,
  open: r.is_open_now, cover: r.cover_path,
});
const fromSvc = (r: any): Row => ({
  bid: r.business_id, key: r.service_id, to: `/b/${r.business_id}`, title: r.service_label, business: r.business_name, catEn: r.category_name_en,
  catHi: r.category_name_hi, catMr: r.category_name_mr, city: r.city, services: null, price: r.price_inr, isFrom: false,
  distance: r.distance_m, open: r.is_open_now, cover: r.cover_path,
});

export default function Explore() {
  const { t, lang } = useI18n();
  const { status, coords, request } = useGeo();
  const [cats, setCats] = useState<Category[]>([]);
  const [q, setQ] = useState('');
  const [maxPriceText, setMaxPriceText] = useState('');
  const [dq, setDq] = useState('');
  const [dm, setDm] = useState('');
  const [category, setCategory] = useState('');
  const [openNow, setOpenNow] = useState(false);
  const [sort, setSort] = useState('distance');
  const [rows, setRows] = useState<Row[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [ratings, setRatings] = useState<Record<string, { avg_rating: number; review_count: number }>>({});
  const [loading, setLoading] = useState(false);
  const [errKey, setErrKey] = useState('');
  const [hasMore, setHasMore] = useState(false);
  const reqId = useRef(0);

  useEffect(() => {
    void supabase.from('business_categories').select('*').eq('is_active', true).order('sort_order')
      .then(({ data }) => setCats((data ?? []) as Category[]));
    // If the browser already remembers permission, skip the button
    void navigator.permissions?.query({ name: 'geolocation' }).then((p) => { if (p.state === 'granted') request(); }).catch(() => undefined);
  }, [request]);

  useEffect(() => {
    const id = setTimeout(() => { setDq(q.trim()); setDm(maxPriceText.trim()); }, 400);
    return () => clearTimeout(id);
  }, [q, maxPriceText]);

  const load = useCallback(async (offset: number) => {
    if (!coords) return;
    const id = ++reqId.current;
    setLoading(true); setErrKey('');
    const mp = Number(dm);
    const base = {
      p_lat: coords.lat, p_lng: coords.lng, p_category: category || null, p_max_price: mp > 0 ? mp : null,
      p_open_now: openNow, p_sort: sort, p_limit: PAGE, p_offset: offset,
    };
    const svc = dq.length > 0;
    const res = svc ? await supabase.rpc('search_services', { ...base, p_query: dq }) : await supabase.rpc('nearby_businesses', base);
    if (id !== reqId.current) return;
    setLoading(false);
    if (res.error) { console.error(res.error); setErrKey('err.generic'); return; }
    const mapped = ((res.data ?? []) as any[]).map(svc ? fromSvc : fromBiz);
    setRows((prev) => (offset === 0 ? mapped : [...prev, ...mapped]));
    setHasMore(mapped.length === PAGE);
    const m = await signedUrlMap(mapped.map((r) => r.cover).filter((x): x is string => !!x));
    if (id === reqId.current) setUrls((prev) => ({ ...prev, ...m }));
    const ids = [...new Set(mapped.map((r) => r.bid))];
    if (ids.length > 0) {
      const rt = await supabase.from('public_business_ratings').select('business_id,avg_rating,review_count').in('business_id', ids);
      const got = (rt.data ?? []) as { business_id: string; avg_rating: number; review_count: number }[];
      if (id === reqId.current) setRatings((prev) => ({ ...prev, ...Object.fromEntries(got.map((x) => [x.business_id, x])) }));
    }
  }, [coords, dq, dm, category, openNow, sort]);

  useEffect(() => { void load(0); }, [load]);

  if (!coords) {
    return (
      <section className="mx-auto max-w-md space-y-4 px-4 py-10 text-center">
        <h1 className="font-display text-2xl font-semibold">{t('explore.title')}</h1>
        <p className="text-ink/80">{t('explore.why')}</p>
        {status === 'denied' && <Msg error={t('explore.denied')} />}
        {status === 'error' && <Msg error={t('explore.unavailable')} />}
        <button className="btn-primary w-full" disabled={status === 'asking'} onClick={request}>
          {status === 'asking' ? t('explore.locating') : status === 'denied' || status === 'error' ? t('explore.retry') : t('explore.allow')}
        </button>
      </section>
    );
  }

  return (
    <section className="mx-auto max-w-3xl space-y-4 px-4 py-6">
      <div>
        <h1 className="font-display text-2xl font-semibold">{t('explore.title')}</h1>
        <p className="text-sm text-ink/70">{t('explore.within')}</p>
      </div>

      <ReferralBanner />
      <Field id="q" label={t('home.search')} value={q} onChange={setQ} />
      <div className="grid grid-cols-2 gap-3">
        <Select id="cat" label={t('explore.category')} value={category} onChange={setCategory}
          options={[{ value: '', label: t('explore.all') }, ...cats.map((c) => ({ value: c.id, label: localName(c.name_en, c.name_hi, c.name_mr, lang) }))]} />
        <Select id="sort" label={t('explore.sort')} value={sort} onChange={setSort}
          options={[{ value: 'distance', label: t('explore.sortDistance') }, { value: 'price', label: t('explore.sortPrice') }]} />
        <Field id="mp" label={t('explore.maxPrice')} value={maxPriceText} onChange={setMaxPriceText} />
        <div className="flex items-end"><Check id="on" label={t('explore.openNow')} checked={openNow} onChange={setOpenNow} /></div>
      </div>

      <Msg error={errKey ? t(errKey) : ''} />
      {loading && rows.length === 0 && [0, 1, 2].map((k) => <div key={k} className="h-28 animate-pulse rounded-2xl bg-ink/10" />)}
      {!loading && !errKey && rows.length === 0 && <p className="py-6 text-center text-ink/70">{t('explore.empty')}</p>}

      <ul className="space-y-3">
        {rows.map((r) => (
          <li key={r.key}>
            <Link to={r.to} className="card flex gap-3 p-3">
              {r.cover && urls[r.cover]
                ? <img src={urls[r.cover]} alt="" loading="lazy" className="h-24 w-24 flex-none rounded-xl object-cover" />
                : <div className="h-24 w-24 flex-none rounded-xl bg-ink/10" />}
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{r.title}</p>
                {r.business && <p className="truncate text-sm">{r.business}</p>}
                <p className="truncate text-xs text-ink/70">{[localName(r.catEn, r.catHi, r.catMr, lang), r.city].filter(Boolean).join(' · ')}</p>
                <p className="text-xs text-ink/60">{ratings[r.bid] ? <><Stars value={ratings[r.bid].avg_rating} /> {ratings[r.bid].avg_rating} ({ratings[r.bid].review_count})</> : t('biz.noReviews')}{r.services !== null ? ` · ${t('explore.services', { n: r.services })}` : ''}</p>
                <p className="mt-1 flex items-center gap-2 text-xs">
                  <span className={`rounded-full px-2 py-0.5 font-medium ${r.open ? 'bg-green-100 text-green-900' : 'bg-ink/10 text-ink/70'}`}>{r.open ? t('explore.openNow') : t('explore.closedNow')}</span>
                  <span>{distanceLabel(r.distance)}</span>
                </p>
              </div>
              {r.price !== null && (
                <div className="flex-none text-right">
                  {r.isFrom && <p className="text-xs text-ink/60">{t('explore.from')}</p>}
                  <p className="font-semibold">{rupees(r.price)}</p>
                </div>
              )}
            </Link>
          </li>
        ))}
      </ul>

      {hasMore && (
        <button className="btn-secondary w-full" disabled={loading} onClick={() => void load(rows.length)}>
          {loading ? t('common.loading') : t('explore.loadMore')}
        </button>
      )}
    </section>
  );
}
