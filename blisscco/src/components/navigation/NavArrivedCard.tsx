import { useEffect, useRef } from 'react';
import { useI18n } from '../../i18n';

/** "You're here": shown when the customer reaches the shop. Location tracking has already stopped at this point. */
export default function NavArrivedCard({ shopName, onViewShop }: { shopName: string; onViewShop: () => void }) {
  const { t } = useI18n();
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => { title.current?.focus(); }, []);   // moves screen-reader focus to the good news

  return (
    <div className="card w-full max-w-md space-y-4 text-center" role="status">
      <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-blush text-ink shadow-card" aria-hidden="true">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" focusable="false"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>
      </span>
      <div>
        <h2 ref={title} tabIndex={-1} className="font-display text-3xl font-semibold leading-tight outline-none">{t('nav.arrived.title')}</h2>
        <p className="mt-1 text-lg font-medium">{shopName}</p>
        <p className="text-sm text-ink/70">{t('nav.arrived.body')}</p>
      </div>
      <button type="button" className="btn-solid min-h-[52px] w-full text-base" onClick={onViewShop}>{t('nav.viewShop')}</button>
    </div>
  );
}
