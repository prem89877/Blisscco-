import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../i18n';
import { INTENT_KEY } from '../lib/oauth';
import { Msg } from './ui';

export default function GoogleButton({ intent }: { intent: 'customer' | 'owner' }) {
  const { t } = useI18n();
  const { signInWithGoogle } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function go() {
    if (busy) return;
    setBusy(true); setError('');
    try { localStorage.setItem(INTENT_KEY, intent); } catch { /* ignore */ }
    const { error: e } = await signInWithGoogle();
    if (e) { setBusy(false); setError(t('err.generic')); }
  }

  return (
    <div className="space-y-2">
      <button type="button" className="btn-secondary w-full gap-2 bg-white" disabled={busy} onClick={() => void go()}>
        <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
          <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z"/>
          <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.5z"/>
          <path fill="#FBBC05" d="M10.5 28.7A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.2.8-4.7l-7.9-6.1A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.8l7.9-6.1z"/>
          <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.8 2.3-8.4 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z"/>
        </svg>
        {busy ? t('common.loading') : t('auth.google')}
      </button>
      <Msg error={error} />
      <p className="text-center text-xs text-ink/60">{t('auth.or')}</p>
    </div>
  );
}
