import { useI18n, type Lang } from '../../i18n';
import { formatDistance, formatDuration } from '../../lib/navigation/units';
import type { NavigationSnapshot, NavInstruction } from '../../lib/navigation/types';
import DirectionIcon from './DirectionIcon';

/** "Turn right in 150 m": the action first, the distance in the customer's own language and units. */
export function instructionText(t: (k: string, v?: Record<string, string | number>) => string, lang: Lang, i: NavInstruction): string {
  const action = t(`nav.ins.${i.kind}`);
  return i.distanceMeters >= 30 ? t('nav.inDistance', { action, distance: formatDistance(i.distanceMeters, lang) }) : action;
}

const iconBox = 'flex h-14 w-14 flex-none items-center justify-center rounded-2xl bg-ink text-white shadow-card';

function Banner({ icon, text, spin }: { icon: 'wifi' | 'gps' | 'route'; text: string; spin?: boolean }) {
  return (
    <div role="status" className="flex items-center gap-2.5 rounded-2xl bg-blush/20 px-3.5 py-2.5 text-sm font-medium ring-1 ring-ink/10">
      {spin
        ? <span className="h-5 w-5 flex-none animate-spin rounded-full border-[3px] border-ink/20 border-t-ink motion-reduce:animate-none" aria-hidden="true" />
        : (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-none" aria-hidden="true" focusable="false">
            {icon === 'wifi'
              ? <><path d="M2 8.8a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 20h.01" /><path d="M3 3l18 18" /></>
              : <><circle cx="12" cy="12" r="3" /><circle cx="12" cy="12" r="8" strokeDasharray="3 3" /></>}
          </svg>
        )}
      <span>{text}</span>
    </div>
  );
}

/** Compact card shown while navigating: remaining distance + time, the next instruction, progress, and an End button. */
export default function NavLiveCard({ snapshot, shopName, onEnd }: { snapshot: NavigationSnapshot; shopName: string; onEnd: () => void }) {
  const { t, lang } = useI18n();
  const { remainingDistance, remainingDuration, instruction, progressPercent, offRoute, rerouting, connectionLost, locationIssue } = snapshot;

  // one status message at a time, most important first. Every one has an icon AND words, never colour alone.
  const status = connectionLost ? { icon: 'wifi' as const, text: t('nav.connectionLost'), spin: false }
    : (offRoute || rerouting) ? { icon: 'route' as const, text: t('nav.rerouting'), spin: true }
    : locationIssue ? { icon: 'gps' as const, text: t('nav.gpsWeak'), spin: false }
    : null;

  // after a wrong turn the old instruction no longer applies
  const guide = offRoute ? null : instruction;
  const guideText = guide ? instructionText(t, lang, guide) : t('nav.ins.fallback', { shop: shopName });
  const street = guide && guide.kind !== 'arrive' && guide.streetName ? t('nav.ins.onto', { street: guide.streetName }) : '';
  const announce = status ? status.text : `${guideText}${street ? ` ${street}` : ''}`;

  return (
    <div className="card w-full max-w-md space-y-3 !rounded-[28px] !p-4 ring-2 ring-white/70" role="region" aria-label={t('nav.liveLabel')}>
      {/* announced politely to screen readers; the distance counting down is not part of it, so it does not chatter */}
      <p className="sr-only" role="status" aria-live="polite">{announce}</p>

      <div className="flex items-end justify-between gap-3">
        <p className="flex flex-wrap items-baseline gap-x-3">
          <span className="font-display text-3xl font-semibold leading-none">{remainingDistance !== null ? formatDistance(remainingDistance, lang) : '–'}</span>
          <span className="text-xl font-medium text-ink/70">{remainingDuration !== null ? formatDuration(remainingDuration, lang) : ''}</span>
        </p>
        <p className="min-w-0 max-w-[40%] truncate text-sm font-medium text-ink/60">{shopName}</p>
      </div>

      {status
        ? <Banner icon={status.icon} text={status.text} spin={status.spin} />
        : (
          <div className="flex items-center gap-3">
            <span className={iconBox}><DirectionIcon kind={guide ? guide.kind : 'straight'} /></span>
            <div className="min-w-0">
              <p className="text-lg font-semibold leading-snug">{guideText}</p>
              {street && <p className="truncate text-sm text-ink/60">{street}</p>}
            </div>
          </div>
        )}

      <div
        role="progressbar" aria-label={t('nav.progress')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progressPercent}
        aria-valuetext={t('nav.progressValue', { percent: progressPercent })}
        className="h-2.5 overflow-hidden rounded-full bg-blush/25"
      >
        <div className="h-full rounded-full bg-blush transition-[width] duration-500 motion-reduce:transition-none" style={{ width: `${progressPercent}%` }} />
      </div>

      <button type="button" className="btn-secondary min-h-[48px] w-full text-base" onClick={onEnd}>{t('nav.end')}</button>
    </div>
  );
}
