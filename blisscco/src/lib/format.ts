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
