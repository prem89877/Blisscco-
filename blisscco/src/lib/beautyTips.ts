import type { Lang } from '../i18n/messages';

/** 100 beauty jokes, slogans and tips (EN / HI / MR). They are shown one after another in a cycle by <BeautyTip />. */
export interface BeautyTipItem { k: 'joke' | 'slogan' | 'tip'; en: string; hi: string; mr: string }

export const BEAUTY_TIPS: BeautyTipItem[] = [
  {"k": "joke", "en": "My haircut and my confidence have one thing in common: both look best right after the salon.", "hi": "मेरे हेयरकट और कॉन्फिडेंस में एक बात कॉमन है: दोनों सैलून से निकलते ही सबसे अच्छे लगते हैं।", "mr": "माझा हेअरकट आणि आत्मविश्वास यांच्यात एक साम्य आहे: दोघे सलूनमधून निघताच सर्वात छान दिसतात."},
  {"k": "joke", "en": "Bad hair day? Tell people it is a bold new style.", "hi": "बाल खराब दिख रहे हैं? बोल दो कि ये नया बोल्ड स्टाइल है।", "mr": "केस खराब दिसतायत? सांगा, हा नवा बोल्ड स्टाइल आहे."},
  {"k": "joke", "en": "The mirror says you look great. The front camera says let us discuss.", "hi": "आईना कहता है: बहुत सुंदर। फ्रंट कैमरा कहता है: ज़रा बात करते हैं।", "mr": "आरसा म्हणतो: खूप सुंदर. फ्रंट कॅमेरा म्हणतो: जरा बोलूया."},
  {"k": "joke", "en": "I said just a trim. The barber heard: give this person a new personality.", "hi": "मैंने कहा बस थोड़ा-सा ट्रिम। नाई ने सुना: इन्हें नया पर्सनैलिटी दे दो।", "mr": "मी म्हटलं फक्त थोडं ट्रिम. न्हाव्याने ऐकलं: यांना नवं व्यक्तिमत्त्व द्या."},
  {"k": "joke", "en": "Eyebrows are sisters, not twins. Every salon knows this.", "hi": "भौंहें जुड़वाँ नहीं, बहनें होती हैं। हर सैलून यह जानता है।", "mr": "भुवया जुळ्या नसतात, बहिणी असतात. प्रत्येक सलूनला हे माहीत असतं."},
  {"k": "joke", "en": "Nothing motivates like a salon appointment at 5 pm.", "hi": "शाम 5 बजे की सैलून अपॉइंटमेंट जैसा मोटिवेशन कहीं नहीं।", "mr": "संध्याकाळी 5 च्या सलून अपॉइंटमेंटसारखी प्रेरणा कशाचीच नाही."},
  {"k": "joke", "en": "My skincare routine: 10 steps planned, 2 done, 8 for tomorrow.", "hi": "मेरा स्किनकेयर रूटीन: 10 स्टेप सोचे, 2 किए, 8 कल पर।", "mr": "माझा स्किनकेअर रुटीन: 10 स्टेप ठरवले, 2 केले, 8 उद्यावर."},
  {"k": "joke", "en": "Fresh haircut energy: walking slower so everyone can notice.", "hi": "ताज़ा हेयरकट वाली एनर्जी: धीरे चलो ताकि सब देख सकें।", "mr": "नवीन हेअरकटची एनर्जी: हळू चाला म्हणजे सगळे बघतील."},
  {"k": "joke", "en": "Lipstick: the cheapest way to look like you slept 8 hours.", "hi": "लिपस्टिक: 8 घंटे सोए दिखने का सबसे सस्ता तरीका।", "mr": "लिपस्टिक: 8 तास झोपल्यासारखं दिसण्याचा सर्वात स्वस्त मार्ग."},
  {"k": "joke", "en": "I do not need a haircut, I need a fresh start with a blow-dry.", "hi": "मुझे हेयरकट नहीं, ब्लो-ड्राई के साथ नई शुरुआत चाहिए।", "mr": "मला हेअरकट नको, ब्लो-ड्रायसह नवी सुरुवात हवी."},
  {"k": "joke", "en": "My hair has two moods: perfect and unpredictable.", "hi": "मेरे बालों के दो मूड हैं: परफेक्ट और अनप्रिडिक्टेबल।", "mr": "माझ्या केसांचे दोन मूड: परफेक्ट आणि अनिश्चित."},
  {"k": "joke", "en": "Fresh manicure rule: touching anything is banned for 20 minutes, even an itchy nose.", "hi": "नया मैनीक्योर, नया नियम: 20 मिनट कुछ भी छूना मना है, नाक की खुजली भी नहीं।", "mr": "नवीन मॅनिक्युअरचा नियम: 20 मिनिटं काहीही हात लावायचा नाही, नाकाला खाज आली तरी नाही."},
  {"k": "joke", "en": "Facial first, worries later.", "hi": "पहले फेशियल, फिर टेंशन।", "mr": "आधी फेशियल, मग टेन्शन."},
  {"k": "joke", "en": "A wise person once said: book the salon before the festival rush.", "hi": "किसी समझदार ने कहा था: त्योहार की भीड़ से पहले सैलून बुक कर लो।", "mr": "एका शहाण्याने म्हटलं होतं: सणाच्या गर्दीआधी सलून बुक करा."},
  {"k": "joke", "en": "Beard trim: because every face deserves a good frame.", "hi": "दाढ़ी की ट्रिमिंग: क्योंकि हर चेहरे को अच्छा फ्रेम चाहिए।", "mr": "दाढीचं ट्रिमिंग: कारण प्रत्येक चेहऱ्याला चांगली फ्रेम हवी."},
  {"k": "joke", "en": "A spa day is just a nap with better lighting.", "hi": "स्पा डे यानी बेहतर लाइटिंग वाली झपकी।", "mr": "स्पा डे म्हणजे चांगल्या लाइटिंगमधली डुलकी."},
  {"k": "joke", "en": "Waiting for my turn at the salon: 5 minutes. Scrolling reels: 45 minutes.", "hi": "सैलून में नंबर का इंतज़ार: 5 मिनट। रील्स स्क्रॉलिंग: 45 मिनट।", "mr": "सलूनमध्ये नंबरची वाट: 5 मिनिटं. रील्स स्क्रोलिंग: 45 मिनिटं."},
  {"k": "joke", "en": "My shampoo promises volume and shine. My hair says we will see.", "hi": "शैम्पू वॉल्यूम और शाइन का वादा करता है। बाल कहते हैं, देखते हैं।", "mr": "शाम्पू व्हॉल्यूम आणि शाइनचं वचन देतो. केस म्हणतात, बघू."},
  {"k": "joke", "en": "Highlights are just sunshine you can book in advance.", "hi": "हाइलाइट्स यानी धूप, जिसे पहले से बुक किया जा सकता है।", "mr": "हायलाइट्स म्हणजे आधीच बुक करता येणारं ऊन."},
  {"k": "joke", "en": "Went in for a trim, came out with a new attitude.", "hi": "ट्रिम के लिए गए थे, नया एटीट्यूड लेकर लौटे।", "mr": "ट्रिमसाठी गेलो, नवा ॲटिट्यूड घेऊन परतलो."},
  {"k": "joke", "en": "Concealer: the real MVP of Monday mornings.", "hi": "कंसीलर: सोमवार सुबह का असली हीरो।", "mr": "कन्सीलर: सोमवार सकाळचा खरा हिरो."},
  {"k": "joke", "en": "Good lighting solves 90 percent of life's problems.", "hi": "अच्छी रोशनी ज़िंदगी की 90 प्रतिशत समस्याएँ सुलझा देती है।", "mr": "चांगला प्रकाश आयुष्यातल्या 90 टक्के समस्या सोडवतो."},
  {"k": "joke", "en": "Every great story starts with: I just want a small change.", "hi": "हर बड़ी कहानी यहीं से शुरू होती है: बस थोड़ा-सा बदलाव चाहिए।", "mr": "प्रत्येक मोठी गोष्ट इथूनच सुरू होते: फक्त थोडा बदल हवा आहे."},
  {"k": "joke", "en": "A salon chair is a free therapy chair with scissors.", "hi": "सैलून की कुर्सी यानी कैंची वाली फ्री थेरेपी चेयर।", "mr": "सलूनची खुर्ची म्हणजे कात्रीवाली फ्री थेरपी चेअर."},
  {"k": "joke", "en": "When the hair does not cooperate, the hairband always does.", "hi": "बाल साथ न दें तो हेयरबैंड हमेशा साथ देता है।", "mr": "केस साथ देत नसतील तर हेअरबँड नेहमी साथ देतो."},
  {"k": "joke", "en": "Sunscreen is the only joke where the punchline is glowing skin.", "hi": "सनस्क्रीन ऐसा जोक है जिसकी पंचलाइन चमकती त्वचा है।", "mr": "सनस्क्रीन असा जोक आहे ज्याची पंचलाइन चमकती त्वचा आहे."},
  {"k": "joke", "en": "The plan: keep the hairstyle simple. The reality: 14 reference photos sent.", "hi": "प्लान: हेयरस्टाइल सिंपल रखना है। असलियत: 14 रेफरेंस फोटो भेज दिए।", "mr": "प्लॅन: हेअरस्टाइल साधी ठेवायची. प्रत्यक्षात: 14 रेफरन्स फोटो पाठवले."},
  {"k": "joke", "en": "Nail art is tiny paintings you can show off while holding chai.", "hi": "नेल आर्ट यानी चाय पकड़ते हुए दिखाई जाने वाली छोटी पेंटिंग।", "mr": "नेल आर्ट म्हणजे चहा धरताना दाखवता येणारी छोटी चित्रं."},
  {"k": "joke", "en": "A fresh shave is a free confidence boost.", "hi": "क्लीन शेव यानी फ्री कॉन्फिडेंस बूस्ट।", "mr": "क्लीन शेव म्हणजे फुकटचा आत्मविश्वास."},
  {"k": "joke", "en": "My mirror and I have a love-hate relationship. It shows everything.", "hi": "मेरे आईने से मेरा प्यार भी है, तकरार भी। ये सब दिखा देता है।", "mr": "माझ्या आरशाशी माझं प्रेमही आहे, भांडणही. तो सगळं दाखवतो."},
  {"k": "joke", "en": "Wedding season: when everyone suddenly remembers eyebrow threading.", "hi": "शादी का सीज़न: जब सबको अचानक आइब्रो थ्रेडिंग याद आती है।", "mr": "लग्नसराई: जेव्हा सगळ्यांना अचानक आयब्रो थ्रेडिंग आठवतं."},
  {"k": "joke", "en": "Bought a bigger mirror so the good hair day looks even bigger.", "hi": "बड़ा आईना खरीदा ताकि अच्छे बालों वाला दिन और बड़ा दिखे।", "mr": "मोठा आरसा घेतला, म्हणजे चांगल्या केसांचा दिवस आणखी मोठा दिसेल."},
  {"k": "joke", "en": "Haircut regret lasts two weeks. Then the hair grows, and so does the confidence.", "hi": "हेयरकट का पछतावा दो हफ्ते चलता है। फिर बाल बढ़ते हैं, और भरोसा भी।", "mr": "हेअरकटचा पश्चात्ताप दोन आठवडे टिकतो. मग केस वाढतात, आणि आत्मविश्वासही."},
  {"k": "joke", "en": "A good massage is proof that the body can say thank you too.", "hi": "अच्छी मसाज इस बात का सबूत है कि शरीर भी शुक्रिया कहता है।", "mr": "चांगला मसाज हा पुरावा आहे की शरीरही धन्यवाद म्हणतं."},
  {"k": "slogan", "en": "Look good. Feel better. Book on Blisscco.", "hi": "अच्छा दिखें। बेहतर महसूस करें। Blisscco पर बुक करें।", "mr": "छान दिसा. अधिक छान वाटून घ्या. Blisscco वर बुक करा."},
  {"k": "slogan", "en": "Your glow, your rules.", "hi": "आपकी चमक, आपके नियम।", "mr": "तुमची चमक, तुमचे नियम."},
  {"k": "slogan", "en": "Self-care is not selfish.", "hi": "सेल्फ-केयर स्वार्थ नहीं है।", "mr": "स्वतःची काळजी म्हणजे स्वार्थ नाही."},
  {"k": "slogan", "en": "Shine from the inside, sparkle at the salon.", "hi": "अंदर से चमकें, सैलून में और निखरें।", "mr": "आतून चमका, सलूनमध्ये आणखी उजळा."},
  {"k": "slogan", "en": "A little pampering goes a long way.", "hi": "थोड़ा-सा लाड़, बहुत दूर तक असर।", "mr": "थोडेसे लाड, खूप दूरपर्यंत परिणाम."},
  {"k": "slogan", "en": "Be your own kind of beautiful.", "hi": "अपने ही अंदाज़ में खूबसूरत बनें।", "mr": "तुमच्या स्वतःच्या शैलीत सुंदर व्हा."},
  {"k": "slogan", "en": "Confidence looks good on you.", "hi": "कॉन्फिडेंस आप पर बहुत जँचता है।", "mr": "आत्मविश्वास तुमच्यावर खूप शोभतो."},
  {"k": "slogan", "en": "Fresh look, fresh start.", "hi": "नया लुक, नई शुरुआत।", "mr": "नवा लुक, नवी सुरुवात."},
  {"k": "slogan", "en": "Treat yourself. You earned it.", "hi": "खुद को ट्रीट दें। आप इसके हक़दार हैं।", "mr": "स्वतःला ट्रीट द्या. तुम्ही त्यास पात्र आहात."},
  {"k": "slogan", "en": "Good hair days are made, not found.", "hi": "अच्छे बालों वाले दिन बनाए जाते हैं, मिलते नहीं।", "mr": "चांगल्या केसांचे दिवस बनवावे लागतात, सापडत नाहीत."},
  {"k": "slogan", "en": "Support local shops, glow local.", "hi": "लोकल दुकानों का साथ दें, लोकल अंदाज़ में चमकें।", "mr": "स्थानिक दुकानांना साथ द्या, स्थानिक पद्धतीने चमका."},
  {"k": "slogan", "en": "Skip the queue worries, take a token.", "hi": "लाइन की चिंता छोड़ें, टोकन लें।", "mr": "रांगेची चिंता सोडा, टोकन घ्या."},
  {"k": "slogan", "en": "Smile. It is the best accessory.", "hi": "मुस्कुराइए। यही सबसे अच्छी एक्सेसरी है।", "mr": "हसा. हीच सर्वोत्तम ॲक्सेसरी आहे."},
  {"k": "slogan", "en": "Beauty begins the moment you decide to be yourself.", "hi": "खूबसूरती तब शुरू होती है जब आप खुद बनने का फ़ैसला करते हैं।", "mr": "सौंदर्य तेव्हा सुरू होतं जेव्हा तुम्ही स्वतः असण्याचं ठरवता."},
  {"k": "slogan", "en": "Your neighbourhood salon is just around the corner.", "hi": "आपका मोहल्ले वाला सैलून बस कोने पर है।", "mr": "तुमचं गल्लीतलं सलून अगदी कोपऱ्यावर आहे."},
  {"k": "slogan", "en": "Small changes, big smiles.", "hi": "छोटे बदलाव, बड़ी मुस्कान।", "mr": "छोटे बदल, मोठं हसू."},
  {"k": "slogan", "en": "Pause. Pamper. Repeat.", "hi": "रुकें। लाड़ करें। दोहराएँ।", "mr": "थांबा. लाड करा. पुन्हा करा."},
  {"k": "slogan", "en": "Make today a good hair day.", "hi": "आज का दिन अच्छे बालों वाला बनाइए।", "mr": "आजचा दिवस चांगल्या केसांचा करा."},
  {"k": "slogan", "en": "Glow up, one appointment at a time.", "hi": "हर अपॉइंटमेंट के साथ थोड़ा और निखरें।", "mr": "प्रत्येक अपॉइंटमेंटसह थोडे अधिक उजळा."},
  {"k": "slogan", "en": "Real shops. Real reviews. Real glow.", "hi": "असली दुकानें। असली रिव्यू। असली चमक।", "mr": "खरी दुकानं. खरे रिव्ह्यू. खरी चमक."},
  {"k": "slogan", "en": "Beauty grows when shared. Tell a friend about Blisscco!", "hi": "सुंदरता बाँटने से बढ़ती है। किसी दोस्त को Blisscco के बारे में बताएँ!", "mr": "सौंदर्य वाटल्याने वाढतं. मित्राला Blisscco बद्दल सांगा!"},
  {"k": "slogan", "en": "Polish your nails, polish your mood.", "hi": "नाखून सजाएँ, मूड भी चमकाएँ।", "mr": "नखं सजवा, मूडही चमकवा."},
  {"k": "slogan", "en": "Today is a great day for a makeover.", "hi": "आज मेकओवर के लिए बढ़िया दिन है।", "mr": "आज मेकओव्हरसाठी छान दिवस आहे."},
  {"k": "slogan", "en": "Soft skin, soft heart, strong style.", "hi": "मुलायम त्वचा, नरम दिल, मज़बूत स्टाइल।", "mr": "मऊ त्वचा, मृदू मन, दमदार स्टाइल."},
  {"k": "slogan", "en": "Walk in as you are, walk out as a masterpiece.", "hi": "जैसे हैं वैसे आइए, कलाकृति बनकर निकलिए।", "mr": "जसे आहात तसे या, कलाकृती बनून बाहेर पडा."},
  {"k": "slogan", "en": "Where there is a will, there is a salon.", "hi": "जहाँ चाह, वहाँ सैलून।", "mr": "जिथे इच्छा, तिथे सलून."},
  {"k": "slogan", "en": "Dress your hair, the outfit will follow.", "hi": "बाल सँवारिए, आउटफ़िट अपने आप जँचेगा।", "mr": "केस सजवा, पोशाख आपोआप शोभेल."},
  {"k": "slogan", "en": "Be kind to your skin. It has been with you forever.", "hi": "अपनी त्वचा से नरमी बरतें। वो हमेशा आपके साथ है।", "mr": "तुमच्या त्वचेशी प्रेमाने वागा. ती कायम तुमच्यासोबत आहे."},
  {"k": "slogan", "en": "Fresh cut, fresh mood.", "hi": "फ्रेश कट, फ्रेश मूड।", "mr": "फ्रेश कट, फ्रेश मूड."},
  {"k": "slogan", "en": "Find your next favourite shop nearby.", "hi": "पास में अपनी अगली पसंदीदा दुकान खोजें।", "mr": "जवळ तुमचं पुढचं आवडतं दुकान शोधा."},
  {"k": "slogan", "en": "Great looks start with great listening. Tell your stylist what you love.", "hi": "बढ़िया लुक अच्छी बातचीत से शुरू होता है। स्टाइलिस्ट को बताइए आपको क्या पसंद है।", "mr": "छान लुक चांगल्या संवादाने सुरू होतो. स्टायलिस्टला तुम्हाला काय आवडतं ते सांगा."},
  {"k": "slogan", "en": "Blisscco: book it, glow it.", "hi": "Blisscco: बुक करें, चमकें।", "mr": "Blisscco: बुक करा, चमका."},
  {"k": "slogan", "en": "Every day is a chance to feel fabulous.", "hi": "हर दिन शानदार महसूस करने का मौका है।", "mr": "प्रत्येक दिवस छान वाटण्याची संधी आहे."},
  {"k": "tip", "en": "Do a patch test before trying any new product or colour.", "hi": "कोई नया प्रोडक्ट या रंग आज़माने से पहले पैच टेस्ट करें।", "mr": "कोणताही नवा प्रोडक्ट किंवा रंग वापरण्यापूर्वी पॅच टेस्ट करा."},
  {"k": "tip", "en": "Tell your stylist about any allergies before the service.", "hi": "सर्विस से पहले स्टाइलिस्ट को अपनी एलर्जी के बारे में बताएँ।", "mr": "सेवेपूर्वी स्टायलिस्टला तुमच्या ॲलर्जीबद्दल सांगा."},
  {"k": "tip", "en": "Bring a reference photo to your appointment. It helps a lot.", "hi": "अपॉइंटमेंट पर रेफरेंस फोटो ले जाएँ। इससे बहुत मदद मिलती है।", "mr": "अपॉइंटमेंटला रेफरन्स फोटो न्या. खूप मदत होते."},
  {"k": "tip", "en": "Remove makeup before sleeping to let your skin rest.", "hi": "सोने से पहले मेकअप हटाएँ, ताकि त्वचा आराम कर सके।", "mr": "झोपण्यापूर्वी मेकअप काढा, म्हणजे त्वचेला आराम मिळेल."},
  {"k": "tip", "en": "Drink enough water. Your skin and hair like it too.", "hi": "पर्याप्त पानी पिएँ। त्वचा और बालों को भी यह पसंद है।", "mr": "पुरेसं पाणी प्या. त्वचा आणि केसांनाही ते आवडतं."},
  {"k": "tip", "en": "Use sunscreen even on cloudy days.", "hi": "बादल वाले दिनों में भी सनस्क्रीन लगाएँ।", "mr": "ढगाळ दिवसांतही सनस्क्रीन लावा."},
  {"k": "tip", "en": "Clean your makeup brushes regularly.", "hi": "अपने मेकअप ब्रश नियमित रूप से साफ़ करें।", "mr": "तुमचे मेकअप ब्रश नियमितपणे स्वच्छ करा."},
  {"k": "tip", "en": "Do not pick at pimples. Let them heal on their own.", "hi": "मुँहासों को न नोचें। उन्हें अपने आप ठीक होने दें।", "mr": "पिंपल्सना हात लावू नका. त्यांना आपोआप बरं होऊ द्या."},
  {"k": "tip", "en": "Book early for festival and wedding days. Good slots go fast.", "hi": "त्योहार और शादी के दिनों के लिए जल्दी बुक करें। अच्छे स्लॉट जल्दी भर जाते हैं।", "mr": "सण आणि लग्नाच्या दिवसांसाठी लवकर बुक करा. चांगले स्लॉट लवकर संपतात."},
  {"k": "tip", "en": "Check a shop's reviews and photos before you book.", "hi": "बुक करने से पहले दुकान के रिव्यू और फ़ोटो देख लें।", "mr": "बुक करण्यापूर्वी दुकानाचे रिव्ह्यू आणि फोटो पहा."},
  {"k": "tip", "en": "Use a wide-tooth comb on wet hair to reduce breakage.", "hi": "गीले बालों में चौड़े दाँत वाली कंघी इस्तेमाल करें, इससे टूटना कम होता है।", "mr": "ओल्या केसांसाठी रुंद दातांचा कंगवा वापरा, केस कमी तुटतात."},
  {"k": "tip", "en": "Regular trims help keep the ends of your hair looking healthy.", "hi": "नियमित ट्रिम से बालों के सिरे सेहतमंद दिखते हैं।", "mr": "नियमित ट्रिमने केसांची टोकं निरोगी दिसतात."},
  {"k": "tip", "en": "Moisturise after a bath while your skin is still slightly damp.", "hi": "नहाने के बाद त्वचा हल्की नम हो तब मॉइस्चराइज़र लगाएँ।", "mr": "आंघोळीनंतर त्वचा किंचित ओलसर असताना मॉइश्चरायझर लावा."},
  {"k": "tip", "en": "Wash your face gently. Scrubbing hard does not clean better.", "hi": "चेहरा हल्के हाथ से धोएँ। ज़ोर से रगड़ने से ज़्यादा सफ़ाई नहीं होती।", "mr": "चेहरा हळुवारपणे धुवा. जोरात घासल्याने जास्त स्वच्छता होत नाही."},
  {"k": "tip", "en": "Let your nail polish dry fully before you touch anything.", "hi": "कुछ भी छूने से पहले नेल पॉलिश को पूरा सूखने दें।", "mr": "काहीही हात लावण्यापूर्वी नेलपॉलिश पूर्ण सुकू द्या."},
  {"k": "tip", "en": "Arrive a few minutes early so your service starts on time.", "hi": "कुछ मिनट पहले पहुँचें ताकि सर्विस समय पर शुरू हो।", "mr": "काही मिनिटं आधी पोहोचा म्हणजे सेवा वेळेवर सुरू होईल."},
  {"k": "tip", "en": "Sleep is a free beauty treatment. Try to get enough.", "hi": "नींद एक मुफ़्त ब्यूटी ट्रीटमेंट है। पूरी नींद लेने की कोशिश करें।", "mr": "झोप हा फुकट ब्यूटी ट्रीटमेंट आहे. पुरेशी झोप घ्या."},
  {"k": "tip", "en": "Tell the shop clearly if something feels too hot or uncomfortable.", "hi": "कुछ ज़्यादा गर्म या असहज लगे तो दुकान वाले को साफ़ बताएँ।", "mr": "काही जास्त गरम किंवा अस्वस्थ वाटलं तर दुकानदाराला स्पष्ट सांगा."},
  {"k": "tip", "en": "Ask the shop if they use fresh towels and clean tools. Good shops are happy to answer.", "hi": "दुकान से पूछें कि वे साफ़ तौलिये और साफ़ औज़ार इस्तेमाल करते हैं या नहीं। अच्छी दुकानें खुशी से बताती हैं।", "mr": "दुकानाला विचारा की ते स्वच्छ टॉवेल आणि स्वच्छ साधनं वापरतात का. चांगली दुकानं आनंदाने सांगतात."},
  {"k": "tip", "en": "Pat your skin dry with a towel instead of rubbing.", "hi": "तौलिये से त्वचा को रगड़ने की जगह थपथपाकर सुखाएँ।", "mr": "टॉवेलने त्वचा घासण्याऐवजी हलक्या थापट्याने कोरडी करा."},
  {"k": "tip", "en": "Oil your hair gently. A relaxed scalp massage feels great too.", "hi": "बालों में हल्के हाथ से तेल लगाएँ। आराम से सिर की मालिश भी बढ़िया लगती है।", "mr": "केसांना हळुवार तेल लावा. आरामशीर डोक्याची मालिशही छान वाटते."},
  {"k": "tip", "en": "Style with heat often? Give your hair a break day each week.", "hi": "अक्सर हीट स्टाइलिंग करते हैं? हफ़्ते में एक दिन बालों को आराम दें।", "mr": "वारंवार हीट स्टायलिंग करता? आठवड्यातून एक दिवस केसांना विश्रांती द्या."},
  {"k": "tip", "en": "Keep a small lip balm handy. Dry lips suit nobody.", "hi": "छोटा लिप बाम पास रखें। फटे होंठ किसी पर अच्छे नहीं लगते।", "mr": "छोटा लिप बाम जवळ ठेवा. कोरडे ओठ कुणालाही शोभत नाहीत."},
  {"k": "tip", "en": "Rate and review after your visit. It helps other customers choose.", "hi": "विज़िट के बाद रेटिंग और रिव्यू दें। इससे दूसरे ग्राहकों को चुनने में मदद मिलती है।", "mr": "भेटीनंतर रेटिंग आणि रिव्ह्यू द्या. त्यामुळे इतर ग्राहकांना निवडायला मदत होते."},
  {"k": "tip", "en": "Not sure what you want? Ask the stylist for options and prices first.", "hi": "क्या चाहिए पता नहीं? पहले स्टाइलिस्ट से विकल्प और दाम पूछ लें।", "mr": "काय हवं ते माहीत नाही? आधी स्टायलिस्टकडून पर्याय आणि दर विचारा."},
  {"k": "tip", "en": "Change your pillowcase often. Fresh cover, fresh skin.", "hi": "तकिये का कवर बार-बार बदलें। साफ़ कवर, साफ़ त्वचा।", "mr": "उशीचं कव्हर वारंवार बदला. स्वच्छ कव्हर, स्वच्छ त्वचा."},
  {"k": "tip", "en": "Tie your hair loosely at night to avoid tugging.", "hi": "रात को बाल ढीले बाँधें ताकि खिंचाव न हो।", "mr": "रात्री केस सैल बांधा म्हणजे ओढ बसणार नाही."},
  {"k": "tip", "en": "A short walk and fresh air do wonders for your glow.", "hi": "थोड़ी सैर और ताज़ी हवा चमक के लिए कमाल करती है।", "mr": "थोडं चालणं आणि ताजी हवा चमकेसाठी कमाल करतात."},
  {"k": "tip", "en": "Eat colourful fruits and veggies. Your skin will thank you.", "hi": "रंग-बिरंगे फल और सब्ज़ियाँ खाएँ। त्वचा शुक्रिया कहेगी।", "mr": "रंगीबेरंगी फळं आणि भाज्या खा. त्वचा धन्यवाद म्हणेल."},
  {"k": "tip", "en": "Open a shop's page and tap a service to see its photos.", "hi": "दुकान का पेज खोलें और किसी सर्विस पर टैप करके उसकी फ़ोटो देखें।", "mr": "दुकानाचं पेज उघडा आणि सेवेवर टॅप करून तिचे फोटो पहा."},
  {"k": "tip", "en": "Tap Get Directions on a shop's page and let the map guide you.", "hi": "दुकान के पेज पर 'रास्ता देखें' दबाएँ और नक़्शे को राह दिखाने दें।", "mr": "दुकानाच्या पेजवर 'दिशा मिळवा' दाबा आणि नकाशाला वाट दाखवू द्या."},
  {"k": "tip", "en": "When Refer & earn is on, sharing Blisscco with a friend can earn you a reward.", "hi": "Refer & earn चालू हो तो दोस्त को Blisscco शेयर करने पर इनाम मिल सकता है।", "mr": "Refer & earn सुरू असताना मित्राला Blisscco शेअर केल्यास बक्षीस मिळू शकतं."},
  {"k": "tip", "en": "Take a deep breath and relax your shoulders. Good looks start with calm.", "hi": "गहरी साँस लें, कंधे ढीले छोड़ें। अच्छा लुक शांत मन से शुरू होता है।", "mr": "दीर्घ श्वास घ्या, खांदे सैल सोडा. छान लुक शांत मनाने सुरू होतो."}
];

export const TIP_EMOJI: Record<BeautyTipItem['k'], string> = { joke: '😄', slogan: '✨', tip: '💡' };

const KEY = 'blisscco.tipIndex';

/** Next position in the cycle. Starts at a random place the first time, then moves on by one each call (remembered on this device). */
export function nextTipIndex(): number {
  const n = BEAUTY_TIPS.length;
  let cur = -1;
  try { const v = Number(localStorage.getItem(KEY)); if (Number.isInteger(v) && v >= 0 && v < n) cur = v; } catch { /* storage unavailable */ }
  const next = cur < 0 ? Math.floor(Math.random() * n) : (cur + 1) % n;
  try { localStorage.setItem(KEY, String(next)); } catch { /* ignore */ }
  return next;
}

export const tipText = (i: number, lang: Lang) => BEAUTY_TIPS[i % BEAUTY_TIPS.length][lang];
