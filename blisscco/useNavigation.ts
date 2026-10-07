import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { NavigationService } from './NavigationService';
import type { NavigationSnapshot } from './types';

/** One NavigationService per screen. Everything in flight (location request, route request, permission listener) is cancelled on unmount. */
export function useNavigation(): { service: NavigationService; snapshot: NavigationSnapshot } {
  const service = useMemo(() => new NavigationService(), []);
  useEffect(() => () => service.stop(), [service]);
  const snapshot = useSyncExternalStore(service.subscribe, service.getSnapshot, service.getSnapshot);
  return { service, snapshot };
}
