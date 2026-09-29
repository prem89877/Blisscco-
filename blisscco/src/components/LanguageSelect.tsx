import { useAuth } from '../context/AuthContext';
import { LANGS, useI18n, type Lang } from '../i18n';

export default function LanguageSelect() {
  const { lang, setLang, t } = useI18n();
  const { session, updateLanguage } = useAuth();

  function onChange(next: Lang) {
    setLang(next);
    if (session) void updateLanguage(next);
  }

  return (
    <label className="flex items-center">
      <span className="sr-only">{t('lang.label')}</span>
      <select
        value={lang}
        onChange={(e) => onChange(e.target.value as Lang)}
        className="min-h-[40px] rounded-full border border-ink/20 bg-white px-3 text-sm"
      >
        {LANGS.map((l) => (<option key={l.code} value={l.code}>{l.label}</option>))}
      </select>
    </label>
  );
}
