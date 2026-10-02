import type { Coupon } from './types';

const KEY = 'blisscco.ref';

// Remember a referral code from a link like https://site/?ref=ABCD1234 until the person signs up.
export function captureRefFromUrl() {
  try {
    const v = new URLSearchParams(window.location.search).get('ref');
    if (v && /^[A-Za-z0-9]{6,12}$/.test(v)) localStorage.setItem(KEY, v.toUpperCase());
  } catch { /* storage unavailable */ }
}
export const getStoredRef = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
export const clearRef = () => { try { localStorage.removeItem(KEY); } catch { /* ignore */ } };

type T = (key: string, vars?: Record<string, string | number>) => string;

export function couponText(c: Pick<Coupon, 'discount_type' | 'discount_value' | 'max_discount_inr'>, t: T): string {
  return c.discount_type === 'percent'
    ? t('cp.percent', { v: Number(c.discount_value), max: Number(c.max_discount_inr ?? 0) })
    : t('cp.flat', { v: Number(c.discount_value) });
}
export const couponState = (c: Pick<Coupon, 'status' | 'expires_at'>) =>
  c.status === 'active' && new Date(c.expires_at) <= new Date() ? 'expired' : c.status;
export const previewDiscount = (c: Pick<Coupon, 'discount_type' | 'discount_value' | 'max_discount_inr'>, price: number) =>
  Math.round((c.discount_type === 'percent' ? Math.min((price * Number(c.discount_value)) / 100, Number(c.max_discount_inr ?? price)) : Math.min(Number(c.discount_value), price)) * 100) / 100;
