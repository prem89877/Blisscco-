import { useI18n } from '../../i18n';
import type { NavigationErrorCode } from '../../lib/navigation/types';

const KEYS: Record<NavigationErrorCode, string> = {
  browser_unsupported: 'unsupported',
  location_denied: 'denied',
  location_unavailable: 'unavailable',
  location_timeout: 'timeout',
  destination_unavailable: 'destination',
  route_failed: 'route',
  network_unavailable: 'network',
  provider_unavailable: 'provider',
  map_unavailable: 'map',
};

// Retrying cannot help these until something outside the app changes, so the button reads "Back to shop" only.
const NO_RETRY: NavigationErrorCode[] = ['browser_unsupported', 'destination_unavailable'];

/** Friendly error panel. Never shows technical details. */
export default function NavErrorState({ code, onRetry, onBack }: { code: NavigationErrorCode; onRetry: () => void; onBack: () => void }) {
  const { t } = useI18n();
  const k = KEYS[code];
  return (
    <div role="alert" className="space-y-3">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-blush/25 text-ink" aria-hidden="true">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16.5h.01" /></svg>
        </span>
        <div className="min-w-0">
          <h2 className="font-display text-lg font-semibold leading-snug">{t(`nav.err.${k}.title`)}</h2>
          <p className="mt-0.5 text-sm text-ink/70">{t(`nav.err.${k}.body`)}</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {!NO_RETRY.includes(code) && <button type="button" className="btn-solid" onClick={onRetry}>{t('nav.retry')}</button>}
        <button type="button" className="btn-secondary" onClick={onBack}>{t('nav.backToShop')}</button>
      </div>
    </div>
  );
}
