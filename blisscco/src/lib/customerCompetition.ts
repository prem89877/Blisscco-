// Refer-a-Customer Competition: shared types. The referral link itself is the existing customer link  https://site/?ref=CODE
// (see lib/referral.ts + claim_referral), so nothing new has to be captured from the URL.

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
