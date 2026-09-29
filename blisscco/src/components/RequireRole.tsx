import type { ReactNode } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { useAuth, type Role } from '../context/AuthContext';
import { useI18n } from '../i18n';
import Skeleton from './Skeleton';

// UX guard only. Real enforcement of every operation is done by RLS / database functions.
export default function RequireRole({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { session, profile, loading } = useAuth();
  const { t } = useI18n();
  const loc = useLocation();

  if (loading) return <Skeleton />;
  if (!session) return <Navigate to="/login" state={{ from: loc.pathname }} replace />;
  if (!profile || profile.is_suspended || !roles.includes(profile.role)) {
    return (
      <div className="mx-auto max-w-md p-6 text-center" role="alert">
        <p>{t('dash.unauthorized')}</p>
        <Link to="/" className="btn-secondary mt-4">{t('common.backHome')}</Link>
      </div>
    );
  }
  return <>{children}</>;
}
