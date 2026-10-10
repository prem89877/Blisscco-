import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import Skeleton from '../components/Skeleton';
import { useAuth } from '../context/AuthContext';
import { clearReturnTo, peekReturnTo } from '../lib/returnTo';

export default function PostLogin() {
  const { session, profile, loading } = useAuth();
  // Booking and reward pages save their path before sending people to log in. Read on the first render, cleared afterwards.
  const [back] = useState<string | null>(() => peekReturnTo());
  useEffect(() => { clearReturnTo(); }, []);

  if (loading) return <Skeleton />;
  if (!session) return <Navigate to="/login" replace />;
  if (back) return <Navigate to={back} replace />;
  const to = profile?.role === 'admin' ? '/admin' : profile?.role === 'owner' ? '/owner' : '/';
  return <Navigate to={to} replace />;
}
