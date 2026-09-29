import { useState, type FormEvent } from 'react';
import AuthCard from '../components/AuthCard';
import Field from '../components/Field';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../i18n';
import { isEmail } from '../lib/validation';

export default function ForgotPassword() {
  const { t } = useI18n();
  const { requestPasswordReset } = useAuth();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError('');
    if (!isEmail(email)) return setError(t('err.invalidEmail'));
    setBusy(true);
    try {
      const { error: err } = await requestPasswordReset(email.trim());
      if (err) setError(t('err.generic')); else setSent(true);
    } catch {
      setError(t('err.network'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard title={t('auth.resetTitle')}>
      {sent ? <p role="status">{t('auth.resetSent')}</p> : (
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <Field id="email" label={t('auth.email')} type="email" autoComplete="email" value={email} onChange={setEmail} disabled={busy} />
          {error && <p role="alert" className="text-sm font-medium text-red-700">{error}</p>}
          <button type="submit" className="btn-primary w-full" disabled={busy}>{busy ? t('common.loading') : t('auth.sendReset')}</button>
        </form>
      )}
    </AuthCard>
  );
}
