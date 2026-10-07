import { useCallback, useEffect, useState } from 'react';
import { useI18n } from '../i18n';

const PREFIX = 'blisscco.tutorial.';

function wasSeen(key: string): boolean {
  try { return localStorage.getItem(PREFIX + key) === '1'; } catch { return true; }   // storage blocked: never nag
}

/** Opens by itself the first time (per browser); `show()` opens it again from the "?" button. */
export function useTutorial(key: string) {
  const [open, setOpen] = useState(false);
  useEffect(() => { if (!wasSeen(key)) setOpen(true); }, [key]);
  const close = useCallback(() => {
    setOpen(false);
    try { localStorage.setItem(PREFIX + key, '1'); } catch { /* ignore */ }
  }, [key]);
  const show = useCallback(() => setOpen(true), []);
  return { open, close, show };
}

export function TutorialButton({ onClick }: { onClick: () => void }) {
  const { t } = useI18n();
  return (
    <button type="button" onClick={onClick} aria-label={t('tut.show')}
      className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-ink/20 bg-white px-3 text-sm font-medium hover:bg-ink/5">
      <span aria-hidden="true" className="flex h-5 w-5 items-center justify-center rounded-full bg-blush text-xs font-bold">?</span>
      {t('tut.show')}
    </button>
  );
}

/** steps: [titleKey, bodyKey] pairs from the i18n files. */
export default function Tutorial({ open, onClose, titleKey, steps }: { open: boolean; onClose: () => void; titleKey: string; steps: [string, string][] }) {
  const { t } = useI18n();
  const [i, setI] = useState(0);
  useEffect(() => { if (open) setI(0); }, [open]);
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  if (!open || steps.length === 0) return null;
  const last = i === steps.length - 1;
  const [title, body] = steps[i];

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/50 p-4 sm:items-center" role="dialog" aria-modal="true" aria-label={t(titleKey)}>
      <div className="card w-full max-w-md space-y-4">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink/60">{t(titleKey)} · {t('tut.stepOf', { n: i + 1, total: steps.length })}</p>
          <button type="button" className="btn-text-muted" onClick={onClose}>{t('tut.skip')}</button>
        </div>
        <div className="flex gap-1.5" aria-hidden="true">
          {steps.map((_, k) => <span key={k} className={`h-1.5 flex-1 rounded-full ${k <= i ? 'bg-blush' : 'bg-ink/10'}`} />)}
        </div>
        <h2 className="font-display text-xl font-semibold">{t(title)}</h2>
        <p className="text-base leading-relaxed text-ink/80">{t(body)}</p>
        <div className="flex gap-2">
          {i > 0 && <button type="button" className="btn-secondary flex-1" onClick={() => setI(i - 1)}>{t('tut.back')}</button>}
          <button type="button" className="btn-solid flex-1" onClick={() => (last ? onClose() : setI(i + 1))}>{last ? t('tut.done') : t('tut.next')}</button>
        </div>
        {last && <p className="text-center text-xs text-ink/60">{t('tut.again')}</p>}
      </div>
    </div>
  );
}
