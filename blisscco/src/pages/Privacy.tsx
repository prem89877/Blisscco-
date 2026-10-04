import { CONTACT_EMAIL, GRIEVANCE_OFFICER, GRIEVANCE_RESPONSE_TIME, OPERATOR_ADDRESS, OPERATOR_NAME } from '../lib/site';
import LegalPage, { H, UL } from './LegalPage';

export default function Privacy() {
  const mail = <a className="link-text" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>;
  return (
    <LegalPage title="Privacy Policy">
      <p>Blisscco is a platform where people discover beauty and personal-care businesses near them and book appointments or walk-in queue tokens. This page explains what personal data we collect, why, who else can see it, and what you can ask us to do. Please also read our Terms.</p>

      <H>Who is responsible for your data</H>
      <p>Blisscco is run by {OPERATOR_NAME}, {OPERATOR_ADDRESS}. In this policy "we" means that operator. We decide why and how the personal data described below is used. Shops listed on Blisscco are independent businesses; once a shop receives your booking details it uses them for its own service to you.</p>

      <H>What we collect</H>
      <p className="font-medium">All account holders (customers and business owners)</p>
      <UL>
        <li>Full name, email address and language preference. We also keep your account type (customer or business owner), whether your email is verified, and whether your account is suspended.</li>
        <li>Your password is handled by our sign-in service. It is not stored in Blisscco's own database tables.</li>
        <li>If you continue with Google, Google tells our sign-in service your name and verified email address (and may also share other basic profile details such as a profile picture link, which Blisscco does not use). We never see your Google password.</li>
        <li>Your notification settings and your in-app notifications.</li>
      </UL>
      <p className="pt-1 font-medium">Customers</p>
      <UL>
        <li>Bookings: the shop, service, price shown at the time of booking, booking type (appointment request or walk-in token), the date you asked for or your token number, status changes with times, and your name copied from your account at the time of booking. If you ask for a reminder, we store that choice.</li>
        <li>Reviews: your star rating, any comment, and the first word of your name, which is shown publicly next to the review.</li>
        <li>Reports about a booking: the reason you type, which our team reads.</li>
        <li>Refer &amp; Earn: your referral code; if you join through someone's link, the code is remembered in your browser until you sign up and we then store which code you used. When a referral qualifies, we store a simplified form of your email address (lower case, with "+tag" parts removed and, for Gmail, dots removed) so the same person cannot be rewarded twice. We also store the coupons you receive and when they are used.</li>
        <li>We do not ask customers for a phone number or home address.</li>
      </UL>
      <p className="pt-1 font-medium">Business owners</p>
      <UL>
        <li>Business details you enter: name, category, description, phone, email, full address, PIN code, map coordinates, photos, services and prices, opening hours, booking and queue settings.</li>
        <li>Your acceptance of our listing terms (which account, which shop, which version, and when).</li>
        <li>Blue badge documents you upload (GST, shop licence, Udyam or other). They are stored in private storage that only you and Blisscco admins can open.</li>
        <li>Banner images and titles, and details of Blisscco services you buy (see Payments below).</li>
      </UL>

      <H>Location</H>
      <p>Blisscco asks your browser for your device location only when you tap to find shops near you, and the browser asks your permission first. We do not track your location in the background. Your coordinates are kept in memory while the app is open and are not saved in your browser or in our database tables. They are sent to our server to find nearby shops and nearby sponsored banners (within about 5 km). As with any online service, our hosting and database providers may keep ordinary technical logs for security and operation. If you deny location, you can still search by typing.</p>
      <p>Business owners can set their shop's location with the device's GPS or by entering it. A shop's location is public as part of its listing.</p>

      <H>What is public</H>
      <p>Anyone, even without an account, can see an approved shop's listing: name, category, description, address, PIN code, map location, photos, services and prices, opening hours, phone number (if the owner has chosen to show it; this is on by default), email (only if the owner chooses to show it), average rating, reviews with the reviewer's first name, the owner's replies, the blue tick if the shop has one, and any live sponsored banner. Do not put private information in a review.</p>

      <H>Who can see booking data</H>
      <p>Your bookings are visible to you, to the shop you booked with, and to Blisscco admins (for support, safety and disputes). The shop sees your name and the booking details. Blisscco does not give shops your email address. Shops that use the walk-in queue may also add a guest name they type themselves.</p>

      <H>How we use your data</H>
      <UL>
        <li>To create and secure your account and keep you signed in.</li>
        <li>To show nearby shops and manage bookings and queues.</li>
        <li>To send you notifications about your bookings, reviews, referral rewards and account (see Notifications below).</li>
        <li>To review shop listings, banners and blue badge documents.</li>
        <li>To run Refer &amp; Earn and coupons and to prevent misuse.</li>
        <li>To process payments from business owners and keep payment records.</li>
        <li>To prevent fraud and abuse, handle complaints and disputes, and meet legal obligations.</li>
        <li>To show shop owners simple visit statistics (see Visit statistics below) and to improve Blisscco.</li>
      </UL>

      <H>Visit statistics (analytics)</H>
      <p>When a shop page is opened, a shop appears in search results, or a booking is made, we record one counter row: which shop, the type of event, where the visit came from (QR code, search, referral link or direct), a time, and a one-way code made from a random ID that your browser tab generates (kept only until the tab is closed, and mixed with the date so it changes every day). This table does not store your name, email, phone number or account ID. Counting a booking once uses a one-way code made from the booking, so someone with direct access to our database could in theory match a counted booking back to that booking. Owners only see totals, never individual visitors. Our database provider receives your browser's normal request details (such as the browser type, which we use only to ignore robots and do not store in this table). These rows are deleted automatically after 400 days (about 13 months).</p>

      <H>Notifications</H>
      <p>Push and email notifications are turned on by default for bookings, approvals, reviews, payments and reminders. Push works only if you allow notifications in your browser; we then store your browser's push address and keys, and the browser type, so we can deliver messages to that device. Email notifications go to your account email. You can switch push or email off, or mute categories, under Notifications &gt; Settings in the app. A notification marked "sent" in our records means the push or email provider accepted it; it does not prove you received or read it. In-app notifications and their delivery records are deleted after 90 days. When you log out, we try to remove this device from push.</p>

      <H>Payments (business owners)</H>
      <p>Customers do not pay Blisscco and Blisscco does not hold customer money: you pay the shop directly. Business owners can buy paid Blisscco services (the blue badge, extra banners and the physical QR poster) through Razorpay, using UPI. Razorpay collects and processes your payment details; Blisscco does not receive or store your UPI PIN or card details. We store the order and payment IDs, amount, status, refunds, date and which service and shop it was for. We also store the payment notifications Razorpay sends us in full, and these may include contact details you gave at checkout (for example email, phone number or UPI ID). Payment records are kept for accounting and dispute purposes.</p>

      <H>Cookies and browser storage</H>
      <p>Blisscco does not use advertising or tracking cookies. Our sign-in service keeps your login session in your browser's local storage. We also store on your device: your language choice, a remembered referral code, a "install the app" reminder time, sign-in return information, and (for signed-in customers) a saved copy of recent data so the app can open offline. Saved copies are removed when you log out. The browser tab ID used for visit statistics lives only in session storage and disappears when the tab is closed. The app installs a service worker that saves the app's own files for offline use; it does not save your private data. Companies whose tools we load (see below) may set their own cookies or identifiers.</p>

      <H>Other companies that handle data for us</H>
      <UL>
        <li>Supabase: database, sign-in, and private file storage (photos, banners, documents).</li>
        <li>Vercel: hosts the website and our server functions.</li>
        <li>Google: "Continue with Google" sign-in, and Google Fonts, which your browser loads when you open the site (this lets Google receive your IP address and browser details).</li>
        <li>Razorpay: payments from business owners. Razorpay's checkout script is loaded when an owner pays.</li>
        <li>Resend: sends our notification emails, so it receives your email address and the email's text.</li>
        <li>Browser push services (such as those run by Google, Apple or Mozilla): carry push notifications to your device.</li>
        <li>An AI provider, used only by business owners for the optional "AI insights" and "AI price suggestion" tools. We send only summary visit numbers, a service name, the shop's city and state, and the shop's other service prices. No customer data is sent. [ACTION REQUIRED: name the AI provider you configured.]</li>
        <li>Our sign-in emails (email verification and password reset) are sent by our sign-in service. [ACTION REQUIRED: confirm which email service sends them.]</li>
      </UL>
      <p>We do not sell your personal data. We share it with these companies only so Blisscco can work, with shops as described above, and with authorities when the law requires.</p>

      <H>Where data is processed</H>
      <p>Some of the companies above may store or process data outside India. [ACTION REQUIRED: confirm the region of your Supabase project and Vercel functions.]</p>

      <H>How long we keep data</H>
      <UL>
        <li>Account, bookings, reviews and referral records: kept while your account exists, and afterwards as needed for disputes, fraud prevention and legal reasons. [ACTION REQUIRED: decide and state a maximum period.]</li>
        <li>Payment records and Razorpay notifications: kept for accounting and legal reasons. [ACTION REQUIRED: state period.]</li>
        <li>Blue badge documents: kept while needed to show how a badge decision was made. [ACTION REQUIRED: state period.]</li>
        <li>In-app notifications and their delivery records: 90 days.</li>
        <li>Visit statistics rows: 400 days (about 13 months).</li>
        <li>AI insight usage log (a count used for daily limits): 30 days.</li>
      </UL>

      <H>Your choices and rights</H>
      <UL>
        <li>You can change your language and notification settings in the app, and deny or turn off location and push notifications in your browser.</li>
        <li>You can ask us to show you the personal data we hold about you, to correct it, or to delete it, by emailing {mail}. We may need to confirm it is really you.</li>
        <li>You can ask to withdraw consent for things that depend on your consent, such as notifications. Withdrawing may mean some features no longer work.</li>
        <li>Business owners can hide their listing at any time by setting it to inactive. To close an account or remove a business and its data, email us.</li>
      </UL>
      <p>There is no delete button in the app yet, so we handle account deletion requests by hand. When we close an account we delete or anonymise the personal data we can, such as name, email and notifications. We may have to keep some records (for example payment records, and booking records that the shop also needs). Reviews you posted may stay on a shop's page without your name unless you ask us to remove them. We will tell you what we could not delete and why.</p>

      <H>Children</H>
      <p>Blisscco is for people aged 18 and over. We do not knowingly collect personal data from anyone under 18. If you think a child has created an account, email us and we will look into it.</p>

      <H>Security</H>
      <p>Access to data inside our database is limited by account type and database security rules, payment secrets stay on our servers, and uploaded documents and photos are kept in private storage that is opened with short-lived links. No online service can promise perfect security. If a data breach affects you, we will tell you and the authorities as the law requires.</p>

      <H>Changes to this policy</H>
      <p>When we change this policy we will publish the new version here with a new date.</p>

      <H>Contact and complaints</H>
      <p>Privacy questions, requests and complaints: {mail}</p>
      <p>Grievance Officer: {GRIEVANCE_OFFICER}. Response time: {GRIEVANCE_RESPONSE_TIME}.</p>
    </LegalPage>
  );
}
