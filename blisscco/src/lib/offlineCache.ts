import { useSyncExternalStore } from 'react';

/**
 * Offline support for signed-in customers.
 *   - The last data that loaded successfully is saved on THIS device, per user, in localStorage.
 *   - When the phone is offline (or a request fails), the app shows that saved copy; fresh/dynamic data needs internet.
 *   - Everything saved here is removed on log out (clearUserCaches), and a copy is only ever read for the same user id.
 */
const PREFIX = 'blisscco.cache.';

interface Saved<T> { savedAt: number; data: T }

export function writeCache<T>(uid: string, name: string, data: T): void {
  try { localStorage.setItem(`${PREFIX}${uid}.${name}`, JSON.stringify({ savedAt: Date.now(), data } satisfies Saved<T>)); } catch { /* storage full or blocked: just skip */ }
}

export function readCache<T>(uid: string, name: string): Saved<T> | null {
  try {
    const raw = localStorage.getItem(`${PREFIX}${uid}.${name}`);
    if (!raw) return null;
    const v = JSON.parse(raw) as Saved<T>;
    return v && typeof v.savedAt === 'number' && 'data' in v ? v : null;
  } catch { return null; }
}

/** Remove every saved copy (called on log out so nothing private stays on a shared phone). */
export function clearUserCaches(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith(PREFIX)) keys.push(k); }
    keys.forEach((k) => localStorage.removeItem(k));
  } catch { /* ignore */ }
}

function subscribe(cb: () => void): () => void {
  window.addEventListener('online', cb);
  window.addEventListener('offline', cb);
  return () => { window.removeEventListener('online', cb); window.removeEventListener('offline', cb); };
}

/** true while the browser says the device has a connection. */
export function useOnline(): boolean {
  return useSyncExternalStore(subscribe, () => navigator.onLine, () => true);
}
