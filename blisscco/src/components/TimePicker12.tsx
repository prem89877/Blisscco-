import { useI18n } from '../i18n';

interface Props {
  /** 24-hour 'HH:MM' (this is what the database stores) */
  value: string;
  onChange: (v: string) => void;
  label: string;
  disabled?: boolean;
  /** minute step in the list (default 5) */
  step?: number;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Time picker that ALWAYS shows hour / minute / AM-PM (a plain <input type="time"> follows the phone's 24-hour setting). */
export default function TimePicker12({ value, onChange, label, disabled, step = 5 }: Props) {
  const { t } = useI18n();
  const [hs, ms] = (value || '10:00').split(':');
  const h24 = Math.min(23, Math.max(0, Number(hs) || 0));
  const min = Math.min(59, Math.max(0, Number(ms) || 0));
  const pm = h24 >= 12;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;

  const minutes = Array.from({ length: Math.ceil(60 / step) }, (_, i) => i * step);
  if (!minutes.includes(min)) { minutes.push(min); minutes.sort((a, b) => a - b); }   // keep an odd saved minute selectable

  function emit(nh12: number, nm: number, npm: boolean) {
    onChange(`${pad((nh12 % 12) + (npm ? 12 : 0))}:${pad(nm)}`);
  }

  return (
    <div role="group" aria-label={label} className="flex items-center gap-2">
      <select aria-label={`${label} – ${t('time.hour')}`} className="input input-compact w-auto" disabled={disabled} value={h12}
        onChange={(e) => emit(Number(e.target.value), min, pm)}>
        {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
      </select>
      <span aria-hidden="true" className="font-semibold">:</span>
      <select aria-label={`${label} – ${t('time.minute')}`} className="input input-compact w-auto" disabled={disabled} value={min}
        onChange={(e) => emit(h12, Number(e.target.value), pm)}>
        {minutes.map((n) => <option key={n} value={n}>{pad(n)}</option>)}
      </select>
      <select aria-label={`${label} – AM/PM`} className="input input-compact w-auto" disabled={disabled} value={pm ? 'PM' : 'AM'}
        onChange={(e) => emit(h12, min, e.target.value === 'PM')}>
        <option value="AM">AM</option>
        <option value="PM">PM</option>
      </select>
    </div>
  );
}
