import { useEffect } from 'react';
import { Link, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../i18n';
import { clearRef, getStoredRef } from '../lib/referral';
import { isSupabaseConfigured, supabase } from '../lib/supabase';
import HeaderMenu from './HeaderMenu';
import Logo from './Logo';

export default function Layout() {
  const { session, profile } = useAuth();
  const { t, setLang } = useI18n();

  // Apply the saved language preference once the profile loads
  useEffect(() => { if (profile?.language) setLang(profile.language); }, [profile?.language, setLang]);

  // A new customer who arrived through a referral link is attributed once, by the server
  useEffect(() => {
    if (profile?.role !== 'customer') return;
    const code = getStoredRef();
    if (!code) return;
    void supabase.rpc('claim_referral', { p_code: code }).then(() => clearRef());
  }, [profile?.id, profile?.role]);

  const home = profile?.role === 'admin' ? '/admin' : profile?.role === 'owner' ? '/owner' : null;

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-10 border-b border-ink/10 bg-cream/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-2 px-4 py-2.5">
          <Link to="/" aria-label="Blisscco"><Logo /></Link>
          <div className="flex items-center gap-2">
            {session ? (
              <>
                <Link to="/my-bookings" className="btn-secondary hidden sm:inline-flex">{t('my.title')}</Link>
                {home && <Link to={home} className="btn-secondary hidden sm:inline-flex">{t(profile?.role === 'admin' ? 'dash.admin' : 'dash.owner')}</Link>}
              </>
            ) : (
              <Link to="/login" className="btn-primary">{t('nav.login')}</Link>
            )}
            <HeaderMenu />
          </div>
        </div>
      </header>

      {!isSupabaseConfigured && (
        <p role="alert" className="bg-ink px-4 py-2 text-center text-sm text-cream">{t('err.config')}</p>
      )}

      <main className="flex-1"><Outlet /></main>

      <footer className="border-t border-ink/10 px-4 py-6 text-center text-sm text-ink/70">
        {profile?.role === 'customer' && <Link to="/refer" className="mr-3 btn-text">{t('ref.title')}</Link>}
        {session && <Link to="/my-bookings" className="mr-3 btn-text">{t('my.title')}</Link>}
        <Link to="/owner/register" className="btn-text">{t('nav.forBusiness')}</Link>
        <p className="mt-2 space-x-3">
          <Link to="/privacy" className="btn-text">{t('footer.privacy')}</Link>
          <Link to="/terms" className="btn-text">{t('footer.terms')}</Link>
        </p>
        <p className="mt-2">© Blisscco</p>
      </footer>
    </div>
  );
}
