import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../i18n';

interface Item { key: string; label: string; icon: string; to?: string; href?: string; active: boolean }

/** Fixed bottom bar (signed-in users). Selected tab = filled icon, others = transparent outline icon. */
export default function BottomNav() {
  const { session, profile } = useAuth();
  const { t } = useI18n();
  const { pathname } = useLocation();
  if (!session) return null;

  const isOwner = profile?.role === 'owner';
  const referTo = profile?.role === 'owner' ? '/owner/competition' : profile?.role === 'admin' ? '/admin/competition' : '/refer';
  const is = (p: string) => pathname === p || pathname.startsWith(p + '/');

  const items: Item[] = [
    isOwner
      ? { key: 'advisor', label: t('bn.advisor'), icon: 'ai-advisor', to: '/owner/advisor', active: is('/owner/advisor') }
      : { key: 'bookings', label: t('bn.bookings'), icon: 'bookings', to: '/my-bookings', active: is('/my-bookings') },
    { key: 'refer', label: t('bn.refer'), icon: 'refer', to: referTo, active: is('/refer') || is('/owner/competition') || is('/admin/competition') },
    { key: 'home', label: t('bn.home'), icon: 'home', to: '/explore', active: pathname === '/' || is('/explore') },
    { key: 'help', label: t('bn.help'), icon: 'help', to: '/support', active: is('/support') },
    { key: 'profile', label: t('bn.profile'), icon: 'profile', to: '/profile', active: is('/profile') },
  ];

  const cls = (active: boolean) =>
    `flex min-h-[56px] flex-1 flex-col items-center justify-center gap-0.5 px-1 text-[11px] font-medium transition active:opacity-70 ${active ? 'text-ink' : 'text-ink/60'}`;

  const inner = (it: Item) => (
    <>
      <img
        src={`/icons/nav/${it.icon}${it.active ? '-filled' : ''}.png`}
        alt=""
        width={26}
        height={26}
        className="h-[26px] w-[26px] object-contain"
        aria-hidden="true"
      />
      <span className="truncate">{it.label}</span>
    </>
  );

  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-10 border-t border-ink/10 bg-cream/95 backdrop-blur"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="mx-auto flex max-w-5xl items-stretch">
        {items.map((it) =>
          it.href ? (
            <a key={it.key} href={it.href} className={cls(it.active)}>{inner(it)}</a>
          ) : (
            <Link key={it.key} to={it.to!} aria-current={it.active ? 'page' : undefined} className={cls(it.active)}>{inner(it)}</Link>
          ),
        )}
      </div>
    </nav>
  );
}
