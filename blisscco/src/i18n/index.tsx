import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { messages, type Lang } from './messages';

export { LANGS } from './messages';
export type { Lang } from './messages';

const KEY = 'blisscco.lang';
type TFn = (key: string, vars ? : Record < string, string | number > ) => string;
interface I18nCtx { lang: Lang;setLang: (l: Lang) => void;t: TFn }

const Ctx = createContext < I18nCtx | null > (null);

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'en' || saved === 'hi' || saved === 'mr') return saved;
  } catch { /* storage unavailable */ }
  return 'en';
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState < Lang > (initialLang);
  
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);
  
  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try { localStorage.setItem(KEY, l); } catch { /* ignore */ }
  }, []);
  
  const t = useCallback < TFn > ((key, vars) => {
    let s = messages[lang][key] ?? messages.en[key] ?? key;
    if (vars)
      for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, String(v));
    return s;
  }, [lang]);
  
  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18nCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useI18n must be used inside I18nProvider');
  return c;
}