import Skeleton from '../components/Skeleton';
import { useAuth } from '../context/AuthContext';
import Explore from './Explore';
import Landing from './Landing';

// Visitors without an account see the welcome page; signed-in users go straight to discovery.
export default function HomeGate() {
  const { session, loading } = useAuth();
  if (loading) return <Skeleton />;
  return session ? <Explore /> : <Landing />;
}
