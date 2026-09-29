import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import AuthCard from '../components/AuthCard';
import Field from '../components/Field';
import Skeleton from '../components/Skeleton';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../i18n';
import { isStrongEnough } from '../lib/validation';

// Supabase puts a temporary recovery session in the URL; it is picked up automatically by the client.
export default function ResetPassword() {
  const { t } = useI18n();
  const { session, loading, updatePassword, signOut } = useAuth();
  const nav = useNavigate();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  if (loading) return <Skeleton />;
  if (!session && !done) {
    return (
      <AuthCard title={t('auth.resetTitle')}>
        <p role="alert">{t('auth.resetLinkInvalid')}</p>
        <Link to="/forgot-password" className="btn-primary w-full">{t('auth.sendReset')}</Link>
      </AuthCard>
    );
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError('');
    if (!isStrongEnough(password)) return setError(t('err.passwordShort'));
    setBusy(true);
    try {
      const { error: err } = await updatePassword(password);
      if (err) { setError(t('err.generic')); return; }
      setDone(true);
      await signOut();
      setTimeout(() => nav('/login', { replace: true }), 1500);
    } catch {
      setError(t('err.network'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard title={t('auth.resetTitle')}>
      {done ? <p role="status">{t('auth.passwordUpdated')}</p> : (
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <Field id="pw" label={t('auth.newPassword')} type="password" autoComplete="new-password" value={password} onChange={setPassword} disabled={busy} />
          {error && <p role="alert" className="text-sm font-medium text-red-700">{error}</p>}
          <button type="submit" className="btn-primary w-full" disabled={busy}>{busy ? t('common.loading') : t('auth.updatePassword')}</button>
        </form>
      )}
    </AuthCard>
  );
}
