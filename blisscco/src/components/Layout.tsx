import { useEffect } from 'react';
import { Link, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../i18n';
import { isSupabaseConfigured } from '../lib/supabase';
import LanguageSelect from './LanguageSelect';
import Logo from './Logo';

export default function Layout() {
  const { session, profile, signOut } = useAuth();
  const { t, setLang } = useI18n();

  // Apply the saved language preference once the profile loads
  useEffect(() => { if (profile?.language) setLang(profile.language); }, [profile?.language, setLang]);

  const home = profile?.role === 'admin' ? '/admin' : profile?.role === 'owner' ? '/owner' : null;

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-10 border-b border-ink/10 bg-cream/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-2 px-4 py-2.5">
          <Link to="/" aria-label="Blisscco"><Logo /></Link>
          <div className="flex items-center gap-2">
            <LanguageSelect />
            {session ? (
              <>
                {home && <Link to={home} className="btn-secondary hidden sm:inline-flex">{t(profile?.role === 'admin' ? 'dash.admin' : 'dash.owner')}</Link>}
                <button className="btn-secondary" onClick={() => void signOut()}>{t('nav.logout')}</button>
              </>
            ) : (
              <Link to="/login" className="btn-primary">{t('nav.login')}</Link>
            )}
          </div>
        </div>
      </header>

      {!isSupabaseConfigured && (
        <p role="alert" className="bg-ink px-4 py-2 text-center text-sm text-cream">{t('err.config')}</p>
      )}

      <main className="flex-1"><Outlet /></main>

      <footer className="border-t border-ink/10 px-4 py-6 text-center text-sm text-ink/70">
        <Link to="/owner/register" className="underline">{t('nav.forBusiness')}</Link>
        <p className="mt-2">© Blisscco</p>
      </footer>
    </div>
  );
}
