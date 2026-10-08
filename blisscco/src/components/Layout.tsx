import { useEffect } from 'react';
import { Link, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../i18n';
import { useOnline } from '../lib/offlineCache';
import { syncPushSubscription } from '../lib/push';
import { recordCustomerDevice } from '../lib/customerCompetition';
import { clearRef, getStoredRef } from '../lib/referral';
import { clearShopRef, getDeviceSignals, getStoredShopRef, recordShopDevice } from '../lib/shopReferral';
import { isSupabaseConfigured, supabase } from '../lib/supabase';
import HeaderMenu from './HeaderMenu';
import InstallPrompt from './InstallPrompt';
import Logo from './Logo';
import NotificationBell from './NotificationBell';

export default function Layout() {
  const { session, profile } = useAuth();
  const { t, setLang } = useI18n();
  const online = useOnline();

  // Apply the saved language preference once the profile loads
  useEffect(() => { if (profile?.language) setLang(profile.language); }, [profile?.language, setLang]);

  // A new customer who arrived through a referral link is attributed once, by the server
  useEffect(() => {
    if (profile?.role !== 'customer') return;
    const code = getStoredRef();
    if (!code) return;
    void (async () => {
      const d = await getDeviceSignals();      // weak fraud signals only (random browser id + hash); the server decides with several signals + admin review
      await supabase.rpc('claim_referral', { p_code: code, p_device_id: d?.id ?? null, p_device_fp: d?.fp ?? null });
      clearRef();
    })();
  }, [profile?.id, profile?.role]);

  // Fraud protection: remember which browser a customer uses (weak signal only)
  useEffect(() => {
    if (profile?.role === 'customer') void recordCustomerDevice();
  }, [profile?.id, profile?.role]);

  // A new business owner who arrived through a shop-referral link (Refer-a-Shop Competition) is attributed once, by the server
  useEffect(() => {
    if (profile?.role !== 'owner') return;
    const code = getStoredShopRef();
    if (!code) return;
    void (async () => {
      const d = await getDeviceSignals();
      await supabase.rpc('claim_shop_referral', { p_code: code, p_device_id: d?.id ?? null, p_device_fp: d?.fp ?? null });
      clearShopRef();
    })();
  }, [profile?.id, profile?.role]);

  // Fraud protection: remember which browser a business owner uses (weak signal only; the server decides with several signals + admin review)
  useEffect(() => {
    if (profile?.role === 'owner') void recordShopDevice();
  }, [profile?.id, profile?.role]);

  // renew this browser's push subscription if this user already turned it on (never turns it on by itself)
  useEffect(() => { if (profile?.id) void syncPushSubscription().catch(() => undefined); }, [profile?.id]);

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
            {session && <NotificationBell uid={session.user.id} />}
            <HeaderMenu />
          </div>
        </div>
      </header>

      {!online && <p role="status" className="bg-amber-100 px-4 py-1.5 text-center text-xs font-medium text-amber-900">{t('off.banner')}</p>}

      <InstallPrompt />

      {!isSupabaseConfigured && (
        <p role="alert" className="bg-ink px-4 py-2 text-center text-sm text-cream">{t('err.config')}</p>
      )}

      <main className="flex-1"><Outlet /></main>

      <footer className="border-t border-ink/10 px-4 py-6 text-center text-sm text-ink/70">
        {profile?.role === 'customer' && <Link to="/refer" className="mr-3 btn-text">{t('ref.title')}</Link>}
        {profile?.role === 'customer' && <Link to="/refer/competition" className="mr-3 btn-text">{t('cc.title')}</Link>}
        {profile?.role === 'owner' && <Link to="/owner/competition" className="mr-3 btn-text">{t('sc.title')}</Link>}
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
