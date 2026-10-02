import { useI18n } from '../i18n';
import { useInstall } from '../lib/installPrompt';

// Slim banner under the header. Shown only when the browser can really install the app (or on iPhone, with manual steps).
export default function InstallPrompt() {
  const { t } = useI18n();
  const { canPrompt, showIosSteps, snoozed, install, snooze } = useInstall();
  if (snoozed || (!canPrompt && !showIosSteps)) return null;
  return (
    <div role="region" aria-label={t('p10.i.title')} className="border-b border-ink/10 bg-white px-4 py-2.5">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2">
        <p className="text-sm">
          <span className="font-semibold">{t('p10.i.title')}.</span>{' '}
          {canPrompt ? t('p10.i.text') : t('p10.i.iosText')}
        </p>
        <div className="flex gap-2">
          {canPrompt && <button className="btn-primary" onClick={() => void install()}>{t('p10.i.button')}</button>}
          <button className="btn-secondary" onClick={snooze}>{t('p10.i.later')}</button>
        </div>
      </div>
    </div>
  );
}
