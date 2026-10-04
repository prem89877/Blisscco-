import { useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../i18n';
import { addDays, istToday } from '../lib/format';

interface Props {
  id: string;
  label: string;
  /** 'YYYY-MM-DD' */
  value: string;
  onChange: (v: string) => void;
  /** the only dates that can be picked ('YYYY-MM-DD'); every other day is greyed out */
  allowed: string[];
  disabled?: boolean;
}

const LOCALES = { en: 'en-IN', hi: 'hi-IN', mr: 'mr-IN' } as const;
const pad = (n: number) => String(n).padStart(2, '0');
const iso = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;

function CalendarIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg aria-hidden="true" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4.5" width="18" height="16.5" rx="3" /><path d="M3 9.5h18M8 2.5v4M16 2.5v4" />
    </svg>
  );
}

function Chevron({ dir }: { dir: 'left' | 'right' }) {
  return (
    <svg aria-hidden="true" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d={dir === 'left' ? 'm15 6-6 6 6 6' : 'm9 6 6 6-6 6'} />
    </svg>
  );
}

/** Calendar date picker: field with calendar icon -> popup month grid, month arrows, Today/Tomorrow shortcuts. */
export default function DatePicker({ id, label, value, onChange, allowed, disabled }: Props) {
  const { t, lang } = useI18n();
  const loc = LOCALES[lang];
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const allowedSet = useMemo(() => new Set(allowed), [allowed]);
  const today = istToday();
  const tomorrow = addDays(today, 1);

  const first = allowed[0] ?? today;
  const last = allowed[allowed.length - 1] ?? today;
  const ym = (d: string) => ({ y: Number(d.slice(0, 4)), m: Number(d.slice(5, 7)) - 1 });
  const [view, setView] = useState(() => ym(value || first));

  useEffect(() => { if (open) setView(ym(value || first)); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => { if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('touchstart', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const fmt = (d: string, o: Intl.DateTimeFormatOptions) => new Date(`${d}T00:00:00Z`).toLocaleDateString(loc, { ...o, timeZone: 'UTC' });
  const monthLabel = fmt(iso(view.y, view.m, 1), { month: 'long', year: 'numeric' });
  const weekdays = Array.from({ length: 7 }, (_, i) => fmt(addDays('2023-01-01', i), { weekday: 'short' }));   // 2023-01-01 is a Sunday
  const lead = new Date(Date.UTC(view.y, view.m, 1)).getUTCDay();
  const dim = new Date(Date.UTC(view.y, view.m + 1, 0)).getUTCDate();
  const cells: (number | null)[] = [...Array<null>(lead).fill(null), ...Array.from({ length: dim }, (_, i) => i + 1)];

  const f = ym(first); const l = ym(last);
  const canPrev = view.y > f.y || (view.y === f.y && view.m > f.m);
  const canNext = view.y < l.y || (view.y === l.y && view.m < l.m);
  const step = (n: number) => setView((v) => { const t0 = v.y * 12 + v.m + n; return { y: Math.floor(t0 / 12), m: t0 % 12 }; });

  const rel = new Intl.RelativeTimeFormat(loc, { numeric: 'auto' });
  const pick = (d: string) => { onChange(d); setOpen(false); };
  const shortcuts = [{ d: today, text: rel.format(0, 'day') }, { d: tomorrow, text: rel.format(1, 'day') }].filter((s) => allowedSet.has(s.d));

  return (
    <div className="space-y-1.5" ref={wrap}>
      <label htmlFor={id} className="text-sm font-medium">{label}</label>
      <div className="relative">
        <button id={id} type="button" disabled={disabled} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((o) => !o)}
          className="input flex items-center gap-3 text-left">
          <CalendarIcon className="h-5 w-5 flex-none text-blush" />
          <span className="flex-1 truncate">{value ? fmt(value, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : t('common.select')}</span>
          <svg aria-hidden="true" className={`h-4 w-4 flex-none transition ${open ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
        </button>

        {open && (
          <div role="dialog" aria-label={label} className="absolute left-0 right-0 z-30 mt-2 rounded-3xl bg-white p-4 shadow-xl ring-1 ring-ink/10">
            <div className="mb-3 flex items-center justify-between">
              <button type="button" aria-label="Previous month" disabled={!canPrev} onClick={() => step(-1)}
                className="flex h-10 w-10 items-center justify-center rounded-full text-ink transition hover:bg-blush/20 disabled:opacity-30"><Chevron dir="left" /></button>
              <p className="font-display text-base font-semibold capitalize">{monthLabel}</p>
              <button type="button" aria-label="Next month" disabled={!canNext} onClick={() => step(1)}
                className="flex h-10 w-10 items-center justify-center rounded-full text-ink transition hover:bg-blush/20 disabled:opacity-30"><Chevron dir="right" /></button>
            </div>

            <div className="grid grid-cols-7 gap-y-1 text-center">
              {weekdays.map((w, i) => <span key={i} className="pb-1 text-xs font-semibold text-ink/50">{w}</span>)}
              {cells.map((d, i) => {
                if (d === null) return <span key={`e${i}`} />;
                const ds = iso(view.y, view.m, d);
                const ok = allowedSet.has(ds);
                const sel = ds === value;
                const isToday = ds === today;
                return (
                  <button key={ds} type="button" disabled={!ok} aria-pressed={sel} aria-label={fmt(ds, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                    onClick={() => pick(ds)}
                    className={`mx-auto flex h-10 w-10 items-center justify-center rounded-full text-sm transition ${
                      sel ? 'bg-blush font-semibold text-ink shadow-md'
                        : ok ? `font-medium hover:bg-blush/25 ${isToday ? 'ring-2 ring-blush' : ''}`
                          : 'cursor-not-allowed text-ink/25 line-through decoration-ink/20'}`}>
                    {d}
                  </button>
                );
              })}
            </div>

            <div className="mt-3 flex items-center justify-between gap-2 border-t border-ink/10 pt-3">
              <div className="flex gap-2">
                {shortcuts.map((s) => (
                  <button key={s.d} type="button" className={`chip capitalize ${value === s.d ? 'chip-on' : ''}`} onClick={() => pick(s.d)}>{s.text}</button>
                ))}
              </div>
              <button type="button" className="btn-text-muted" onClick={() => setOpen(false)}>{t('common.cancel')}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
