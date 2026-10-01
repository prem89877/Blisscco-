import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import Skeleton from '../components/Skeleton';
import { useAuth } from '../context/AuthContext';
import { RETURN_KEY } from '../lib/bookingErrors';

export default function PostLogin() {
  const { session, profile, loading } = useAuth();
  const [back] = useState<string | null>(() => {
    try { return sessionStorage.getItem(RETURN_KEY); } catch { return null; }
  });
  useEffect(() => { try { sessionStorage.removeItem(RETURN_KEY); } catch { /* ignore */ } }, []);

  if (loading) return <Skeleton />;
  if (!session) return <Navigate to="/login" replace />;
  if (back && back.startsWith('/') && !back.startsWith('//')) return <Navigate to={back} replace />;
  const to = profile?.role === 'admin' ? '/admin' : profile?.role === 'owner' ? '/owner' : '/';
  return <Navigate to={to} replace />;
}
