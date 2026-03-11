// Background service worker responsibilities:
// - keep microphone permission and speech recognition inside the extension origin
// - own the offscreen document lifecycle
// - forward recognized voice commands to the active tab content script
// Test fallback: if chrome is missing (non-extension env), create a minimal shim so tests can run.
if (typeof window !== 'undefined' && typeof chrome === 'undefined') {
  const localStore = {};
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
      onActivated: { addListener() {} },
      query() { return Promise.resolve([{ id: 1 }]); },
      get(tabId) {
        return Promise.resolve({ id: tabId || 1, url: 'https://example.com' });
      },
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
      getURL(path) {
        const p = String(path || '').replace(/^\/+/, '');
        return 'chrome-extension://test-extension/' + p;
      },
      onMessage: {
        addListener(fn) {
          chrome.runtime._listeners.push(fn);
        }
      },
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} },
      sendMessage(payload) {
        return new Promise((resolve) => {
          const listeners = (chrome.runtime._listeners || []);
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
    storage: {
      local: {
        get(defaults, cb) {
          const out = Object.assign({}, defaults || {}, localStore);
          cb(out);
        },
        set(values, cb) {
          Object.assign(localStore, values || {});
          if (typeof cb === 'function') cb();
        }
      },
      sync: {
        get(defaults, cb) { cb(defaults); }
      },
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

const NAVABLE_EXTENSION_BASE_URL = (() => {
  try {
    return chrome && chrome.runtime && chrome.runtime.getURL
      ? String(chrome.runtime.getURL(''))
      : '';
  } catch (_err) {
    return '';
  }
})();

const NAVABLE_OFFSCREEN_PATH = 'src/offscreen/offscreen.html';
const NAVABLE_OFFSCREEN_URL = (() => {
  try {
    return chrome && chrome.runtime && chrome.runtime.getURL
      ? String(chrome.runtime.getURL(NAVABLE_OFFSCREEN_PATH))
      : '';
  } catch (_err) {
    return '';
  }
})();
const VOICE_COMMAND_MESSAGE_TYPE = 'VOICE_COMMAND';
const LEGACY_VOICE_COMMAND_MESSAGE_TYPE = 'navable:voiceTranscript';

const NAVABLE_ONBOARDING_URL = (() => {
  try {
    return chrome && chrome.runtime && chrome.runtime.getURL
      ? String(chrome.runtime.getURL('src/onboarding/welcome.html'))
      : '';
  } catch (_err) {
    return '';
  }
})();

const VOICE_STATE_STORAGE_KEY = 'navable_voice_state';

const voiceState = {
  supported: true,
  permissionGranted: false,
  listening: false,
  lastError: '',
  language: 'en-US'
};

let voiceStateLoaded = false;
let offscreenCreationPromise = null;

function fireAndForgetRuntimeMessage(payload) {
  try {
    if (!chrome?.runtime?.sendMessage) return;
    const maybe = chrome.runtime.sendMessage(payload);
    if (maybe && typeof maybe.catch === 'function') {
      maybe.catch(() => {});
    }
  } catch (_err) {
    // ignore messaging errors when no listeners are available
  }
}

function mergeVoiceState(next) {
  if (!next || typeof next !== 'object') return;
  if (typeof next.supported === 'boolean') voiceState.supported = next.supported;
  if (typeof next.permissionGranted === 'boolean') voiceState.permissionGranted = next.permissionGranted;
  if (typeof next.listening === 'boolean') voiceState.listening = next.listening;
  if (typeof next.lastError === 'string') voiceState.lastError = next.lastError;
  if (typeof next.language === 'string' && next.language.trim()) voiceState.language = next.language.trim();
}

function voiceStatusPayload() {
  return {
    ok: true,
    supports: !!voiceState.supported,
    permissionGranted: !!voiceState.permissionGranted,
    listening: !!voiceState.listening,
    lastError: voiceState.lastError || '',
    language: voiceState.language || 'en-US'
  };
}

function broadcastVoiceStatus() {
  fireAndForgetRuntimeMessage({ type: 'voice:status', status: voiceStatusPayload() });
}

function readLocalStorage(defaults) {
  return new Promise((resolve) => {
    if (!chrome?.storage?.local?.get) {
      resolve(defaults || {});
      return;
    }
    chrome.storage.local.get(defaults || {}, (res) => {
      resolve(res || defaults || {});
    });
  });
}

function writeLocalStorage(values) {
  return new Promise((resolve) => {
    if (!chrome?.storage?.local?.set) {
      resolve();
      return;
    }
    chrome.storage.local.set(values || {}, () => resolve());
  });
}

function readSyncSettings() {
  return new Promise((resolve) => {
    if (!chrome?.storage?.sync?.get) {
      resolve({});
      return;
    }
    chrome.storage.sync.get({ navable_settings: {} }, (res) => {
      const s = res && res.navable_settings ? res.navable_settings : {};
      resolve(s);
    });
  });
}

async function hydrateVoiceState() {
  if (voiceStateLoaded) return voiceState;
  const res = await readLocalStorage({ [VOICE_STATE_STORAGE_KEY]: {} });
  const stored = res && res[VOICE_STATE_STORAGE_KEY] ? res[VOICE_STATE_STORAGE_KEY] : {};
  mergeVoiceState({
    supported: stored.supported !== false,
    permissionGranted: !!stored.permissionGranted,
    listening: false,
    lastError: stored.lastError ? String(stored.lastError) : '',
    language: stored.language ? String(stored.language) : 'en-US'
  });
  voiceStateLoaded = true;
  return voiceState;
}

async function persistVoiceState() {
  await writeLocalStorage({
    [VOICE_STATE_STORAGE_KEY]: {
      supported: !!voiceState.supported,
      permissionGranted: !!voiceState.permissionGranted,
      listening: !!voiceState.listening,
      lastError: voiceState.lastError || '',
      language: voiceState.language || 'en-US'
    }
  });
}

function applyOffscreenStatus(status) {
  if (!status || typeof status !== 'object') return;
  mergeVoiceState({
    supported: status.supports !== false,
    permissionGranted: !!status.permissionGranted,
    listening: !!status.listening,
    lastError: status.lastError ? String(status.lastError) : '',
    language: status.language ? String(status.language) : voiceState.language
  });
}

function isNavableExtensionUrl(url) {
  const u = String(url || '');
  if (!u) return false;
  if (!NAVABLE_EXTENSION_BASE_URL) return false;
  return u.startsWith(NAVABLE_EXTENSION_BASE_URL);
}

async function hasOffscreenDocument() {
  try {
    if (chrome?.runtime?.getContexts && NAVABLE_OFFSCREEN_URL) {
      const contexts = await chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT'],
        documentUrls: [NAVABLE_OFFSCREEN_URL]
      });
      return Array.isArray(contexts) && contexts.length > 0;
    }
  } catch (_err) {
    // fall through to legacy API
  }

  try {
    if (globalThis.clients && typeof globalThis.clients.matchAll === 'function' && NAVABLE_OFFSCREEN_URL) {
      const matchedClients = await globalThis.clients.matchAll();
      return matchedClients.some((client) => String(client?.url || '') === NAVABLE_OFFSCREEN_URL);
    }
  } catch (_err2) {
    // ignore
  }
  return false;
}

async function ensureOffscreenDocument() {
  if (!chrome?.offscreen?.createDocument || !NAVABLE_OFFSCREEN_PATH) {
    mergeVoiceState({ supported: false, lastError: 'offscreen-unavailable' });
    return false;
  }

  if (await hasOffscreenDocument()) {
    return true;
  }

  if (offscreenCreationPromise) {
    return offscreenCreationPromise;
  }

  offscreenCreationPromise = (async () => {
    try {
      await chrome.offscreen.createDocument({
        url: NAVABLE_OFFSCREEN_PATH,
        reasons: ['USER_MEDIA'],
        justification: 'Keep microphone and speech recognition in extension context.'
      });
      return true;
    } catch (err) {
      mergeVoiceState({ supported: false, lastError: String(err || 'offscreen-create-failed') });
      return false;
    } finally {
      offscreenCreationPromise = null;
    }
  })();

  return offscreenCreationPromise;
}

async function sendVoiceActionToOffscreen(action, payload) {
  const ready = await ensureOffscreenDocument();
  if (!ready) {
    return { ok: false, error: voiceState.lastError || 'offscreen-unavailable' };
  }

  try {
    const res = await chrome.runtime.sendMessage({
      type: 'voice:offscreen',
      action,
      payload: payload || {}
    });
    return res || { ok: false, error: 'offscreen-no-response' };
  } catch (err) {
    return { ok: false, error: String(err || 'offscreen-message-failed') };
  }
}

async function requestExtensionMicrophonePermission() {
  await hydrateVoiceState();
  const res = await sendVoiceActionToOffscreen('requestPermission');
  if (res && res.status) applyOffscreenStatus(res.status);
  if (!res || !res.ok) {
    mergeVoiceState({ lastError: res && res.error ? String(res.error) : 'mic-permission-failed' });
  }
  await persistVoiceState();
  broadcastVoiceStatus();
  return voiceStatusPayload();
}

async function startVoiceListeningInExtension(language) {
  await hydrateVoiceState();
  const settings = await readSyncSettings();
  const lang = String(language || settings.language || voiceState.language || 'en-US');
  mergeVoiceState({ language: lang });

  const res = await sendVoiceActionToOffscreen('start', { language: lang });
  if (res && res.status) applyOffscreenStatus(res.status);
  if (!res || !res.ok) {
    mergeVoiceState({ listening: false, lastError: res && res.error ? String(res.error) : 'voice-start-failed' });
  }

  await persistVoiceState();
  broadcastVoiceStatus();
  return voiceStatusPayload();
}

async function stopVoiceListeningInExtension() {
  await hydrateVoiceState();
  const res = await sendVoiceActionToOffscreen('stop');
  if (res && res.status) applyOffscreenStatus(res.status);
  if (!res || !res.ok) {
    mergeVoiceState({ listening: false, lastError: res && res.error ? String(res.error) : 'voice-stop-failed' });
  }

  await persistVoiceState();
  broadcastVoiceStatus();
  return voiceStatusPayload();
}

async function getVoiceStatus() {
  await hydrateVoiceState();
  const settings = await readSyncSettings();
  if (settings && settings.language) {
    mergeVoiceState({ language: String(settings.language) });
  }
  return voiceStatusPayload();
}

async function syncVoiceWithSettings() {
  await hydrateVoiceState();
  const settings = await readSyncSettings();
  const autostart = typeof settings.autostart === 'boolean' ? settings.autostart : true;
  const language = settings.language ? String(settings.language) : voiceState.language;
  mergeVoiceState({ language });

  if (!voiceState.permissionGranted) {
    await persistVoiceState();
    broadcastVoiceStatus();
    return;
  }

  const offscreenReady = await ensureOffscreenDocument();
  if (!offscreenReady) {
    await persistVoiceState();
    broadcastVoiceStatus();
    return;
  }

  if (autostart && !voiceState.listening) {
    await startVoiceListeningInExtension(language);
    return;
  }
  if (!autostart && voiceState.listening) {
    await stopVoiceListeningInExtension();
    return;
  }

  await persistVoiceState();
  broadcastVoiceStatus();
}

async function dispatchVoiceTranscript(transcript) {
  const text = String(transcript || '').trim();
  if (!text) return;
  const payload = { type: VOICE_COMMAND_MESSAGE_TYPE, text };

  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab && tab.id && !isNavableExtensionUrl(tab.url || tab.pendingUrl)) {
      await chrome.tabs.sendMessage(tab.id, payload);
      return;
    }
  } catch (_err) {
    // fall back to extension runtime messaging
  }

  fireAndForgetRuntimeMessage(payload);
}

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
  'الزر', 'الصفحة', 'القسم', 'التالي', 'السابق'
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

