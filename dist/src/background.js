function createMemoryStorageArea() {
  const data = {};
  return {
    _data: data,
    get(query, cb) {
      if (query === null || typeof query === 'undefined') {
        cb({ ...data });
        return;
      }
      if (Array.isArray(query)) {
        cb(query.reduce((acc, key) => {
          acc[key] = Object.prototype.hasOwnProperty.call(data, key) ? data[key] : undefined;
          return acc;
        }, {}));
        return;
      }
      if (typeof query === 'string') {
        cb({ [query]: Object.prototype.hasOwnProperty.call(data, query) ? data[query] : undefined });
        return;
      }
      const defaults = query && typeof query === 'object' ? query : {};
      cb(Object.keys(defaults).reduce((acc, key) => {
        acc[key] = Object.prototype.hasOwnProperty.call(data, key) ? data[key] : defaults[key];
        return acc;
      }, {}));
    },
    set(items, cb) {
      Object.keys(items || {}).forEach((key) => {
        data[key] = items[key];
      });
      if (typeof cb === 'function') cb();
    },
    remove(keys, cb) {
      const keyList = Array.isArray(keys) ? keys : [keys];
      keyList.forEach((key) => {
        delete data[key];
      });
      if (typeof cb === 'function') cb();
    },
    clear(cb) {
      Object.keys(data).forEach((key) => {
        delete data[key];
      });
      if (typeof cb === 'function') cb();
    }
  };
}

// Test fallback: if chrome is missing (non-extension env), create a minimal shim so tests can run.
if (typeof window !== 'undefined' && typeof chrome === 'undefined') {
  const syncStorage = createMemoryStorageArea();
  const sessionStorage = createMemoryStorageArea();
  window.chrome = {
    commands: {
      _listeners: [],
      onCommand: {
        addListener(fn) {
          chrome.commands._listeners.push(fn);
        }
      },
      _trigger(command) {
        (this._listeners || []).forEach((fn) => {
          try { fn(command); } catch (_e) { /* ignore */ }
        });
      }
    },
    tabs: {
      _created: [],
      onCreated: { addListener() {} },
      onUpdated: { addListener() {} },
      onRemoved: { addListener() {} },
      query() { return Promise.resolve([{ id: 1 }]); },
      create(createProperties) {
        const url = createProperties && createProperties.url ? String(createProperties.url) : 'about:blank';
        chrome.tabs._created.push(url);
        return Promise.resolve({ id: chrome.tabs._created.length + 1, url });
      },
      update(tabId, updateProperties) {
        // Support both update(tabId, props) and update(props) signatures in tests.
        let props = updateProperties;
        if (typeof tabId === 'object' && tabId) {
          props = tabId;
        }
        const url = props && props.url ? String(props.url) : undefined;
        return Promise.resolve({ id: typeof tabId === 'number' ? tabId : 1, url });
      },
      sendMessage(_tabId, payload) {
        return new Promise((resolve) => {
          const listeners = (chrome.runtime._listeners || []);
          let responded = false;
          const sendResponse = (res) => {
            responded = true;
            resolve(res);
          };
          listeners.forEach((fn) => {
            try {
              const maybeAsync = fn(payload, { tab: { id: _tabId } }, sendResponse);
              if (maybeAsync === true) {
                // async response allowed
              }
            } catch (_e) {
              // ignore listener errors
            }
          });
          if (!responded) {
            setTimeout(() => resolve(undefined), 0);
          }
        });
      }
    },
    runtime: {
      _listeners: [],
      onMessage: {
        addListener(fn) {
          chrome.runtime._listeners.push(fn);
        }
      },
      sendMessage(payload) {
        return new Promise((resolve) => {
          const listeners = chrome.runtime._listeners || [];
          let responded = false;
          const sendResponse = (res) => {
            responded = true;
            resolve(res);
          };
          listeners.forEach((fn) => {
            try {
              const maybeAsync = fn(payload, {}, sendResponse);
              if (maybeAsync === true) {
                // async response allowed
              }
            } catch (_e) {
              // ignore listener errors
            }
          });
          if (!responded) {
            setTimeout(() => resolve(undefined), 0);
          }
        });
      }
    },
    tts: {
      _spoken: [],
      _stopCount: 0,
      speak(text, options, cb) {
        chrome.tts._spoken.push({
          text: String(text || ''),
          options: options || {}
        });
        if (typeof cb === 'function') setTimeout(() => cb(), 0);
        if (options && typeof options.onEvent === 'function') {
          setTimeout(() => {
            try { options.onEvent({ type: 'start' }); } catch (_err) { /* ignore */ }
          }, 0);
          setTimeout(() => {
            try { options.onEvent({ type: 'end' }); } catch (_err2) { /* ignore */ }
          }, 10);
        }
      },
      stop() {
        chrome.tts._stopCount += 1;
      }
    },
    storage: {
      sync: syncStorage,
      session: sessionStorage,
      onChanged: { addListener() {} }
    }
  };
}

const NAVABLE_NEW_TAB_URL = (() => {
  try {
    return chrome && chrome.runtime && chrome.runtime.getURL
      ? String(chrome.runtime.getURL('src/newtab/newtab.html'))
      : '';
  } catch (_err) {
    return '';
  }
})();

const TRANSLATE_MESSAGES_URL = 'http://localhost:3000/api/translate-messages';
const OUTPUT_LOCALES = {
  en: 'en-US',
  fr: 'fr-FR',
  ar: 'ar-SA'
};
const outputMessageLoadPromises = {};

const OUTPUT_MESSAGES = {
  en: {
    summary_unavailable: 'Page summary is unavailable.',
    no_title: 'No title found.',
    title_value: 'Title: {value}.',
    counts_value: 'Headings {headings}, links {links}, buttons {buttons}.',
    top_heading: 'Top heading: {value}.',
    excerpt_value: 'Page snippet: {value}.',
    try_commands: 'Try commands like: describe this page, scroll down, read title, read heading.',
    ai_summaries_off: 'AI summaries are off. Enable AI in options for a richer summary.',
    suggestion_scroll: 'Try: scroll down.',
    suggestion_title: 'Try: read the title.',
    suggestion_heading: 'Try: move to the next heading.',
    suggestion_open_link: 'Try: open first link.',
    opening_value: 'Opening {value}.',
    open_website_failed: 'Could not open that website.',
    missing_url: 'Missing website name or URL.',
    ai_answers_off: 'AI answers are off. Enable AI in options to ask general questions.',
    answer_unavailable: 'I could not answer that right now.'
  },
  fr: {
    summary_unavailable: 'Le resume de la page n est pas disponible.',
    no_title: 'Aucun titre trouve.',
    title_value: 'Titre : {value}.',
    counts_value: 'Titres {headings}, liens {links}, boutons {buttons}.',
    top_heading: 'Titre principal : {value}.',
    excerpt_value: 'Extrait de la page : {value}.',
    try_commands: 'Essayez des commandes comme : decris cette page, fais defiler vers le bas, lis le titre, lis le titre suivant.',
    ai_summaries_off: 'Les resumes IA sont desactives. Activez l IA dans les options pour un resume plus riche.',
    suggestion_scroll: 'Essayez : fais defiler vers le bas.',
    suggestion_title: 'Essayez : lis le titre.',
    suggestion_heading: 'Essayez : va au titre suivant.',
    suggestion_open_link: 'Essayez : ouvre le premier lien.',
    opening_value: 'Ouverture de {value}.',
    open_website_failed: 'Impossible d ouvrir ce site.',
    missing_url: 'Nom du site ou URL manquant.',
    ai_answers_off: 'Les reponses IA sont desactivees. Activez l IA dans les options pour poser des questions generales.',
    answer_unavailable: 'Je n ai pas pu repondre a cela pour le moment.'
  },
  ar: {
    summary_unavailable: 'ملخص الصفحة غير متاح.',
    no_title: 'لم يتم العثور على عنوان.',
    title_value: 'العنوان: {value}.',
    counts_value: 'العناوين {headings}، الروابط {links}، الأزرار {buttons}.',
    top_heading: 'أعلى عنوان: {value}.',
    excerpt_value: 'مقتطف من الصفحة: {value}.',
    try_commands: 'جرّب أوامر مثل: صف هذه الصفحة، مرر للأسفل، اقرأ العنوان، اقرأ العنوان التالي.',
    ai_summaries_off: 'ملخصات الذكاء الاصطناعي متوقفة. فعّل الذكاء الاصطناعي من الإعدادات للحصول على ملخص أفضل.',
    suggestion_scroll: 'جرّب: مرر إلى الأسفل.',
    suggestion_title: 'جرّب: اقرأ العنوان.',
    suggestion_heading: 'جرّب: انتقل إلى العنوان التالي.',
    suggestion_open_link: 'جرّب: افتح أول رابط.',
    opening_value: 'جارٍ فتح {value}.',
    open_website_failed: 'تعذر فتح هذا الموقع.',
    missing_url: 'اسم الموقع أو الرابط مفقود.',
    ai_answers_off: 'إجابات الذكاء الاصطناعي متوقفة. فعّل الذكاء الاصطناعي من الإعدادات لطرح أسئلة عامة.',
    answer_unavailable: 'تعذر عليّ الإجابة عن ذلك الآن.'
  }
};

function normalizeOutputLanguage(lang) {
  const raw = String(lang || '').trim().replace(/_/g, '-');
  if (!raw) return 'en';
  try {
    const canonical = new Intl.Locale(raw).baseName;
    return canonical.split('-')[0].toLowerCase() || 'en';
  } catch (_err) {
    return raw.toLowerCase().split(/[-_]/)[0] || 'en';
  }
}

function normalizeLanguageMode(mode, fallbackLanguage) {
  const raw = String(mode || '').trim().toLowerCase();
  if (raw === 'auto') return 'auto';
  if (!raw) return 'auto';
  const normalized = normalizeOutputLanguage(raw || fallbackLanguage || 'en-US');
  if (normalized === 'ar' || normalized === 'en') return normalized;
  return 'auto';
}

