type M = Record<string, string>;

const en: M = {
  'p11.report': 'Report a problem', 'p11.reportWhy': 'What went wrong? (at least 10 characters)', 'p11.reportSend': 'Send to Blisscco',
  'p11.reportSent': 'Thanks. The Blisscco team will review this booking.',
  'p11.err.already_open': 'You already reported this booking.', 'p11.err.reason_required': 'Please write at least 10 characters.',
  'p11.err.too_old': 'This booking is too old to report (30 days).', 'p11.err.not_finished': 'Only finished bookings can be reported.',
};
const hi: M = {
  'p11.report': 'समस्या बताएं', 'p11.reportWhy': 'क्या गलत हुआ? (कम से कम 10 अक्षर)', 'p11.reportSend': 'Blisscco को भेजें',
  'p11.reportSent': 'धन्यवाद। Blisscco टीम इस बुकिंग की जांच करेगी।',
  'p11.err.already_open': 'आप इस बुकिंग की शिकायत पहले ही कर चुके हैं।', 'p11.err.reason_required': 'कृपया कम से कम 10 अक्षर लिखें।',
  'p11.err.too_old': 'यह बुकिंग बहुत पुरानी है (30 दिन)।', 'p11.err.not_finished': 'केवल पूरी हो चुकी बुकिंग की शिकायत हो सकती है।',
};
const mr: M = {
  'p11.report': 'समस्या सांगा', 'p11.reportWhy': 'काय चुकले? (किमान 10 अक्षरे)', 'p11.reportSend': 'Blisscco ला पाठवा',
  'p11.reportSent': 'धन्यवाद. Blisscco टीम या बुकिंगची तपासणी करेल.',
  'p11.err.already_open': 'तुम्ही या बुकिंगची तक्रार आधीच केली आहे.', 'p11.err.reason_required': 'कृपया किमान 10 अक्षरे लिहा.',
  'p11.err.too_old': 'ही बुकिंग खूप जुनी आहे (30 दिवस).', 'p11.err.not_finished': 'फक्त पूर्ण झालेल्या बुकिंगची तक्रार करता येते.',
};

export const p11 = { en, hi, mr };
