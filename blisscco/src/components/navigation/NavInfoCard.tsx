import { useState } from 'react';
import { useI18n } from '../../i18n';
import { formatDistance, formatDuration } from '../../lib/navigation/units';
import type { NavigationSnapshot } from '../../lib/navigation/types';
import NavArrivedCard from './NavArrivedCard';
import NavErrorState from './NavErrorState';
import NavLiveCard from './NavLiveCard';

interface Props {
  snapshot: NavigationSnapshot;
  shopName: string;
  photoUrl?: string | null;
  address: string | null;
  /** Asks for location and calculates the route (idle screen). */
  onStart: () => void;
  /** Route preview -> live navigation. */
  onBegin: () => void;
  onEnd: () => void;
  onViewShop: () => void;
  onRetry: () => void;
  onBack: () => void;
}

/** Small round shop photo; falls back to a blush "B" badge. */
function ShopThumb({ url, size = 56 }: { url: string | null; size?: number }) {
  const [bad, setBad] = useState(false);
  const box = { width: size, height: size };
  return url && !bad
    ? <img src={url} alt="" style={box} className="flex-none rounded-2xl object-cover shadow-card ring-2 ring-blush" onError={() => setBad(true)} />
    : <span style={box} className="flex flex-none items-center justify-center rounded-2xl bg-blush font-display text-xl font-semibold shadow-card" aria-hidden="true">B</span>;
}

function Busy({ title, hint }: { title: string; hint?: string }) {
  return (
    <div role="status" aria-live="polite" className="flex items-center gap-3">
      <span className="h-6 w-6 flex-none animate-spin rounded-full border-[3px] border-blush/30 border-t-blush" aria-hidden="true" />
      <div>
        <p className="font-medium">{title}</p>
        {hint && <p className="text-sm text-ink/60">{hint}</p>}
      </div>
    </div>
  );
}

/** Bottom card of the navigation screen. Shows friendly text only: no coordinates, no technical data. */
export default function NavInfoCard({ snapshot, shopName, photoUrl = null, address, onStart, onBegin, onEnd, onViewShop, onRetry, onBack }: Props) {
  const { t, lang } = useI18n();
  const { navigationStatus: st } = snapshot;

  let body;
  if (st === 'error' && snapshot.error) {
    body = <NavErrorState code={snapshot.error} onRetry={onRetry} onBack={onBack} />;
  } else if (st === 'requesting_location') {
    body = <Busy title={t('nav.requesting')} hint={t('nav.requestingHint')} />;
  } else if (st === 'locating') {
    body = <Busy title={t('nav.locating')} />;
  } else if (st === 'calculating_route') {
    body = <Busy title={t('nav.calculating')} />;
  } else if (st === 'navigating') {
    return <NavLiveCard snapshot={snapshot} shopName={shopName} onEnd={onEnd} />;
  } else if (st === 'completed') {
    return <NavArrivedCard shopName={shopName} onViewShop={onViewShop} />;
  } else if (st === 'route_ready' && snapshot.routeDistance !== null && snapshot.estimatedDuration !== null) {
    body = (
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <ShopThumb url={photoUrl} />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-ink/70">{shopName}</p>
            <p className="mt-1 flex flex-wrap items-baseline gap-x-3">
              <span className="font-display text-3xl font-semibold leading-none">{formatDistance(snapshot.routeDistance, lang)}</span>
              <span className="rounded-full bg-blush/30 px-2.5 py-0.5 text-base font-semibold">{formatDuration(snapshot.estimatedDuration, lang)}</span>
            </p>
          </div>
        </div>
        {address && <p className="line-clamp-2 text-sm text-ink/60">{address}</p>}
        <div className="flex flex-col gap-2">
          <button type="button" className="btn-solid min-h-[52px] w-full text-base" onClick={onBegin}>{t('nav.start')}</button>
          <button type="button" className="btn-secondary w-full" onClick={onRetry}>{t('nav.refresh')}</button>
        </div>
      </div>
    );
  } else {
    // idle: the screen was opened directly (link / reload), so nothing has been asked yet
    body = (
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <ShopThumb url={photoUrl} />
          <div className="min-w-0">
            <p className="font-display text-xl font-semibold leading-snug">{shopName}</p>
            {address && <p className="mt-0.5 line-clamp-2 text-sm text-ink/60">{address}</p>}
          </div>
        </div>
        <p className="text-sm text-ink/70">{t('nav.startHint')}</p>
        <button type="button" className="btn-solid w-full" onClick={onStart}>{t('nav.start')}</button>
      </div>
    );
  }

  return (
    <div className="card w-full max-w-md !rounded-[28px] ring-2 ring-white/70">
      <span className="mx-auto mb-3 block h-1 w-10 rounded-full bg-ink/15" aria-hidden="true" />
      {body}
    </div>
  );
}