function configuredOutputLanguage(settings = {}, requestedOutputLanguage = '') {
  const rawRequested = String(requestedOutputLanguage || '').trim();
  if (rawRequested && rawRequested.toLowerCase() !== 'auto') return normalizeOutputLanguage(rawRequested);
  const mode = normalizeLanguageMode(settings.languageMode, settings.language || 'en-US');
  if (mode !== 'auto') return mode;
  return normalizeOutputLanguage(settings.language || 'en-US');
}

function supportsExtensionTts() {
  return !!(chrome && chrome.tts && typeof chrome.tts.speak === 'function');
}

function stopExtensionTts() {
  return new Promise((resolve) => {
    if (!supportsExtensionTts()) {
      resolve(false);
      return;
    }
    try {
      if (typeof chrome.tts.stop === 'function') chrome.tts.stop();
      resolve(true);
    } catch (_err) {
      resolve(false);
    }
  });
}

function speakWithExtensionTts(text, opts = {}) {
  return new Promise((resolve) => {
    const message = String(text || '').trim();
    if (!message || !supportsExtensionTts()) {
      resolve({ ok: false, error: 'tts unavailable' });
      return;
    }

    try {
      if (typeof chrome.tts.stop === 'function') chrome.tts.stop();
    } catch (_err) {
      // ignore
    }

    const speakOptions = {
      enqueue: false,
      lang: typeof opts.lang === 'string' && opts.lang.trim() ? String(opts.lang).trim() : undefined,
      desiredEventTypes: ['start', 'end', 'interrupted', 'cancelled', 'error']
    };
    let finished = false;
    const fallbackMs = Math.min(20000, Math.max(2500, message.length * 90));
    const fallbackTimer = setTimeout(() => {
      if (finished) return;
      finished = true;
      resolve({ ok: true, eventType: 'timeout' });
    }, fallbackMs);

    function finish(result) {
      if (finished) return;
      finished = true;
      try { clearTimeout(fallbackTimer); } catch (_err) { /* ignore */ }
      resolve(result);
    }

    speakOptions.onEvent = (event) => {
      const type = event && event.type ? String(event.type) : '';
      if (!type) return;
      if (type === 'error') {
        finish({
          ok: false,
          error: event && event.errorMessage ? String(event.errorMessage) : 'tts error',
          eventType: type
        });
        return;
      }
      if (type === 'end' || type === 'interrupted' || type === 'cancelled') {
        finish({ ok: true, eventType: type });
      }
    };

    try {
      chrome.tts.speak(message, speakOptions, () => {
        const lastError = chrome.runtime && chrome.runtime.lastError && chrome.runtime.lastError.message
          ? String(chrome.runtime.lastError.message)
          : '';
        if (lastError) {
          finish({ ok: false, error: lastError });
          return;
        }
      });
    } catch (err) {
      finish({ ok: false, error: String(err || 'tts failed') });
    }
  });
}

function canonicalizeLocale(lang) {
  const raw = String(lang || '').trim().replace(/_/g, '-');
  if (!raw) return '';
  try {
    return new Intl.Locale(raw).baseName;
  } catch (_err) {
    const parts = raw.split('-').filter(Boolean);
    if (!parts.length) return '';
    parts[0] = parts[0].toLowerCase();
    for (let i = 1; i < parts.length; i += 1) {
      if (parts[i].length === 2) parts[i] = parts[i].toUpperCase();
      else if (parts[i].length === 4) parts[i] = parts[i][0].toUpperCase() + parts[i].slice(1).toLowerCase();
      else parts[i] = parts[i].toLowerCase();
    }
    return parts.join('-');
  }
}

function sanitizeOutputMessages(candidate, fallbackDictionary) {
  return Object.keys(fallbackDictionary).reduce((acc, key) => {
    const value = candidate && Object.prototype.hasOwnProperty.call(candidate, key)
      ? candidate[key]
      : null;
    acc[key] = typeof value === 'string' && value.trim() ? value : fallbackDictionary[key];
    return acc;
  }, {});
}

function ensureOutputMessages(lang) {
  const normalized = normalizeOutputLanguage(lang);
  if (!normalized || normalized === 'en' || OUTPUT_MESSAGES[normalized]) {
    return Promise.resolve(OUTPUT_MESSAGES[normalized] || OUTPUT_MESSAGES.en);
  }
  if (outputMessageLoadPromises[normalized]) return outputMessageLoadPromises[normalized];

  outputMessageLoadPromises[normalized] = fetch(TRANSLATE_MESSAGES_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      language: normalized,
      messages: OUTPUT_MESSAGES.en
    })
  }).then((response) => {
    if (!response.ok) throw new Error(`Translation failed with status ${response.status}`);
    return response.json();
  }).then((payload) => {
    OUTPUT_MESSAGES[normalized] = sanitizeOutputMessages(payload?.messages, OUTPUT_MESSAGES.en);
    return OUTPUT_MESSAGES[normalized];
  }).catch(() => OUTPUT_MESSAGES.en).finally(() => {
    delete outputMessageLoadPromises[normalized];
  });

  return outputMessageLoadPromises[normalized];
}

function outputLocale(lang) {
  const normalized = normalizeOutputLanguage(lang);
  if (OUTPUT_LOCALES[normalized]) return OUTPUT_LOCALES[normalized];
  return canonicalizeLocale(lang) || normalized || OUTPUT_LOCALES.en;
}

function outputMessage(key, lang, params = {}) {
  const normalized = normalizeOutputLanguage(lang);
  const dictionary = OUTPUT_MESSAGES[normalized] || OUTPUT_MESSAGES.en;
  const fallback = OUTPUT_MESSAGES.en;
  const template = dictionary[key] || fallback[key] || key;
  return String(template).replace(/\{(\w+)\}/g, (_match, name) => (
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : ''
  ));
}

function isInternalNewTabUrl(url) {
  const u = String(url || '');
  if (!u) return false;
  if (u === 'chrome://newtab/' || u === 'chrome://newtab') return true;
  if (u === 'edge://newtab/' || u === 'edge://newtab') return true;
  if (u === 'about:newtab' || u === 'about:newtab#' || u === 'about:home') return true;
  if (u.startsWith('chrome-search://local-ntp')) return true;
  if (u.startsWith('chrome://new-tab-page')) return true;
  return false;
}

async function redirectNewTabToNavable(tabId, url) {
  if (!NAVABLE_NEW_TAB_URL || !tabId) return;
  if (!isInternalNewTabUrl(url)) return;
  try {
    await chrome.tabs.update(tabId, { url: NAVABLE_NEW_TAB_URL });
  } catch (err) {
    console.warn('[Navable] new tab redirect failed', err);
  }
}

// Send message to the active tab
async function sendToActiveTab(payload) {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id) throw new Error('No active tab');
  return chrome.tabs.sendMessage(tab.id, payload);
}

async function sendToSpecificTab(tabId, payload) {
  if (!tabId) throw new Error('No target tab');
  return chrome.tabs.sendMessage(tabId, payload);
}

async function sendToTargetTab(tabId, payload) {
  if (tabId) return sendToSpecificTab(tabId, payload);
  return sendToActiveTab(payload);
}

async function tryExecutePlan(plan) {
  try {
    await sendToActiveTab({ type: 'navable:executePlan', plan });
  } catch (_e) {
    // ignore; we will try local execution next
  }
  // Also run locally in page/test context when available to ensure commands work without messaging.
  if (typeof window !== 'undefined' && (window).NavableTools && (window).NavableTools.runPlan) {
    try {
      await (window).NavableTools.runPlan(plan);
      return true;
    } catch (_err) {
      return false;
    }
  }
  return false;
}

const INTENT_STOPWORDS = new Set([
  'a', 'an', 'the', 'me', 'to', 'for', 'please', 'can', 'could', 'would', 'you',
  'show', 'take', 'bring', 'go', 'move', 'open', 'visit', 'launch', 'scroll', 'read',
  'tell', 'what', 'is', 'my', 'current', 'this', 'that', 'of', 'on', 'in', 'at',
  'page', 'section', 'heading', 'link', 'button', 'item', 'tab', 'website', 'site',
  'le', 'la', 'les', 'de', 'des', 'du', 'un', 'une', 'moi', 'mon', 'ma', 'mes', 'sur',
  'ici', 'cette', 'ce', 'cet', 'dans', 'pour', 'que', 'quoi', 'ou', 'où', 'vas', 'va',
  'ouvre', 'lis', 'montre', 'titre', 'lien', 'bouton', 'champ',
  'من', 'على', 'في', 'إلى', 'الى', 'هذا', 'هذه', 'ذلك', 'تلك', 'لي', 'لو', 'ممكن',
  'افتح', 'اذهب', 'روح', 'انتقل', 'اقرأ', 'مرر', 'انزل', 'اطلع', 'العنوان', 'الرابط',
  'الزر', 'الصفحة', 'القسم', 'التالي', 'السابق', 'شو', 'ايش', 'وين', 'على', 'وديني', 'خذني',
  'خلي', 'خليني', 'خلينا', 'لفوق', 'لتحت'
]);

function hasIntent(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

function tokenizeIntentText(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\u0600-\u06ff\s]/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token && token.length > 1 && !INTENT_STOPWORDS.has(token));
}

const FIELD_LIKE_INTENT_TOKENS = ['password', 'email', 'username', 'search', 'phone', 'code', 'otp', 'pin', 'field', 'input', 'box'];
const BUTTON_LIKE_INTENT_TOKENS = ['button', 'submit', 'continue', 'confirm', 'save', 'send'];
const LINK_LIKE_INTENT_TOKENS = ['link', 'pricing', 'docs', 'documentation', 'login', 'signin'];
const HEADING_LIKE_INTENT_TOKENS = ['heading', 'section', 'title', 'part'];

function hasAnyIntentToken(tokens, candidates) {
  return tokens.some((token) => candidates.includes(token));
}