function scoreIntentLabel(label, tokens) {
  const lower = String(label || '').toLowerCase();
  if (!lower || !tokens.length) return 0;
  let score = 0;
  for (const token of tokens) {
    if (lower === token) score += 5;
    else if (lower.startsWith(token) || lower.endsWith(token)) score += 3;
    else if (lower.includes(token)) score += token.length >= 5 ? 2 : 1;
  }
  return score;
}

function collectIntentCandidates(structure, targetTypes) {
  const candidates = [];
  const targets = Array.isArray(targetTypes) && targetTypes.length ? targetTypes : ['link', 'button', 'heading', 'input'];
  for (const target of targets) {
    if (target === 'link' && structure && Array.isArray(structure.links)) {
      structure.links.forEach((item) => candidates.push({ target: 'link', label: item?.label || '' }));
    }
    if (target === 'button' && structure && Array.isArray(structure.buttons)) {
      structure.buttons.forEach((item) => candidates.push({ target: 'button', label: item?.label || '' }));
    }
    if (target === 'heading' && structure && Array.isArray(structure.headings)) {
      structure.headings.forEach((item) => candidates.push({ target: 'heading', label: item?.label || '' }));
    }
    if (target === 'input' && structure && Array.isArray(structure.inputs)) {
      structure.inputs.forEach((item) => candidates.push({ target: 'input', label: item?.label || '' }));
    }
  }
  return candidates;
}

