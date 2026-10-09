import type { Lang } from '../i18n/messages';
import { fmtDate } from './format';

type T = (key: string, vars?: Record<string, string | number>) => string;

/** A shop's own offer / coupon code (shop_offers table) */
export interface ShopOffer {
  id: string; business_id: string; code: string; discount_type: 'percent' | 'flat'; discount_value: number;
  max_discount_inr: number | null; min_spend_inr: number; starts_at: string | null; ends_at: string | null;
  is_active: boolean; created_at: string;
}

/** One live offer as returned to the browse page (get_shop_offers) */
export interface PublicOffer {
  business_id: string; offer_id: string; code: string; discount_type: 'percent' | 'flat'; discount_value: number;
  max_discount_inr: number | null; min_spend_inr: number; ends_at: string | null;
}

/** "20% OFF" or "₹100 OFF" */
export const offerBadge = (o: { discount_type: 'percent' | 'flat'; discount_value: number }, t: T): string =>
  o.discount_type === 'percent' ? t('of.pctOff', { v: Number(o.discount_value) }) : t('of.flatOff', { v: Number(o.discount_value) });

/** 'YYYY-MM-DD' of an instant, in Indian time */
export const istDate = (iso: string): string => new Date(new Date(iso).getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);

export const offerEndsText = (ends: string | null, lang: Lang, t: T): string => (ends ? t('of.till', { d: fmtDate(istDate(ends), lang) }) : '');

export type OfferState = 'live' | 'paused' | 'scheduled' | 'expired';
export function offerState(o: Pick<ShopOffer, 'is_active' | 'starts_at' | 'ends_at'>, now = Date.now()): OfferState {
  if (!o.is_active) return 'paused';
  if (o.ends_at && new Date(o.ends_at).getTime() <= now) return 'expired';
  if (o.starts_at && new Date(o.starts_at).getTime() > now) return 'scheduled';
  return 'live';
}
