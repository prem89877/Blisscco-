import { supabase } from './supabase';

// Anonymous analytics. Only a random per-tab id is sent (kept in sessionStorage, erased when the tab closes).
// No name, phone, email or location is ever included. Errors are swallowed: tracking must never break the page.
export type Source = 'qr' | 'search' | 'referral' | 'direct';
const SESSION_KEY = 'blisscco.sid';
const SOURCE_PREFIX = 'blisscco.src.';

function sessionId(): string {
  try {
    let v = sessionStorage.getItem(SESSION_KEY);
    if (!v || !/^[A-Za-z0-9-]{16,64}$/.test(v)) {
      v = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
      sessionStorage.setItem(SESSION_KEY, v);
    }
    return v;
  } catch { return ''; }
}

// Automated browsers (Selenium / Puppeteer) announce themselves; the database filters crawlers by user-agent as well.
const isAutomated = () => typeof navigator !== 'undefined' && navigator.webdriver === true;

/** `?src=qr|search|referral` from the link. No/unknown value: `referral` if the visitor arrived through a Refer & Earn link (code still remembered), else `direct`. */
export function sourceFromParam(v: string | null, cameWithReferral = false): Source {
  if (v === 'qr' || v === 'search' || v === 'referral') return v;
  return cameWithReferral ? 'referral' : 'direct';
}

export function trackView(businessId: string, src: Source) {
  const sid = sessionId();
  if (!sid || isAutomated()) return;
  try { sessionStorage.setItem(SOURCE_PREFIX + businessId, src); } catch { /* ignore */ }
  void supabase.rpc('track_event', { p_business_id: businessId, p_event: 'profile_view', p_source: src, p_session: sid }).then(() => undefined, () => undefined);
}

/** Call right after a booking succeeded. The database only accepts it if a real booking was just made. */
export function trackBooking(businessId: string) {
  const sid = sessionId();
  if (!sid || isAutomated()) return;
  let src: Source = 'direct';
  // the source was already resolved when the shop page was opened
  try { src = sourceFromParam(sessionStorage.getItem(SOURCE_PREFIX + businessId)); } catch { /* ignore */ }
  void supabase.rpc('track_event', { p_business_id: businessId, p_event: 'booking', p_source: src, p_session: sid }).then(() => undefined, () => undefined);
}

export function trackImpressions(businessIds: string[]) {
  const sid = sessionId();
  const ids = [...new Set(businessIds)].slice(0, 50);
  if (!sid || isAutomated() || ids.length === 0) return;
  void supabase.rpc('track_impressions', { p_business_ids: ids, p_session: sid }).then(() => undefined, () => undefined);
}

// ---- types for the owner analytics screen ----
export interface Counts { profile_view: number; search_impression: number; booking: number }
export interface AnalyticsData {
  from: string; to: string; totals: Counts;
  by_source: ({ source: Source } & Counts)[];
  daily: ({ day: string } & Counts)[];
}
