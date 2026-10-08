// Refer-a-Shop Competition: remember a shop-referral code from a link like https://site/owner/register?sref=S2ABCD3F
// until the new business owner has signed up (the server then attributes it once; see claim_shop_referral).
const KEY = 'blisscco.sref';

export function captureShopRefFromUrl() {
  try {
    const v = new URLSearchParams(window.location.search).get('sref');
    if (v && /^[A-Za-z0-9]{6,12}$/.test(v)) localStorage.setItem(KEY, v.toUpperCase());
  } catch { /* storage unavailable */ }
}
export const getStoredShopRef = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
export const clearShopRef = () => { try { localStorage.removeItem(KEY); } catch { /* ignore */ } };

export interface CompetitionOverview {
  id: string; title: string; description: string | null; status: 'active' | 'paused' | 'ended';
  starts_at: string; ends_at: string; reward_amount_inr: number; server_now: string;
  my_rank: number | null; my_count: number; participants: number; can_participate: boolean;
  winner_business_name: string | null; winner_referral_count: number | null; i_won: boolean;
}
export interface LeaderRow { rank: number; business_name: string; referrals: number; is_me: boolean }

/** Splits a number of seconds into days / hours / minutes for the countdown. */
export function splitSeconds(total: number) {
  const s = Math.max(0, Math.floor(total));
  return { d: Math.floor(s / 86400), h: Math.floor((s % 86400) / 3600), m: Math.floor((s % 3600) / 60), s: s % 60 };
}

/** datetime-local value (India time) <-> ISO. The admin always types India time. */
const IST_MS = 5.5 * 3600 * 1000;
export const isoToLocalInput = (iso: string) => new Date(new Date(iso).getTime() + IST_MS).toISOString().slice(0, 16);
export const localInputToIso = (v: string) => new Date(`${v}:00+05:30`).toISOString();
export const addDaysLocal = (v: string, days: number) => isoToLocalInput(new Date(new Date(localInputToIso(v)).getTime() + days * 86400000).toISOString());
