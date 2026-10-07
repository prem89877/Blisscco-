import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import NavErrorState from '../components/navigation/NavErrorState';
import NavInfoCard from '../components/navigation/NavInfoCard';
import NavMap, { type NavMapHandle } from '../components/navigation/NavMap';
import Seo from '../components/Seo';
import { useI18n } from '../i18n';
import { resolveDestination } from '../lib/navigation/GeocodingProvider';
import { useNavigation } from '../lib/navigation/useNavigation';
import { NavigationError, type Destination, type NavigationErrorCode } from '../lib/navigation/types';
import { supabase } from '../lib/supabase';
import { signedUrlMap } from '../lib/storage';

const round = 'flex h-12 w-12 items-center justify-center rounded-full bg-white text-ink shadow-card ring-2 ring-white/70 transition active:scale-95';

/** Customer navigation screen: /b/:id/navigate. Opened from the shop profile's "Navigate" button.
 *  Location permission is asked only after the Navigate tap (router state `autostart`) or the "Start navigation" button. */
export default function Navigate() {
  const { id } = useParams();
  const { t } = useI18n();
  const go = useNavigate();
  const loc = useLocation();
  const { service, snapshot } = useNavigation();

  const autostart = useRef(Boolean((loc.state as { autostart?: boolean } | null)?.autostart));
  const cameFromApp = useRef(loc.key !== 'default');
  const mapRef = useRef<NavMapHandle>(null);
  const stack = useRef<HTMLDivElement>(null);

  const [dest, setDest] = useState<Destination | null | undefined>(undefined);   // undefined = loading, null = unavailable
  const [destError, setDestError] = useState<NavigationErrorCode>('destination_unavailable');
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);   // owner's first business photo (small, shown on the map pin and cards)
  const [mapFailed, setMapFailed] = useState(false);
  const [mapKey, setMapKey] = useState(0);
  const [bottomInset, setBottomInset] = useState(280);
  // follow mode: the map keeps the customer in view while navigating; moving the map by hand turns it off, Recenter turns it on
  const [following, setFollowing] = useState(true);

  // shop data (same public view the profile page uses)
  useEffect(() => {
    if (!id) { setDest(null); return; }
    const ctrl = new AbortController();
    setDest(undefined);
    void (async () => {
      try {
        const { data, error } = await supabase.from('public_businesses')
          .select('id,name,address_line,city,state,pincode,latitude,longitude').eq('id', id).maybeSingle();
        if (ctrl.signal.aborted) return;
        if (error || !data) { setDestError(navigator.onLine === false ? 'network_unavailable' : 'destination_unavailable'); setDest(null); return; }
        const d = await resolveDestination(data as Parameters<typeof resolveDestination>[0], ctrl.signal);
        if (!ctrl.signal.aborted) setDest({ ...d, shopId: id });   // the routing backend checks the shop's saved location from this id
      } catch (e) {
        if (ctrl.signal.aborted) return;
        setDestError(e instanceof NavigationError ? e.code : 'destination_unavailable');
        setDest(null);
      }
    })();
    return () => ctrl.abort();
  }, [id]);

  // the shop's first photo (same order as the profile page: sort_order). Optional: without it the pin keeps its "B".
  useEffect(() => {
    if (!id) { setPhotoUrl(null); return; }
    let cancelled = false;
    setPhotoUrl(null);
    void (async () => {
      try {
        const { data } = await supabase.from('business_images').select('storage_path').eq('business_id', id).order('sort_order').limit(1);
        const path = (data as { storage_path: string }[] | null)?.[0]?.storage_path;
        if (!path) return;
        const urls = await signedUrlMap([path]);
        if (!cancelled && urls[path]) setPhotoUrl(urls[path]);
      } catch { /* the photo is only decoration */ }
    })();
    return () => { cancelled = true; };
  }, [id]);

  // Opened through the Navigate button: begin now (this is the moment location is requested), then drop the flag
  // so a page reload does not start by itself.
  useEffect(() => {
    if (!dest || !autostart.current) return;
    autostart.current = false;
    void service.start(dest);
    go(`${loc.pathname}${loc.search}`, { replace: true, state: null });
  }, [dest, service, go, loc.pathname, loc.search]);

  // keep the route inside the visible map area, above the bottom card
  useEffect(() => {
    const el = stack.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setBottomInset(Math.round(el.getBoundingClientRect().height) + 12));
    ro.observe(el);
    return () => ro.disconnect();
  }, [dest]);

  const back = useCallback(() => {
    if (cameFromApp.current) go(-1); else go(`/b/${id}`, { replace: true });
  }, [go, id]);
  const toShop = useCallback(() => go(`/b/${id}`, { replace: true }), [go, id]);

  const start = useCallback(() => { if (dest) void service.start(dest); }, [dest, service]);
  const retry = useCallback(() => { void service.retry(); }, [service]);
  const begin = useCallback(() => { setFollowing(true); service.beginNavigation(); }, [service]);
  const end = useCallback(() => { service.endNavigation(); }, [service]);
  const recenter = useCallback(() => { setFollowing(true); mapRef.current?.recenter(); }, []);
  const insets = useMemo(() => ({ top: 96, bottom: bottomInset }), [bottomInset]);

  const backButton = (
    <button type="button" className={round} onClick={back} aria-label={t('nav.back')}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>
    </button>
  );

  if (dest === undefined || dest === null) {
    return (
      <div className="fixed inset-0 flex flex-col bg-blush p-3">
        <Seo title={`${t('nav.title')} | Blisscco`} noindex />
        <div>{backButton}</div>
        <div className="flex flex-1 items-center justify-center px-1">
          <div className="card w-full max-w-md">
            {dest === undefined
              ? <div role="status" className="flex items-center gap-3"><span className="h-6 w-6 animate-spin rounded-full border-[3px] border-blush/30 border-t-blush" aria-hidden="true" /><p className="font-medium">{t('nav.loading')}</p></div>
              : <NavErrorState code={destError} onRetry={() => window.location.reload()} onBack={toShop} />}
          </div>
        </div>
      </div>
    );
  }

  const { navigationStatus: st, userLocation, route } = snapshot;
  const navigating = st === 'navigating';
  const canRecenter = !mapFailed && (st === 'route_ready' || navigating);
  const tracking = navigating && following;

  return (
    <div className="fixed inset-0 overflow-hidden bg-blush">
      <Seo title={`${t('nav.title')} · ${dest.name} | Blisscco`} noindex />

      {!mapFailed && (
        <div className="absolute inset-0 isolate">
          <NavMap key={mapKey} ref={mapRef} destination={dest} photoUrl={photoUrl} userLocation={userLocation} route={route}
            insets={insets} navigating={navigating} following={following} liveDot={st === 'route_ready' || navigating}
            onManualMove={() => { if (navigating) setFollowing(false); }} onError={() => setMapFailed(true)} />
        </div>
      )}

      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-center gap-2 p-3" style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 0.75rem)' }}>
        <div className="pointer-events-auto">{backButton}</div>
        <div className="pointer-events-auto flex h-12 min-w-0 max-w-[68vw] items-center gap-2 rounded-full bg-white py-1 pl-1 pr-4 shadow-card ring-2 ring-white/70 sm:max-w-sm">
          {photoUrl
            ? <img src={photoUrl} alt="" className="h-10 w-10 flex-none rounded-full object-cover ring-1 ring-ink/10" onError={() => setPhotoUrl(null)} />
            : <span className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-blush font-display text-lg font-semibold" aria-hidden="true">B</span>}
          <p className="truncate text-sm font-semibold">{dest.name}</p>
        </div>
      </div>

      <div ref={stack} className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex flex-col items-center gap-3 p-3" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 0.75rem)' }}>
        {canRecenter && (
          <button
            type="button" onClick={recenter} aria-label={t('nav.recenter')} aria-pressed={navigating ? tracking : undefined}
            className={`pointer-events-auto flex min-h-[48px] items-center gap-2 self-end rounded-full px-4 text-sm font-medium shadow-card ring-2 ring-white/70 transition active:scale-95 ${tracking ? 'bg-ink text-white' : 'bg-white text-ink'}`}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
              <circle cx="12" cy="12" r="3" fill={tracking ? 'currentColor' : 'none'} /><circle cx="12" cy="12" r="8" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
            </svg>
            {t('nav.recenterShort')}
          </button>
        )}
        <div className="pointer-events-auto flex w-full justify-center">
          {mapFailed
            ? <div className="card w-full max-w-md"><NavErrorState code="map_unavailable" onRetry={() => { setMapFailed(false); setMapKey((k) => k + 1); }} onBack={toShop} /></div>
            : <NavInfoCard snapshot={snapshot} shopName={dest.name} photoUrl={photoUrl} address={dest.address} onStart={start} onBegin={begin} onEnd={end} onViewShop={toShop} onRetry={retry} onBack={toShop} />}
        </div>
      </div>
    </div>
  );
}
