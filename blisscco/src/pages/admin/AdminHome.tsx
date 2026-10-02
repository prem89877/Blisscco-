import { Link } from 'react-router-dom';
import { useI18n } from '../../i18n';

export default function AdminHome() {
  const { t } = useI18n();
  return (
    <section className="mx-auto max-w-2xl space-y-4 px-4 py-6">
      <h1 className="font-display text-2xl font-semibold">{t('dash.admin')}</h1>
      <Link to="/admin/applications" className="card block font-medium">{t('admin.applications')}</Link>
      <Link to="/admin/categories" className="card block font-medium">{t('admin.categories')}</Link>
      <Link to="/admin/reviews" className="card block font-medium">{t('ad.reviews')}</Link>
      <Link to="/admin/referrals" className="card block font-medium">{t('ad.referrals')}</Link>
      <Link to="/admin/banners" className="card block font-medium">{t('p8.adBanners')}</Link>
      <Link to="/admin/verifications" className="card block font-medium">{t('p8.adVerify')}</Link>
      <Link to="/admin/payments" className="card block font-medium">{t('p8.adPayments')}</Link>
    </section>
  );
}
