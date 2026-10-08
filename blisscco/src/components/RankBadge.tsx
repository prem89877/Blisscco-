import { useI18n } from '../i18n';

const SRC: Record<number, string> = { 1: '/badges/rank-1.png', 2: '/badges/rank-2.png', 3: '/badges/rank-3.png' };

/** Gold / silver / bronze badge for the top 3 of the Refer-a-Shop leaderboard (and the winner); "#n" for everyone else. */
export default function RankBadge({ rank, size = 32 }: { rank: number; size?: number }) {
  const { t } = useI18n();
  const src = SRC[rank];
  if (!src) return <span>#{rank}</span>;
  return <img src={src} alt={t(`sc.rank${rank}`)} height={size} style={{ height: size, width: 'auto', maxWidth: size * 1.4 }} className="inline-block object-contain" loading="lazy" />;
}
