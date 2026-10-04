import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import ReferralBanner from '../components/ReferralBanner';
import BannerStrip from '../components/BannerStrip';
import { Stars } from '../components/Stars';
import { VerifiedTick } from '../components/TierBadge';
import { Msg } from '../components/ui';
import { useGeo } from '../context/LocationContext';
import { useI18n } from '../i18n';
import { trackImpressions } from '../lib/analytics';
import { distanceLabel, localName, rupees } from '../lib/format';
import { signedUrlMap } from '../lib/storage';
import { supabase } from '../lib/supabase';
import { SEARCH_HINTS } from '../lib/searchHints';

const PAGE = 20;

interface Row {
  bid: string; key: string; to: string; title: string; business: string | null; catEn: string; catHi: string | null; catMr: string | null;
  city: string | null; services: number | null; price: number | null; isFrom: boolean; distance: number; open: boolean; cover: string | null; verified: boolean;
  exact: boolean;   // false = found through the typo-tolerant match (similar spelling / sound)
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const fromBiz = (r: any): Row => ({
  bid: r.business_id, key: r.business_id, to: `/b/${r.business_id}?src=search`, title: r.name, business: null, catEn: r.category_name_en, catHi: r.category_name_hi,
  catMr: r.category_name_mr, city: r.city, services: r.service_count, price: r.min_price, isFrom: true, distance: r.distance_m,
  open: r.is_open_now, cover: r.cover_path, verified: !!r.is_verified, exact: true,
});
const fromSvc = (r: any): Row => ({
  bid: r.business_id, key: r.service_id, to: `/b/${r.business_id}?src=search`, title: r.service_label, business: r.business_name, catEn: r.category_name_en,
  catHi: r.category_name_hi, catMr: r.category_name_mr, city: r.city, services: null, price: r.price_inr, isFrom: false,
  distance: r.distance_m, open: r.is_open_now, cover: r.cover_path, verified: !!r.is_verified, exact: r.is_exact !== false,
});

export default function Explore() {
  const { t, lang } = useI18n();
  const { status, coords, request } = useGeo();
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  const [openNow, setOpenNow] = useState(false);
  const [hint, setHint] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [ratings, setRatings] = useState<Record<string, { avg_rating: number; review_count: number }>>({});
  const [loading, setLoading] = useState(false);
  const [errKey, setErrKey] = useState('');
  const [hasMore, setHasMore] = useState(false);
  const reqId = useRef(0);

  useEffect(() => {
    // If the browser already remembers permission, skip the button
    void navigator.permissions?.query({ name: 'geolocation' }).then((p) => { if (p.state === 'granted') request(); }).catch(() => undefined);
  }, [request]);

  useEffect(() => {
    const id = setTimeout(() => setDq(q.trim()), 400);
    return () => clearTimeout(id);
  }, [q]);

  // Rotate the light example text in the empty search bar every 2 seconds
  useEffect(() => {
    if (q) return;
    const id = setInterval(() => setHint((h) => (h + 1) % SEARCH_HINTS.length), 2000);
    return () => clearInterval(id);
  }, [q]);

  // Keyboard "Search" key: search right away and close the keyboard
  function onSearch(e: FormEvent) {
    e.preventDefault();
    setDq(q.trim());
    inputRef.current?.blur();
  }

  const load = useCallback(async (offset: number) => {
    if (!coords) return;
    const id = ++reqId.current;
    setLoading(true); setErrKey('');
    const base = {
      p_lat: coords.lat, p_lng: coords.lng, p_category: null, p_max_price: null,
      p_open_now: openNow, p_sort: 'distance', p_limit: PAGE, p_offset: offset,
    };
    const svc = dq.length > 0;
    const res = svc ? await supabase.rpc('search_services', { ...base, p_query: dq }) : await supabase.rpc('nearby_businesses', base);
    if (id !== reqId.current) return;
    setLoading(false);
    if (res.error) { console.error(res.error); setErrKey('err.generic'); return; }
    const mapped = ((res.data ?? []) as any[]).map(svc ? fromSvc : fromBiz);
    setRows((prev) => (offset === 0 ? mapped : [...prev, ...mapped]));
    setHasMore(mapped.length === PAGE);
    trackImpressions(mapped.map((r) => r.bid));   // shops shown on screen; anonymous, de-duplicated by the database
    const m = await signedUrlMap(mapped.map((r) => r.cover).filter((x): x is string => !!x));
    if (id === reqId.current) setUrls((prev) => ({ ...prev, ...m }));
    const ids = [...new Set(mapped.map((r) => r.bid))];
    if (ids.length > 0) {
      const rt = await supabase.from('public_business_ratings').select('business_id,avg_rating,review_count').in('business_id', ids);
      const got = (rt.data ?? []) as { business_id: string; avg_rating: number; review_count: number }[];
      if (id === reqId.current) setRatings((prev) => ({ ...prev, ...Object.fromEntries(got.map((x) => [x.business_id, x])) }));
    }
  }, [coords, dq, openNow]);

  useEffect(() => { void load(0); }, [load]);

  if (!coords) {
    return (
      <section className="mx-auto max-w-md space-y-4 px-4 py-10 text-center">
        <h1 className="font-display text-2xl font-semibold">{t('explore.title')}</h1>
        <p className="text-ink/80">{t('explore.why')}</p>
        {status === 'denied' && <Msg error={t('explore.denied')} />}
        {status === 'error' && <Msg error={t('explore.unavailable')} />}
        {status === 'outside' && <Msg error={t('geo.outsideIndiaUser')} />}
        <button className="btn-primary w-full" disabled={status === 'asking'} onClick={request}>
          {status === 'asking' ? t('explore.locating') : status === 'denied' || status === 'error' || status === 'outside' ? t('explore.retry') : t('explore.allow')}
        </button>
      </section>
    );
  }

  return (
    <section className="mx-auto max-w-3xl space-y-4 px-4 py-6">
      <div className="explore-hero">
        <h1 className="font-display text-2xl font-semibold sm:text-3xl">{t('explore.title')}</h1>
        <p className="mt-0.5 flex items-center gap-1.5 text-sm text-ink/70">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="text-blush">
            <path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21Z" /><circle cx="12" cy="9.5" r="2.5" />
          </svg>
          {t('explore.within')}
        </p>

        <form role="search" onSubmit={onSearch} className="search-bar mt-4">
          <label htmlFor="q" className="sr-only">{t('home.search')}</label>
          <input
            ref={inputRef}
            id="q"
            type="search"
            enterKeyHint="search"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="search-input [&::-webkit-search-cancel-button]:appearance-none"
          />
          {!q && (
            <span key={hint} aria-hidden="true" className="hint-fade pointer-events-none absolute left-5 right-16 top-1/2 -translate-y-1/2 truncate text-base text-ink/40">
              {t('explore.eg')} {SEARCH_HINTS[hint]}
            </span>
          )}
          <button type="submit" aria-label={t('home.search')} className="search-btn">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
              <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
            </svg>
          </button>
        </form>

        <div className="chip-row mt-3">
          <button type="button" aria-pressed={openNow} onClick={() => setOpenNow((v) => !v)} className={`chip ${openNow ? 'chip-on' : ''}`}>
            <span className={`h-2 w-2 rounded-full ${openNow ? 'bg-white' : 'bg-green-500'}`} aria-hidden="true" />
            {t('explore.openNow')}
          </button>
          {SEARCH_HINTS.slice(0, 8).map((h) => (
            <button key={h} type="button" onClick={() => { setQ(h); setDq(h); inputRef.current?.blur(); }} className="chip capitalize">{h}</button>
          ))}
        </div>
      </div>

      <ReferralBanner />
      <BannerStrip lat={coords.lat} lng={coords.lng} />

      <Msg error={errKey ? t(errKey) : ''} />
      {loading && rows.length === 0 && [0, 1, 2].map((k) => <div key={k} className="h-72 animate-pulse rounded-3xl bg-ink/10" />)}
      {!loading && !errKey && rows.length === 0 && <p className="py-6 text-center text-ink/70">{t('explore.empty')}</p>}
      {dq && rows.length > 0 && !rows.some((r) => r.exact) && <p role="status" className="px-2 text-sm text-ink/70">{t('explore.similar', { q: dq })}</p>}

      <ul className="grid gap-4 sm:grid-cols-2">
        {rows.map((r) => {
          const rt = ratings[r.bid];
          const name = r.business ?? r.title;
          return (
            <li key={r.key}>
              <Link to={r.to} className="shop-card">
                <div className="shop-cover">
                  {r.cover && urls[r.cover]
                    ? <img src={urls[r.cover]} alt="" loading="lazy" />
                    : <div className="flex h-full w-full items-center justify-center font-display text-6xl font-semibold text-ink/30" aria-hidden="true">{name.slice(0, 1).toUpperCase()}</div>}
                  <div className="absolute left-3 top-3 z-10 flex gap-1.5">
                    <span className="shop-pill">
                      <span className={`h-2 w-2 rounded-full ${r.open ? 'bg-green-500' : 'bg-ink/40'}`} aria-hidden="true" />
                      {r.open ? t('explore.openNow') : t('explore.closedNow')}
                    </span>
                  </div>
                  <span className="shop-pill absolute bottom-3 right-3 z-10">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="text-blush"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21Z" /><circle cx="12" cy="9.5" r="2.5" /></svg>
                    {distanceLabel(r.distance)}
                  </span>
                </div>

                <div className="space-y-2 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="flex items-center gap-1.5 font-display text-lg font-semibold leading-tight">
                        <span className="truncate">{r.title}</span>{!r.business && r.verified && <VerifiedTick size={18} />}
                      </p>
                      {r.business && <p className="flex items-center gap-1.5 text-sm text-ink/80"><span className="truncate">{r.business}</span>{r.verified && <VerifiedTick size={14} />}</p>}
                    </div>
                    {r.price !== null && (
                      <div className="flex-none text-right">
                        {r.isFrom && <p className="text-[11px] leading-none text-ink/60">{t('explore.from')}</p>}
                        <p className="text-lg font-semibold leading-tight">{rupees(r.price)}</p>
                      </div>
                    )}
                  </div>

                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                    <span className="rounded-full bg-blush/25 px-2.5 py-1 font-semibold">{localName(r.catEn, r.catHi, r.catMr, lang)}</span>
                    {r.city && <span className="truncate text-ink/70">{r.city}</span>}
                  </p>

                  <p className="flex items-center gap-1.5 text-xs text-ink/70">
                    {rt ? <><Stars value={rt.avg_rating} /> <span className="font-semibold text-ink">{rt.avg_rating}</span> ({rt.review_count})</> : t('biz.noReviews')}
                    {r.services !== null ? <span>· {t('explore.services', { n: r.services })}</span> : null}
                  </p>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>

      {hasMore && (
        <button className="btn-secondary w-full" disabled={loading} onClick={() => void load(rows.length)}>
          {loading ? t('common.loading') : t('explore.loadMore')}
        </button>
      )}
    </section>
  );
}
