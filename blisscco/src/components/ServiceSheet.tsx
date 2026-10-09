import { useCallback, useEffect, useRef, useState, type TouchEvent } from 'react';
import { useI18n } from '../i18n';
import { rupees } from '../lib/format';
import type { Service } from '../lib/types';

interface Props { service: Service; images: string[]; onClose: () => void }

/** Half-screen bottom sheet (slides up from the bottom) that shows a service's photos, price and details. */
export default function ServiceSheet({ service, images, onClose }: Props) {
  const { t } = useI18n();
  const [closing, setClosing] = useState(false);
  const [dragY, setDragY] = useState(0);
  const startY = useRef<number | null>(null);
  const title = service.name || service.service_category;

  const close = useCallback(() => {
    setClosing(true);
    window.setTimeout(onClose, 200);
  }, [onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [close]);

  // swipe down on the top part of the sheet to close it
  const onTouchStart = (e: TouchEvent) => { startY.current = e.touches[0].clientY; };
  const onTouchMove = (e: TouchEvent) => {
    if (startY.current === null) return;
    setDragY(Math.max(0, e.touches[0].clientY - startY.current));
  };
  const onTouchEnd = () => {
    if (dragY > 90) close(); else setDragY(0);
    startY.current = null;
  };

  return (
    <div className="fixed inset-0 z-40" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" aria-label={t('svc.close')} onClick={close} tabIndex={-1}
        className={`absolute inset-0 h-full w-full cursor-default bg-ink/40 ${closing ? 'sheet-fade-out' : 'sheet-fade-in'}`} />
      <div
        className={`absolute inset-x-0 bottom-0 mx-auto flex h-[50dvh] max-h-[50vh] w-full max-w-xl flex-col rounded-t-3xl bg-white shadow-card ${closing ? 'sheet-down' : 'sheet-up'}`}
        style={{ transform: dragY ? `translateY(${dragY}px)` : undefined, transition: dragY ? 'none' : undefined, paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} className="touch-none">
          <div className="mx-auto mt-2 h-1.5 w-10 rounded-full bg-ink/20" aria-hidden="true" />
          <div className="flex items-start justify-between gap-3 px-4 pb-2 pt-3">
            <div className="min-w-0">
              <h2 className="truncate font-display text-lg font-semibold">{title}</h2>
              <p className="text-sm text-ink/70">
                <b className="text-base text-ink">{rupees(service.price_inr)}</b>
                {service.duration_minutes ? ` · ${service.duration_minutes} ${t('biz.min')}` : ''}
              </p>
            </div>
            <button type="button" onClick={close} aria-label={t('svc.close')}
              className="flex h-10 w-10 flex-none items-center justify-center rounded-full border border-ink/20 text-ink hover:bg-ink/5">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 pb-4">
          {images.length > 0 ? (
            <div className="-mx-4 flex snap-x snap-mandatory gap-2 overflow-x-auto px-4" style={{ scrollbarWidth: 'none' }}>
              {images.map((u, i) => (
                <div key={u} className={`flex h-[26dvh] flex-none snap-center items-center justify-center overflow-hidden rounded-2xl bg-cream ${images.length > 1 ? 'w-[82%]' : 'w-full'}`}>
                  <img src={u} alt={t('svc.photoAlt', { name: title, n: i + 1, total: images.length })} className="h-full w-full object-contain" />
                </div>
              ))}
            </div>
          ) : (
            <p className="rounded-2xl bg-cream p-4 text-center text-sm text-ink/70">{t('svc.noPhotos')}</p>
          )}
          {service.description && <p className="whitespace-pre-line text-sm leading-relaxed text-ink/80">{service.description}</p>}
        </div>
      </div>
    </div>
  );
}