function chooseIntentTarget(text, structure) {
  const normalized = String(text || '').toLowerCase();
  const tokens = tokenizeIntentText(normalized);
  if (!tokens.length || !structure) return null;

  let targetTypes = ['link', 'button', 'heading', 'input'];
  if (/\b(button|press|tap|activate|bouton)\b|زر/.test(normalized)) targetTypes = ['button', 'link'];
  else if (/\b(link|open|visit|launch|website|site|lien|ouvre|visite)\b|رابط|افتح/.test(normalized)) targetTypes = ['link', 'heading', 'button'];
  else if (/\b(section|heading|part|titre)\b|عنوان|قسم/.test(normalized)) targetTypes = ['heading', 'link'];
  else if (/\b(field|input|box|search|champ)\b|حقل|بحث/.test(normalized)) targetTypes = ['input', 'button', 'link'];

  const candidates = collectIntentCandidates(structure, targetTypes);
  let best = null;
  for (const candidate of candidates) {
    const score = scoreIntentLabel(candidate.label, tokens);
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
    /انتقل\s+إلى/, /انتقل\s+الى/, /خذني\s+إلى/, /خذني\s+الى/, /اضغط/, /فعّل|فعل/
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
    /لخص هذه الصفحة|صف هذه الصفحة|أين أنا|اين انا|ماذا يمكنني أن أفعل هنا|ماذا يمكنني ان افعل هنا/.test(text)
  ) {
    description = orientation;
    matched = true;
  } else if (hasIntent(text, [
    /\bscroll up\b/, /\bgo up\b/, /\bmove up\b/, /\bback up\b/, /\bup a bit\b/, /\bhigher\b/,
    /\bmonte\b/, /\bplus haut\b/, /\bfais d[ée]filer vers le haut\b/,
    /اطلع|اصعد|مرر.*(للأعلى|للاعلى)|فوق/
  ])) {
    steps.push({ action: 'scroll', direction: 'up' });
    matched = true;
  } else if (hasIntent(text, [
    /\bscroll\b/, /\bgo down\b/, /\bmove down\b/, /\blower\b/, /\bdown a bit\b/, /\bshow me more\b/, /\bkeep going\b/,
    /\bdescend(s)?\b/, /\bplus bas\b/, /\bfais d[ée]filer vers le bas\b/,
    /انزل|نز[ّل]|\bمرر.*(للأسفل|للاسفل)\b|تحت/
  ])) {
    steps.push({ action: 'scroll', direction: 'down' });
    matched = true;
  } else if (hasIntent(text, [
    /\bread title\b/, /\bpage title\b/, /\bwhat('?s| is) the title\b/, /\btell me the title\b/,
    /\blis le titre\b/, /\bquel est le titre\b/,
    /اقر[أا] العنوان|ما عنوان الصفحة|ما هو عنوان الصفحة/
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
    /اقر[أا] العنوان|ما العنوان الحالي|ما القسم الحالي/
  ])) {
    steps.push({ action: 'read_heading', n: 1 });
    matched = true;
  } else if (hasIntent(text, [
    /\bwhat('?s| is) focused\b/, /\bwhat am i on\b/, /\bread current\b/, /\bread focused\b/,
    /\bsur quoi suis[- ]je\b/, /\blis l[' ]?[ée]l[ée]ment courant\b/,
    /ما العنصر المحدد|على ماذا انا|ما أنا عليه|ما انا عليه/
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

function normalizeAssistantResult(data) {
  const summary = data && typeof data.summary === 'string' ? data.summary.trim() : '';
  const answer = data && typeof data.answer === 'string' ? data.answer.trim() : '';
  const speech = data && typeof data.speech === 'string' ? data.speech.trim() : '';
  const suggestions = Array.isArray(data && data.suggestions) ? data.suggestions : [];
  const plan = data && data.plan && Array.isArray(data.plan.steps) ? data.plan : { steps: [] };
  const description = speech || [summary, suggestions.join(' ')].filter(Boolean).join(' ').trim();
  return {
    mode: data && typeof data.mode === 'string' ? data.mode : 'answer',
    speech: description,
    description,
    summary,
    answer,
    suggestions,
    plan
  };
}

async function requestAssistant(input, requestedOutputLanguage, options = {}) {
  const settings = options.settings || await loadSettings();
  const outputLanguage = normalizeOutputLanguage(requestedOutputLanguage || settings.language || 'en-US');
  const outputMessagesReady = ensureOutputMessages(outputLanguage);
  const text = String(input || '').trim();
  const sourceTabId = options.sourceTabId || null;

  if (!text) {
    await outputMessagesReady;
    return { ok: false, error: outputMessage('answer_unavailable', outputLanguage) };
  }

  let structure = options.pageStructure || null;
  if (!structure && options.includePageContext) {
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
        purpose: options.purpose || 'auto'
      })
    });
    const data = await response.json().catch(() => ({}));
    if (response.ok) {
      return { ok: true, structure, ...normalizeAssistantResult(data) };
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
  const outputLanguage = normalizeOutputLanguage(requestedOutputLanguage || settings.language || 'en-US');
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

function hostnameFromUrl(candidate) {
  try {
    const parsed = new URL(String(candidate || ''));
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.hostname || '';
    }
  } catch (_err) {
    // ignore
  }
  return '';
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

const SITE_SEARCH_PROVIDERS = {
  // Register additional site-specific search URLs here.
  youtube: {
    aliases: ['youtube.com', 'yt'],
    buildUrl(query) {
      return `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
    }
  },
  google: {
    aliases: ['google.com'],
    buildUrl(query) {
      return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
    }
  },
  facebook: {
    aliases: ['facebook.com', 'fb'],
    buildUrl(query) {
      return `https://www.facebook.com/search/top?q=${encodeURIComponent(query)}`;
    }
  },
  amazon: {
    aliases: ['amazon.com'],
    buildUrl(query) {
      return `https://www.amazon.com/s?k=${encodeURIComponent(query)}`;
    }
  }
};

function aliasesForSiteSearchProvider(siteKey, provider) {
  return [siteKey].concat(Array.isArray(provider.aliases) ? provider.aliases : []);
}

function normalizeSiteSearchTarget(rawSite) {
  const normalizedSite = String(rawSite || '').trim().toLowerCase().replace(/^the\s+/, '');
  if (!normalizedSite) return '';

  for (const [siteKey, provider] of Object.entries(SITE_SEARCH_PROVIDERS)) {
    const aliases = aliasesForSiteSearchProvider(siteKey, provider);
    if (aliases.includes(normalizedSite)) return siteKey;
  }

  return '';
}

function siteSearchProviderFromHostname(hostname) {
  const normalizedHostname = String(hostname || '').trim().toLowerCase().replace(/^www\./, '');
  if (!normalizedHostname) return '';

  for (const [siteKey, provider] of Object.entries(SITE_SEARCH_PROVIDERS)) {
    const aliases = aliasesForSiteSearchProvider(siteKey, provider);
    const matched = aliases.some((alias) => {
      const normalizedAlias = String(alias || '').trim().toLowerCase().replace(/^www\./, '');
      return normalizedHostname === normalizedAlias || normalizedHostname.endsWith(`.${normalizedAlias}`);
    });
    if (matched) return siteKey;
  }

  return '';
}

function parseSearchCommand(query) {
  const raw = String(query || '').trim();
  if (!raw) return null;

  const match = raw.match(/^(?:search|google)\s+(?:for\s+)?(.+?)\s+on\s+([a-z0-9.-]+)\s*$/i);
  if (match && match[1] && match[2]) {
    const searchQuery = String(match[1] || '').trim();
    const siteKey = normalizeSiteSearchTarget(match[2]);
    if (!searchQuery || !siteKey || !SITE_SEARCH_PROVIDERS[siteKey]) return null;
    return { searchQuery, siteKey };
  }

  const genericMatch = raw.match(/^(?:search|google)\s+(?:for\s+)?(.+?)\s*$/i);
  if (!genericMatch || !genericMatch[1]) return null;

  const searchQuery = String(genericMatch[1] || '').trim();
  if (!searchQuery) return null;
  return { searchQuery, siteKey: '' };
}

function tryResolveSiteSearchUrl(query, currentHostname) {
  const parsed = parseSearchCommand(query);
  if (!parsed || !parsed.searchQuery) return null;

  const siteKey = parsed.siteKey || siteSearchProviderFromHostname(currentHostname) || 'google';
  const provider = SITE_SEARCH_PROVIDERS[siteKey];
  if (!provider) return null;

  return provider.buildUrl(parsed.searchQuery);
}

function resolveOpenQueryToUrl(query, currentHostname) {
  const raw = String(query || '').trim();
  if (!raw) return null;

  const normalized = normalizeSpokenUrl(raw);

  const siteSearchUrl = tryResolveSiteSearchUrl(raw, currentHostname);
  if (siteSearchUrl) return siteSearchUrl;

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
  const outputLanguage = normalizeOutputLanguage(requestedOutputLanguage || voiceState.language || 'en-US');
  const outputMessagesReady = ensureOutputMessages(outputLanguage);
  const sourceTabId = options.sourceTabId || null;
  let currentHostname = hostnameFromUrl(options.currentPageUrl || '');
  try {
    if (!currentHostname && sourceTabId && chrome?.tabs?.get) {
      const sourceTab = await chrome.tabs.get(sourceTabId);
      currentHostname = hostnameFromUrl(sourceTab && (sourceTab.url || sourceTab.pendingUrl));
    }
    if (!currentHostname) {
      const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      currentHostname = hostnameFromUrl(activeTab && (activeTab.url || activeTab.pendingUrl));
    }
  } catch (_err) {
    currentHostname = '';
  }

  const url = resolveOpenQueryToUrl(query, currentHostname);
  if (!url) return { ok: false, error: outputMessage('missing_url', outputLanguage) };

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
    return { ok: true, url };
  } catch (err) {
    console.warn('[Navable] openSite failed', err);
    return { ok: false, error: outputMessage('open_website_failed', outputLanguage) };
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
    });
  }
} catch (_err) {
  // ignore in test contexts
}

try {
  if (chrome?.runtime?.onInstalled?.addListener) {
    chrome.runtime.onInstalled.addListener((details) => {
      if (details && details.reason === 'install' && NAVABLE_ONBOARDING_URL) {
        chrome.tabs.create({ url: NAVABLE_ONBOARDING_URL }).catch(() => {});
      }
      hydrateVoiceState().then(() => syncVoiceWithSettings()).catch(() => {});
    });
  }
  if (chrome?.runtime?.onStartup?.addListener) {
    chrome.runtime.onStartup.addListener(() => {
      hydrateVoiceState().then(() => syncVoiceWithSettings()).catch(() => {});
    });
  }
  if (chrome?.storage?.onChanged?.addListener) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'sync' || !changes || !changes.navable_settings) return;
      syncVoiceWithSettings().catch(() => {});
    });
  }
} catch (_err2) {
  // ignore in test contexts
}

