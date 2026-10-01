import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

type Status = 'idle' | 'asking' | 'granted' | 'denied' | 'error';
interface Coords { lat: number; lng: number }
interface Ctx { status: Status; coords: Coords | null; request: () => void }

const Ctx = createContext<Ctx | null>(null);

// Location is kept in memory only (never stored), so every new visit asks again.
export function LocationProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('idle');
  const [coords, setCoords] = useState<Coords | null>(null);

  const request = useCallback(() => {
    if (!navigator.geolocation) { setStatus('error'); return; }
    setStatus('asking');
    navigator.geolocation.getCurrentPosition(
      (pos) => { setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude }); setStatus('granted'); },
      (err) => setStatus(err.code === err.PERMISSION_DENIED ? 'denied' : 'error'),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 60000 },
    );
  }, []);

  const value = useMemo(() => ({ status, coords, request }), [status, coords, request]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useGeo(): Ctx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useGeo must be used inside LocationProvider');
  return c;
}
