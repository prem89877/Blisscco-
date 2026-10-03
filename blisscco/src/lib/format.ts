import type { Category } from './types';
import type { Lang } from '../i18n';

export const rupees = (n: number) => `₹${Number(n).toLocaleString('en-IN')}`;

export function catName(c: Pick<Category, 'name_en' | 'name_hi' | 'name_mr'>, lang: Lang): string {
  return (lang === 'hi' ? c.name_hi : lang === 'mr' ? c.name_mr : null) || c.name_en;
}

export const directionsUrl = (lat: number, lng: number) =>
  `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${lat},${lng}`)}`;

export const mapsPointUrl = (lat: number, lng: number) =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${lat},${lng}`)}`;

export const hhmm = (v: string | null) => (v ? v.slice(0, 5) : '');

/** 12-hour clock for every time shown on the site: '15:30' (or '15:30:00') -> '3:30 PM'. Storage and logic stay 24-hour. */
export function fmt12(v: string | null | undefined): string {
  if (!v) return '';
  const [hs, ms = '0'] = v.split(':');
  const h = Number(hs);
  const m = Number(ms);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return v;
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h % 24 >= 12 ? 'PM' : 'AM'}`;
}
/** Opening-hours range for display: '10:00:00', '20:00:00' -> '10:00 AM – 8:00 PM' */
export const hoursRange = (opens: string | null, closes: string | null) => `${fmt12(opens)} – ${fmt12(closes)}`;

export function localName(en: string, hi: string | null, mr: string | null, lang: Lang): string {
  return (lang === 'hi' ? hi : lang === 'mr' ? mr : null) || en;
}

export const distanceLabel = (m: number) => (m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`);

const IST = 'Asia/Kolkata';
const LOCALES: Record<Lang, string> = { en: 'en-IN', hi: 'hi-IN', mr: 'mr-IN' };
export const istToday = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
export const addDays = (d: string, n: number) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
export const dowOf = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay();
export const fmtDate = (d: string, lang: Lang) => new Date(`${d}T00:00:00Z`).toLocaleDateString(LOCALES[lang], { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const istParts = (iso: string) => { const d = new Date(new Date(iso).getTime() + 5.5 * 3600 * 1000); return { h: d.getUTCHours(), m: d.getUTCMinutes() }; };
/** Time of day in India time, 12-hour with AM/PM (same on every phone, in every language). */
export const fmtTime = (iso: string, _lang?: Lang) => { const { h, m } = istParts(iso); return fmt12(`${h}:${m}`); };
/** e.g. '5 Oct, 3:30 PM' (date in the chosen language, time always 12-hour AM/PM) */
export const fmtDateTime = (iso: string, lang: Lang) =>
  `${new Date(iso).toLocaleDateString(LOCALES[lang], { timeZone: IST, day: 'numeric', month: 'short' })}, ${fmtTime(iso)}`;
export const istDayStartIso = (d: string) => new Date(`${d}T00:00:00+05:30`).toISOString();
