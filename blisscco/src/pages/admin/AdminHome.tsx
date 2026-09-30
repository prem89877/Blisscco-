import { Link } from 'react-router-dom';
import { useI18n } from '../../i18n';

export default function AdminHome() {
  const { t } = useI18n();
  return (
    <section className="mx-auto max-w-2xl space-y-4 px-4 py-6">
      <h1 className="font-display text-2xl font-semibold">{t('dash.admin')}</h1>
      <Link to="/admin/applications" className="card block font-medium">{t('admin.applications')}</Link>
      <Link to="/admin/categories" className="card block font-medium">{t('admin.categories')}</Link>
    </section>
  );
}
