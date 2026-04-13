(function () {
  if (typeof window === 'undefined' || window.NavableI18n) return;

  var DEFAULT_LANGUAGE = 'en';
  var DEFAULT_TRANSLATE_URL = 'http://localhost:3000/api/translate-messages';
  var LOCALES = {
    en: 'en-US',
    fr: 'fr-FR',
    ar: 'ar-SA'
  };
  var VOICE_LOCALE_GROUPS = {
    en: ['en-US', 'en-GB', 'en-AU', 'en-IN'],
    ar: ['ar-SA', 'ar-JO', 'ar-EG', 'ar-AE']
  };

  var LANGUAGE_NAMES = {
    english: 'en',
    anglais: 'en',
    eng: 'en',
    french: 'fr',
    francais: 'fr',
    français: 'fr',
    arabe: 'ar',
    arabic: 'ar',
    arabee: 'ar',
    العربية: 'ar',
    الانجليزية: 'en',
    الإنجليزية: 'en',
    الفرنسية: 'fr'
  };

  var MESSAGES = {
    en: {
      navable_ready: 'Navable is ready. Say "help" to hear example commands.',
      navable_test_announcement: 'Navable: test announcement (fallback hotkey).',
      generic_announcement: 'Navable: announcement.',
      help_examples:
        'Try: summarize this page, scroll down, read title, next heading, open first link, activate focused, read selection, or ask "what is machine learning?" Press Alt+Shift+M to toggle listening.',
      listening_help: 'Listening. Say "help" to hear example commands.',
      stopped_listening: 'Stopped listening. Press Alt+Shift+M to start again.',
      unknown_command: 'I did not catch that. Say "help" to hear example commands.',
      processing_request: 'Working on that.',
      listening_paused_hidden: 'Listening is paused until this tab is visible again.',
      answering_question: 'Let me answer that.',
      answer_failed: 'Sorry, I could not answer that right now.',
      speech_not_available: 'Speech recognition not available.',
      speech_not_allowed: 'Speech recognition is not allowed in this browser.',
      speech_network_issue: 'Speech recognition is unavailable due to a network issue.',
      speech_problem_retry: 'Speech recognition had a problem. Please try again.',
      microphone_busy_retry: 'Microphone is busy in another tab or app. Retrying...',
      scrolled_down: 'Scrolled down.',
      scrolled_up: 'Scrolled up.',
      scrolled_top: 'Scrolled to top.',
      scrolled_bottom: 'Scrolled to bottom.',
      title_value: 'Title: {value}',
      value_not_found: 'not found',
      selection_value: 'Selection: {value}',
      no_selection: 'No selection.',
      no_focused_text: 'No focused element text.',
      no_focused_element: 'No focused element.',
      not_found_heading: 'I did not find that heading.',
      not_found_link: 'I did not find that link.',
      not_found_button: 'I did not find that button.',
      not_found_generic: 'I did not find a {target}.',
      ambiguous_target: 'I found {count} matching {target} for {value}. Say first, second, or be more specific.',
      heading_value: 'Heading: {value}',
      unnamed: 'unnamed',
      opening_value: 'Opening {value}',
      focused_value: 'Focused {value}',
      activated_value: 'Activated {value}',
      target_link: 'link',
      target_button: 'button',
      target_heading: 'heading',
      target_input: 'input',
      target_element: 'element',
      summarizing_wait: 'Summarizing this page... please wait.',
      summarize_unavailable_page: 'Sorry, summarization is unavailable on this page.',
      summarize_failed: 'Sorry, I could not summarize this page.',
      summarize_request_failed: 'Sorry, the summary request failed. Please try again.',
      tell_website_to_open: 'Tell me which website to open.',
      open_site_unavailable: 'Opening a website is unavailable.',
      open_site_failed: 'Could not open that site.',
      wait_for_user_input: 'Please provide input, then tell me to continue.',
      newtab_try_open: 'I did not catch that. Try: "Open YouTube" or ask a quick question.',
      newtab_help_examples: 'Try: "Open YouTube", "Open example dot com", "Search for weather", or "What is photosynthesis?"',
      newtab_listening: 'Listening... Say "Open YouTube" or ask a quick question.',
      voice_unavailable_browser: 'Voice input is not available in this browser.',
      mic_access_blocked: 'Microphone access is blocked. Allow microphone for this extension to use voice.',
      mic_busy: 'Microphone is busy. Close other apps or tabs using the mic, then try again.',
      opening_site: 'Opening {value}...',
      missing_url: 'Missing website name or URL.'
    },
    fr: {
      navable_ready: 'Navable est pret. Dites "aide" pour entendre des exemples de commandes.',
      navable_test_announcement: 'Navable : annonce de test (raccourci de secours).',
      generic_announcement: 'Navable : annonce.',
      help_examples:
        'Essayez : resume cette page, fais defiler vers le bas, lis le titre, titre suivant, ouvre le premier lien, active l element cible, lis la selection, ou demande "qu est-ce que l apprentissage automatique ?". Appuyez sur Alt+Shift+M pour activer ou arreter l ecoute.',
      listening_help: 'J ecoute. Dites "aide" pour entendre des exemples de commandes.',
      stopped_listening: 'Ecoute arretee. Appuyez sur Alt+Shift+M pour recommencer.',
      unknown_command: 'Je n ai pas compris. Dites "aide" pour entendre des exemples de commandes.',
      processing_request: 'Je m en occupe.',
      listening_paused_hidden: 'L ecoute est en pause jusqu a ce que vous reveniez sur cet onglet.',
      answering_question: 'Je reflechis a cela.',
      answer_failed: 'Desole, je n ai pas pu repondre a cela pour le moment.',
      speech_not_available: 'La reconnaissance vocale n est pas disponible.',
      speech_not_allowed: 'La reconnaissance vocale n est pas autorisee dans ce navigateur.',
      speech_network_issue: 'La reconnaissance vocale est indisponible a cause d un probleme reseau.',
      speech_problem_retry: 'La reconnaissance vocale a rencontre un probleme. Reessayez.',
      microphone_busy_retry: 'Le microphone est utilise dans un autre onglet ou une autre application. Nouvelle tentative...',
      scrolled_down: 'Defilement vers le bas.',
      scrolled_up: 'Defilement vers le haut.',
      scrolled_top: 'Retour en haut de la page.',
      scrolled_bottom: 'Aller en bas de la page.',
      title_value: 'Titre : {value}',
      value_not_found: 'introuvable',
      selection_value: 'Selection : {value}',
      no_selection: 'Aucune selection.',
      no_focused_text: 'Aucun texte sur l element cible.',
      no_focused_element: 'Aucun element cible.',
      not_found_heading: 'Je n ai pas trouve ce titre.',
      not_found_link: 'Je n ai pas trouve ce lien.',
      not_found_button: 'Je n ai pas trouve ce bouton.',
      not_found_generic: 'Je n ai pas trouve {target}.',
      ambiguous_target: 'J ai trouve {count} {target} correspondants pour {value}. Dites premier, deuxieme, ou soyez plus precis.',
      heading_value: 'Titre : {value}',
      unnamed: 'sans nom',
      opening_value: 'Ouverture de {value}',
      focused_value: 'Focus sur {value}',
      activated_value: 'Activation de {value}',
      target_link: 'le lien',
      target_button: 'le bouton',
      target_heading: 'le titre',
      target_input: 'le champ',
      target_element: 'l element',
      summarizing_wait: 'Je resume cette page... veuillez patienter.',
      summarize_unavailable_page: 'Desole, le resume n est pas disponible sur cette page.',
      summarize_failed: 'Desole, je n ai pas pu resumer cette page.',
      summarize_request_failed: 'Desole, la demande de resume a echoue. Reessayez.',
      tell_website_to_open: 'Dites-moi quel site ouvrir.',
      open_site_unavailable: 'L ouverture d un site web n est pas disponible.',
      open_site_failed: 'Impossible d ouvrir ce site.',
      wait_for_user_input: 'Veuillez fournir une saisie, puis dites-moi de continuer.',
      newtab_try_open: 'Je n ai pas compris. Essayez : "Ouvre YouTube" ou posez une question rapide.',
      newtab_help_examples: 'Essayez : "Ouvre YouTube", "Ouvre example point com", "Recherche la meteo", ou "Qu est-ce que la photosynthese ?".',
      newtab_listening: 'J ecoute... Dites "Ouvre YouTube" ou posez une question rapide.',
      voice_unavailable_browser: 'La saisie vocale n est pas disponible dans ce navigateur.',
      mic_access_blocked: 'L acces au microphone est bloque. Autorisez le microphone pour cette extension.',
      mic_busy: 'Le microphone est occupe. Fermez les autres applications ou onglets qui l utilisent, puis reessayez.',
      opening_site: 'Ouverture de {value}...',
      missing_url: 'Nom du site ou URL manquant.'
    },
    ar: {
      navable_ready: 'نافابل جاهز. قل "مساعدة" لسماع أمثلة للأوامر.',
      navable_test_announcement: 'نافابل: إعلان تجريبي (اختصار احتياطي).',
      generic_announcement: 'نافابل: إعلان.',
      help_examples:
        'جرّب: لخّص هذه الصفحة، مرر إلى الأسفل، اقرأ العنوان، العنوان التالي، افتح أول رابط، فعّل العنصر المحدد، اقرأ التحديد، أو اسأل "ما هو التعلم الآلي؟". اضغط Alt+Shift+M لتبديل الاستماع.',
      listening_help: 'أستمع الآن. قل "مساعدة" لسماع أمثلة للأوامر.',
      stopped_listening: 'تم إيقاف الاستماع. اضغط Alt+Shift+M للبدء من جديد.',
      unknown_command: 'لم أفهم ذلك. قل "مساعدة" لسماع أمثلة للأوامر.',
      processing_request: 'أعمل على ذلك الآن.',
      listening_paused_hidden: 'تم إيقاف الاستماع مؤقتاً حتى تعود إلى هذا التبويب.',
      answering_question: 'دعني أجيب عن ذلك.',
      answer_failed: 'عذراً، لم أتمكن من الإجابة عن ذلك الآن.',
      speech_not_available: 'التعرّف على الكلام غير متاح.',
      speech_not_allowed: 'التعرّف على الكلام غير مسموح به في هذا المتصفح.',
      speech_network_issue: 'التعرّف على الكلام غير متاح بسبب مشكلة في الشبكة.',
      speech_problem_retry: 'حدثت مشكلة في التعرّف على الكلام. حاول مرة أخرى.',
      microphone_busy_retry: 'الميكروفون مستخدم في تبويب أو تطبيق آخر. سأحاول مرة أخرى...',
      scrolled_down: 'تم التمرير إلى الأسفل.',
      scrolled_up: 'تم التمرير إلى الأعلى.',
      scrolled_top: 'تم الانتقال إلى أعلى الصفحة.',
      scrolled_bottom: 'تم الانتقال إلى أسفل الصفحة.',
      title_value: 'العنوان: {value}',
      value_not_found: 'غير موجود',
      selection_value: 'التحديد: {value}',
      no_selection: 'لا يوجد تحديد.',
      no_focused_text: 'لا يوجد نص للعنصر المحدد.',
      no_focused_element: 'لا يوجد عنصر محدد.',
      not_found_heading: 'لم أجد هذا العنوان.',
      not_found_link: 'لم أجد هذا الرابط.',
      not_found_button: 'لم أجد هذا الزر.',
      not_found_generic: 'لم أجد {target}.',
      ambiguous_target: 'وجدت {count} من {target} المطابقة لـ {value}. قل الأول أو الثاني أو كن أكثر تحديداً.',
      heading_value: 'العنوان: {value}',
      unnamed: 'بدون اسم',
      opening_value: 'جارٍ فتح {value}',
      focused_value: 'تم التركيز على {value}',
      activated_value: 'تم تفعيل {value}',
      target_link: 'الرابط',
      target_button: 'الزر',
      target_heading: 'العنوان',
      target_input: 'حقل الإدخال',
      target_element: 'العنصر',
      summarizing_wait: 'أقوم بتلخيص هذه الصفحة... يرجى الانتظار.',
      summarize_unavailable_page: 'عذراً، التلخيص غير متاح في هذه الصفحة.',
      summarize_failed: 'عذراً، لم أتمكن من تلخيص هذه الصفحة.',
      summarize_request_failed: 'عذراً، فشل طلب التلخيص. حاول مرة أخرى.',
      tell_website_to_open: 'أخبرني بأي موقع تريد فتحه.',
      open_site_unavailable: 'فتح موقع ويب غير متاح.',
      open_site_failed: 'تعذر فتح هذا الموقع.',
      wait_for_user_input: 'يرجى إدخال البيانات ثم أخبرني أن أتابع.',
      newtab_try_open: 'لم أفهم ذلك. جرّب: "افتح يوتيوب" أو اطرح سؤالاً سريعاً.',
      newtab_help_examples: 'جرّب: "افتح يوتيوب"، "افتح example dot com"، "ابحث عن الطقس"، أو "ما هي عملية البناء الضوئي؟".',
      newtab_listening: 'أستمع الآن... قل "افتح يوتيوب" أو اطرح سؤالاً سريعاً.',
      voice_unavailable_browser: 'الإدخال الصوتي غير متاح في هذا المتصفح.',
      mic_access_blocked: 'الوصول إلى الميكروفون محظور. اسمح للميكروفون لهذه الإضافة لاستخدام الصوت.',
      mic_busy: 'الميكروفون مشغول. أغلق التطبيقات أو التبويبات الأخرى التي تستخدمه ثم حاول مرة أخرى.',
      opening_site: 'جارٍ فتح {value}...',
      missing_url: 'اسم الموقع أو الرابط مفقود.'
    }
  };

  var pendingLanguageLoads = {};

  function getFetchImpl() {
    return window.fetch;
  }

  function canonicalizeLocale(lang) {
    var raw = String(lang || '').trim().replace(/_/g, '-');
    if (!raw) return '';
    try {
      if (window.Intl && typeof window.Intl.Locale === 'function') {
        return new window.Intl.Locale(raw).baseName;
      }
    } catch (_err) {
      // fall through
    }

    var parts = raw.split('-').filter(Boolean);
    if (!parts.length) return '';
    parts[0] = parts[0].toLowerCase();
    for (var i = 1; i < parts.length; i++) {
      if (parts[i].length === 2) parts[i] = parts[i].toUpperCase();
      else if (parts[i].length === 4) parts[i] = parts[i].charAt(0).toUpperCase() + parts[i].slice(1).toLowerCase();
      else parts[i] = parts[i].toLowerCase();
    }
    return parts.join('-');
  }

  function normalizeLanguage(lang) {
    var raw = String(lang || '').trim().toLowerCase();
    if (!raw) return DEFAULT_LANGUAGE;
    if (LANGUAGE_NAMES[raw]) return LANGUAGE_NAMES[raw];

    var canonical = canonicalizeLocale(raw);
    if (canonical) {
      var primary = canonical.split('-')[0].toLowerCase();
      if (LANGUAGE_NAMES[primary]) return LANGUAGE_NAMES[primary];
      return primary || DEFAULT_LANGUAGE;
    }

    var parts = raw.split(/[-_]/);
    if (parts[0] && LANGUAGE_NAMES[parts[0]]) return LANGUAGE_NAMES[parts[0]];
    return parts[0] || DEFAULT_LANGUAGE;
  }

  function localeForLanguage(lang) {
    var normalized = normalizeLanguage(lang);
    if (LOCALES[normalized]) return LOCALES[normalized];
    var canonical = canonicalizeLocale(lang);
    if (canonical) return canonical;
    return normalized || LOCALES[DEFAULT_LANGUAGE];
  }

  function recognitionLocalesForLanguage(lang, preferredLocale) {
    var normalized = normalizeLanguage(lang);
    var locales = [];
    var seen = {};

    function push(locale) {
      var canonical = canonicalizeLocale(locale);
      if (!canonical) return;
      if (normalizeLanguage(canonical) !== normalized) return;
      var key = canonical.toLowerCase();
      if (seen[key]) return;
      seen[key] = true;
      locales.push(canonical);
    }

    push(preferredLocale);
    (VOICE_LOCALE_GROUPS[normalized] || []).forEach(push);
    push(localeForLanguage(normalized));
    return locales;
  }

  function normalizeLanguageMode(mode, fallbackLanguage) {
    var raw = String(mode || '').trim().toLowerCase();
    if (raw === 'auto') return 'auto';
    if (!raw) return 'auto';
    var explicit = normalizeLanguage(raw || fallbackLanguage || DEFAULT_LANGUAGE);
    if (explicit === 'ar' || explicit === 'en') return explicit;
    return 'auto';
  }

  function interpolate(template, params) {
    var text = String(template || '');
    var values = params || {};
    return text.replace(/\{(\w+)\}/g, function (_m, key) {
      return Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : '';
    });
  }

  function sanitizeMessages(candidate, fallbackMessages) {
    var safe = {};
    var fallback = fallbackMessages || {};
    Object.keys(fallback).forEach(function (key) {
      var value = candidate && Object.prototype.hasOwnProperty.call(candidate, key) ? candidate[key] : null;
      safe[key] = typeof value === 'string' && value.trim() ? value : fallback[key];
    });
    return safe;
  }

  function t(key, lang, params) {
    var normalized = normalizeLanguage(lang);
    var messages = MESSAGES[normalized] || MESSAGES[DEFAULT_LANGUAGE];
    var fallbackMessages = MESSAGES[DEFAULT_LANGUAGE];
    var template = messages[key];
    if (template == null) template = fallbackMessages[key];
    if (template == null) return key;
    return interpolate(template, params);
  }

  function ensureLanguage(lang) {
    var normalized = normalizeLanguage(lang);
    if (!normalized || normalized === DEFAULT_LANGUAGE || MESSAGES[normalized]) {
      return Promise.resolve(MESSAGES[normalized] || MESSAGES[DEFAULT_LANGUAGE]);
    }
    if (pendingLanguageLoads[normalized]) return pendingLanguageLoads[normalized];

    var fetchImpl = getFetchImpl();
    if (typeof fetchImpl !== 'function') {
      return Promise.resolve(MESSAGES[DEFAULT_LANGUAGE]);
    }

    pendingLanguageLoads[normalized] = fetchImpl(DEFAULT_TRANSLATE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        language: normalized,
        messages: MESSAGES[DEFAULT_LANGUAGE]
      })
    }).then(function (response) {
      if (!response || !response.ok) throw new Error('Language pack request failed');
      return response.json();
    }).then(function (payload) {
      var translated = sanitizeMessages(payload && payload.messages ? payload.messages : null, MESSAGES[DEFAULT_LANGUAGE]);
      MESSAGES[normalized] = translated;
      return translated;
    }).catch(function () {
      return MESSAGES[DEFAULT_LANGUAGE];
    }).finally(function () {
      delete pendingLanguageLoads[normalized];
    });

    return pendingLanguageLoads[normalized];
  }

  function countMatches(text, pattern) {
    var matches = String(text || '').match(pattern);
    return matches ? matches.length : 0;
  }

  function detectLanguage(text, fallbackLanguage) {
    var raw = String(text || '').trim();
    if (!raw) return normalizeLanguage(fallbackLanguage);
    if (/[\u0600-\u06FF]/.test(raw)) return 'ar';

    var lower = raw.toLowerCase();
    var frScore = 0;
    var enScore = 0;
    var arLatnScore = 0;

    if (/[àâçéèêëîïôûùüÿœæ]/i.test(raw)) frScore += 3;
    frScore += countMatches(lower, /\b(bonjour|salut|merci|ouvre|ouvrir|recherche|resume|résume|résumé|decris|décris|titre|page|lien|bouton|suivant|precedent|précédent|aide|ecoute|écoute)\b/g);
    enScore += countMatches(lower, /\b(open|search|scroll|summary|summarize|describe|title|button|link|page|help|listen|stop|start|next|previous|focus|activate)\b/g);
    arLatnScore += countMatches(lower, /\b(ifta[h7]|efta[h7]|roo[h7]|rou[h7]|wayn|wein|shu|sho|khallas|waq[aei]f|inzil|inzal|itla[3a]|tal[ae]3|dawwer|dowwer|mosa[ae]da)\b/g);

    if (frScore > enScore && frScore > 0) return 'fr';
    if (arLatnScore > 0) return 'ar';
    if (enScore > frScore && enScore > 0) return 'en';

    return normalizeLanguage(fallbackLanguage);
  }

  function resolveNamedLanguage(name) {
    var normalized = String(name || '')
      .trim()
      .toLowerCase()
      .replace(/[.,!?]/g, '');
    return LANGUAGE_NAMES[normalized] || null;
  }

  function extractExplicitOutputLanguage(text) {
    var raw = String(text || '').trim();
    if (!raw) return null;
    var lower = raw.toLowerCase();

    var englishMatch = lower.match(/\b(?:answer|respond|reply|speak|say|summarize|summarise|describe)\b[\s\S]{0,24}?\b(?:in)\s+(english|french|arabic)\b/);
    if (englishMatch && englishMatch[1]) return resolveNamedLanguage(englishMatch[1]);

    var frenchMatch = lower.match(/\b(?:reponds|réponds|parle|dis|resume|résume|decris|décris)\b[\s\S]{0,24}?\ben\s+(anglais|francais|français|arabe)\b/);
    if (frenchMatch && frenchMatch[1]) return resolveNamedLanguage(frenchMatch[1]);

    if (/بالانجليزية|بالإنجليزية|بالانجليزي|بالإنجليزي/.test(raw)) return 'en';
    if (/بالفرنسية/.test(raw)) return 'fr';
    if (/بالعربية|بالعربي/.test(raw)) return 'ar';

    return null;
  }

  function resolveOutputLanguage(options) {
    var opts = options || {};
    var transcript = opts.transcript || '';
    var explicit = extractExplicitOutputLanguage(transcript);
    if (explicit) return normalizeLanguage(explicit);
    return detectLanguage(transcript, opts.fallbackLanguage || DEFAULT_LANGUAGE);
  }

  window.NavableI18n = {
    messages: MESSAGES,
    normalizeLanguage: normalizeLanguage,
    normalizeLanguageMode: normalizeLanguageMode,
    localeForLanguage: localeForLanguage,
    recognitionLocalesForLanguage: recognitionLocalesForLanguage,
    detectLanguage: detectLanguage,
    extractExplicitOutputLanguage: extractExplicitOutputLanguage,
    resolveOutputLanguage: resolveOutputLanguage,
    ensureLanguage: ensureLanguage,
    t: t
  };
})();
