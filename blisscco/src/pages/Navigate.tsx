import { useCallback, useEffect, useRef, useState } from 'react';
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

const round = 'flex h-11 w-11 items-center justify-center rounded-full bg-white text-ink shadow-card ring-1 ring-ink/10 transition active:scale-95';

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
  const [mapFailed, setMapFailed] = useState(false);
  const [mapKey, setMapKey] = useState(0);
  const [bottomInset, setBottomInset] = useState(280);

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
        if (!ctrl.signal.aborted) setDest(d);
      } catch (e) {
        if (ctrl.signal.aborted) return;
        setDestError(e instanceof NavigationError ? e.code : 'destination_unavailable');
        setDest(null);
      }
    })();
    return () => ctrl.abort();
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

  const backButton = (
    <button type="button" className={round} onClick={back} aria-label={t('nav.back')}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>
    </button>
  );

  if (dest === undefined || dest === null) {
    return (
      <div className="fixed inset-0 flex flex-col bg-cream p-3">
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
  const canRecenter = !mapFailed && (st === 'route_ready' || st === 'navigating' || st === 'completed');

  return (
    <div className="fixed inset-0 overflow-hidden bg-cream">
      <Seo title={`${t('nav.title')} · ${dest.name} | Blisscco`} noindex />

      {!mapFailed && (
        <div className="absolute inset-0 isolate">
          <NavMap key={mapKey} ref={mapRef} destination={dest} userLocation={userLocation} route={route}
            insets={{ top: 96, bottom: bottomInset }} onError={() => setMapFailed(true)} />
        </div>
      )}

      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-center gap-2 p-3" style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 0.75rem)' }}>
        <div className="pointer-events-auto">{backButton}</div>
        <p className="pointer-events-auto max-w-[50vw] truncate rounded-full bg-white px-4 py-2.5 text-sm font-medium shadow-card ring-1 ring-ink/10 sm:max-w-sm">{dest.name}</p>
      </div>

      <div ref={stack} className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex flex-col items-center gap-3 p-3" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 0.75rem)' }}>
        {canRecenter && (
          <button type="button" className={`${round} pointer-events-auto self-end`} onClick={() => mapRef.current?.recenter()} aria-label={t('nav.recenter')} title={t('nav.recenter')}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3" /><circle cx="12" cy="12" r="8" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /></svg>
          </button>
        )}
        <div className="pointer-events-auto flex w-full justify-center">
          {mapFailed
            ? <div className="card w-full max-w-md"><NavErrorState code="map_unavailable" onRetry={() => { setMapFailed(false); setMapKey((k) => k + 1); }} onBack={toShop} /></div>
            : <NavInfoCard snapshot={snapshot} shopName={dest.name} address={dest.address} onStart={start} onRetry={retry} onBack={toShop} />}
        </div>
      </div>
    </div>
  );
}
