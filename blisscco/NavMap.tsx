import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { useI18n } from '../../i18n';
import { loadMapProvider, mapCreateDefaults, type MapController } from '../../lib/navigation/MapProvider';
import type { Destination, Route, UserLocation } from '../../lib/navigation/types';

export interface NavMapHandle { recenter: () => void }

interface Props {
  destination: Destination;
  userLocation: UserLocation | null;
  route: Route | null;
  /** Space (px) covered by the top bar / bottom info card, so the route is fitted into the visible part of the map. */
  insets: { top: number; bottom: number };
  onError: () => void;
}

/** Full-size map. Created only when this component mounts (i.e. when the navigation screen opens); the map library is loaded lazily. */
const NavMap = forwardRef<NavMapHandle, Props>(function NavMap({ destination, userLocation, route, insets, onError }, ref) {
  const { t } = useI18n();
  const box = useRef<HTMLDivElement>(null);
  const [ctrl, setCtrl] = useState<MapController | null>(null);
  const onErrorRef = useRef(onError);
  const insetsRef = useRef(insets);
  onErrorRef.current = onError;
  insetsRef.current = insets;

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
        setCtrl(c);
      } catch {
        if (!cancelled) onErrorRef.current();
      }
    })();
    return () => { cancelled = true; setCtrl(null); created?.destroy(); };
  }, [lat, lng]);

  useEffect(() => { ctrl?.setDestination({ lat, lng }, destination.name); }, [ctrl, lat, lng, destination.name]);

  useEffect(() => {
    if (!ctrl) return;
    ctrl.setUserLocation(userLocation?.position ?? null, userLocation?.accuracyMeters ?? null);
    if (userLocation && !route) ctrl.fitToRoute(insetsRef.current);   // preview: you + the shop while the route is being calculated
  }, [ctrl, userLocation, route]);

  useEffect(() => {
    if (!ctrl) return;
    ctrl.setRoute(route?.path ?? null);
    if (route) ctrl.fitToRoute(insetsRef.current);
  }, [ctrl, route]);

  useImperativeHandle(ref, () => ({ recenter: () => ctrl?.fitToRoute(insetsRef.current) }), [ctrl]);

  return <div ref={box} className="bc-map absolute inset-0" role="application" aria-label={t('nav.mapLabel')} />;
});

export default NavMap;
