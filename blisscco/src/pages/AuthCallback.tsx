import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import Skeleton from '../components/Skeleton';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../i18n';
import { INTENT_KEY } from '../lib/oauth';
import { supabase } from '../lib/supabase';

// Landing page after Google sign-in. Applies "owner" intent and the chosen language for brand-new accounts.
export default function AuthCallback() {
  const { session, profile, loading, refreshProfile, updateLanguage } = useAuth();
  const { lang } = useI18n();
  const nav = useNavigate();
  const ran = useRef(false);

  useEffect(() => {
    if (loading || ran.current) return;
    if (!session) { nav('/login', { replace: true }); return; }
    ran.current = true;
    void (async () => {
      let intent: string | null = null;
      try { intent = localStorage.getItem(INTENT_KEY); localStorage.removeItem(INTENT_KEY); } catch { /* ignore */ }
      if (intent === 'owner' && profile?.role === 'customer') {
        const { error } = await supabase.rpc('become_owner');
        if (!error) await refreshProfile();
      }
      const isNew = Date.now() - new Date(session.user.created_at).getTime() < 2 * 60 * 1000;
      if (isNew) await updateLanguage(lang);
      nav('/post-login', { replace: true });
    })();
  }, [loading, session, profile, lang, nav, refreshProfile, updateLanguage]);

  return <Skeleton />;
}
