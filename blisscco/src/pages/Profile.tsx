import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../i18n';

export default function Profile() {
  const { t } = useI18n();
  const { session, profile, signOut } = useAuth();
  const role = profile?.role;
  const dash = role === 'admin' ? '/admin' : role === 'owner' ? '/owner' : null;

  return (
    <div className="mx-auto max-w-xl space-y-4 px-4 py-6">
      <h1 className="font-display text-2xl font-semibold">{t('bn.profile')}</h1>
      <div className="card space-y-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-ink/60">{t('prof.name')}</p>
          <p className="text-base">{profile?.full_name || '—'}</p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-ink/60">{t('prof.email')}</p>
          <p className="break-all text-base">{session?.user.email ?? '—'}</p>
        </div>
        {role && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-ink/60">{t('prof.role')}</p>
            <p className="text-base">{t(`prof.role.${role}`)}</p>
          </div>
        )}
      </div>
      <div className="flex flex-col gap-2">
        {dash && <Link to={dash} className="btn-secondary">{t(role === 'admin' ? 'dash.admin' : 'dash.owner')}</Link>}
        <button type="button" onClick={() => void signOut()} className="btn-secondary">{t('nav.logout')}</button>
      </div>
    </div>
  );
}
