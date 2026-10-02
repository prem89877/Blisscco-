import { useI18n } from '../i18n';

export function VerifiedTick({ size = 18 }: { size?: number }) {
  const { t } = useI18n();
  return (
    <svg role="img" aria-label={t('p8.verified')} width={size} height={size} viewBox="0 0 24 24" className="inline-block flex-none align-text-bottom">
      <title>{t('p8.verified')}</title>
      <circle cx="12" cy="12" r="11" fill="#1D9BF0" />
      <path d="M7 12.5l3.2 3.2L17 8.9" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function TierChip({ rank }: { rank: number }) {
  if (rank < 1) return null;
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wide ${rank >= 2 ? 'bg-ink text-amber-300' : 'bg-blush/40 text-ink'}`}>
      {rank >= 2 ? 'ELITE' : 'PRO'}
    </span>
  );
}
