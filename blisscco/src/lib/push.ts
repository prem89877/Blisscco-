// Browser side of Phase 10: service-worker registration and web-push subscription.
// The private VAPID key never reaches the browser; only the PUBLIC key (VITE_VAPID_PUBLIC_KEY) is used here.
import { supabase } from './supabase';

const PUBLIC_KEY = ((import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined) ?? '').trim();

export type PushSupport = 'ok' | 'unsupported' | 'needs_install' | 'no_key';

export const isStandalone = (): boolean =>
  window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;

export const isIos = (): boolean =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

// Per-device, per-account memory (only this phone/browser): "user switched push off here" and "we already asked once".
const optOutKey = (uid: string) => `bc_push_optout_${uid}`;
const askedKey = (uid: string) => `bc_push_asked_${uid}`;
const lsGet = (k: string): string | null => { try { return window.localStorage.getItem(k); } catch { return null; } };
const lsSet = (k: string, v: string) => { try { window.localStorage.setItem(k, v); } catch { /* storage blocked: ignore */ } };
const lsDel = (k: string) => { try { window.localStorage.removeItem(k); } catch { /* ignore */ } };
async function currentUid(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.user.id ?? null;
}
let askListenerSet = false;

export function pushSupport(): PushSupport {
  if (isIos() && !isStandalone()) return 'needs_install';     // iPhone/iPad only allow web push for an installed app
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported';
  if (!PUBLIC_KEY) return 'no_key';
  return 'ok';
}

export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;
  if (!import.meta.env.PROD) return;                          // dev server: no service worker (avoids stale files while coding)
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((e) => console.error('service worker registration failed', e));
  });
}

function keyBytes(b64: string) {                              // no return type on purpose: keeps it assignable to BufferSource on every TS version
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

function sameKey(sub: PushSubscription): boolean {
  const have = sub.options?.applicationServerKey;
  if (!have) return false;
  const a = new Uint8Array(have);
  const b = keyBytes(PUBLIC_KEY);
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

async function saveToServer(sub: PushSubscription): Promise<boolean> {
  const j = sub.toJSON();
  const p256dh = j.keys?.p256dh;
  const auth = j.keys?.auth;
  if (!j.endpoint || !p256dh || !auth) return false;
  const { error } = await supabase.rpc('save_push_subscription', {
    p_endpoint: j.endpoint, p_p256dh: p256dh, p_auth: auth, p_user_agent: navigator.userAgent.slice(0, 300),
  });
  if (error) { console.error('save_push_subscription failed', error.message); return false; }
  return true;
}

// `navigator.serviceWorker.ready` never resolves when no worker is registered (e.g. `npm run dev`), which would hang
// the screen or log-out. So: use an existing registration, otherwise register one (only when enabling push).
async function getRegistration(create: boolean): Promise<ServiceWorkerRegistration | null> {
  let reg = await navigator.serviceWorker.getRegistration();
  if (!reg && create) reg = await navigator.serviceWorker.register('/sw.js');
  if (!reg) return null;
  if (!reg.active) await navigator.serviceWorker.ready;
  return reg;
}

async function currentSubscription(): Promise<PushSubscription | null> {
  if (pushSupport() !== 'ok') return null;
  try {
    const reg = await getRegistration(false);
    return reg ? await reg.pushManager.getSubscription() : null;
  } catch { return null; }
}

/** Is THIS browser subscribed AND known to the server for the logged-in user? */
export async function isPushOnHere(): Promise<boolean> {
  const sub = await currentSubscription();
  if (!sub || Notification.permission !== 'granted') return false;
  const { data } = await supabase.from('push_subscriptions').select('id').eq('endpoint', sub.endpoint).maybeSingle();
  return Boolean(data);
}

export type EnableResult = 'ok' | 'denied' | 'unsupported' | 'error';

export async function enablePush(): Promise<EnableResult> {
  if (pushSupport() !== 'ok') return 'unsupported';
  try {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') return 'denied';
    const uid = await currentUid();
    if (uid) lsDel(optOutKey(uid));                                   // switching on again (or auto-on) clears any earlier opt-out
    const reg = await getRegistration(true);
    if (!reg) return 'error';
    let sub = await reg.pushManager.getSubscription();
    if (sub && !sameKey(sub)) { await sub.unsubscribe(); sub = null; }   // made with another VAPID key: unusable
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(PUBLIC_KEY) });
    return (await saveToServer(sub)) ? 'ok' : 'error';
  } catch (e) {
    console.error('enablePush failed', e);
    return 'error';
  }
}

/** userChoice=true: the person pressed "turn off" on this device, so auto-enable must leave it off. Log-out passes nothing. */
export async function disablePush(userChoice = false): Promise<void> {
  if (userChoice) {
    const uid = await currentUid();
    if (uid) lsSet(optOutKey(uid), '1');
  }
  const sub = await currentSubscription();
  if (!sub) return;
  await supabase.rpc('remove_push_subscription', { p_endpoint: sub.endpoint });
  await sub.unsubscribe().catch(() => false);
}

/**
 * Called when the app opens for a logged-in user. Push is ON BY DEFAULT:
 * - notification permission already granted -> subscribes this device and saves it (no extra step in Settings);
 * - permission not asked yet -> asks ONCE, on the person's first tap (phones require a tap for the permission pop-up);
 * - the person switched push off on this device in Settings -> left alone;
 * - permission blocked -> nothing to do.
 */
export async function syncPushSubscription(): Promise<void> {
  if (pushSupport() !== 'ok') return;
  const uid = await currentUid();
  if (!uid) return;
  if (lsGet(optOutKey(uid))) return;

  if (Notification.permission === 'granted') {
    const sub = await currentSubscription();
    if (sub && sameKey(sub)) {
      const { data } = await supabase.from('push_subscriptions').select('id').eq('endpoint', sub.endpoint).maybeSingle();
      if (data) return;                                         // already subscribed and known to the server
    }
    await enablePush();                                         // new install / new account on this phone / rotated VAPID key
    return;
  }

  if (Notification.permission === 'default' && !lsGet(askedKey(uid)) && !askListenerSet) {
    askListenerSet = true;
    window.addEventListener('pointerdown', () => {
      askListenerSet = false;
      lsSet(askedKey(uid), '1');
      void enablePush().catch(() => undefined);
    }, { once: true });
  }
}

/** On log-out the device stops receiving this account's notifications (matters on shared phones). */
export async function forgetPushOnThisDevice(): Promise<void> {
  try {
    // never let a slow network block log-out for more than 3 seconds
    await Promise.race([disablePush(), new Promise<void>((resolve) => { window.setTimeout(resolve, 3000); })]);
  } catch (e) { console.error('push cleanup failed', e); }
}
