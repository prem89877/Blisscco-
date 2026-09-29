import { useI18n } from '../i18n';

export default function Placeholder({ titleKey }: { titleKey: string }) {
  const { t } = useI18n();
  return (
    <section className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="font-display text-2xl font-semibold">{t(titleKey)}</h1>
      <p className="mt-2 text-ink/70">{t('dash.soon')}</p>
    </section>
  );
}
