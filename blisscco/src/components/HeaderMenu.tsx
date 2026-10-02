import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { LANGS, useI18n, type Lang } from '../i18n';

/** Three-line (hamburger) menu: language changer + log out live here. */
export default function HeaderMenu() {
  const { lang, setLang, t } = useI18n();
  const { session, updateLanguage, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function pick(next: Lang) {
    setLang(next);
    if (session) void updateLanguage(next);
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label="Menu"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex h-11 w-11 items-center justify-center rounded-full border border-ink/20 text-ink hover:bg-ink/5"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <path d="M4 7h16M4 12h16M4 17h16" />
        </svg>
      </button>

      {open && (
        <div role="menu" className="absolute right-0 top-12 z-20 w-56 space-y-3 rounded-2xl border border-ink/10 bg-white p-3 shadow-card">
          <div>
            <p className="mb-1.5 px-1 text-xs font-semibold uppercase tracking-wide text-ink/60">{t('lang.label')}</p>
            <div className="flex flex-col gap-1">
              {LANGS.map((l) => (
                <button
                  key={l.code}
                  type="button"
                  role="menuitemradio"
                  aria-checked={lang === l.code}
                  onClick={() => pick(l.code)}
                  className={`flex min-h-[40px] items-center justify-between rounded-xl px-3 text-left text-sm ${lang === l.code ? 'bg-blush/30 font-semibold' : 'hover:bg-ink/5'}`}
                >
                  {l.label}
                  {lang === l.code && <span aria-hidden="true">✓</span>}
                </button>
              ))}
            </div>
          </div>
          {session && (
            <button
              type="button"
              role="menuitem"
              onClick={() => { setOpen(false); void signOut(); }}
              className="flex min-h-[44px] w-full items-center justify-center rounded-xl border border-ink/20 text-sm font-medium hover:bg-ink/5"
            >
              {t('nav.logout')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
