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
  budget_inr: number | null; config: { pause_blocks_registrations?: boolean } | null;
}
export type MegaPartnerStatus = 'invited' | 'accepted' | 'declined' | 'withdrawn' | 'removed';
export interface MegaShop {
  id: string; name: string; city: string | null; status?: string;
  /** Only the owner dashboard fills these (per partner shop, this campaign). */
  partner_status?: MegaPartnerStatus; verified_services?: number; rewards_issued?: number; rewards_redeemed?: number;
}
export interface MegaLimits {
  min_discount_pct: number; max_discount_pct: number; min_flat_inr: number; max_flat_inr: number;
  max_partner_shops: number; min_budget_inr: number; max_budget_inr: number; updated_at?: string;
}
export interface MegaBudget {
  budget_inr: number | null; spent_inr: number; remaining_inr: number | null;
  outstanding_exposure_inr: number; uncapped_outstanding: number; shortfall_inr: number;
}
export interface MegaFlag {
  id: string; flag_type: string; severity: 'low' | 'medium' | 'high'; status: 'open' | 'confirmed'; source: 'system' | 'admin';
  created_at: string; business_name: string | null; customer_name: string; reward_code: string | null; reward_status: string | null;
}
/** Five numbers that must never be mixed up: enrolled (registrations), verified_services, issued, redeemed, discount_cost_inr. */
export interface MegaStats {
  enrolled: number; verified_services: number; issued: number; on_hold: number; redeemed: number; expired: number; active: number;
  revoked: number; discount_cost_inr: number; discount_given_inr: number; bills_inr: number;
}
export interface MegaHeld { id: string; code: string; business_name: string; customer_name: string; risk_flags: string[]; created_at: string }
export interface MegaRecent { code: string; customer_name: string; business_name: string; bill_inr: number; discount_inr: number; redeemed_at: string }
export interface MegaDashboard {
  store: MegaStore | null; campaign: MegaCampaign | null; shops: MegaShop[]; stats: Partial<MegaStats>; held: MegaHeld[]; recent: MegaRecent[];
  my_role?: 'owner' | 'manager'; can_manage?: boolean;       // managers can read and redeem; only the primary owner can change the campaign
  issuance_open?: boolean; registrations_open?: boolean;
  budget?: MegaBudget | null; flags?: MegaFlag[]; limits?: MegaLimits | null;
}

export interface MegaPublic {
  found: boolean;
  store?: { name: string; description: string | null; city: string | null };
  campaign?: {
    id: string; title: string; description: string | null; status: 'active' | 'paused';
    /** Server-made: 'expired' = the end date has passed although the owner never pressed "end". */
    state?: 'active' | 'paused' | 'expired';
    starts_at: string; ends_at: string;
    reward_type: MegaRewardType; reward_value: number; max_discount_inr: number | null; min_purchase_inr: number;
    min_service_price_inr: number; max_rewards: number; one_reward_per_shop: boolean; registrations_open?: boolean;
  } | null;
  /** True when the store has no running campaign but an earlier one has ended (0041). */
  closed?: boolean;
  shops?: MegaShop[];
  me?: { role: 'customer' | 'owner' | 'admin'; enrolled: boolean; enrolled_at?: string | null; earned: number; email_verified?: boolean } | null;
  server_now?: string;
}
/** get_mega_terms(): the customer terms of a campaign (null when none are published) and whether this user accepted them. */
export interface MegaTermsPayload { terms: { id: string; version: number; title: string; body_md: string } | null; accepted: boolean }
/** join_mega_campaign() answer: a new entry, or this account was already in. */
export type MegaJoinResult = 'joined' | 'already_joined';

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
  'budget_required', 'budget_out_of_range', 'invalid_budget', 'budget_decrease_blocked', 'budget_below_spent', 'budget_exhausted',
  'discount_out_of_range', 'campaign_not_active', 'registrations_paused', 'invalid_limits',
  'terms_required', 'terms_not_accepted',
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

/** Whole-rupee display with Indian grouping; null = not set. */
export const inr = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`);
/** Share (0-100) of the budget already spent. */
export const spentPct = (b: MegaBudget | null | undefined) => (b && b.budget_inr ? Math.min(100, Math.round((b.spent_inr / b.budget_inr) * 100)) : 0);
