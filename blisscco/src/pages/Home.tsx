import { Link } from 'react-router-dom';
import { useI18n } from '../i18n';

export default function Home() {
  const { t } = useI18n();
  return (
    <section className="mx-auto max-w-3xl px-4 py-10 text-center">
      <p className="text-sm font-medium text-ink/70">{t('app.tagline')}</p>
      <h1 className="mt-2 font-display text-3xl font-semibold leading-tight sm:text-4xl">{t('home.title')}</h1>
      <p className="mx-auto mt-3 max-w-xl text-ink/80">{t('home.sub')}</p>

      <div className="mx-auto mt-6 max-w-xl">
        <label htmlFor="q" className="sr-only">{t('home.search')}</label>
        <input id="q" className="input rounded-full" placeholder={t('home.search')} disabled aria-describedby="q-note" />
        <p id="q-note" className="mt-2 text-sm text-ink/60">{t('home.soon')}</p>
      </div>

      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Link to="/register" className="btn-primary">{t('nav.register')}</Link>
        <Link to="/owner/register" className="btn-secondary">{t('nav.forBusiness')}</Link>
      </div>
    </section>
  );
}
