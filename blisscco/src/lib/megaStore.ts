// Mega Store Customer Reward Cycle: shared types and helpers (database: migration 0038).
// The Mega Store funds 100% of every shopping reward. Blisscco never pays or reimburses it.

export type MegaStoreStatus = 'pending_review' | 'approved' | 'rejected' | 'suspended';
export type MegaCampaignStatus = 'draft' | 'active' | 'paused' | 'ended';
export type MegaRewardType = 'percent' | 'flat';
export type MegaRewardState = 'active' | 'on_hold' | 'redeemed' | 'expired' | 'revoked' | 'rejected';

export interface MegaStore {
  id: string; name: string; description: string | null; phone: string | null; city: string | null;
  address_line: string | null; code: string; status: MegaStoreStatus; rejection_reason: string | null;
}
export interface MegaCampaign {
  id: string; title: string; description: string | null; status: MegaCampaignStatus; starts_at: string; ends_at: string;
  reward_type: MegaRewardType; reward_value: number; max_discount_inr: number | null; min_purchase_inr: number;
  min_service_price_inr: number; max_rewards_per_customer: number; one_reward_per_shop: boolean;
}
export interface MegaShop { id: string; name: string; city: string | null; status?: string }
export interface MegaStats {
  enrolled: number; issued: number; on_hold: number; redeemed: number; expired: number; active: number;
  discount_given_inr: number; bills_inr: number;
}
export interface MegaHeld { id: string; code: string; business_name: string; customer_name: string; risk_flags: string[]; created_at: string }
export interface MegaRecent { code: string; customer_name: string; business_name: string; bill_inr: number; discount_inr: number; redeemed_at: string }
export interface MegaDashboard {
  store: MegaStore | null; campaign: MegaCampaign | null; shops: MegaShop[]; stats: Partial<MegaStats>; held: MegaHeld[]; recent: MegaRecent[];
}

export interface MegaPublic {
  found: boolean;
  store?: { name: string; description: string | null; city: string | null };
  campaign?: {
    id: string; title: string; description: string | null; status: 'active' | 'paused'; starts_at: string; ends_at: string;
    reward_type: MegaRewardType; reward_value: number; max_discount_inr: number | null; min_purchase_inr: number;
    min_service_price_inr: number; max_rewards: number; one_reward_per_shop: boolean;
  } | null;
  shops?: MegaShop[];
  me?: { role: 'customer' | 'owner' | 'admin'; enrolled: boolean; earned: number } | null;
  server_now?: string;
}

export interface MyMegaReward {
  id: string; code: string; store_name: string; store_city: string | null; campaign_title: string; business_name: string;
  reward_type: MegaRewardType; reward_value: number; max_discount_inr: number | null; min_purchase_inr: number;
  state: MegaRewardState; issued_at: string | null; expires_at: string | null; redeemed_at: string | null;
  discount_given_inr: number | null; max_rewards: number;
}

export interface MegaLookup {
  id: string; code: string; customer_name: string; business_name: string; reward_type: MegaRewardType; reward_value: number;
  max_discount_inr: number | null; min_purchase_inr: number; state: MegaRewardState; issued_at: string | null;
  expires_at: string | null; redeemed_at: string | null; redeemed_bill_inr: number | null; discount_given_inr: number | null;
}

export interface AdminMegaStore {
  id: string; name: string; city: string | null; status: MegaStoreStatus; rejection_reason: string | null; created_at: string;
  owner_name: string | null; owner_email: string | null; campaign_title: string | null; campaign_status: MegaCampaignStatus | null;
  campaign_ends_at: string | null; shops: number; enrolled: number; issued: number; redeemed: number; discount_given_inr: number;
}

const KNOWN = [
  'owner_only', 'invalid_name', 'already_exists', 'not_found', 'name_locked', 'store_not_approved', 'invalid_title', 'invalid_dates',
  'invalid_value', 'campaign_locked', 'invalid_transition', 'no_campaign', 'no_shops', 'shop_not_found', 'own_shop', 'too_many_shops',
  'last_shop', 'customer_only', 'email_not_verified', 'declare_required', 'not_active', 'own_store', 'not_available', 'already_redeemed',
  'not_usable', 'expired', 'invalid_bill', 'below_min_purchase', 'invalid_status',
];
/** Database functions raise stable codes; map them to translated text (mg.err.<code>). */
export const megaErrKey = (message: string | undefined) => (message && KNOWN.includes(message) ? `mg.err.${message}` : 'err.generic');

/** "20% off (up to ₹500)" / "₹200 off" */
export function rewardLabel(type: MegaRewardType, value: number, maxDiscount: number | null, t: (k: string, v?: Record<string, string | number>) => string): string {
  const v = Number(value);
  if (type === 'percent') {
    return maxDiscount ? t('mg.pctOffCap', { v, max: Number(maxDiscount).toLocaleString('en-IN') }) : t('mg.pctOff', { v });
  }
  return t('mg.flatOff', { v: v.toLocaleString('en-IN') });
}

/** Campaign dates are whole days in India time: start = 00:00, end = 23:59:59 IST. */
export const istStartIso = (day: string) => new Date(`${day}T00:00:00+05:30`).toISOString();
export const istEndIso = (day: string) => new Date(`${day}T23:59:59+05:30`).toISOString();
export const istDayOf = (iso: string) => new Date(new Date(iso).getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);

export const campaignLink = (code: string) => `${window.location.origin}/mega/${code}`;
export const redeemLink = (code: string) => `${window.location.origin}/mega/redeem/${code}`;

/** Whole days left until an ISO date (0 when passed). */
export const daysLeft = (iso: string | null) => (iso ? Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000)) : 0);
