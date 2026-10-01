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
export const fmtDateTime = (iso: string, lang: Lang) => new Date(iso).toLocaleString(LOCALES[lang], { timeZone: IST, day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
export const fmtTime = (iso: string, lang: Lang) => new Date(iso).toLocaleTimeString(LOCALES[lang], { timeZone: IST, hour: 'numeric', minute: '2-digit' });
export const istDayStartIso = (d: string) => new Date(`${d}T00:00:00+05:30`).toISOString();
