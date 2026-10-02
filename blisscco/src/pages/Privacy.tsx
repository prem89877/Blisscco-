import { CONTACT_EMAIL } from '../lib/site';
import LegalPage, { H } from './LegalPage';

export default function Privacy() {
  return (
    <LegalPage title="Privacy Policy">
      <p>Blisscco is a platform to discover beauty and personal-care businesses near you. This page explains what data we collect and why.</p>
      <H>What we collect</H>
      <ul className="list-disc space-y-1 pl-5">
        <li>Account data: name, email address and language preference. If you sign in with Google, we receive your name and verified email from Google. We never see your Google password.</li>
        <li>Phone number, only if you choose to verify it (for example for referral rewards).</li>
        <li>Location: your device location only when you allow it, to show businesses near you. We do not track your location in the background.</li>
        <li>Business owners: business details, photos, address, coordinates, services and prices you submit.</li>
        <li>Bookings, reviews and usage events needed to run the service and show business analytics.</li>
        <li>Anonymous visit counts for shops (a shop page opened, a shop shown in search, a booking made, and whether it came from a QR code, search, a referral link or directly). These counts are linked to the shop only, not to your name, phone number, email or account, and are deleted after about 13 months.</li>
      </ul>
      <H>How we use it</H>
      <p>To create and secure your account, show nearby businesses, manage bookings and queues, prevent fraud and abuse, send service notifications, and improve Blisscco.</p>
      <H>Who we share it with</H>
      <p>Business owners see only what they need to serve your booking. We use service providers to run the app (hosting and database, sign-in, email, and payments for business subscriptions). We do not sell your personal data.</p>
      <H>Your choices</H>
      <p>You can change your language and notification settings, deny location access, and ask us to correct or delete your account data by emailing us.</p>
      <H>Retention and security</H>
      <p>We keep data while your account is active and as required by law. Access to data is restricted by role and database security rules.</p>
      <H>Contact</H>
      <p>Questions or requests: <a className="link-text" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a></p>
    </LegalPage>
  );
}
