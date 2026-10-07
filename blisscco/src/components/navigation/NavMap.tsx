import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { useI18n } from '../../i18n';
import { loadMapProvider, mapCreateDefaults, type MapController } from '../../lib/navigation/MapProvider';
import type { Destination, Route, UserLocation } from '../../lib/navigation/types';

export interface NavMapHandle { recenter: () => void }

interface Props {
  destination: Destination;
  /** First shop photo (signed URL), shown small inside the shop pin. */
  photoUrl?: string | null;
  userLocation: UserLocation | null;
  route: Route | null;
  /** Space (px) covered by the top bar / bottom info card, so the route is fitted into the visible part of the map. */
  insets: { top: number; bottom: number };
  /** Live navigation is running (tracking). Before that the map only previews the route. */
  navigating: boolean;
  /** Follow mode: the map keeps the customer in view. Turned off by the customer moving / zooming the map, back on by Recenter. */
  following: boolean;
  onManualMove: () => void;
  onError: () => void;
}

/** Full-size map. Created only when this component mounts (i.e. when the navigation screen opens); the map library is loaded lazily. */
const NavMap = forwardRef<NavMapHandle, Props>(function NavMap({ destination, photoUrl = null, userLocation, route, insets, navigating, following, onManualMove, onError }, ref) {
  const { t } = useI18n();
  const box = useRef<HTMLDivElement>(null);
  const [ctrl, setCtrl] = useState<MapController | null>(null);
  const onErrorRef = useRef(onError);
  const insetsRef = useRef(insets);
  const manualRef = useRef(onManualMove);
  const navigatingRef = useRef(navigating);
  onErrorRef.current = onError;
  insetsRef.current = insets;
  manualRef.current = onManualMove;
  navigatingRef.current = navigating;

  const { lat, lng } = destination.position;
  const nameRef = useRef(destination.name);
  nameRef.current = destination.name;
  const youLabel = t('nav.you');
  const youRef = useRef(youLabel);
  youRef.current = youLabel;

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    let cancelled = false;
    let created: MapController | null = null;
    void (async () => {
      try {
        const provider = await loadMapProvider();
        if (cancelled) return;
        const c = provider.create(el, {
          ...mapCreateDefaults(), center: { lat, lng },
          labels: { destination: nameRef.current, you: youRef.current },
        });
        created = c;
        c.setDestination({ lat, lng }, nameRef.current);
        c.onManualMove(() => manualRef.current());
        setCtrl(c);
      } catch {
        if (!cancelled) onErrorRef.current();
      }
    })();
    return () => { cancelled = true; setCtrl(null); created?.destroy(); };
  }, [lat, lng]);

  useEffect(() => { ctrl?.setDestination({ lat, lng }, destination.name); }, [ctrl, lat, lng, destination.name]);
  useEffect(() => { ctrl?.setDestinationPhoto(photoUrl); }, [ctrl, photoUrl]);

  useEffect(() => {
    if (!ctrl) return;
    ctrl.setUserLocation(userLocation?.position ?? null, userLocation?.accuracyMeters ?? null, userLocation?.headingDegrees ?? null);
    if (userLocation && !route) ctrl.fitToRoute(insetsRef.current);   // preview: you + the shop while the route is being calculated
  }, [ctrl, userLocation, route]);

  useEffect(() => {
    if (!ctrl) return;
    ctrl.setRoute(route?.path ?? null);
    // During navigation a new route (after a wrong turn) must not throw the camera around: the customer's own view stays.
    if (route && !navigatingRef.current) ctrl.fitToRoute(insetsRef.current);
  }, [ctrl, route]);

  useEffect(() => { ctrl?.setInsets(insets); }, [ctrl, insets]);

  // follow mode only exists while navigating
  useEffect(() => { ctrl?.setFollowing(navigating && following, insetsRef.current); }, [ctrl, navigating, following]);

  useImperativeHandle(ref, () => ({
    recenter: () => {
      if (!ctrl) return;
      if (navigatingRef.current) ctrl.setFollowing(true, insetsRef.current);   // back to the customer
      else ctrl.fitToRoute(insetsRef.current);                                // preview: the whole route
    },
  }), [ctrl]);

  return <div ref={box} className="bc-map absolute inset-0" role="application" aria-label={t('nav.mapLabel')} />;
});

export default NavMap;
