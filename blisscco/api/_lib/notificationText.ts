// Notification wording in English / Hindi / Marathi.
// ONE source for everything the user reads: the in-app list (browser), web-push and e-mail (Vercel route).
// Pure functions, no imports, so both the Vite app and /api/dispatch-notifications can use this file.
// The database stores only the type + a few facts (data); the text is built here in the user's language.

export type NotifLang = 'en' | 'hi' | 'mr';
export type NotifData = Record<string, unknown>;
type Tpl = Record<NotifLang, [string, string]>;

const T: Record<string, Tpl> = {
  booking_new: {
    en: ['New booking', '{who} booked {service} for {when}.'],
    hi: ['नई बुकिंग', '{who} ने {when} के लिए {service} बुक किया।'],
    mr: ['नवीन बुकिंग', '{who} यांनी {when} साठी {service} बुक केले.'],
  },
  booking_new_walkin: {
    en: ['New walk-in token', '{who} took token #{token} for {service}.'],
    hi: ['नया वॉक-इन टोकन', '{who} ने {service} के लिए टोकन #{token} लिया।'],
    mr: ['नवीन वॉक-इन टोकन', '{who} यांनी {service} साठी टोकन #{token} घेतले.'],
  },
  booking_confirmed: {
    en: ['Booking confirmed', '{service} at {shop}, {when}.'],
    hi: ['बुकिंग कन्फ़र्म', '{shop} में {service}, {when}।'],
    mr: ['बुकिंग निश्चित', '{shop} येथे {service}, {when}.'],
  },
  booking_confirmed_walkin: {
    en: ['Token #{token} confirmed', 'Your walk-in token for {service} at {shop}. Check the queue for the wait time.'],
    hi: ['टोकन #{token} कन्फ़र्म', '{shop} में {service} के लिए आपका वॉक-इन टोकन। इंतज़ार का समय कतार में देखें।'],
    mr: ['टोकन #{token} निश्चित', '{shop} येथे {service} साठी तुमचे वॉक-इन टोकन. प्रतीक्षा वेळ रांगेत पहा.'],
  },
  booking_cancelled_by_shop: {
    en: ['Booking cancelled by the shop', '{shop} cancelled your {service} booking. You can book another time.'],
    hi: ['दुकान ने बुकिंग रद्द की', '{shop} ने आपकी {service} बुकिंग रद्द कर दी। आप दूसरा समय बुक कर सकते हैं।'],
    mr: ['दुकानाने बुकिंग रद्द केली', '{shop} ने तुमची {service} बुकिंग रद्द केली. तुम्ही दुसरी वेळ बुक करू शकता.'],
  },
  booking_cancelled_by_customer: {
    en: ['Customer cancelled', '{who} cancelled their {service} booking.'],
    hi: ['ग्राहक ने रद्द किया', '{who} ने अपनी {service} बुकिंग रद्द कर दी।'],
    mr: ['ग्राहकाने रद्द केले', '{who} यांनी त्यांची {service} बुकिंग रद्द केली.'],
  },
  booking_in_service: {
    en: ["It's your turn", '{shop} has started your {service}.'],
    hi: ['आपकी बारी है', '{shop} ने आपकी {service} शुरू कर दी है।'],
    mr: ['तुमची पाळी आहे', '{shop} ने तुमची {service} सुरू केली आहे.'],
  },
  booking_completed: {
    en: ['Thanks for visiting', 'How was {service} at {shop}? A short review helps other customers.'],
    hi: ['आने के लिए धन्यवाद', '{shop} में {service} कैसी रही? छोटा-सा रिव्यू दूसरों की मदद करता है।'],
    mr: ['भेट दिल्याबद्दल धन्यवाद', '{shop} येथे {service} कशी वाटली? छोटा रिव्यू इतरांना मदत करतो.'],
  },
  booking_no_show: {
    en: ['Marked as no-show', '{shop} marked your {service} booking as a no-show.'],
    hi: ['नो-शो दर्ज', '{shop} ने आपकी {service} बुकिंग को नो-शो दर्ज किया।'],
    mr: ['नो-शो नोंदवले', '{shop} ने तुमची {service} बुकिंग नो-शो म्हणून नोंदवली.'],
  },
  business_approved: {
    en: ['Your shop is approved', '{shop} is now live on Blisscco.'],
    hi: ['आपकी दुकान मंज़ूर हो गई', '{shop} अब Blisscco पर लाइव है।'],
    mr: ['तुमचे दुकान मंजूर झाले', '{shop} आता Blisscco वर लाइव्ह आहे.'],
  },
  business_reactivated: {
    en: ['Your shop is active again', '{shop} was reactivated and is visible to customers.'],
    hi: ['आपकी दुकान फिर से चालू', '{shop} दोबारा चालू कर दी गई है और ग्राहकों को दिखेगी।'],
    mr: ['तुमचे दुकान पुन्हा सुरू', '{shop} पुन्हा सुरू केले आहे आणि ग्राहकांना दिसेल.'],
  },
  business_rejected: {
    en: ['Shop needs changes', '{shop} was not approved.{reasonLine} Fix it and submit again.'],
    hi: ['दुकान में बदलाव ज़रूरी', '{shop} मंज़ूर नहीं हुई।{reasonLine} सुधारकर दोबारा भेजें।'],
    mr: ['दुकानात बदल आवश्यक', '{shop} मंजूर झाले नाही.{reasonLine} सुधारून पुन्हा सादर करा.'],
  },
  business_suspended: {
    en: ['Shop suspended', '{shop} was suspended and is hidden from customers. Contact support for details.'],
    hi: ['दुकान निलंबित', '{shop} निलंबित कर दी गई है और ग्राहकों को नहीं दिखेगी। जानकारी के लिए सपोर्ट से संपर्क करें।'],
    mr: ['दुकान निलंबित', '{shop} निलंबित केले आहे आणि ग्राहकांना दिसणार नाही. तपशीलासाठी सपोर्टशी संपर्क साधा.'],
  },
  business_pending: {
    en: ['Shop waiting for review', '{shop} was submitted for approval.'],
    hi: ['दुकान समीक्षा के लिए', '{shop} को मंज़ूरी के लिए भेजा गया है।'],
    mr: ['दुकान तपासणीसाठी', '{shop} मंजुरीसाठी सादर केले आहे.'],
  },
  banner_pending: {
    en: ['Banner waiting for review', '{shop} submitted the banner "{title}".'],
    hi: ['बैनर समीक्षा के लिए', '{shop} ने बैनर "{title}" भेजा है।'],
    mr: ['बॅनर तपासणीसाठी', '{shop} ने बॅनर "{title}" सादर केला आहे.'],
  },
  banner_approved: {
    en: ['Banner approved', 'Your banner "{title}" is approved and will start showing.'],
    hi: ['बैनर मंज़ूर', 'आपका बैनर "{title}" मंज़ूर हो गया और दिखना शुरू होगा।'],
    mr: ['बॅनर मंजूर', 'तुमचा बॅनर "{title}" मंजूर झाला आणि दिसू लागेल.'],
  },
  banner_rejected: {
    en: ['Banner not approved', 'Your banner "{title}" was not approved.{reasonLine} Your banner credit is returned.'],
    hi: ['बैनर मंज़ूर नहीं', 'आपका बैनर "{title}" मंज़ूर नहीं हुआ।{reasonLine} आपका बैनर क्रेडिट वापस मिल गया है।'],
    mr: ['बॅनर मंजूर नाही', 'तुमचा बॅनर "{title}" मंजूर झाला नाही.{reasonLine} तुमचे बॅनर क्रेडिट परत मिळाले आहे.'],
  },
  verification_pending: {
    en: ['Badge document waiting', '{shop} uploaded a document for the blue badge.'],
    hi: ['बैज दस्तावेज़ समीक्षा के लिए', '{shop} ने ब्लू बैज के लिए दस्तावेज़ भेजा है।'],
    mr: ['बॅज दस्तऐवज तपासणीसाठी', '{shop} ने ब्लू बॅजसाठी दस्तऐवज सादर केला आहे.'],
  },
  verification_approved: {
    en: ['Document approved', '{shop}: your document is approved. You can now buy the blue badge.'],
    hi: ['दस्तावेज़ मंज़ूर', '{shop}: आपका दस्तावेज़ मंज़ूर हुआ। अब आप ब्लू बैज खरीद सकते हैं।'],
    mr: ['दस्तऐवज मंजूर', '{shop}: तुमचा दस्तऐवज मंजूर झाला. आता तुम्ही ब्लू बॅज खरेदी करू शकता.'],
  },
  verification_rejected: {
    en: ['Document not approved', '{shop}: your document was not approved.{reasonLine} Please upload a clearer one.'],
    hi: ['दस्तावेज़ मंज़ूर नहीं', '{shop}: आपका दस्तावेज़ मंज़ूर नहीं हुआ।{reasonLine} कृपया साफ़ दस्तावेज़ दोबारा अपलोड करें।'],
    mr: ['दस्तऐवज मंजूर नाही', '{shop}: तुमचा दस्तऐवज मंजूर झाला नाही.{reasonLine} कृपया स्पष्ट दस्तऐवज पुन्हा अपलोड करा.'],
  },
  review_new: {
    en: ['New {stars}-star review', '{who} reviewed {shop}.'],
    hi: ['नया {stars}-स्टार रिव्यू', '{who} ने {shop} का रिव्यू दिया।'],
    mr: ['नवीन {stars}-स्टार रिव्यू', '{who} यांनी {shop} चा रिव्यू दिला.'],
  },
  review_reply: {
    en: ['The shop replied to your review', '{shop} responded to your review.'],
    hi: ['दुकान ने आपके रिव्यू का जवाब दिया', '{shop} ने आपके रिव्यू का जवाब दिया।'],
    mr: ['दुकानाने तुमच्या रिव्यूला उत्तर दिले', '{shop} ने तुमच्या रिव्यूला उत्तर दिले.'],
  },
  review_removed: {
    en: ['A review was removed', 'A review on {shop} was removed by an admin.'],
    hi: ['एक रिव्यू हटाया गया', '{shop} का एक रिव्यू एडमिन ने हटा दिया।'],
    mr: ['एक रिव्यू काढला', '{shop} चा एक रिव्यू अ‍ॅडमिनने काढून टाकला.'],
  },
  payment_success: {
    en: ['Payment received', '{amount} for {plan} ({shop}). It is active now.'],
    hi: ['भुगतान मिला', '{shop} के लिए {plan} का {amount}। यह अब चालू है।'],
    mr: ['पेमेंट मिळाले', '{shop} साठी {plan} चे {amount}. ते आता सुरू आहे.'],
  },
  payment_refunded: {
    en: ['Refund processed', '{refund} was refunded for {plan} ({shop}).'],
    hi: ['रिफ़ंड हो गया', '{shop} के {plan} का {refund} रिफ़ंड किया गया।'],
    mr: ['रिफंड झाला', '{shop} च्या {plan} चे {refund} रिफंड केले.'],
  },
  payment_refunded_partial: {
    en: ['Partial refund processed', '{refund} of {amount} was refunded for {plan} ({shop}).'],
    hi: ['आंशिक रिफ़ंड हुआ', '{shop} के {plan} के {amount} में से {refund} रिफ़ंड किया गया।'],
    mr: ['अंशतः रिफंड झाला', '{shop} च्या {plan} च्या {amount} पैकी {refund} रिफंड केले.'],
  },
  payment_issue: {
    en: ['Payment needs checking', 'We received a payment for {plan}, but the amount did not match. Nothing was activated and we are checking it.'],
    hi: ['भुगतान की जाँच ज़रूरी', '{plan} का भुगतान मिला, पर राशि मेल नहीं खाई। कुछ भी चालू नहीं हुआ और हम इसकी जाँच कर रहे हैं।'],
    mr: ['पेमेंटची तपासणी आवश्यक', '{plan} साठी पेमेंट मिळाले, पण रक्कम जुळली नाही. काहीही सुरू झाले नाही आणि आम्ही तपासत आहोत.'],
  },
  payment_issue_admin: {
    en: ['Payment amount mismatch', '{shop}: the {plan} payment did not match the expected amount. Check Payments.'],
    hi: ['भुगतान राशि में अंतर', '{shop}: {plan} का भुगतान अपेक्षित राशि से मेल नहीं खाया। भुगतान पेज देखें।'],
    mr: ['पेमेंट रकमेत फरक', '{shop}: {plan} चे पेमेंट अपेक्षित रकमेशी जुळले नाही. पेमेंट्स पेज तपासा.'],
  },
  appointment_reminder_24h: {
    en: ['Appointment in about 24 hours', '{service} at {shop}, {when}.'],
    hi: ['लगभग 24 घंटे में आपकी अपॉइंटमेंट', '{shop} में {service}, {when}।'],
    mr: ['सुमारे 24 तासांत तुमची अपॉइंटमेंट', '{shop} येथे {service}, {when}.'],
  },
  appointment_reminder_2h: {
    en: ['Appointment in about 2 hours', '{service} at {shop}, {when}.'],
    hi: ['लगभग 2 घंटे में आपकी अपॉइंटमेंट', '{shop} में {service}, {when}।'],
    mr: ['सुमारे 2 तासांत तुमची अपॉइंटमेंट', '{shop} येथे {service}, {when}.'],
  },
  appointment_remind_20: {
    en: ['✨ Glow time in 20 minutes!', 'Your {service} at {shop} starts at {time}. Your glow-up is almost here, time to head out! 💖'],
    hi: ['✨ 20 मिनट में आपका ग्लो टाइम!', '{shop} में {service} {time} पर है। आपका नया लुक बस आने वाला है, अब निकलने का समय है! 💖'],
    mr: ['✨ 20 मिनिटांत तुमचा ग्लो टाइम!', '{shop} येथे {service} {time} वाजता आहे. तुमचा नवा लूक जवळ आलाय, आता निघण्याची वेळ! 💖'],
  },
  appointment_time_set: {
    en: ['Your time is set! 🎉', '{shop} will see you on {when} for {service}. Open My bookings and tap “Get notified” to get a reminder 20 minutes before.'],
    hi: ['आपका समय तय हो गया! 🎉', '{shop} ने {service} के लिए {when} का समय दिया है। मेरी बुकिंग खोलें और 20 मिनट पहले रिमाइंडर के लिए “सूचना पाएँ” दबाएँ।'],
    mr: ['तुमची वेळ ठरली! 🎉', '{shop} ने {service} साठी {when} ची वेळ दिली आहे. माझी बुकिंग उघडा आणि 20 मिनिटे आधी रिमाइंडरसाठी “सूचना मिळवा” दाबा.'],
  },
  appointment_time_changed: {
    en: ['Your time was updated', '{shop} moved your {service} to {when}. Check My bookings.'],
    hi: ['आपका समय बदला गया', '{shop} ने आपकी {service} का समय {when} कर दिया है। मेरी बुकिंग देखें।'],
    mr: ['तुमची वेळ बदलली', '{shop} ने तुमची {service} {when} ला हलवली आहे. माझी बुकिंग पहा.'],
  },
  booking_new_request: {
    en: ['New appointment request', '{who} wants {service} on {date}. Send them a time from your queue.'],
    hi: ['नई अपॉइंटमेंट रिक्वेस्ट', '{who} को {date} को {service} चाहिए। कतार पेज से उन्हें समय भेजें।'],
    mr: ['नवीन अपॉइंटमेंट विनंती', '{who} यांना {date} रोजी {service} हवे आहे. रांग पेजवरून त्यांना वेळ पाठवा.'],
  },
  booking_confirmed_request: {
    en: ['Request sent ✅', '{shop} will send you a time for {service} on {date}. We will notify you as soon as it is set.'],
    hi: ['रिक्वेस्ट भेज दी गई ✅', '{shop} {date} को {service} के लिए आपको समय भेजेगा। समय तय होते ही हम आपको बताएँगे।'],
    mr: ['विनंती पाठवली ✅', '{shop} {date} रोजी {service} साठी तुम्हाला वेळ पाठवेल. वेळ ठरताच आम्ही कळवू.'],
  },
  appointment_request_closed: {
    en: ['Request closed', '{shop} could not fit your {service} request for {date}. You can request another day.'],
    hi: ['रिक्वेस्ट बंद हुई', '{shop} आपकी {date} की {service} रिक्वेस्ट पूरी नहीं कर सका। आप दूसरा दिन चुन सकते हैं।'],
    mr: ['विनंती बंद झाली', '{shop} तुमची {date} ची {service} विनंती पूर्ण करू शकले नाही. तुम्ही दुसरा दिवस निवडू शकता.'],
  },
  coupon_expiring: {
    en: ['Coupon expiring soon', 'Your {disc} coupon expires on {expires}. Use it before then.'],
    hi: ['कूपन जल्द खत्म होगा', 'आपका {disc} का कूपन {expires} को खत्म हो रहा है। उससे पहले इस्तेमाल करें।'],
    mr: ['कूपन लवकरच संपणार', 'तुमचे {disc} चे कूपन {expires} रोजी संपत आहे. त्याआधी वापरा.'],
  },
  subscription_expiring_7d: {
    en: ['{plan} ends soon', '{plan} for {shop} ends on {expires}. Renew to keep the benefits.'],
    hi: ['{plan} जल्द खत्म होगा', '{shop} का {plan} {expires} को खत्म होगा। लाभ जारी रखने के लिए रिन्यू करें।'],
    mr: ['{plan} लवकरच संपणार', '{shop} चा {plan} {expires} रोजी संपेल. फायदे सुरू ठेवण्यासाठी रिन्यू करा.'],
  },
  subscription_expiring_1d: {
    en: ['{plan} ends within a day', '{plan} for {shop} ends on {expires}. Renew now so nothing stops.'],
    hi: ['{plan} एक दिन में खत्म', '{shop} का {plan} {expires} को खत्म होगा। रुकावट से बचने के लिए अभी रिन्यू करें।'],
    mr: ['{plan} एका दिवसात संपणार', '{shop} चा {plan} {expires} रोजी संपेल. खंड पडू नये म्हणून आत्ताच रिन्यू करा.'],
  },
  test: {
    en: ['Test notification', 'Notifications are working on this device.'],
    hi: ['टेस्ट नोटिफ़िकेशन', 'इस डिवाइस पर नोटिफ़िकेशन काम कर रहे हैं।'],
    mr: ['टेस्ट सूचना', 'या डिव्हाइसवर सूचना काम करत आहेत.'],
  },
};

