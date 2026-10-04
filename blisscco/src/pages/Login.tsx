import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import AuthCard from '../components/AuthCard';
import Field from '../components/Field';
import GoogleButton from '../components/GoogleButton';
import LegalConsent from '../components/LegalConsent';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../i18n';
import { authErrorKey, isEmail } from '../lib/validation';

export default function Login({ role }: { role: 'customer' | 'owner' | 'admin' }) {
  const { t } = useI18n();
  const { signIn } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError('');
    if (!isEmail(email)) return setError(t('err.invalidEmail'));
    if (!password) return setError(t('err.passwordRequired'));
    setBusy(true);
    try {
      const { error: err } = await signIn(email.trim(), password);
      if (err) setError(t(authErrorKey(err.message)));
      else nav('/post-login', { replace: true });
    } catch {
      setError(t('err.network'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard title={t(`auth.loginTitle.${role}`)}>
      {role !== 'admin' && <LegalConsent />}
      {role !== 'admin' && <GoogleButton intent={role} />}
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Field id="email" label={t('auth.email')} type="email" autoComplete="email" value={email} onChange={setEmail} disabled={busy} />
        <Field id="password" label={t('auth.password')} type="password" autoComplete="current-password" value={password} onChange={setPassword} disabled={busy} />
        {error && <p role="alert" className="text-sm font-medium text-red-700">{error}</p>}
        <button type="submit" className="btn-primary w-full" disabled={busy}>{busy ? t('common.loading') : t('auth.login')}</button>
      </form>
      <div className="space-y-2 text-center text-sm">
        <Link to="/forgot-password" className="btn-text">{t('auth.forgot')}</Link>
        {role !== 'admin' && (
          <p>{t('auth.noAccount')}{' '}
            <Link to={role === 'owner' ? '/owner/register' : '/register'} className="font-medium btn-text">{t('nav.register')}</Link>
          </p>
        )}
        {role === 'customer' && <p><Link to="/owner/login" className="btn-text">{t('auth.iAmOwner')}</Link></p>}
        {role === 'owner' && <p><Link to="/login" className="btn-text">{t('auth.iAmCustomer')}</Link></p>}
      </div>
    </AuthCard>
  );
}
