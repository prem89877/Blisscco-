import { useI18n } from '../i18n';

const SIZES = { sm: '', md: 'text-lg', lg: 'text-2xl' } as const;

export function Stars({ value, size = 'sm' }: { value: number; size?: keyof typeof SIZES }) {
  const full = Math.round(value);
  return (
    <span aria-label={`${value} / 5`} className={`whitespace-nowrap tracking-wide text-amber-500 ${SIZES[size]}`}>
      {'★'.repeat(full)}<span className="text-ink/20">{'★'.repeat(5 - full)}</span>
    </span>
  );
}

export function StarInput({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const { t } = useI18n();
  return (
    <div className="flex gap-1" role="group">
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" aria-label={t('rv.stars', { n })} aria-pressed={value === n} onClick={() => onChange(n)}
          className={`flex h-11 w-11 items-center justify-center text-3xl ${n <= value ? 'text-amber-500' : 'text-ink/20'}`}>★</button>
      ))}
    </div>
  );
}