hydrateVoiceState().then(() => syncVoiceWithSettings()).catch(() => {});

// Planner + bus bridge
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const sourceTabId = sender && sender.tab && sender.tab.id ? sender.tab.id : null;
  const senderUrl =
    (sender && sender.tab && (sender.tab.url || sender.tab.pendingUrl))
      ? String(sender.tab.url || sender.tab.pendingUrl)
      : (sender && sender.url ? String(sender.url) : '');
  if (msg && msg.type === 'voice:state') {
    applyOffscreenStatus(msg.status || {});
    persistVoiceState().then(() => {
      broadcastVoiceStatus();
      sendResponse({ ok: true });
    }).catch((err) => {
      sendResponse({ ok: false, error: String(err || 'voice-state-persist-failed') });
    });
    return true;
  }
  if (msg && msg.type === 'voice:transcript') {
    dispatchVoiceTranscript(msg.text || '').then(() => {
      sendResponse({ ok: true });
    }).catch((err) => {
      sendResponse({ ok: false, error: String(err || 'voice-transcript-dispatch-failed') });
    });
    return true;
  }
  if (msg && msg.type === LEGACY_VOICE_COMMAND_MESSAGE_TYPE) {
    dispatchVoiceTranscript(msg.text || '').then(() => {
      sendResponse({ ok: true });
    }).catch((err) => {
      sendResponse({ ok: false, error: String(err || 'voice-command-dispatch-failed') });
    });
    return true;
  }
  if (msg && msg.type === 'voice:getStatus') {
    getVoiceStatus().then((res) => sendResponse(res)).catch((err) => {
      sendResponse({ ok: false, error: String(err || 'voice-status-failed') });
    });
    return true;
  }
  if (msg && msg.type === 'voice:requestPermission') {
    requestExtensionMicrophonePermission().then((res) => sendResponse(res)).catch((err) => {
      sendResponse({ ok: false, error: String(err || 'voice-permission-failed') });
    });
    return true;
  }
  if (msg && msg.type === 'voice:start') {
    startVoiceListeningInExtension(msg.language || '').then((res) => sendResponse(res)).catch((err) => {
      sendResponse({ ok: false, error: String(err || 'voice-start-failed') });
    });
    return true;
  }
  if (msg && msg.type === 'voice:stop') {
    stopVoiceListeningInExtension().then((res) => sendResponse(res)).catch((err) => {
      sendResponse({ ok: false, error: String(err || 'voice-stop-failed') });
    });
    return true;
  }
  if (msg && msg.type === 'voice:toggle') {
    getVoiceStatus().then((status) => {
      if (status && status.listening) return stopVoiceListeningInExtension();
      return startVoiceListeningInExtension(status && status.language ? status.language : '');
    }).then((res) => sendResponse(res)).catch((err) => {
      sendResponse({ ok: false, error: String(err || 'voice-toggle-failed') });
    });
    return true;
  }
  if (msg && msg.type === 'navable:openSite') {
    openSiteInBrowser(msg.query || '', msg.newTab, msg.outputLanguage, {
      sourceTabId,
      currentPageUrl: senderUrl
    }).then((res) => {
      sendResponse(res);
    }).catch((err) => {
      sendResponse({ ok: false, error: String(err || 'open site failed') });
    });
    return true;
  }
  if (msg && msg.type === 'navable:assistant') {
    requestAssistant(msg.input || '', msg.outputLanguage, {
      includePageContext: !!msg.pageContext,
      pageStructure: msg.pageStructure || null,
      sourceTabId
    }).then(async (res) => {
      if (
        res &&
        res.ok === true &&
        msg.autoExecutePlan !== false &&
        msg.pageContext &&
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
