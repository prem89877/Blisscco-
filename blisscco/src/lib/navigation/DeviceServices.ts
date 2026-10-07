// Small browser services used during live navigation, each behind an interface so the controller stays framework-free and testable.

export interface NetworkPort {
  isOnline(): boolean;
  /** Calls cb(true/false) when the device goes online / offline. Returns a cleanup function. */
  subscribe(cb: (online: boolean) => void): () => void;
}

export const browserNetwork: NetworkPort = {
  isOnline: () => typeof navigator === 'undefined' || navigator.onLine !== false,
  subscribe(cb) {
    if (typeof window === 'undefined') return () => undefined;
    const on = () => cb(true);
    const off = () => cb(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  },
};

/** Keeps the phone screen awake while navigating (a sleeping screen stops GPS updates). Best effort: unsupported browsers just skip it. */
export interface ScreenWakePort {
  /** Starts keeping the screen on. Returns a function that releases it. */
  hold(): () => void;
}

interface WakeLockSentinelLike { release(): Promise<void>; addEventListener?(t: 'release', cb: () => void): void }
interface WakeLockApi { request(type: 'screen'): Promise<WakeLockSentinelLike> }

export const browserScreenWake: ScreenWakePort = {
  hold() {
    const api = typeof navigator !== 'undefined' ? (navigator as unknown as { wakeLock?: WakeLockApi }).wakeLock : undefined;
    if (!api || typeof document === 'undefined') return () => undefined;
    let sentinel: WakeLockSentinelLike | null = null;
    let active = true;
    const acquire = async () => {
      try {
        const s = await api.request('screen');
        if (!active) { void s.release().catch(() => undefined); return; }
        sentinel = s;
      } catch { /* denied (battery saver, hidden tab): navigation works without it */ }
    };
    const onVisible = () => { if (active && document.visibilityState === 'visible') void acquire(); };   // the lock is dropped when the tab is hidden
    document.addEventListener('visibilitychange', onVisible);
    void acquire();
    return () => {
      active = false;
      document.removeEventListener('visibilitychange', onVisible);
      void sentinel?.release().catch(() => undefined);
      sentinel = null;
    };
  },
};
