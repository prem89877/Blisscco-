// Refer-a-Shop Competition: remember a shop-referral code from a link like https://site/owner/register?sref=S2ABCD3F
// until the new business owner has signed up (the server then attributes it once; see claim_shop_referral).
import { supabase } from './supabase';

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
  id: string; title: string; description: string | null; status: 'active' | 'paused' | 'pending_verification' | 'ended';
  starts_at: string; ends_at: string; reward_amount_inr: number; server_now: string;
  my_rank: number | null; my_count: number; participants: number; can_participate: boolean;
  winner_business_name: string | null; winner_referral_count: number | null; i_won: boolean; verification_pending: boolean;
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

/**
 * Fraud protection helper. A random id kept in this browser + a hash of a few browser attributes. They are only sent to the server as
 * WEAK signals (the server adds several signals together and an admin reviews anything suspicious) - they are never used to block anybody by themselves.
 */
const DEVICE_KEY = 'blisscco.devid';
const hex = (buf: ArrayBuffer) => Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');

export async function getDeviceSignals(): Promise<{ id: string; fp: string } | null> {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id || !/^[a-f0-9]{32}$/.test(id)) {
      id = hex(crypto.getRandomValues(new Uint8Array(16)).buffer);
      localStorage.setItem(DEVICE_KEY, id);
    }
    const raw = [navigator.userAgent, navigator.language, `${screen.width}x${screen.height}`, screen.colorDepth, new Date().getTimezoneOffset(), navigator.hardwareConcurrency ?? ''].join('|');
    const fp = hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw))).slice(0, 32);
    return { id, fp };
  } catch { return null; }
}

/** Tells the server which browser this owner uses (once per browser session). */
export async function recordShopDevice() {
  try {
    if (sessionStorage.getItem('blisscco.devrec')) return;
    const d = await getDeviceSignals();
    if (!d) return;
    const { error } = await supabase.rpc('record_shop_device', { p_device_id: d.id, p_device_fp: d.fp });
    if (!error) sessionStorage.setItem('blisscco.devrec', '1');
  } catch { /* never block the app for this */ }
}
