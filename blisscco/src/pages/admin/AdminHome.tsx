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
      <Link to="/admin/competition" className="card block font-medium">{t('sa.title')}</Link>
      <Link to="/admin/competition/fraud" className="card block font-medium">🛡️ {t('fr.title')}</Link>
      <Link to="/admin/customer-competition" className="card block font-medium">{t('cc.adminTitle')}</Link>
      <Link to="/admin/banners" className="card block font-medium">{t('p8.adBanners')}</Link>
      <Link to="/admin/verifications" className="card block font-medium">{t('p8.adVerify')}</Link>
      <Link to="/admin/payments" className="card block font-medium">{t('p8.adPayments')}</Link>
      <Link to="/admin/users" className="card block font-medium">Users</Link>
      <Link to="/admin/disputes" className="card block font-medium">Booking disputes</Link>
      <Link to="/admin/promotions" className="card block font-medium">Promotions</Link>
      <Link to="/admin/reports" className="card block font-medium">Earnings report</Link>
      <Link to="/admin/notify" className="card block font-medium">Send notification</Link>
      <Link to="/admin/audit" className="card block font-medium">Audit log</Link>
    </section>
  );
}
