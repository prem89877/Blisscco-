// Refer-a-Customer Competition: shared types. The referral link itself is the existing customer link  https://site/?ref=CODE
// (see lib/referral.ts + claim_referral), so nothing new has to be captured from the URL.

import { supabase } from './supabase';
import { getDeviceSignals } from './shopReferral';

export type CcStatus = 'draft' | 'active' | 'paused' | 'pending_verification' | 'ended';
export type CcRule = 'completed_booking' | 'confirmed_booking';

export interface CcOverview {
  id: string; title: string; description: string | null; status: Exclude<CcStatus, 'draft'>;
  starts_at: string; ends_at: string; reward_amount_inr: number; server_now: string;
  sponsor_business_name: string | null; reward_valid_days: number; eligibility_rule: CcRule; min_booking_value_inr: number;
  my_rank: number | null; my_count: number; my_in_review: number; my_waiting: number; participants: number;
  winner_name: string | null; winner_referral_count: number | null; i_won: boolean;
}
export interface CcLeaderRow { rank: number; display_name: string; referrals: number; is_me: boolean }
export interface CcMyReferral {
  id: string; created_at: string; display_name: string; email_verified: boolean; activity_done: boolean;
  state: 'waiting' | 'under_review' | 'counted' | 'rejected'; reject_reason: string | null;
}
export interface PromoBalance {
  id: string; code: string; amount_inr: number; used_inr: number; remaining_inr: number; expires_at: string;
  state: 'active' | 'used' | 'expired' | 'revoked'; sponsor_business_name: string | null; competition_title: string | null; created_at: string;
}
export interface PromoHistoryRow { id: string; grant_code: string; business_name: string; amount_inr: number; created_at: string }

// ---- fraud protection (migration 0033) ----
// clear = nothing found | suspicious = ON HOLD (does not count) | in_review = admin is looking | approved = admin cleared it
// rejected / fraudulent = admin decision (never counts; admin can restore)
export type CcReviewStatus = 'clear' | 'suspicious' | 'in_review' | 'approved' | 'rejected' | 'fraudulent';
export type CcEligibility = 'counted' | 'on_hold' | 'rejected' | 'fraudulent' | 'booking_invalid' | 'account_invalid' | 'waiting';
export type CcAction = 'start_review' | 'approve' | 'reject' | 'fraud' | 'restore';
export interface CcSignal { code: string; weight: number; count?: number }
export interface CcAdminReferral {
  id: string | null; referral_id: string; referral_date: string; qualified_at: string | null;
  status: 'qualified' | 'rejected' | 'waiting'; review_status: CcReviewStatus | null; eligibility: CcEligibility;
  referrer_name: string; referred_name: string; business_name: string | null;
  booking_id: string | null; booking_status: string | null; booking_price: number | null; booking_date: string | null;
  risk_score: number; risk_signals: CcSignal[]; reject_reason: string | null; review_note: string | null;
  reviewed_by_name: string | null; reviewed_at: string | null; referrer_fraud_count: number;
}
export interface CcHistoryRow {
  id: string; action: string; from_state: string | null; to_state: string | null; note: string | null; actor_name: string | null;
  created_at: string; details: Record<string, unknown>;
}

/** Which admin decisions are possible for a referral (the server checks the same rules again). */
export function ccActionsFor(r: Pick<CcAdminReferral, 'status' | 'review_status'>): CcAction[] {
  if (r.status === 'qualified') {
    if (r.review_status === 'suspicious') return ['start_review', 'approve', 'reject', 'fraud'];
    if (r.review_status === 'in_review') return ['approve', 'reject', 'fraud'];
    return ['reject', 'fraud'];                       // clear or already approved: admin can still remove it
  }
  if (r.status === 'rejected') return ['restore'];
  return [];
}

/** Tells the server which browser this customer uses (once per browser session). Weak signal only; never blocks anybody by itself. */
export async function recordCustomerDevice() {
  try {
    if (sessionStorage.getItem('blisscco.cdevrec')) return;
    const d = await getDeviceSignals();
    if (!d) return;
    const { error } = await supabase.rpc('record_customer_device', { p_device_id: d.id, p_device_fp: d.fp });
    if (!error) sessionStorage.setItem('blisscco.cdevrec', '1');
  } catch { /* never block the app for this */ }
}
