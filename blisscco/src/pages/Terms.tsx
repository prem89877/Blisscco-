import { CONTACT_EMAIL, COURTS_CITY, GRIEVANCE_OFFICER, GRIEVANCE_RESPONSE_TIME, OPERATOR_ADDRESS, OPERATOR_NAME } from '../lib/site';
import LegalPage, { H, UL } from './LegalPage';

export default function Terms() {
  const mail = <a className="link-text" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>;
  return (
    <LegalPage title="Terms of Service">
      <p>These terms apply when you use Blisscco as a visitor, customer or business owner. By creating an account or using Blisscco you agree to them and to our Privacy Policy. If you do not agree, please do not use Blisscco.</p>

      <H>What Blisscco is</H>
      <p>Blisscco is run by {OPERATOR_NAME}, {OPERATOR_ADDRESS}. It is an online platform that helps customers find beauty and personal-care businesses, request appointments, take walk-in queue tokens, and read and write reviews. The businesses are independent. Blisscco does not provide salon, spa, tattoo or any other service itself, does not employ the businesses, and is not a party to the service between a customer and a business.</p>

      <H>Accounts</H>
      <UL>
        <li>You must be 18 or older to create an account.</li>
        <li>Give correct information, keep your password safe, and tell us if you think someone else is using your account. You are responsible for what happens under your account.</li>
        <li>Browsing needs no account. Booking, reviewing and Refer &amp; Earn need one.</li>
      </UL>

      <H>Customers: bookings and queues</H>
      <UL>
        <li>Blisscco does not charge customers for bookings. You pay the business directly at the shop, and prices shown are set by the business.</li>
        <li>Appointment: you choose a service and a date, and the shop then sends you a time. If the shop does not send a time within 1 hour, the request closes automatically and you can request again. A request is not a confirmed appointment until the shop sets a time.</li>
        <li>Walk-in token: you get a token and your place in the line is worked out live. Any waiting time shown is the shop's own estimate. A shop may start, skip or cancel a token, and you may cancel yours before service starts.</li>
        <li>Blisscco does not charge cancellation or no-show fees. Whether a shop treats you differently after a no-show is between you and the shop.</li>
        <li>Delays, cancellations by a shop, service quality, safety, pricing differences and any compensation are matters between you and the business. Blisscco cannot guarantee that a business will honour a booking or that its information is correct.</li>
        <li>If something went wrong with a finished or cancelled booking, you can send a report from the booking within 30 days. We may look at the records and, where they are wrong, correct the booking status. A report does not mean Blisscco will refund or compensate you.</li>
        <li>Reminders and other notifications are sent on a best-effort basis and may be delayed or not delivered.</li>
      </UL>

      <H>Reviews and ratings</H>
      <UL>
        <li>Any signed-in customer can review a shop, either from one of their own bookings or directly from the shop page (one direct review per shop). The shop's own owner cannot review that shop. Blisscco does not check whether a service was actually received, so a review is not proof of a purchase.</li>
        <li>Reviews are the personal opinions of the people who write them. They are published straight away, with the reviewer's first name. Blisscco does not guarantee that any review or rating is true, complete or unbiased.</li>
        <li>Write only about your own experience, honestly. Do not post fake or paid reviews, reviews of your own business or a competitor, abuse, threats, defamatory statements, other people's private details, or anything unlawful. Business owners must not write reviews for their own shop, ask friends or staff to do so, or offer rewards for good reviews.</li>
        <li>Business owners can reply publicly to a review and can report a review to us. Anyone else who thinks a review breaks these rules can email us. We may remove a review that breaks these rules or that we are legally required to remove. We aim not to remove honest reviews only because they are critical.</li>
      </UL>

      <H>Business owners: listings</H>
      <UL>
        <li>You must own the business or be authorised to list it. One real business should have one listing; duplicate, fake, misleading or unauthorised listings are not allowed.</li>
        <li>You are responsible for everything you submit: name, category, description, photos, address, map location, phone, services, prices, opening hours, and your queue status and waiting times. Photos must be genuine, and you must have the right to use them. Keep information up to date and honour the bookings and prices you show.</li>
        <li>You are responsible for your own licences, permits, taxes, hygiene and safety obligations, and for the services you provide.</li>
        <li>Blisscco reviews a listing before it goes live and may approve, reject or suspend it, ask for changes, or hide it. Approval means we checked that the listing looks complete under our process. It is not a check of your licences or quality and it is not an endorsement.</li>
        <li>You give Blisscco a non-exclusive permission to show and store the content you upload (such as photos, banners and descriptions) on Blisscco and in its promotional materials for Blisscco, for as long as your listing is on Blisscco. You keep ownership of your content.</li>
        <li>You will receive customers' names and booking details. Use them only to provide the booked service and keep them private. You are responsible for how you handle them.</li>
      </UL>

      <H>Paid services for business owners</H>
      <UL>
        <li>Blisscco currently offers three optional paid services: the blue badge, extra banners, and a personalised physical QR poster. Prices are shown before you pay and may change for future purchases. You pay Blisscco through Razorpay by UPI. All prices are inclusive of applicable GST. A GST-compliant invoice/receipt will be provided electronically after payment.</li>
        <li>A service starts only after Razorpay confirms the payment to us, which can take a short while. If a payment fails, the payment provider handles any return of money.</li>
        <li>Refunds and cancellations: Payments are non-refundable and cannot be cancelled after successful payment. Physical QR poster orders cannot be cancelled once processing has started. If a payment is refunded in full, the blue badge or banner credit it gave is removed.</li>
      </UL>

      <H>Blue badge</H>
      <UL>
        <li>To get the badge, you upload a business document (GST, shop licence, Udyam or another document). A Blisscco admin looks at it. If it is approved, you may buy the badge, and the blue tick shows next to your shop name for one year while it is active.</li>
        <li>The badge only means that a Blisscco admin reviewed a business document submitted by the shop. It does not mean Blisscco guarantees or endorses the shop, its service quality, prices, safety or licences, and we cannot promise that a document is genuine or still valid.</li>
        <li>The badge does not change where a shop appears in search results. We may remove a badge if we find the document was false or the shop breaks these terms. No refund will be provided if a badge is removed due to false documents or violation of these Terms.</li>
      </UL>

      <H>Sponsored banners</H>
      <UL>
        <li>A banner is a paid promotion. It is marked "Sponsored" and may be shown to people within about 5 km of the shop. Each banner needs one banner credit.</li>
        <li>Every banner is checked by Blisscco before it is shown. A banner must be honest, lawful and made from images you have the right to use. If we reject a banner, or you cancel it before review, the credit is returned. An approved banner runs for 30 days.</li>
        <li>Paying for a banner does not guarantee more customers or bookings.</li>
      </UL>

      <H>Refer &amp; Earn and coupons</H>
      <UL>
        <li>When Refer &amp; Earn is switched on, a customer who shares a link can earn a coupon after the person who joined verifies their email and completes a service at a shop that neither of them owns. Only one reward is given per person. The reward is chosen from the options we set, and coupons expire.</li>
        <li>Coupons have no cash value. A shop gives the discount on the final bill. Shops can turn coupon acceptance off in their settings; a shop that accepts coupons should honour a valid one for a completed booking. The shop enters the coupon within 7 days of the booking being completed. Blisscco does not pay the discount.</li>
        <li>We may reject or cancel rewards and coupons, and end or change the campaign at any time, if we suspect misuse such as fake accounts or bookings.</li>
      </UL>

      <H>QR codes</H>
      <p>A shop's QR code opens that shop's page on Blisscco. Opening it adds to the shop's visit count as described in the Privacy Policy. It does not give Blisscco your name or location.</p>

      <H>Acceptable use</H>
      <p>Do not use Blisscco to break the law, commit fraud or impersonate anyone; post content that is false, abusive, defamatory, obscene or that infringes someone's rights; harass others; make fake accounts, fake bookings or fake reviews; misuse referrals or coupons; collect data from Blisscco with automated tools; or attack, overload or try to get around the security of Blisscco.</p>

      <H>Suspension and removal</H>
      <p>We may reject or remove content or listings, cancel bookings, withdraw rewards, or suspend or close an account if you break these terms, if we suspect fraud or illegal activity, if a business is reported or found to be unsafe or false, or if the law or an authority requires it. Where we reasonably can, we will tell you why and you can write to us to ask for a review. You can stop using Blisscco at any time. Business owners can set a listing to inactive. To close an account, email us.</p>

      <H>Our responsibility</H>
      <p>Blisscco is provided on an “as is” and “as available” basis. We do not guarantee uninterrupted service or complete accuracy. To the extent permitted by law, Blisscco is not responsible for businesses, users, their services or disputes between them, or indirect or consequential losses. Nothing in these Terms limits rights or liability that cannot be limited under Indian law.</p>

      <H>Changes to these terms</H>
      <p>We may update these terms. The new version will be posted here with a new date. If you keep using Blisscco after the change, you accept it, unless the law needs your fresh consent. Business owners may be asked to accept updated listing terms.</p>

      <H>Governing law</H>
      <p>These Terms are governed by the laws of India. Courts in {COURTS_CITY} shall have jurisdiction, subject to applicable consumer laws.</p>

      <H>Contact and complaints</H>
      <p>{mail}</p>
      <p>Grievance Officer: {GRIEVANCE_OFFICER}. Response time: {GRIEVANCE_RESPONSE_TIME}.</p>
    </LegalPage>
  );
}