function inferIntentTargetTypes(normalized, tokens) {
  if (hasAnyIntentToken(tokens, FIELD_LIKE_INTENT_TOKENS) || /\b(field|input|box|search|champ)\b|حقل|بحث|ابحث|دو[ّو]?ر/.test(normalized)) {
    return ['input', 'button', 'link', 'heading'];
  }
  if (hasAnyIntentToken(tokens, BUTTON_LIKE_INTENT_TOKENS) || /\b(button|press|tap|activate|bouton)\b|زر|اضغط|فع[ّ]?ل/.test(normalized)) {
    return ['button', 'link', 'input', 'heading'];
  }
  if (hasAnyIntentToken(tokens, HEADING_LIKE_INTENT_TOKENS) || /\b(section|heading|part|titre)\b|عنوان|قسم|جزء/.test(normalized)) {
    return ['heading', 'link', 'button', 'input'];
  }
  if (hasAnyIntentToken(tokens, LINK_LIKE_INTENT_TOKENS) || /\b(link|open|visit|launch|website|site|lien|ouvre|visite)\b|رابط|افتح|وديني|خذني|روح/.test(normalized)) {
    return ['link', 'button', 'heading', 'input'];
  }
  return ['link', 'button', 'heading', 'input'];
}

function scoreIntentCandidate(candidate, tokens, targetTypes) {
  const label = String(candidate?.label || '').toLowerCase();
  const meta = String(candidate?.meta || '').toLowerCase();
  if ((!label && !meta) || !tokens.length) return 0;
  let score = 0;
  for (const token of tokens) {
    if (label === token) score += 10;
    else if (label.startsWith(token) || label.endsWith(token)) score += 6;
    else if (label.includes(token)) score += token.length >= 5 ? 4 : 2;
    else if (meta.includes(token)) score += token.length >= 5 ? 3 : 1;
    if (candidate?.target === 'input' && token === 'password' && String(candidate?.inputType || '').toLowerCase() === 'password') score += 14;
    if (candidate?.target === 'input' && token === 'email' && String(candidate?.inputType || '').toLowerCase() === 'email') score += 12;
    if (candidate?.target === 'input' && token === 'search' && String(candidate?.inputType || '').toLowerCase() === 'search') score += 11;
  }
  const typeIndex = targetTypes.indexOf(candidate?.target || '');
  if (typeIndex >= 0) score += Math.max(0, 8 - typeIndex * 2);
  return score;
}

function collectIntentCandidates(structure, targetTypes) {
  const candidates = [];
  const targets = Array.isArray(targetTypes) && targetTypes.length ? targetTypes : ['link', 'button', 'heading', 'input'];
  for (const target of targets) {
    if (target === 'link' && structure && Array.isArray(structure.links)) {
      structure.links.forEach((item) => candidates.push({
        target: 'link',
        label: item?.label || '',
        meta: `${item?.href || ''}`
      }));
    }
    if (target === 'button' && structure && Array.isArray(structure.buttons)) {
      structure.buttons.forEach((item) => candidates.push({
        target: 'button',
        label: item?.label || '',
        meta: `${item?.tag || ''}`
      }));
    }
    if (target === 'heading' && structure && Array.isArray(structure.headings)) {
      structure.headings.forEach((item) => candidates.push({
        target: 'heading',
        label: item?.label || '',
        meta: `${item?.level != null ? 'level ' + item.level : ''}`
      }));
    }
    if (target === 'input' && structure && Array.isArray(structure.inputs)) {
      structure.inputs.forEach((item) => candidates.push({
        target: 'input',
        label: item?.label || '',
        meta: `${item?.name || ''} ${item?.placeholder || ''}`,
        inputType: item?.inputType || ''
      }));
    }
  }
  return candidates;
}

function chooseIntentTarget(text, structure) {
  const normalized = String(text || '').toLowerCase();
  const tokens = tokenizeIntentText(normalized);
  if (!tokens.length || !structure) return null;

  const targetTypes = inferIntentTargetTypes(normalized, tokens);
  const candidates = collectIntentCandidates(structure, targetTypes);
  let best = null;
  for (const candidate of candidates) {
    const score = scoreIntentCandidate(candidate, tokens, targetTypes);
    if (!score) continue;
    if (!best || score > best.score) best = { ...candidate, score };
  }
  return best;
}

function isTargetSelectionIntent(text) {
  const normalized = String(text || '').toLowerCase();
  if (!normalized) return false;
  return hasIntent(normalized, [
    /\bopen\b/, /\bgo to\b/, /\btake me to\b/, /\bbring me to\b/, /\bshow me\b/,
    /\bfocus\b/, /\bclick\b/, /\bpress\b/, /\bactivate\b/, /\bvisit\b/, /\blaunch\b/,
    /\bouvre\b/, /\bva(?:s)?\s+à\b/, /\bva(?:s)?\s+a\b/, /\bmontre(?:-moi)?\b/,
    /\bclique\b/, /\bactive\b/, /\bvisite\b/, /\blance\b/,
    /افتح/, /اذهب\s+إلى/, /اذهب\s+الى/, /روح\s+على/, /روح\s+إلى/, /روح\s+الى/,
    /انتقل\s+إلى/, /انتقل\s+الى/, /خذني\s+إلى/, /خذني\s+الى/, /خذني\s+على/, /وديني\s+على/,
    /وديني\s+إلى/, /وديني\s+الى/, /خليني\s+أروح/, /خليني\s+اروح/, /خلينا\s+نروح/, /اضغط/, /فعّل|فعل/
  ]);
}

