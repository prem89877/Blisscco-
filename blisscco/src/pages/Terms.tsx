import { CONTACT_EMAIL } from '../lib/site';
import LegalPage, { H } from './LegalPage';

export default function Terms() {
  return (
    <LegalPage title="Terms of Service">
      <p>By using Blisscco you agree to these terms.</p>
      <H>What Blisscco is</H>
      <p>Blisscco helps customers find and book beauty and personal-care businesses. Businesses are independent. Blisscco does not provide the services itself.</p>
      <H>Customers</H>
      <ul className="list-disc space-y-1 pl-5">
        <li>Booking through Blisscco is free. You pay the business directly at the shop.</li>
        <li>Provide accurate information and do not misuse referrals, coupons or reviews.</li>
        <li>Reviews must reflect a real, completed service.</li>
      </ul>
      <H>Business owners</H>
      <ul className="list-disc space-y-1 pl-5">
        <li>Listings are reviewed by Blisscco and may be approved, rejected or suspended.</li>
        <li>You must provide genuine photos, your real location, correct prices and valid contact details.</li>
        <li>You are responsible for the services you provide and for keeping your queue and prices up to date.</li>
      </ul>
      <H>Acceptable use</H>
      <p>No fraud, fake listings, fake reviews, harassment or attempts to break or bypass the platform. We may suspend accounts that do.</p>
      <H>Liability</H>
      <p>Blisscco is provided "as is". We are not responsible for the quality of services offered by businesses or for disputes between customers and businesses, to the extent permitted by law.</p>
      <H>Governing law</H>
      <p>These terms are governed by the laws of India.</p>
      <H>Contact</H>
      <p><a className="underline" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a></p>
    </LegalPage>
  );
}
