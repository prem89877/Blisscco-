import { useI18n } from '../../i18n';
import { formatDistance, formatDuration } from '../../lib/navigation/units';
import type { NavigationSnapshot } from '../../lib/navigation/types';
import NavErrorState from './NavErrorState';

interface Props {
  snapshot: NavigationSnapshot;
  shopName: string;
  address: string | null;
  onStart: () => void;
  onRetry: () => void;
  onBack: () => void;
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
export default function NavInfoCard({ snapshot, shopName, address, onStart, onRetry, onBack }: Props) {
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
  } else if ((st === 'route_ready' || st === 'navigating' || st === 'completed') && snapshot.routeDistance !== null && snapshot.estimatedDuration !== null) {
    body = (
      <div className="space-y-3">
        <div>
          <p className="truncate text-sm font-medium text-ink/70">{shopName}</p>
          <p className="mt-1 flex flex-wrap items-baseline gap-x-3">
            <span className="font-display text-3xl font-semibold leading-none">{formatDistance(snapshot.routeDistance, lang)}</span>
            <span className="text-xl font-medium text-ink/70">{formatDuration(snapshot.estimatedDuration, lang)}</span>
          </p>
          {address && <p className="mt-1.5 line-clamp-2 text-sm text-ink/60">{address}</p>}
        </div>
        <button type="button" className="btn-secondary" onClick={onRetry}>{t('nav.refresh')}</button>
      </div>
    );
  } else {
    // idle: the screen was opened directly (link / reload), so nothing has been asked yet
    body = (
      <div className="space-y-3">
        <div>
          <p className="font-display text-xl font-semibold leading-snug">{shopName}</p>
          {address && <p className="mt-1 line-clamp-2 text-sm text-ink/60">{address}</p>}
          <p className="mt-2 text-sm text-ink/70">{t('nav.startHint')}</p>
        </div>
        <button type="button" className="btn-solid w-full" onClick={onStart}>{t('nav.start')}</button>
      </div>
    );
  }

  return <div className="card w-full max-w-md">{body}</div>;
}
