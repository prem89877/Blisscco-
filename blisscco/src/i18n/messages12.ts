type M = Record<string, string>;

// Subscriptions (PRO / ELITE) were removed. These keys replace the old texts.
// Only paid services left: Banner (per banner) and Blue badge.
const en: M = {
  'p8.plansTitle': 'Paid services', 'p8.current': 'Your services', 'p8.addons': 'Banner & Blue badge',
  'p8.err.plan_required': 'This service is not available right now.',
  'p9.aiTitle': 'AI insights', 'p9.lockedTitle': 'Analytics unavailable', 'p9.lockedText': 'Analytics is not available for this shop right now.',
  'biz.openNow': 'Open now', 'biz.closedNow': 'Closed now', 'biz.today': 'Today', 'biz.about': 'About', 'biz.from': 'from',
  'biz.visit': 'Visit', 'biz.noServices': 'No services listed yet.', 'biz.photos': 'photos',
};
const hi: M = {
  'p8.plansTitle': 'पेड सेवाएँ', 'p8.current': 'आपकी सेवाएँ', 'p8.addons': 'बैनर और ब्लू बैज',
  'p8.err.plan_required': 'यह सेवा अभी उपलब्ध नहीं है।',
  'p9.aiTitle': 'AI इनसाइट्स', 'p9.lockedTitle': 'एनालिटिक्स उपलब्ध नहीं', 'p9.lockedText': 'इस दुकान के लिए एनालिटिक्स अभी उपलब्ध नहीं है।',
  'biz.openNow': 'अभी खुला है', 'biz.closedNow': 'अभी बंद है', 'biz.today': 'आज', 'biz.about': 'परिचय', 'biz.from': 'से शुरू',
  'biz.visit': 'आएँ', 'biz.noServices': 'अभी कोई सेवा नहीं जोड़ी गई।', 'biz.photos': 'फोटो',
};
const mr: M = {
  'p8.plansTitle': 'सशुल्क सेवा', 'p8.current': 'तुमच्या सेवा', 'p8.addons': 'बॅनर आणि ब्लू बॅज',
  'p8.err.plan_required': 'ही सेवा सध्या उपलब्ध नाही.',
  'p9.aiTitle': 'AI इनसाइट्स', 'p9.lockedTitle': 'अ‍ॅनालिटिक्स उपलब्ध नाही', 'p9.lockedText': 'या दुकानासाठी अ‍ॅनालिटिक्स सध्या उपलब्ध नाही.',
  'biz.openNow': 'आता उघडे आहे', 'biz.closedNow': 'आता बंद आहे', 'biz.today': 'आज', 'biz.about': 'माहिती', 'biz.from': 'पासून',
  'biz.visit': 'भेट द्या', 'biz.noServices': 'अजून सेवा जोडलेली नाही.', 'biz.photos': 'फोटो',
};

export const p12 = { en, hi, mr };
