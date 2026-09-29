import { Navigate } from 'react-router-dom';
import Skeleton from '../components/Skeleton';
import { useAuth } from '../context/AuthContext';

export default function PostLogin() {
  const { session, profile, loading } = useAuth();
  if (loading) return <Skeleton />;
  if (!session) return <Navigate to="/login" replace />;
  const to = profile?.role === 'admin' ? '/admin' : profile?.role === 'owner' ? '/owner' : '/';
  return <Navigate to={to} replace />;
}
