import { Link } from 'react-router-dom';
import { useI18n } from '../i18n';

/** Notice shown next to every sign-up / sign-in button (Google sign-in can create an account too). */
export default function LegalConsent() {
  const { t } = useI18n();
  return (
    <p className="text-center text-xs text-ink/60">
      {t('legal.agreePre')}{' '}
      <Link to="/terms" className="link-text">{t('footer.terms')}</Link>{' '}
      {t('legal.and')}{' '}
      <Link to="/privacy" className="link-text">{t('footer.privacy')}</Link>
      {t('legal.agreePost')}
    </p>
  );
}
