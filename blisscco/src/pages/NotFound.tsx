import { Link } from 'react-router-dom';
import Seo from '../components/Seo';
import { useI18n } from '../i18n';

export default function NotFound() {
  const { t } = useI18n();
  return (
    <section className="mx-auto max-w-md space-y-4 px-4 py-16 text-center">
      <Seo title="Page not found | Blisscco" noindex />
      <p className="font-display text-6xl font-semibold text-blush" aria-hidden="true">404</p>
      <h1 className="font-display text-2xl font-semibold">{t('seo.404.title')}</h1>
      <p className="text-ink/80">{t('seo.404.body')}</p>
      <div className="flex flex-col gap-3 pt-2">
        <Link to="/" className="btn-primary">{t('common.backHome')}</Link>
        <Link to="/explore" className="btn-secondary">{t('landing.browse')}</Link>
      </div>
    </section>
  );
}