const LOCALE: Record<NotifLang, string> = { en: 'en-IN', hi: 'hi-IN', mr: 'mr-IN' };
const WHO: Record<NotifLang, string> = { en: 'A customer', hi: 'एक ग्राहक', mr: 'एक ग्राहक' };
const REASON: Record<NotifLang, string> = { en: ' Reason: ', hi: ' कारण: ', mr: ' कारण: ' };

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0);

/** 12-hour clock in India time: 3:30 PM */
function time12(d: Date): string {
  const x = new Date(d.getTime() + 5.5 * 3600 * 1000);
  const h = x.getUTCHours();
  return `${h % 12 === 0 ? 12 : h % 12}:${String(x.getUTCMinutes()).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

function fmtWhen(iso: unknown, lang: NotifLang): string {
  const s = str(iso);
  if (!s) return '';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.toLocaleDateString(LOCALE[lang], { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short' })}, ${time12(d)}`;
}

function fmtClock(iso: unknown): string {
  const s = str(iso);
  const d = s ? new Date(s) : null;
  return d && !Number.isNaN(d.getTime()) ? time12(d) : '';
}

/** 'YYYY-MM-DD' (the day a customer asked for) -> 'Mon, 5 Oct' */
function fmtDay(ymd: unknown, lang: NotifLang): string {
  const s = str(ymd);
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00Z`) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString(LOCALE[lang], { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }) : '';
}

const inr = (paise: unknown, lang: NotifLang) => `₹${(num(paise) / 100).toLocaleString(LOCALE[lang], { maximumFractionDigits: 2 })}`;

/** Which template a stored notification uses (some types have a variant). */
export function templateKey(type: string, data: NotifData): string {
  const walkin = str(data.booking_type) === 'walkin';
  const noTime = str(data.booking_type) === 'appointment' && !str(data.start_at);   // appointment request: the shop has not sent a time yet
  if (type === 'booking_new' && walkin) return 'booking_new_walkin';
  if (type === 'booking_confirmed' && walkin) return 'booking_confirmed_walkin';
  if (type === 'booking_new' && noTime) return 'booking_new_request';
  if (type === 'booking_confirmed' && noTime) return 'booking_confirmed_request';
  if (type === 'appointment_time_set' && data.rescheduled === true) return 'appointment_time_changed';
  if (type === 'appointment_reminder') return str(data.window) === '2h' ? 'appointment_reminder_2h' : 'appointment_reminder_24h';
  if (type === 'subscription_expiring') return str(data.window) === '1d' ? 'subscription_expiring_1d' : 'subscription_expiring_7d';
  if (type === 'payment_refunded' && data.partial === true) return 'payment_refunded_partial';
  return type;
}

export function composeNotification(type: string, data: NotifData, langIn: string): { title: string; body: string } {
  const lang: NotifLang = langIn === 'hi' || langIn === 'mr' ? langIn : 'en';
  const tpl = T[templateKey(type, data)];
  if (!tpl) return { title: 'Blisscco', body: '' };

  const reason = str(data.reason);
  const discount = num(data.discount_value);
  const vars: Record<string, string> = {
    shop: str(data.business_name),
    service: str(data.service),
    who: str(data.customer_name) || str(data.reviewer_name) || WHO[lang],
    when: fmtWhen(data.start_at, lang),
    time: fmtClock(data.start_at),
    date: fmtDay(data.requested_date, lang),
    token: str(data.token),
    stars: str(data.rating),
    plan: str(data.plan_name),
    title: str(data.title),
    amount: inr(data.amount_paise, lang),
    refund: inr(data.refunded_paise, lang),
    expires: fmtWhen(data.expires_at, lang),
    disc: str(data.discount_type) === 'percent' ? `${discount}%` : `₹${discount}`,
    reasonLine: reason ? `${REASON[lang]}${reason}${/[.!?।]$/.test(reason) ? '' : '.'}` : '',
  };
  const fill = (s: string) => s.replace(/\{(\w+)\}/g, (_m, k: string) => vars[k] ?? '').replace(/\s{2,}/g, ' ').replace(/\s+([.,।])/g, '$1').trim();
  const [title, body] = tpl[lang];
  return { title: fill(title), body: fill(body) };
}
