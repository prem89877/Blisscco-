import { RETURN_KEY } from './bookingErrors';

// Remembers where to send the customer after login / sign-up (for example the Mega Store campaign page they scanned).
// sessionStorage covers Google sign-in and normal login in the same tab. localStorage is the fallback for the e-mail
// verification link, which usually opens in a NEW tab where sessionStorage is empty. The fallback expires after 24 hours.
const LATER_KEY = 'blisscco.returnToLater';
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Only same-site paths are accepted (no "//host" or full URLs). */
export const isSafePath = (p: string | null | undefined): p is string => !!p && p.startsWith('/') && !p.startsWith('//') && !p.includes('\\');

export function rememberReturnTo(path: string): void {
  if (!isSafePath(path)) return;
  try { sessionStorage.setItem(RETURN_KEY, path); } catch { /* ignore */ }
  try { localStorage.setItem(LATER_KEY, JSON.stringify({ path, at: Date.now() })); } catch { /* ignore */ }
}

/** Reads the saved path without removing it (safe to call during render, also twice in React StrictMode). */
export function peekReturnTo(): string | null {
  let found: string | null = null;
  try { found = sessionStorage.getItem(RETURN_KEY); } catch { /* ignore */ }
  if (!found) {
    try {
      const raw = localStorage.getItem(LATER_KEY);
      if (raw) {
        const v = JSON.parse(raw) as { path?: string; at?: number };
        if (v.path && typeof v.at === 'number' && Date.now() - v.at < MAX_AGE_MS) found = v.path;
      }
    } catch { /* ignore */ }
  }
  return isSafePath(found) ? found : null;
}

/** Removes the saved path (call once it has been used). */
export function clearReturnTo(): void {
  try { sessionStorage.removeItem(RETURN_KEY); } catch { /* ignore */ }
  try { localStorage.removeItem(LATER_KEY); } catch { /* ignore */ }
}
