import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { LANGS, useI18n, type Lang } from '../i18n';

export default function Settings() {
  const { lang, setLang, t } = useI18n();
  const { updateLanguage } = useAuth();

  function pick(next: Lang) {
    setLang(next);
    void updateLanguage(next);
  }

  return (
    <div className="mx-auto max-w-xl space-y-4 px-4 py-6">
      <h1 className="font-display text-2xl font-semibold">{t('bn.settings')}</h1>
      <div className="card">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink/60">{t('lang.label')}</p>
        <div className="flex flex-col gap-1">
          {LANGS.map((l) => (
            <button
              key={l.code}
              type="button"
              aria-pressed={lang === l.code}
              onClick={() => pick(l.code)}
              className={`flex min-h-[44px] items-center justify-between rounded-xl px-3 text-left text-sm ${lang === l.code ? 'bg-blush/30 font-semibold' : 'hover:bg-ink/5'}`}
            >
              {l.label}
              {lang === l.code && <span aria-hidden="true">✓</span>}
            </button>
          ))}
        </div>
      </div>
      <Link to="/notifications/settings" className="card flex min-h-[48px] items-center justify-between text-sm font-medium">
        {t('set.notifications')}<span aria-hidden="true">›</span>
      </Link>
    </div>
  );
}
