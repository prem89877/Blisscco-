// "Add to Home Screen" support. Chrome/Edge/Android fire `beforeinstallprompt` once; we keep it until the user taps Install.
// iPhone Safari has no such event, so the banner shows manual steps there instead.
import { useSyncExternalStore } from 'react';
import { isIos, isStandalone } from './push';

interface InstallEvent extends Event { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }

let deferred: InstallEvent | null = null;
let installed = false;
let version = 0;
const listeners = new Set<() => void>();
const emit = () => { version += 1; listeners.forEach((l) => l()); };

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e as InstallEvent; emit(); });
  window.addEventListener('appinstalled', () => { deferred = null; installed = true; emit(); });
}

const subscribe = (cb: () => void) => { listeners.add(cb); return () => { listeners.delete(cb); }; };
const snapshot = () => version;

const KEY = 'blisscco.installDismissed';
const SNOOZE_MS = 14 * 24 * 3600 * 1000;

function dismissedRecently(): boolean {
  try { const v = Number(localStorage.getItem(KEY)); return Boolean(v) && Date.now() - v < SNOOZE_MS; } catch { return false; }
}

export function useInstall() {
  useSyncExternalStore(subscribe, snapshot, snapshot);
  const standalone = typeof window !== 'undefined' && isStandalone();
  const ios = typeof window !== 'undefined' && isIos();
  return {
    canPrompt: deferred !== null && !installed && !standalone,
    showIosSteps: ios && !standalone && !installed,
    snoozed: dismissedRecently(),
    async install(): Promise<void> {
      if (!deferred) return;
      const e = deferred;
      deferred = null;                                        // the event can only be used once
      emit();
      await e.prompt();
      await e.userChoice.catch(() => undefined);
    },
    snooze(): void {
      try { localStorage.setItem(KEY, String(Date.now())); } catch { /* storage blocked: banner returns next visit */ }
      emit();
    },
  };
}
