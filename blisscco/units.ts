import type { Lang } from '../../i18n';

// Distance / time text for the customer. Metric by default; miles where the device region uses them.
const LOCALES: Record<Lang, string> = { en: 'en-IN', hi: 'hi-IN', mr: 'mr-IN' };
const MILE_REGIONS = new Set(['US', 'GB', 'LR', 'MM']);

function usesMiles(): boolean {
  try {
    const region = new Intl.Locale(navigator.language).region;
    return !!region && MILE_REGIONS.has(region);
  } catch {
    return false;
  }
}

function unitText(value: number, unit: string, locale: string, maxFraction: number, fallback: string): string {
  try {
    return new Intl.NumberFormat(locale, { style: 'unit', unit, unitDisplay: 'short', maximumFractionDigits: maxFraction } as Intl.NumberFormatOptions).format(value);
  } catch {
    return `${Number(value.toFixed(maxFraction))} ${fallback}`;
  }
}

/** 1800 -> "1.8 km", 450 -> "450 m" (or miles / feet for US / UK style locales). */
export function formatDistance(meters: number, lang: Lang): string {
  const locale = LOCALES[lang];
  const m = Math.max(0, meters);
  if (usesMiles()) {
    const miles = m / 1609.344;
    if (miles < 0.1) return unitText(Math.max(10, Math.round((m * 3.28084) / 10) * 10), 'foot', locale, 0, 'ft');
    return unitText(miles, 'mile', locale, miles < 10 ? 1 : 0, 'mi');
  }
  if (m < 1000) return unitText(Math.max(10, Math.round(m / 10) * 10), 'meter', locale, 0, 'm');
  const km = m / 1000;
  return unitText(km, 'kilometer', locale, km < 10 ? 1 : 0, 'km');
}

/** 360 -> "6 min", 4000 -> "1 hr 7 min". */
export function formatDuration(seconds: number, lang: Lang): string {
  const locale = LOCALES[lang];
  const totalMin = Math.max(1, Math.round(seconds / 60));
  if (totalMin < 60) return unitText(totalMin, 'minute', locale, 0, 'min');
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m ? `${unitText(h, 'hour', locale, 0, 'h')} ${unitText(m, 'minute', locale, 0, 'min')}` : unitText(h, 'hour', locale, 0, 'h');
}