function stubPlanner(command, structure, outputLanguage, preferIntentFallback) {
  const text = String(command || '').toLowerCase();
  const steps = [];
  let description = '';
  const orientation = buildFriendlyOrientation(structure, outputLanguage);
  let matched = false;

  if (
    text.includes('describe') ||
    text.includes('summarize') ||
    text.includes('summary') ||
    text.includes('overview') ||
    text.includes('where am i') ||
    text.includes('what can i do here') ||
    /\br[ée]sum[ée]?\b/.test(text) ||
    /\bd[ée]cri(s|re)\b/.test(text) ||
    /où suis[- ]?je|ou suis[- ]?je/.test(text) ||
    /que puis[- ]je faire ici/.test(text) ||
    /لخص هذه الصفحة|صف هذه الصفحة|أين أنا|اين انا|ماذا يمكنني أن أفعل هنا|ماذا يمكنني ان افعل هنا|شو هاي الصفحة|ايش هاي الصفحة|شو موجود هون|احكيلي عن الصفحة|اعطيني ملخص/.test(text)
  ) {
    description = orientation;
    matched = true;
  } else if (hasIntent(text, [
    /\bscroll up\b/, /\bgo up\b/, /\bmove up\b/, /\bback up\b/, /\bup a bit\b/, /\bhigher\b/,
    /\bmonte\b/, /\bplus haut\b/, /\bfais d[ée]filer vers le haut\b/,
    /اطلع|طلع|اصعد|مرر.*(للأعلى|للاعلى|لفوق)|لفوق|فوق شوي|كم[ّ]?ل لفوق/
  ])) {
    steps.push({ action: 'scroll', direction: 'up' });
    matched = true;
  } else if (hasIntent(text, [
    /\bscroll\b/, /\bgo down\b/, /\bmove down\b/, /\blower\b/, /\bdown a bit\b/, /\bshow me more\b/, /\bkeep going\b/,
    /\bdescend(s)?\b/, /\bplus bas\b/, /\bfais d[ée]filer vers le bas\b/,
    /انزل|نز[ّل]|\bمرر.*(للأسفل|للاسفل|لتحت)\b|لتحت|تحت شوي|كم[ّ]?ل لتحت/
  ])) {
    steps.push({ action: 'scroll', direction: 'down' });
    matched = true;
  } else if (hasIntent(text, [
    /\bread title\b/, /\bpage title\b/, /\bwhat('?s| is) the title\b/, /\btell me the title\b/,
    /\blis le titre\b/, /\bquel est le titre\b/,
    /اقر[أا] العنوان|ما عنوان الصفحة|ما هو عنوان الصفحة|شو عنوان الصفحة|ايش عنوان الصفحة/
  ])) {
    steps.push({ action: 'read_title' });
    matched = true;
  } else if (hasIntent(text, [
    /\bread selection\b/, /\bread selected\b/, /\bwhat did i select\b/,
    /\blis la s[ée]lection\b/,
    /اقر[أا] التحديد|ما الذي حددته/
  ])) {
    steps.push({ action: 'read_selection' });
    matched = true;
  } else if (hasIntent(text, [
    /\bread heading\b/, /\bcurrent heading\b/, /\bwhat heading am i on\b/,
    /\blis le titre\b/, /\bquel titre\b/, /\bsection actuelle\b/,
    /اقر[أا] العنوان|ما العنوان الحالي|ما القسم الحالي|شو العنوان الحالي|ايش العنوان الحالي/
  ])) {
    steps.push({ action: 'read_heading', n: 1 });
    matched = true;
  } else if (hasIntent(text, [
    /\bwhat('?s| is) focused\b/, /\bwhat am i on\b/, /\bread current\b/, /\bread focused\b/,
    /\bsur quoi suis[- ]je\b/, /\blis l[' ]?[ée]l[ée]ment courant\b/,
    /ما العنصر المحدد|على ماذا انا|ما أنا عليه|ما انا عليه|شو العنصر الحالي|ايش العنصر الحالي|وين انا واقف|على شو انا/
  ])) {
    steps.push({ action: 'read_focused' });
    matched = true;
  } else if (hasIntent(text, [
    /\bnext heading\b/, /\bnext section\b/, /\bnext part\b/, /\bmove forward a section\b/,
    /\btitre suivant\b/, /\bsection suivante\b/,
    /العنوان التالي|القسم التالي/
  ])) {
    steps.push({ action: 'move_heading', direction: 'next' });
    matched = true;
  } else if (hasIntent(text, [
    /\bprevious heading\b/, /\bprev heading\b/, /\bprevious section\b/, /\bgo back a section\b/, /\blast section\b/,
    /\btitre pr[ée]c[ée]dent\b/, /\bsection pr[ée]c[ée]dente\b/,
    /العنوان السابق|القسم السابق/
  ])) {
    steps.push({ action: 'move_heading', direction: 'prev' });
    matched = true;
  } else {
    const target = isTargetSelectionIntent(text) ? chooseIntentTarget(text, structure) : null;
    if (target) {
      matched = true;
      if (target.target === 'heading') {
        steps.push({ action: 'focus_element', target: 'heading', label: target.label });
      } else if (/\bfocus\b/.test(text)) {
        steps.push({ action: 'focus_element', target: target.target, label: target.label });
      } else if (target.target === 'input') {
        steps.push({ action: 'focus_element', target: 'input', label: target.label });
      } else {
        steps.push({ action: 'click_element', target: target.target, label: target.label });
      }
    } else if (!preferIntentFallback) {
      description = outputMessage('try_commands', outputLanguage);
    }
  }

  return { description, steps, matched };
}

function isSummaryCommandText(text) {
  const t = String(text || '').toLowerCase();
  if (!t) return false;
  return (
    t.includes('summarize') ||
    t.includes('summary') ||
    t.includes('describe this page') ||
    t.includes('describe the page') ||
    t.includes('what is this page') ||
    t.includes("what's on this page") ||
    t.includes('what is on this page') ||
    t.includes("what's this page") ||
    /r[ée]sum[ée]?.*cette page/.test(t) ||
    /d[ée]cri(s|re).*cette page/.test(t) ||
    /c[' ]?est quoi cette page/.test(t) ||
    /qu[' ]?est[- ]ce que cette page/.test(t) ||
    /ما هذه الصفحه/.test(t) ||
    /ما هذه الصفحة/.test(t) ||
    /ما هو محتوى الصفحة/.test(t) ||
    /ملخص/.test(t) ||
    /وصف الصفحة/.test(t)
  );
}

function isCurrentPageReferenceText(text) {
  const t = String(text || '').trim().toLowerCase();
  if (!t) return false;
  return (
    /\b(?:this|current)\s+(?:page|screen|site)\b/.test(t) ||
    /\b(?:on|in)\s+(?:this|the current)\s+(?:page|screen|site)\b/.test(t) ||
    /\b(?:sur|dans)\s+(?:cette|la)\s+(?:page|ecran|écran|site)\b/.test(t) ||
    /(?:في|على|ب)\s+(?:هاي|هذه|هاد|هذي)\s+(?:الصفحة|الشاشة|الموقع)/.test(t) ||
    /(?:الصفحة|الشاشة|الموقع)\s+(?:الحالية|هاي|هذه)/.test(t)
  );
}

function isPageQuestionRequestText(text) {
  const t = String(text || '').trim().toLowerCase();
  if (!t || !isCurrentPageReferenceText(t)) return false;
  return (
    /\b(answer|correct answer|question|quiz|exercise|problem|prompt|choice|choices|option|options|solve|read|explain)\b/.test(t) ||
    /\b(r[ée]ponse|question|quiz|exercice|probl[èe]me|choix|option|options|r[ée]soudre|lire|explique)\b/.test(t) ||
    /(سؤال|اسئلة|أسئلة|جواب|الجواب|إجابة|اجابة|حل|خيارات|خيار|اختيار|اقر[أا]|اشرح)/.test(t)
  );
}

function isPageAssistantRequestText(text) {
  const t = String(text || '').trim().toLowerCase();
  if (!t) return false;
  if (isSummaryCommandText(t)) return true;
  if (isPageQuestionRequestText(t)) return true;
  return (
    /\b(where am i|help me here|help on this page|help on this site|what can i do here|what can i do on this page|what can i do on this site|what is important here|what's important here|what is important on this page|what's important on this page|tell me about this page|tell me about the page|guide me here|what am i looking at|what is on this screen|what's on this screen|what is here|what's here)\b/.test(t) ||
    /\b(o[uù] suis[- ]?je|aide[- ]?moi ici|que puis[- ]je faire ici|que puis[- ]je faire sur cette page|qu[' ]?est[- ]ce qui est important ici|qu[' ]?est[- ]ce qui est important sur cette page|parle[- ]?moi de cette page|guide[- ]?moi ici|qu[' ]?y a[- ]t[- ]il ici)\b/.test(t) ||
    /(أين أنا|اين انا|ساعدني هنا|ساعدني هون|ماذا يمكنني أن أفعل هنا|ماذا يمكنني ان افعل هنا|شو المهم هون|ايش المهم هون|شو المهم هنا|ايش المهم هنا|احكيلي عن (?:هاي|هذه) الصفحة|احكيلي عن ه(?:اي|ذا) الموقع|دلني هون|دلني هنا|وجهني هون|وجهني هنا|شو في هون|ايش في هون|شو الموجود هون|ايش الموجود هون)/.test(t)
  );
}

function isSessionFollowUpText(text) {
  const t = String(text || '').trim().toLowerCase();
  if (!t) return false;
  return (
    /^(tell me more|more detail|more details|go on|continue|keep going|expand that|what about that|what about it|and then)\b/.test(t) ||
    /^(dis[- ]?m[' ]?en plus|plus de d[ée]tails|continue|vas[- ]?y|et ensuite)\b/.test(t) ||
    /^(احكيلي اكثر|احكيلي المزيد|زيدني|كم[ّ]?ل|كمل|ماذا عن ذلك|شو كمان|ايش كمان)\b/.test(t)
  );
}

function trimSessionText(text, maxLen = 240) {
  const raw = String(text || '').replace(/\s+/g, ' ').trim();
  if (!raw) return '';
  return raw.length > maxLen ? `${raw.slice(0, Math.max(0, maxLen - 3)).trim()}...` : raw;
}

function hostForUrl(url) {
  try {
    return new URL(String(url || '')).hostname.toLowerCase();
  } catch (_err) {
    return '';
  }
}

function extractReferencedEntity(text) {
  const raw = trimSessionText(text, 160);
  if (!raw || isSessionFollowUpText(raw)) return '';
  const cleaned = trimSessionText(
    raw
      .replace(/^[“"'`]+|[”"'`]+$/g, '')
      .replace(/^(who|what|when|where|why|how)\s+(is|are|was|were)\s+/i, '')
      .replace(/^(explain|define|compare|tell me about|more about|what about)\s+/i, '')
      .replace(/^(qui|que|qu[' ]?est[- ]?ce que|qu[' ]?est-ce que|explique|definis|définis|compare|parle[- ]?moi de|dis[- ]?moi)\s+/i, '')
      .replace(/^(من|ما هو|ما هي|ما|اشرح|عر[ّ]ف|عرف|احكيلي عن|قل لي عن|خبرني عن|شو هو|ايش هو)\s+/i, '')
      .replace(/^(the|a|an|le|la|les|un|une|ال)\s+/i, '')
      .replace(/[?!.]+$/g, ''),
    80
  );
  return cleaned;
}

function isSensitivePageStructure(structure) {
  const privacy = structure && structure.privacy ? structure.privacy : {};
  return !!(privacy && (privacy.sensitivePage || Number(privacy.sensitiveInputCount || 0) > 0));
}

function sanitizePageMemory(structure, summaryText) {
  if (!structure) return null;
  const privacy = structure && structure.privacy ? structure.privacy : {};
  const sensitiveInputCount = Math.max(0, Number(privacy.sensitiveInputCount || 0));
  const sensitivePage = isSensitivePageStructure(structure);
  return {
    url: trimSessionText(structure.url, 280),
    host: hostForUrl(structure.url),
    title: trimSessionText(structure.title, 120),
    topHeading: trimSessionText(structure && structure.headings && structure.headings[0] ? structure.headings[0].label : '', 120),
    activeLabel: sensitivePage ? '' : trimSessionText(structure.activeLabel, 120),
    summary: sensitivePage ? '' : trimSessionText(summaryText, 260),
    sensitivePage,
    sensitiveInputCount
  };
}

const SESSION_TTL_MS = 15 * 60 * 1000;
const DOMAIN_HABIT_TTL_MS = 24 * 60 * 60 * 1000;
const GLOBAL_SESSION_KEY = '__global__';
const SESSION_STORAGE_PREFIX = 'navable.session.';
const DOMAIN_HABIT_STORAGE_PREFIX = 'navable.domainHabit.';
const assistantSessionFallback = new Map();
const domainHabitFallback = new Map();

function sessionKeyForSource(sourceTabId) {
  return sourceTabId || GLOBAL_SESSION_KEY;
}

function assistantSessionStorageKey(sourceTabId) {
  return `${SESSION_STORAGE_PREFIX}${sessionKeyForSource(sourceTabId)}`;
}

function domainHabitStorageKey(host) {
  return `${DOMAIN_HABIT_STORAGE_PREFIX}${String(host || '').trim().toLowerCase()}`;
}

function sessionStorageArea() {
  try {
    return chrome && chrome.storage && chrome.storage.session && typeof chrome.storage.session.get === 'function'
      ? chrome.storage.session
      : null;
  } catch (_err) {
    return null;
  }
}

function storageAreaGet(area, query) {
  return new Promise((resolve) => {
    if (!area || typeof area.get !== 'function') {
      resolve({});
      return;
    }
    try {
      area.get(query, (res) => {
        resolve(res || {});
      });
    } catch (_err) {
      resolve({});
    }
  });
}

function storageAreaSet(area, items) {
  return new Promise((resolve) => {
    if (!area || typeof area.set !== 'function') {
      resolve();
      return;
    }
    try {
      area.set(items, () => resolve());
    } catch (_err) {
      resolve();
    }
  });
}

function storageAreaRemove(area, keys) {
  return new Promise((resolve) => {
    if (!area || typeof area.remove !== 'function') {
      resolve();
      return;
    }
    try {
      area.remove(keys, () => resolve());
    } catch (_err) {
      resolve();
    }
  });
}

async function readScopedMemory(storageKey, fallbackMap, ttlMs) {
  const now = Date.now();
  const area = sessionStorageArea();
  if (area) {
    const result = await storageAreaGet(area, { [storageKey]: null });
    const value = result && Object.prototype.hasOwnProperty.call(result, storageKey) ? result[storageKey] : null;
    if (value && value.updatedAt && now - value.updatedAt <= ttlMs) {
      return { ...value };
    }
    if (value) {
      await storageAreaRemove(area, [storageKey]);
    }
    return null;
  }
  const fallback = fallbackMap.get(storageKey);
  if (fallback && fallback.updatedAt && now - fallback.updatedAt <= ttlMs) {
    return { ...fallback };
  }
  fallbackMap.delete(storageKey);
  return null;
}

async function writeScopedMemory(storageKey, value, fallbackMap) {
  const normalized = {
    ...(value || {}),
    updatedAt: Date.now()
  };
  const area = sessionStorageArea();
  if (area) {
    await storageAreaSet(area, { [storageKey]: normalized });
    return normalized;
  }
  fallbackMap.set(storageKey, normalized);
  return normalized;
}

async function removeScopedMemory(storageKey, fallbackMap) {
  fallbackMap.delete(storageKey);
  const area = sessionStorageArea();
  if (area) {
    await storageAreaRemove(area, [storageKey]);
  }
}

async function getAssistantSession(sourceTabId) {
  return await readScopedMemory(
    assistantSessionStorageKey(sourceTabId),
    assistantSessionFallback,
    SESSION_TTL_MS
  );
}

async function setAssistantSession(sourceTabId, session) {
  return await writeScopedMemory(
    assistantSessionStorageKey(sourceTabId),
    session,
    assistantSessionFallback
  );
}

async function clearAssistantSession(sourceTabId) {
  await removeScopedMemory(
    assistantSessionStorageKey(sourceTabId),
    assistantSessionFallback
  );
}

async function ensureDomainHabit(host) {
  const normalizedHost = String(host || '').trim().toLowerCase();
  if (!normalizedHost) return null;
  const existing = await readScopedMemory(
    domainHabitStorageKey(normalizedHost),
    domainHabitFallback,
    DOMAIN_HABIT_TTL_MS
  );
  if (existing) return existing;
  return {
    host: normalizedHost,
    updatedAt: 0,
    purposeCounts: { answer: 0, page: 0, summary: 0 },
    lastEntity: '',
    lastPageTitle: '',
    lastAction: ''
  };
}

function dominantDomainPurpose(entry) {
  if (!entry || !entry.purposeCounts) return '';
  const counts = entry.purposeCounts;
  const order = ['answer', 'page', 'summary'];
  let best = '';
  let bestCount = 0;
  order.forEach((purpose) => {
    const count = Number(counts[purpose] || 0);
    if (count > bestCount) {
      best = purpose;
      bestCount = count;
    }
  });
  return best;
}

async function recordDomainHabit(host, updates = {}) {
  const entry = await ensureDomainHabit(host);
  if (!entry) return;
  entry.updatedAt = Date.now();
  if (updates.purpose && Object.prototype.hasOwnProperty.call(entry.purposeCounts, updates.purpose)) {
    entry.purposeCounts[updates.purpose] += 1;
  }
  if (updates.entity) entry.lastEntity = trimSessionText(updates.entity, 80);
  if (updates.pageTitle) entry.lastPageTitle = trimSessionText(updates.pageTitle, 120);
  if (updates.action) entry.lastAction = trimSessionText(updates.action, 120);
  await writeScopedMemory(domainHabitStorageKey(entry.host), entry, domainHabitFallback);
}

async function buildDomainHabitSnapshot(host) {
  const entry = await ensureDomainHabit(host);
  if (!entry) return null;
  return {
    host: entry.host,
    dominantPurpose: dominantDomainPurpose(entry),
    lastEntity: trimSessionText(entry.lastEntity, 80),
    lastPageTitle: trimSessionText(entry.lastPageTitle, 120),
    lastAction: trimSessionText(entry.lastAction, 120)
  };
}

function hostFromSessionRequest(options = {}, structure = null) {
  return hostForUrl(
    options.pageUrl ||
    (structure && structure.url ? structure.url : '') ||
    (options.pageStructure && options.pageStructure.url ? options.pageStructure.url : '')
  );
}

async function buildSessionContext(sourceTabId) {
  const session = await getAssistantSession(sourceTabId);
  if (!session) return null;
  const host = session.host || (session.lastPage && session.lastPage.host) || '';
  return {
    lastPurpose: session.lastPurpose || '',
    lastUserUtterance: session.lastInput || '',
    lastEntity: session.lastEntity || '',
    lastAssistantReply: session.lastAssistantSpeech || '',
    lastAnswer: session.lastAnswer || '',
    lastPage: session.lastPage || null,
    lastAction: session.lastAction || '',
    outputLanguage: session.outputLanguage || '',
    detectedLanguage: session.detectedLanguage || '',
    recognitionProvider: session.recognitionProvider || '',
    domainHabits: await buildDomainHabitSnapshot(host)
  };
}

async function rememberAssistantTurn(sourceTabId, info = {}) {
  const existing = await getAssistantSession(sourceTabId) || {};
  const input = trimSessionText(info.input, 180);
  const purpose = info.purpose || existing.lastPurpose || '';
  const summary = trimSessionText(info.summary, 260);
  const answer = trimSessionText(info.answer, 260);
  const speech = trimSessionText(info.speech || info.description || answer || summary, 260);
  const pageMemory = info.structure
    ? sanitizePageMemory(info.structure, summary || speech)
    : (existing.lastPage || null);
  const host = hostForUrl((pageMemory && pageMemory.url) || info.pageUrl || existing.host || '');
  const entity = extractReferencedEntity(info.input) || existing.lastEntity || '';
  const action = trimSessionText(
    info.action ||
      (info.plan && info.plan.steps && info.plan.steps.length && info.plan.steps[0] && info.plan.steps[0].action
        ? info.plan.steps[0].action
        : '') ||
      existing.lastAction,
    120
  );

  await setAssistantSession(sourceTabId, {
    host,
    lastPurpose: purpose,
    lastInput: input || existing.lastInput || '',
    lastEntity: entity,
    lastAssistantSpeech: speech || existing.lastAssistantSpeech || '',
    lastAnswer: answer || existing.lastAnswer || '',
    lastSummary: summary || existing.lastSummary || '',
    lastAction: action,
    outputLanguage: info.outputLanguage || existing.outputLanguage || '',
    detectedLanguage: info.detectedLanguage || existing.detectedLanguage || '',
    recognitionProvider: info.recognitionProvider || existing.recognitionProvider || '',
    lastPage: pageMemory
  });

  if (host) {
    await recordDomainHabit(host, {
      purpose: purpose === 'summary' ? 'summary' : purpose === 'page' ? 'page' : purpose === 'answer' ? 'answer' : '',
      entity,
      pageTitle: pageMemory && !pageMemory.sensitivePage ? pageMemory.title : '',
      action
    });
  }
}

async function rememberActionTurn(sourceTabId, info = {}) {
  const existing = await getAssistantSession(sourceTabId) || {};
  const pageMemory = info.structure ? sanitizePageMemory(info.structure, '') : (existing.lastPage || null);
  const host = hostForUrl((pageMemory && pageMemory.url) || info.url || existing.host || '');
  const action = trimSessionText(info.action, 120);
  await setAssistantSession(sourceTabId, {
    host,
    lastPurpose: existing.lastPurpose || '',
    lastInput: existing.lastInput || '',
    lastEntity: existing.lastEntity || '',
    lastAssistantSpeech: existing.lastAssistantSpeech || '',
    lastAnswer: existing.lastAnswer || '',
    lastSummary: existing.lastSummary || '',
    lastAction: action || existing.lastAction || '',
    outputLanguage: info.outputLanguage || existing.outputLanguage || '',
    detectedLanguage: existing.detectedLanguage || '',
    recognitionProvider: existing.recognitionProvider || '',
    lastPage: pageMemory
  });
  if (host && action) {
    await recordDomainHabit(host, {
      pageTitle: pageMemory && !pageMemory.sensitivePage ? pageMemory.title : '',
      action
    });
  }
}

function assistantPurposeForText(text, includePageContext, explicitPurpose, session) {
  const rawPurpose = typeof explicitPurpose === 'string' ? String(explicitPurpose).trim().toLowerCase() : '';
  if (rawPurpose === 'summary' || rawPurpose === 'page') return rawPurpose;
  if (rawPurpose === 'answer' && !isPageAssistantRequestText(text)) return rawPurpose;
  if (isSummaryCommandText(text)) return 'summary';
  if (isPageAssistantRequestText(text)) return 'page';
  if (isSessionFollowUpText(text)) {
    const priorPurpose = session && session.lastPurpose ? String(session.lastPurpose).trim().toLowerCase() : '';
    if (priorPurpose === 'summary' || priorPurpose === 'page') return 'page';
    if (priorPurpose === 'answer') return 'answer';
  }
  if (rawPurpose === 'answer') return rawPurpose;
  if (!includePageContext) return 'answer';
  return 'answer';
}

function buildFriendlyOrientation(structure, outputLanguage) {
  if (!structure) return outputMessage('summary_unavailable', outputLanguage);
  const counts = structure.counts || {};
  const title = structure.title
    ? outputMessage('title_value', outputLanguage, { value: structure.title })
    : outputMessage('no_title', outputLanguage);
  const basics = outputMessage('counts_value', outputLanguage, {
    headings: counts.headings || 0,
    links: counts.links || 0,
    buttons: counts.buttons || 0
  });
  const topHeading =
    structure.headings && structure.headings.length
      ? outputMessage('top_heading', outputLanguage, { value: structure.headings[0].label })
      : '';
  const excerpt = structure.excerpt
    ? outputMessage('excerpt_value', outputLanguage, { value: structure.excerpt.slice(0, 220) })
    : '';
  return [title, basics, topHeading, excerpt].filter(Boolean).join(' ');
}

const summaryCache = { url: null, outputLanguage: 'en', ts: 0, result: null };

async function loadSettings() {
  return new Promise((resolve) => {
    if (!chrome.storage || !chrome.storage.sync) {
      resolve({});
      return;
    }
    chrome.storage.sync.get({ navable_settings: {} }, (res) => {
      resolve(res && res.navable_settings ? res.navable_settings : {});
    });
  });
}

function normalizeAssistantAction(data) {
  const raw = data && data.action && typeof data.action === 'object' ? data.action : null;
  if (!raw || Array.isArray(raw)) return null;
  const type = typeof raw.type === 'string' ? raw.type.trim().toLowerCase() : '';
  if (type !== 'open_site') return null;
  const query = typeof raw.query === 'string' ? raw.query.trim() : '';
  if (!query) return null;
  return {
    type: 'open_site',
    query,
    newTab: raw.newTab !== false
  };
}

function stripOpenIntentPrefixes(text) {
  let value = String(text || '').trim().toLowerCase();
  if (!value) return '';

  const prefixes = [
    /^(?:hey\s+navable|navable|please|pls)\b[\s,]*/,
    /^(?:can you|could you|would you|will you)\b[\s,]*/,
    /^(?:peux[- ]?tu|pourrais[- ]?tu|tu peux|svp|stp|s['’]?il te pla[îi]t)\b[\s,]*/,
    /^(?:لو سمحت|من فضلك|رجاءً?|رجاء|ممكن|بتقدر|تقدر)\b[\s،]*/
  ];

  let changed = true;
  while (changed) {
    changed = false;
    for (const pattern of prefixes) {
      const next = value.replace(pattern, '').trim();
      if (next !== value) {
        value = next;
        changed = true;
      }
    }
  }

  return value;
}

function extractAssistantOpenSiteQuery(text) {
  const normalized = stripOpenIntentPrefixes(text);
  if (!normalized) return null;

  const ar = normalized.match(/^(افتح(?:\s+لي)?|خذني\s+على|خذني\s+إلى|خذني\s+الى|وديني\s+على|وديني\s+إلى|وديني\s+الى|اذهب\s+إلى|اذهب\s+الى|روح\s+على|روح\s+إلى|روح\s+الى|انتقل\s+إلى|انتقل\s+الى|خليني\s+أروح\s+على|خليني\s+اروح\s+على|خلينا\s+نروح\s+على)\s+(.+)$/);
  if (ar && ar[2]) return String(ar[2]).trim();

  const fr = normalized.match(/^(ouvre|va(?:s)?\s+(?:a|à)|aller?\s+(?:a|à)|visite|lance)\s+(.+)$/);
  if (fr && fr[2]) {
    return String(fr[2])
      .trim()
      .replace(/^(le|la|les|un|une)\b/, '')
      .trim()
      .replace(/^(site|page|onglet|application|appli)\b/, '')
      .trim();
  }

  const en = normalized.match(/^(open(?:\s+up)?|navigate to|go to|take me to|visit|bring up|launch|pull up)\s+(.+)$/);
  if (!en || !en[2]) return null;

  const query = String(en[2])
    .trim()
    .replace(/^(me|for me)\b/, '')
    .trim()
    .replace(/^(a|an|the)\b/, '')
    .trim()
    .replace(/^(new\s+)?tab\b/, '')
    .trim()
    .replace(/^(website|site|page|app)\b/, '')
    .trim()
    .replace(/\bfor me\b/g, '')
    .trim()
    .replace(/\bplease\b/g, '')
    .trim();

  return query || null;
}

function normalizeAssistantResult(data) {
  const summary = data && typeof data.summary === 'string' ? data.summary.trim() : '';
  const answer = data && typeof data.answer === 'string' ? data.answer.trim() : '';
  const speech = data && typeof data.speech === 'string' ? data.speech.trim() : '';
  const suggestions = Array.isArray(data && data.suggestions) ? data.suggestions : [];
  const plan = data && data.plan && Array.isArray(data.plan.steps) ? data.plan : { steps: [] };
  const action = normalizeAssistantAction(data);
  const description = speech || [summary, suggestions.join(' ')].filter(Boolean).join(' ').trim();
  return {
    mode: data && typeof data.mode === 'string' ? data.mode : 'answer',
    speech: description,
    description,
    summary,
    answer,
    suggestions,
    plan,
    action
  };
}

async function requestAssistant(input, requestedOutputLanguage, options = {}) {
  const settings = options.settings || await loadSettings();
  const outputLanguage = configuredOutputLanguage(settings, requestedOutputLanguage);
  const outputMessagesReady = ensureOutputMessages(outputLanguage);
  const text = String(input || '').trim();
  const sourceTabId = options.sourceTabId || null;
  const requestHost = hostFromSessionRequest(options);
  let previousSession = await getAssistantSession(sourceTabId);
  if (previousSession && requestHost && previousSession.host && previousSession.host !== requestHost) {
    await clearAssistantSession(sourceTabId);
    previousSession = null;
  }
  const purpose = assistantPurposeForText(text, !!options.includePageContext, options.purpose, previousSession);
  const shouldIncludePageContext = purpose === 'summary' || purpose === 'page';
  const sessionContext = await buildSessionContext(sourceTabId);

  if (!text) {
    await outputMessagesReady;
    return { ok: false, error: outputMessage('answer_unavailable', outputLanguage) };
  }

  const directOpenQuery = extractAssistantOpenSiteQuery(text);
  if (directOpenQuery) {
    const action = { type: 'open_site', query: directOpenQuery, newTab: true };
    const openResult = await openSiteInBrowser(directOpenQuery, true, outputLanguage, {
      sourceTabId,
      announce: false
    });
    if (!openResult.ok) {
      return { ok: false, error: openResult.error || outputMessage('open_website_failed', outputLanguage) };
    }

    await rememberAssistantTurn(sourceTabId, {
      input: text,
      purpose: 'answer',
      outputLanguage,
      speech: openResult.speech || '',
      detectedLanguage: options.detectedLanguage || '',
      recognitionProvider: options.recognitionProvider || '',
      pageUrl: openResult.url || ''
    });

    return {
      ok: true,
      structure: null,
      mode: 'action',
      speech: openResult.speech || '',
      description: openResult.speech || '',
      summary: '',
      answer: '',
      suggestions: [],
      plan: { steps: [] },
      action,
      url: openResult.url || ''
    };
  }

  let structure = shouldIncludePageContext ? (options.pageStructure || null) : null;
  if (!structure && shouldIncludePageContext) {
    try {
      const structureRes = await sendToTargetTab(sourceTabId, { type: 'navable:getStructure' });
      structure = structureRes && structureRes.structure ? structureRes.structure : null;
    } catch (_err) {
      structure = null;
    }
  }

  try {
    const response = await fetch('http://localhost:3000/api/assistant', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: text,
        outputLanguage,
        pageStructure: structure,
        purpose,
        sessionContext
      })
    });
    const data = await response.json().catch(() => ({}));
    if (response.ok) {
      const normalized = normalizeAssistantResult(data);
      if (normalized.action && normalized.action.type === 'open_site') {
        const openResult = await openSiteInBrowser(
          normalized.action.query,
          normalized.action.newTab,
          outputLanguage,
          { sourceTabId, announce: false }
        );
        if (!openResult.ok) {
          return { ok: false, structure, error: openResult.error || outputMessage('open_website_failed', outputLanguage) };
        }

        const actionSpeech = openResult.speech || normalized.speech || '';
        await rememberAssistantTurn(sourceTabId, {
          input: text,
          purpose: 'answer',
          outputLanguage,
          speech: actionSpeech,
          detectedLanguage: options.detectedLanguage || '',
          recognitionProvider: options.recognitionProvider || '',
          pageUrl: openResult.url || ''
        });

        return {
          ok: true,
          structure,
          mode: 'action',
          speech: actionSpeech,
          description: actionSpeech,
          summary: '',
          answer: '',
          suggestions: [],
          plan: { steps: [] },
          action: normalized.action,
          url: openResult.url || ''
        };
      }

      await rememberAssistantTurn(sourceTabId, {
        input: text,
        purpose,
        outputLanguage,
        structure,
        speech: normalized.speech,
        description: normalized.description,
        summary: normalized.summary,
        answer: normalized.answer,
        plan: normalized.plan,
        detectedLanguage: options.detectedLanguage || '',
        recognitionProvider: options.recognitionProvider || '',
        pageUrl: options.pageUrl || (structure && structure.url ? structure.url : '')
      });
      return { ok: true, structure, ...normalized };
    }
    if (data && typeof data.error === 'string' && data.error.trim()) {
      return { ok: false, structure, error: data.error.trim() };
    }
  } catch (err) {
    console.warn('[Navable] assistant backend failed', err);
  }

  await outputMessagesReady;
  return { ok: false, structure, error: outputMessage('answer_unavailable', outputLanguage) };
}

async function runPlanner(command, requestedOutputLanguage, preferIntentFallback, options = {}) {
  const settings = await loadSettings();
  const outputLanguage = configuredOutputLanguage(settings, requestedOutputLanguage);
  const outputMessagesReady = ensureOutputMessages(outputLanguage);
  const sourceTabId = options.sourceTabId || null;
  let structure = options.pageStructure || null;
  if (!structure) {
    const structureRes = await sendToTargetTab(sourceTabId, { type: 'navable:getStructure' });
    structure = structureRes && structureRes.structure ? structureRes.structure : null;
  }
  const text = String(command || '').toLowerCase();
  const isSummaryRequest = isSummaryCommandText(text);

  // If the user asks to summarize/summary, prefer backend AI + plan where allowed by settings.
  if (isSummaryRequest) {
    const aiMode = settings.aiMode || 'off';
    const canUseCache =
      summaryCache.url &&
      structure &&
      structure.url &&
      summaryCache.url === structure.url &&
      summaryCache.outputLanguage === outputLanguage &&
      Date.now() - summaryCache.ts < 2 * 60 * 1000;

    if (!!settings.aiEnabled && aiMode !== 'off') {
      if (canUseCache && summaryCache.result) {
        const cached = summaryCache.result;
        if (cached.description) {
          await sendToTargetTab(sourceTabId, {
            type: 'navable:announce',
            text: cached.description,
            mode: 'assertive',
            lang: outputLocale(outputLanguage)
          });
        }
        if (aiMode === 'summary_plan' && cached.plan && cached.plan.steps && cached.plan.steps.length) {
          await sendToTargetTab(sourceTabId, {
            type: 'navable:executePlan',
            plan: cached.plan,
            silentOutput: true
          });
        }
        return { ...cached, structure, cached: true, ok: true };
      }

      const assistantResult = await requestAssistant(command || 'Summarize this page', outputLanguage, {
        settings,
        pageStructure: structure,
        sourceTabId,
        purpose: 'summary'
      });

      if (assistantResult.ok && (assistantResult.summary || assistantResult.description)) {
        const summaryText = assistantResult.summary ? assistantResult.summary.trim() : assistantResult.description.trim();
        const suggestionsText =
          assistantResult.suggestions && assistantResult.suggestions.length
            ? ' Suggestions: ' + assistantResult.suggestions.join(' ')
            : '';
        const description = (summaryText + suggestionsText).trim();

        if (description) {
          await sendToTargetTab(sourceTabId, {
            type: 'navable:announce',
            text: description,
            mode: 'assertive',
            lang: outputLocale(outputLanguage)
          });
        }
        if (
          aiMode === 'summary_plan' &&
          assistantResult.plan &&
          assistantResult.plan.steps &&
          assistantResult.plan.steps.length
        ) {
          await sendToTargetTab(sourceTabId, {
            type: 'navable:executePlan',
            plan: assistantResult.plan,
            silentOutput: true
          });
        }

        const result = {
          ok: true,
          plan: assistantResult.plan,
          structure,
          description,
          summary: summaryText,
          suggestions: assistantResult.suggestions
        };
        summaryCache.url = structure && structure.url ? structure.url : null;
        summaryCache.outputLanguage = outputLanguage;
        summaryCache.ts = Date.now();
        summaryCache.result = result;
        return result;
      }
      // If AI path fails, fall back to local stub planner.
    } else {
      // AI disabled: give a friendly orientation and tell the user how to enable AI.
      await outputMessagesReady;
      const description = `${buildFriendlyOrientation(structure, outputLanguage)} ${outputMessage('ai_summaries_off', outputLanguage)}`;
      await sendToTargetTab(sourceTabId, {
        type: 'navable:announce',
        text: description,
        mode: 'assertive',
        lang: outputLocale(outputLanguage)
      });
      await rememberAssistantTurn(sourceTabId, {
        input: command,
        purpose: 'summary',
        outputLanguage,
        structure,
        speech: description,
        summary: description,
        pageUrl: structure && structure.url ? structure.url : ''
      });
      return {
        ok: true,
        plan: { steps: [] },
        structure,
        description,
        summary: description,
        suggestions: []
      };
    }
  }

  const plan = stubPlanner(command, structure, outputLanguage, !!preferIntentFallback);

  if (preferIntentFallback && !plan.matched && !plan.description && (!plan.steps || !plan.steps.length)) {
    return { ok: false, error: 'Intent not understood', unhandled: true, plan: { steps: [] }, structure };
  }

  if (plan.description) {
    await outputMessagesReady;
    await sendToTargetTab(sourceTabId, {
      type: 'navable:announce',
      text: plan.description,
      mode: isSummaryRequest ? 'assertive' : 'polite',
      lang: outputLocale(outputLanguage)
    });
  }
  if (plan.steps && plan.steps.length) {
    await sendToTargetTab(sourceTabId, { type: 'navable:executePlan', plan: { steps: plan.steps } });
  }

  if (isSummaryRequest || plan.description) {
    await rememberAssistantTurn(sourceTabId, {
      input: command,
      purpose: isSummaryRequest ? 'summary' : 'page',
      outputLanguage,
      structure,
      speech: plan.description || '',
      summary: plan.description || '',
      plan,
      pageUrl: structure && structure.url ? structure.url : ''
    });
  } else if (plan.steps && plan.steps.length) {
    await rememberActionTurn(sourceTabId, {
      action: plan.steps[0].action || '',
      outputLanguage,
      structure
    });
  }

  return { ok: true, plan, structure };
}

function normalizeSpokenUrl(query) {
  let s = String(query || '').trim();
  if (!s) return '';
  s = s.replace(/^[\s"'“”‘’]+|[\s"'“”‘’]+$/g, '').trim();
  s = s.replace(/\s+/g, ' ');
  const lower = s.toLowerCase();

  // If the user speaks a URL: "example dot com slash login"
  let out = lower;
  out = out.replace(/\s+dot\s+/g, '.');
  out = out.replace(/\s+point\s+/g, '.');
  out = out.replace(/\s+slash\s+/g, '/');
  out = out.replace(/\s+colon\s+/g, ':');
  out = out.replace(/\s*\/\s*/g, '/');
  out = out.replace(/\s*\.\s*/g, '.');
  out = out.replace(/\s*:\s*/g, ':');
  return out.trim();
}

const KNOWN_SITE_ALIASES = {
  youtube: 'https://www.youtube.com/',
  'you tube': 'https://www.youtube.com/',
  'يوتيوب': 'https://www.youtube.com/',
  'اليوتيوب': 'https://www.youtube.com/',
  google: 'https://www.google.com/',
  'جوجل': 'https://www.google.com/',
  'غوغل': 'https://www.google.com/',
  gmail: 'https://mail.google.com/',
  'google mail': 'https://mail.google.com/',
  'جي ميل': 'https://mail.google.com/',
  'جيميل': 'https://mail.google.com/',
  facebook: 'https://www.facebook.com/',
  'فيسبوك': 'https://www.facebook.com/',
  'فيس بوك': 'https://www.facebook.com/',
  instagram: 'https://www.instagram.com/',
  'انستغرام': 'https://www.instagram.com/',
  'انستجرام': 'https://www.instagram.com/',
  whatsapp: 'https://web.whatsapp.com/',
  'واتساب': 'https://web.whatsapp.com/',
  twitter: 'https://x.com/',
  x: 'https://x.com/',
  'تويتر': 'https://x.com/',
  'تيكتوك': 'https://www.tiktok.com/',
  'تيك توك': 'https://www.tiktok.com/',
  tiktok: 'https://www.tiktok.com/',
  linkedin: 'https://www.linkedin.com/',
  'لينكدان': 'https://www.linkedin.com/',
  reddit: 'https://www.reddit.com/',
  'ريديت': 'https://www.reddit.com/',
  wikipedia: 'https://www.wikipedia.org/',
  'ويكيبيديا': 'https://www.wikipedia.org/',
  amazon: 'https://www.amazon.com/',
  'امازون': 'https://www.amazon.com/',
  amazonprime: 'https://www.amazon.com/',
  netflix: 'https://www.netflix.com/',
  'نتفليكس': 'https://www.netflix.com/',
  spotify: 'https://open.spotify.com/',
  'سبوتيفاي': 'https://open.spotify.com/',
  github: 'https://github.com/',
  'جيتهاب': 'https://github.com/',
  'جيت هب': 'https://github.com/',
  'stack overflow': 'https://stackoverflow.com/',
  stackoverflow: 'https://stackoverflow.com/',
  'chat gpt': 'https://chatgpt.com/',
  chatgpt: 'https://chatgpt.com/',
  'شات جي بي تي': 'https://chatgpt.com/',
  'تشات جي بي تي': 'https://chatgpt.com/'
};

function normalizeNamedSiteQuery(query) {
  let s = normalizeSpokenUrl(query);
  if (!s) return '';
  s = s
    .replace(/^(the|a|an)\s+/g, '')
    .replace(/^(site|website|page|app)\s+/g, '')
    .replace(/^(le|la|les|un|une)\s+/g, '')
    .replace(/^(site\s+web|site|page|application|appli|onglet)\s+/g, '')
    .replace(/^(موقع|الموقع|صفحة|الصفحة|تطبيق|التطبيق)\s+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return s;
}

function resolveNamedSiteUrl(query) {
  const normalized = normalizeNamedSiteQuery(query);
  if (!normalized) return null;
  if (KNOWN_SITE_ALIASES[normalized]) return KNOWN_SITE_ALIASES[normalized];

  const withoutArticle = normalized
    .replace(/^(the|le|la|les)\s+/g, '')
    .replace(/^ال/g, '')
    .trim();
  if (KNOWN_SITE_ALIASES[withoutArticle]) return KNOWN_SITE_ALIASES[withoutArticle];

  const squeezed = withoutArticle.replace(/\s+/g, '');
  if (KNOWN_SITE_ALIASES[squeezed]) return KNOWN_SITE_ALIASES[squeezed];

  return null;
}

function stripDiacritics(value) {
  const text = String(value || '');
  if (!text) return '';
  try {
    return text.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  } catch (_e) {
    return text;
  }
}

function guessDirectHostUrl(query) {
  const normalized = normalizeNamedSiteQuery(query);
  if (!normalized) return null;
  if (Array.from(normalized).some((ch) => ch.charCodeAt(0) > 127)) return null;

  const ascii = stripDiacritics(normalized)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!ascii) return null;

  const tokens = ascii.split(' ').filter(Boolean);
  if (!tokens.length) return null;

  const joined = tokens.join('');
  if (!/^[a-z0-9-]+$/.test(joined)) return null;
  if (joined.length < 2) return `https://${joined}.com/`;
  return `https://www.${joined}.com/`;
}

function resolveDirectOpenFallbackUrl(query) {
  const directGuess = guessDirectHostUrl(query);
  if (directGuess) return directGuess;
  return `https://www.google.com/search?btnI=I&q=${encodeURIComponent(`${String(query || '').trim()} official site`)}`;
}

function tryParseHttpUrl(candidate) {
  try {
    const u = new URL(candidate);
    if (u.protocol === 'http:' || u.protocol === 'https:') return u.toString();
  } catch (_e) {
    // ignore
  }
  return null;
}

function looksLikeHostWithOptionalPath(candidate) {
  if (!candidate) return false;
  if (/\s/.test(candidate)) return false;
  const host = candidate.split(/[/?#]/)[0] || '';
  if (!host || host.length > 255) return false;
  const parts = host.split('.');
  if (parts.length < 2) return false;
  const tld = parts[parts.length - 1] || '';
  if (tld.length < 2) return false;
  for (const part of parts) {
    if (!part || part.length > 63) return false;
    if (!/^[a-z0-9-]+$/i.test(part)) return false;
    if (part.startsWith('-') || part.endsWith('-')) return false;
  }
  return true;
}

function resolveOpenQueryToUrl(query) {
  const raw = String(query || '').trim();
  if (!raw) return null;

  const normalized = normalizeSpokenUrl(raw);

  // Explicit search intent: "search for <x>"
  const searchMatch = normalized.match(/^(search|google)\s+(for\s+)?(.+)$/);
  if (searchMatch && searchMatch[3]) {
    return `https://www.google.com/search?q=${encodeURIComponent(searchMatch[3])}`;
  }

  // Full URL
  const direct = tryParseHttpUrl(normalized);
  if (direct) return direct;

  const namedSite = resolveNamedSiteUrl(raw);
  if (namedSite) return namedSite;

  // Domain (with optional path), missing scheme
  if (looksLikeHostWithOptionalPath(normalized)) {
    return tryParseHttpUrl(`https://${normalized}`);
  }

  // Single token like "facebook" -> assume .com
  if (!/\s/.test(normalized) && /^[a-z0-9-]{2,}$/i.test(normalized) && !normalized.includes('.')) {
    return `https://www.${normalized}.com/`;
  }

  // Open-intent fallback: prefer direct-open behavior over a search-results page.
  return resolveDirectOpenFallbackUrl(raw);
}

function friendlyUrlForSpeech(url) {
  try {
    const u = new URL(url);
    const host = u.hostname || url;
    const path = u.pathname && u.pathname !== '/' ? u.pathname : '';
    return (host + path).replace(/^www\./i, '');
  } catch (_e) {
    return String(url || '');
  }
}

async function openSiteInBrowser(query, newTab, requestedOutputLanguage, options = {}) {
  const outputLanguage = normalizeOutputLanguage(requestedOutputLanguage);
  const outputMessagesReady = ensureOutputMessages(outputLanguage);
  const url = resolveOpenQueryToUrl(query);
  const sourceTabId = options.sourceTabId || null;
  if (!url) return { ok: false, error: outputMessage('missing_url', outputLanguage) };

  const speech = outputMessage('opening_value', outputLanguage, { value: friendlyUrlForSpeech(url) });
  if (options.announce !== false) {
    outputMessagesReady.then(() => (
      sendToTargetTab(sourceTabId, {
        type: 'navable:announce',
        text: outputMessage('opening_value', outputLanguage, { value: friendlyUrlForSpeech(url) }),
        mode: 'assertive',
        lang: outputLocale(outputLanguage)
      })
    )).catch(() => {
      // ignore announce failures (e.g., unsupported active tab)
    });
  }

  try {
    if (newTab === false) {
      if (sourceTabId) {
        await chrome.tabs.update(sourceTabId, { url });
      } else {
        const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        if (tab && tab.id) {
          await chrome.tabs.update(tab.id, { url });
        } else {
          await chrome.tabs.create({ url });
        }
      }
    } else {
      await chrome.tabs.create({ url });
    }
    await rememberActionTurn(sourceTabId, {
      action: 'open_site',
      outputLanguage,
      url
    });
    return { ok: true, url, speech };
  } catch (err) {
    console.warn('[Navable] openSite failed', err);
    return { ok: false, error: outputMessage('open_website_failed', outputLanguage) };
  }
}

async function resetAssistantSessionForTabNavigation(tabId, url) {
  if (!tabId) return;
  const nextHost = hostForUrl(url);
  if (!nextHost) return;
  const existing = await getAssistantSession(tabId);
  if (!existing || !existing.host) return;
  if (existing.host !== nextHost) {
    await clearAssistantSession(tabId);
  }
}

// Keyboard commands → tools on active tab
chrome.commands.onCommand.addListener(async (command) => {
  try {
    if (command === 'scroll-down') {
      const ok = await tryExecutePlan({ steps: [{ action: 'scroll', direction: 'down' }] });
      if (!ok && typeof window !== 'undefined' && window.scrollBy) {
        window.scrollBy({ top: Math.floor(window.innerHeight * 0.8), behavior: 'auto' });
      }
      return;
    }
    if (command === 'scroll-up') {
      const ok = await tryExecutePlan({ steps: [{ action: 'scroll', direction: 'up' }] });
      if (!ok && typeof window !== 'undefined' && window.scrollBy) {
        window.scrollBy({ top: -Math.floor(window.innerHeight * 0.8), behavior: 'auto' });
      }
      return;
    }
    if (command === 'next-heading') {
      const ok = await tryExecutePlan({ steps: [{ action: 'move_heading', direction: 'next' }] });
      if (!ok && typeof window !== 'undefined' && (window).NavableTools?.runPlan) {
        await (window).NavableTools.runPlan({ steps: [{ action: 'move_heading', direction: 'next' }] });
      }
      return;
    }
    if (command === 'prev-heading') {
      const ok = await tryExecutePlan({ steps: [{ action: 'move_heading', direction: 'prev' }] });
      if (!ok && typeof window !== 'undefined' && (window).NavableTools?.runPlan) {
        await (window).NavableTools.runPlan({ steps: [{ action: 'move_heading', direction: 'prev' }] });
      }
      return;
    }
  } catch (err) {
    console.warn('[Navable] command handler failed', command, err);
  }
});

// Ensure Navable is usable "from the beginning" by redirecting internal new tab pages
// (where extensions cannot inject content scripts) to Navable's New Tab page.
try {
  if (chrome?.tabs?.onCreated?.addListener) {
    chrome.tabs.onCreated.addListener((tab) => {
      const url = tab && (tab.pendingUrl || tab.url) ? String(tab.pendingUrl || tab.url) : '';
      if (!tab || !tab.id) return;
      redirectNewTabToNavable(tab.id, url);
    });
  }
  if (chrome?.tabs?.onUpdated?.addListener) {
    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      const url =
        (changeInfo && changeInfo.url) ||
        (tab && (tab.pendingUrl || tab.url) ? String(tab.pendingUrl || tab.url) : '');
      redirectNewTabToNavable(tabId, url);
      resetAssistantSessionForTabNavigation(tabId, url).catch(() => {
        // ignore session reset failures
      });
    });
  }
  if (chrome?.tabs?.onRemoved?.addListener) {
    chrome.tabs.onRemoved.addListener((tabId) => {
      clearAssistantSession(tabId).catch(() => {
        // ignore session cleanup failures
      });
    });
  }
} catch (_err) {
  // ignore in test contexts
}

// Planner + bus bridge
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const sourceTabId = sender && sender.tab && sender.tab.id ? sender.tab.id : null;
  if (msg && msg.type === 'navable:openSite') {
    openSiteInBrowser(msg.query || '', msg.newTab, msg.outputLanguage, {
      sourceTabId
    }).then((res) => {
      sendResponse(res);
    }).catch((err) => {
      sendResponse({ ok: false, error: String(err || 'open site failed') });
    });
    return true;
  }
  if (msg && msg.type === 'navable:assistant') {
    requestAssistant(msg.input || '', msg.outputLanguage, {
      purpose: msg.purpose || 'auto',
      includePageContext: !!msg.pageContext,
      pageStructure: msg.pageStructure || null,
      sourceTabId,
      detectedLanguage: msg.detectedLanguage || '',
      recognitionProvider: msg.recognitionProvider || '',
      pageUrl: msg.pageUrl || ''
    }).then(async (res) => {
      if (
        res &&
        res.ok === true &&
        msg.autoExecutePlan !== false &&
        (msg.pageContext || res.mode === 'page') &&
        res.plan &&
        res.plan.steps &&
        res.plan.steps.length
      ) {
        try {
          await sendToTargetTab(sourceTabId, { type: 'navable:executePlan', plan: res.plan });
        } catch (err) {
          console.warn('[Navable] assistant plan execution failed', err);
        }
      }
      sendResponse(res);
    }).catch((err) => {
      sendResponse({ ok: false, error: String(err || 'assistant failed') });
    });
    return true;
  }
  if (msg && msg.type === 'planner:run') {
    runPlanner(msg.command || '', msg.outputLanguage, msg.preferIntentFallback, {
      pageStructure: msg.pageStructure || null,
      sourceTabId
    }).then((res) => {
      sendResponse(res);
    }).catch((err) => {
      sendResponse({ ok: false, error: String(err || 'planner failed') });
    });
    return true;
  }
  if (msg && msg.type === 'navable:tts') {
    if (msg.action === 'stop') {
      stopExtensionTts().then((ok) => {
        sendResponse({ ok: !!ok });
      }).catch((err) => {
        sendResponse({ ok: false, error: String(err || 'tts stop failed') });
      });
      return true;
    }
    if (msg.action === 'speak') {
      speakWithExtensionTts(msg.text || '', {
        lang: msg.lang || ''
      }).then((res) => {
        sendResponse(res);
      }).catch((err) => {
        sendResponse({ ok: false, error: String(err || 'tts failed') });
      });
      return true;
    }
  }
  if (msg && msg.type === 'bus:request') {
    if (msg.kind === 'planner:run') {
      runPlanner(msg.payload?.command || '', msg.payload?.outputLanguage, msg.payload?.preferIntentFallback, {
        pageStructure: msg.payload?.pageStructure || null,
        sourceTabId
      }).then((res) => sendResponse(res)).catch((err) => {
        sendResponse({ ok: false, error: String(err || 'planner failed') });
      });
      return true;
    }
    if (msg.kind === 'navable:getStructure') {
      sendToTargetTab(sourceTabId, { type: 'navable:getStructure' }).then((res) => sendResponse(res)).catch((err) => {
        sendResponse({ ok: false, error: String(err || 'structure failed') });
      });
      return true;
    }
  }
  return undefined;
});
