import type { InstructionKind } from '../../lib/navigation/types';

// Blisscco-style line icons for each plain instruction. Decorative: the instruction text always says the same thing.

const ARROW = <path d="M12 19V5M5 12l7-7 7 7" />;
const rotated = (deg: number) => <g transform={`rotate(${deg} 12 12)`}>{ARROW}</g>;

const ICONS: Record<InstructionKind, JSX.Element> = {
  straight: ARROW,
  left: <path d="M18 20v-6a4 4 0 0 0-4-4H5M9 5l-4 5 4 5" />,
  right: <path d="M6 20v-6a4 4 0 0 1 4-4h9M15 5l4 5-4 5" />,
  slight_left: rotated(-45),
  slight_right: rotated(45),
  sharp_left: rotated(-130),
  sharp_right: rotated(130),
  uturn: <path d="M8 20V9a4 4 0 0 1 8 0v7M12 12l4 4 4-4" />,
  keep_left: rotated(-22),
  keep_right: rotated(22),
  roundabout: <><circle cx="12" cy="15" r="4" /><path d="M12 11V3M9 6l3-3 3 3" /></>,
  arrive: <path d="M6 21V4M6 4h11l-2.5 4L17 12H6" />,
};

export default function DirectionIcon({ kind, size = 28 }: { kind: InstructionKind; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {ICONS[kind]}
    </svg>
  );
}
