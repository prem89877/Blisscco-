import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import AuthCard from '../components/AuthCard';
import Field from '../components/Field';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../i18n';
import { authErrorKey, isEmail, isStrongEnough } from '../lib/validation';

export default function Register({ role }: { role: 'customer' | 'owner' }) {
  const { t, lang } = useI18n();
  const { signUp } = useAuth();
  const nav = useNavigate();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError('');
    if (fullName.trim().length < 2) return setError(t('err.nameRequired'));
    if (!isEmail(email)) return setError(t('err.invalidEmail'));
    if (!isStrongEnough(password)) return setError(t('err.passwordShort'));
    setBusy(true);
    try {
      const r = await signUp({ email: email.trim(), password, fullName: fullName.trim(), role, language: lang });
      if (r.error) setError(t(authErrorKey(r.error.message)));
      else if (r.alreadyRegistered) setError(t('err.emailExists'));
      else if (r.needsVerification) setDone(true);
      else nav('/post-login', { replace: true });
    } catch {
      setError(t('err.network'));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <AuthCard title={t(`auth.registerTitle.${role}`)}>
        <p role="status">{t('auth.checkEmail')}</p>
        <Link to={role === 'owner' ? '/owner/login' : '/login'} className="btn-primary w-full">{t('auth.login')}</Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard title={t(`auth.registerTitle.${role}`)}>
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Field id="name" label={t('auth.fullName')} autoComplete="name" value={fullName} onChange={setFullName} disabled={busy} />
        <Field id="email" label={t('auth.email')} type="email" autoComplete="email" value={email} onChange={setEmail} disabled={busy} />
        <Field id="password" label={t('auth.password')} type="password" autoComplete="new-password" value={password} onChange={setPassword} disabled={busy} />
        {error && <p role="alert" className="text-sm font-medium text-red-700">{error}</p>}
        <button type="submit" className="btn-primary w-full" disabled={busy}>{busy ? t('common.loading') : t('auth.register')}</button>
      </form>
      <div className="space-y-2 text-center text-sm">
        <p>{t('auth.haveAccount')}{' '}
          <Link to={role === 'owner' ? '/owner/login' : '/login'} className="font-medium underline">{t('auth.login')}</Link>
        </p>
        {role === 'customer' && <p><Link to="/owner/register" className="underline">{t('auth.iAmOwner')}</Link></p>}
        {role === 'owner' && <p><Link to="/register" className="underline">{t('auth.iAmCustomer')}</Link></p>}
      </div>
    </AuthCard>
  );
}
