function pad2(n) {
  return String(n).padStart(2, '0');
}

function formatClock(now) {
  const h = pad2(now.getHours());
  const m = pad2(now.getMinutes());
  return `${h}:${m}`;
}

function formatDate(now) {
  try {
    return now.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
  } catch {
    return now.toDateString();
  }
}

function greetingForHour(hour) {
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function updateHeader() {
  const now = new Date();
  const clock = document.getElementById('clock');
  const greeting = document.getElementById('greeting');
  if (clock) clock.textContent = formatClock(now);
  if (greeting) greeting.textContent = `${greetingForHour(now.getHours())} • ${formatDate(now)}`;
}

function looksLikeUrl(text) {
  if (!text) return false;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(text)) return true;
  if (/\s/.test(text)) return false;
  if (text.startsWith('localhost')) return true;
  return text.includes('.') || text.includes('/') || text.includes(':');
}

function resolveQueryToUrl(raw) {
  const q0 = (raw || '').trim();
  if (!q0) return null;

  const q = q0
    .replace(/\s+dot\s+/gi, '.')
    .replace(/\s+slash\s+/gi, '/')
    .replace(/\s+/g, ' ')
    .trim();

  if (looksLikeUrl(q)) {
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(q)) return q;
    return `https://${q}`;
  }

  return `https://www.google.com/search?q=${encodeURIComponent(q)}`;
}

async function openUrl(url) {
  if (!url) return;
  try {
    if (chrome?.tabs?.update) {
      await chrome.tabs.update({ url });
      return;
    }
  } catch (_err) {
    // fall through
  }
  window.location.assign(url);
}

function announce(text, mode = 'polite') {
  const msg = String(text || '').trim();
  if (!msg) return;
  try {
    const options = {
      mode: mode === 'assertive' ? 'assertive' : 'polite',
      lang: outputLocale(currentOutputLanguage())
    };
    if (prefersNewtabChromeTtsOutput() && window.NavableAnnounce && typeof window.NavableAnnounce.output === 'function') {
      window.NavableAnnounce.output(msg, options);
    } else if (window.NavableAnnounce && typeof window.NavableAnnounce.speak === 'function') {
      window.NavableAnnounce.speak(msg, options);
    } else if (window.NavableAnnounce && typeof window.NavableAnnounce.output === 'function') {
      window.NavableAnnounce.output(msg, options);
    }

    if (prefersNewtabChromeTtsOutput()) {
      const playbackToken = beginNewtabTtsPlayback();
      requestNewtabChromeTtsSpeak(msg, options).then((spoken) => {
        finishNewtabTtsPlayback(playbackToken, spoken ? 450 : 0);
        if (spoken) return;
        try {
          if (window.NavableAnnounce && typeof window.NavableAnnounce.speak === 'function') {
            window.NavableAnnounce.speak(msg, options);
          }
        } catch (_err2) {
          // ignore
        }
      });
    }
  } catch (_err) {
    // ignore
  }
}

const i18n = window.NavableI18n || null;

function normalizeOutputLanguage(lang) {
  if (i18n && typeof i18n.normalizeLanguage === 'function') return i18n.normalizeLanguage(lang);
  return String(lang || 'en').toLowerCase().split(/[-_]/)[0] || 'en';
}

function outputLocale(lang) {
  if (i18n && typeof i18n.localeForLanguage === 'function') return i18n.localeForLanguage(lang);
  return String(lang || 'en-US');
}

function normalizeLanguageMode(mode, fallbackLanguage) {
  if (i18n && typeof i18n.normalizeLanguageMode === 'function') {
    return i18n.normalizeLanguageMode(mode, fallbackLanguage);
  }
  if (!String(mode || '').trim()) return 'auto';
  const normalized = normalizeOutputLanguage(mode || fallbackLanguage || 'en-US');
  return normalized === 'ar' || normalized === 'en' ? normalized : 'auto';
}

function normalizeOutputMode(mode) {
  const raw = String(mode || '').trim().toLowerCase();
  if (raw === 'chrome_tts' || raw === 'chrome-tts' || raw === 'chrome tts') return 'chrome_tts';
  return 'screen_reader';
}

function prefersNewtabChromeTtsOutput() {
  return normalizeOutputMode(newtabOutputMode) === 'chrome_tts';
}

function requestNewtabChromeTtsSpeak(text, opts = {}) {
  return new Promise((resolve) => {
    const msg = String(text || '').trim();
    if (!msg || !chrome?.runtime?.sendMessage) {
      resolve(false);
      return;
    }
    try {
      const maybePromise = chrome.runtime.sendMessage({
        type: 'navable:tts',
        action: 'speak',
        text: msg,
        lang: opts.lang || outputLocale(currentOutputLanguage())
      }, (response) => {
        const lastError = chrome?.runtime?.lastError?.message ? String(chrome.runtime.lastError.message) : '';
        if (lastError) {
          resolve(false);
          return;
        }
        resolve(!!(response && response.ok));
      });
      if (maybePromise && typeof maybePromise.then === 'function') {
        maybePromise.then((response) => {
          resolve(!!(response && response.ok));
        }).catch(() => {
          resolve(false);
        });
      }
    } catch (_err) {
      resolve(false);
    }
  });
}

function requestNewtabChromeTtsStop() {
  if (!chrome?.runtime?.sendMessage) return;
  try {
    const maybePromise = chrome.runtime.sendMessage({ type: 'navable:tts', action: 'stop' }, () => {
      void chrome?.runtime?.lastError;
    });
    if (maybePromise && typeof maybePromise.catch === 'function') {
      maybePromise.catch(() => {});
    }
  } catch (_err) {
    // ignore
  }
}

function currentLanguageMode() {
  return normalizeLanguageMode(newtabLanguageMode, newtabConfiguredVoiceLang || 'en-US');
}

function lockedOutputLanguage() {
  const mode = currentLanguageMode();
  return mode === 'auto' ? '' : mode;
}

function recognitionLocalesForLanguage(language, preferredLocale) {
  if (i18n && typeof i18n.recognitionLocalesForLanguage === 'function') {
    return i18n.recognitionLocalesForLanguage(language, preferredLocale);
  }
  return [newtabRecognitionLocaleFor(preferredLocale || outputLocale(language))];
}

function currentOutputLanguage() {
  const locked = lockedOutputLanguage();
  if (locked) return locked;
  return normalizeOutputLanguage(newtabOutputLanguage || newtabVoiceLang || 'en-US');
}

function translate(key, params, lang) {
  const resolved = normalizeOutputLanguage(lang || currentOutputLanguage());
  if (i18n && typeof i18n.t === 'function') return i18n.t(key, resolved, params);
  return key;
}

function ensureOutputLanguageReady(lang) {
  const resolved = normalizeOutputLanguage(lang || currentOutputLanguage());
  if (i18n && typeof i18n.ensureLanguage === 'function') return i18n.ensureLanguage(resolved);
  return Promise.resolve();
}

function resolveTranscriptLanguage(text) {
  if (i18n && typeof i18n.resolveOutputLanguage === 'function') {
    return i18n.resolveOutputLanguage({
      transcript: text,
      fallbackLanguage: currentOutputLanguage()
    });
  }
  return currentOutputLanguage();
}

function setNewtabOutputLanguage(transcript, detectedLanguage) {
  const locked = lockedOutputLanguage();
  if (locked) {
    newtabOutputLanguage = locked;
    return newtabOutputLanguage;
  }
  if (detectedLanguage) {
    newtabOutputLanguage = normalizeOutputLanguage(detectedLanguage);
    return newtabOutputLanguage;
  }
  newtabOutputLanguage = resolveTranscriptLanguage(transcript);
  return newtabOutputLanguage;
}

function detectNewtabRecognitionLanguage(transcript, detectedLanguage) {
  const locked = lockedOutputLanguage();
  if (locked) return locked;
  if (detectedLanguage) return normalizeOutputLanguage(detectedLanguage);
  if (i18n && typeof i18n.detectLanguage === 'function') {
    return i18n.detectLanguage(transcript, normalizeOutputLanguage(newtabVoiceLang || 'en-US'));
  }
  return normalizeOutputLanguage(newtabVoiceLang || 'en-US');
}

function newtabRecognitionLocaleFor(lang) {
  const raw = String(lang || '').trim();
  if (!raw) return String(newtabVoiceLang || 'en-US');
  if (raw.includes('-') || raw.includes('_')) return raw.replace(/_/g, '-');
  return outputLocale(raw);
}

function newtabRecognitionCandidateLocales() {
  const seen = new Set();
  const list = [];
  const mode = currentLanguageMode();

  function pushLocale(locale) {
    const normalized = newtabRecognitionLocaleFor(locale);
    const key = String(normalized || '').toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    list.push(normalized);
  }

  function pushLanguage(language, preferredLocale) {
    recognitionLocalesForLanguage(language, preferredLocale).forEach(pushLocale);
  }

  pushLocale(newtabVoiceLang || 'en-US');
  pushLocale(newtabConfiguredVoiceLang || 'en-US');

  if (mode === 'auto') {
    const primary = normalizeOutputLanguage(newtabVoiceLang || currentOutputLanguage() || newtabConfiguredVoiceLang || 'en-US');
    const secondary = primary === 'ar' ? 'en' : 'ar';
    pushLanguage(
      secondary,
      secondary === normalizeOutputLanguage(newtabConfiguredVoiceLang || '') ? newtabConfiguredVoiceLang : outputLocale(secondary)
    );
    pushLanguage(primary, newtabConfiguredVoiceLang || outputLocale(primary));
    pushLanguage(currentOutputLanguage(), newtabVoiceLang || newtabConfiguredVoiceLang || 'en-US');
  } else {
    pushLanguage(mode, newtabConfiguredVoiceLang || outputLocale(mode));
  }

  return list;
}

function isVoiceSupported() {
  try {
    return !!(window.NavableSpeech && typeof window.NavableSpeech.supportsRecognition === 'function' && window.NavableSpeech.supportsRecognition());
  } catch (_err) {
    return false;
  }
}

function getVoiceStatusEls() {
  return {
    btn: document.getElementById('btnMicToggle'),
    status: document.getElementById('micStatus')
  };
}

function stripOpenIntentPrefixes(transcript) {
  let s = String(transcript || '').trim().toLowerCase();
  if (!s) return '';

  const patterns = [
    /^(?:hey\s+navable|navable|please|pls)\b[\s,]*/,
    /^(?:can you|could you|would you|will you)\b[\s,]*/,
    /^(?:peux[- ]?tu|pourrais[- ]?tu|tu peux|svp|stp|s['’]?il te pla[îi]t)\b[\s,]*/,
    /^(?:لو سمحت|من فضلك|رجاءً?|رجاء|ممكن|بتقدر|تقدر)\b[\s،]*/
  ];

  let changed = true;
  while (changed) {
    changed = false;
    for (const pattern of patterns) {
      const next = s.replace(pattern, '').trim();
      if (next !== s) {
        s = next;
        changed = true;
      }
    }
  }

  return s;
}

function extractOpenSiteQuery(transcript) {
  const s = stripOpenIntentPrefixes(transcript);
  if (!s) return null;

  // Arabic website intents.
  const ar = s.match(/^(افتح(?:\s+لي)?|خذني\s+على|خذني\s+إلى|خذني\s+الى|وديني\s+على|وديني\s+إلى|وديني\s+الى|اذهب\s+إلى|اذهب\s+الى|روح\s+على|روح\s+إلى|روح\s+الى|انتقل\s+إلى|انتقل\s+الى|خليني\s+أروح\s+على|خليني\s+اروح\s+على|خلينا\s+نروح\s+على)\s+(.+)$/);
  if (ar && ar[2]) return String(ar[2]).trim();

  // French website intents.
  const fr = s.match(/^(ouvre|va(?:s)?\s+(?:a|à)|aller?\s+(?:a|à)|visite|lance)\s+(.+)$/);
  if (fr && fr[2]) {
    return String(fr[2])
      .trim()
      .replace(/^(le|la|les|un|une)\b/, '')
      .trim()
      .replace(/^(site|page|onglet|application|appli)\b/, '')
      .trim();
  }

  // English: flexible website intents.
  if (!/^(open|open up|navigate to|go to|take me to|visit|bring up|launch|pull up)\b/.test(s)) return null;

  const q = s
    .replace(/^(open(\s+up)?|navigate to|go to|take me to|visit|bring up|launch|pull up)\b/, '')
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

  return q || null;
}

function extractSearchQuery(transcript) {
  const s = String(transcript || '').trim().toLowerCase();
  if (!s) return null;

  const en = s.match(/^(search|google|look up|find|search up|check)\s+(for\s+)?(.+)$/);
  if (en && en[3]) return `search for ${String(en[3]).trim()}`;

  const fr = s.match(/^(cherche|recherche)\s+(.+)$/);
  if (fr && fr[2]) return `search for ${String(fr[2]).trim()}`;

  const ar = s.match(/^(ابحث|فتش|دو[ّو]?ر|طل[ّ]?ع)(\s+عن)?\s+(.+)$/);
  if (ar && ar[3]) return `search for ${String(ar[3]).trim()}`;

  return null;
}

function parseVoiceCommand(transcript) {
  const t = String(transcript || '').trim();
  const low = t.toLowerCase();
  if (!low) return null;

  if (
    /^(help|commands|show commands|what can i say\??|what can you do\??|aide|montre les commandes|que puis-je dire\??)$/.test(low) ||
    /مساعدة|شو الاوامر|ايش الاوامر|شو بقدر احكي|ايش بقدر احكي/.test(low)
  ) {
    return { type: 'help' };
  }

  if (/^(stop|stop listening|cancel|arr[êe]te|stoppe|توقف|قف|وقف|خلاص|اسكت)$/.test(low)) {
    return { type: 'stop' };
  }

  const searchQuery = extractSearchQuery(low);
  if (searchQuery) return { type: 'open_site', query: searchQuery };

  const q = extractOpenSiteQuery(t);
  if (q) return { type: 'open_site', query: q };

  return null;
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

let newtabAssistantSession = null;

function trimAssistantMemoryText(text, maxLen = 240) {
  const raw = String(text || '').replace(/\s+/g, ' ').trim();
  if (!raw) return '';
  return raw.length > maxLen ? `${raw.slice(0, Math.max(0, maxLen - 3)).trim()}...` : raw;
}

function extractAssistantEntity(text) {
  const raw = trimAssistantMemoryText(text, 160);
  if (!raw || isSessionFollowUpText(raw)) return '';
  return trimAssistantMemoryText(
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
}

function buildNewtabAssistantSessionContext() {
  if (!newtabAssistantSession) return null;
  return {
    lastPurpose: newtabAssistantSession.lastPurpose || '',
    lastUserUtterance: newtabAssistantSession.lastUserUtterance || '',
    lastEntity: newtabAssistantSession.lastEntity || '',
    lastAssistantReply: newtabAssistantSession.lastAssistantReply || '',
    lastAnswer: newtabAssistantSession.lastAnswer || '',
    lastPage: null,
    lastAction: newtabAssistantSession.lastAction || '',
    outputLanguage: newtabAssistantSession.outputLanguage || '',
    detectedLanguage: newtabAssistantSession.detectedLanguage || '',
    recognitionProvider: newtabAssistantSession.recognitionProvider || '',
    domainHabits: null
  };
}

function rememberNewtabAssistantTurn(info = {}) {
  const existing = newtabAssistantSession || {};
  const purpose = info.purpose || existing.lastPurpose || '';
  const speech = trimAssistantMemoryText(info.speech || info.description, 260);
  const answer = trimAssistantMemoryText(info.answer, 260);
  newtabAssistantSession = {
    lastPurpose: purpose,
    lastUserUtterance: trimAssistantMemoryText(info.input, 180) || existing.lastUserUtterance || '',
    lastEntity: extractAssistantEntity(info.input) || existing.lastEntity || '',
    lastAssistantReply: speech || answer || existing.lastAssistantReply || '',
    lastAnswer: answer || existing.lastAnswer || '',
    lastAction: existing.lastAction || '',
    outputLanguage: trimAssistantMemoryText(info.outputLanguage, 24) || existing.outputLanguage || '',
    detectedLanguage: trimAssistantMemoryText(info.detectedLanguage, 24) || existing.detectedLanguage || '',
    recognitionProvider: trimAssistantMemoryText(info.recognitionProvider, 24) || existing.recognitionProvider || ''
  };
}

function assistantQuestionPurposeForText(text, sessionContext = null) {
  if (!isSessionFollowUpText(text)) return 'answer';
  const priorPurpose = sessionContext && sessionContext.lastPurpose
    ? String(sessionContext.lastPurpose).trim().toLowerCase()
    : '';
  if (priorPurpose === 'answer') return 'answer';
  return 'auto';
}

let newtabRecognizer = null;
let newtabWantsListening = false;
let newtabVoiceReady = false;
let newtabVoiceLang = 'en-US';
let newtabConfiguredVoiceLang = 'en-US';
let newtabLanguageMode = 'auto';
let newtabOutputMode = 'screen_reader';
let newtabOutputLanguage = 'en';
let newtabRecognizerRefreshTimer = null;
let newtabLastRecognitionResultAt = 0;
let newtabLastRecognitionLocaleRotateAt = 0;
let newtabVoiceTurnInFlight = false;
let newtabVoiceTurnResumeTimer = null;
let newtabPausedForVisibility = false;
let newtabTtsPlaybackInFlight = false;
let newtabTtsPlaybackToken = 0;
let newtabTtsPlaybackResumeTimer = null;

function clearNewtabRecognizerRefreshTimer() {
  if (!newtabRecognizerRefreshTimer) return;
  try {
    clearTimeout(newtabRecognizerRefreshTimer);
  } catch (_err) {
    // ignore
  }
  newtabRecognizerRefreshTimer = null;
}

function clearNewtabVoiceTurnResumeTimer() {
  if (!newtabVoiceTurnResumeTimer) return;
  try {
    clearTimeout(newtabVoiceTurnResumeTimer);
  } catch (_err) {
    // ignore
  }
  newtabVoiceTurnResumeTimer = null;
}

function clearNewtabTtsPlaybackResumeTimer() {
  if (!newtabTtsPlaybackResumeTimer) return;
  try {
    clearTimeout(newtabTtsPlaybackResumeTimer);
  } catch (_err) {
    // ignore
  }
  newtabTtsPlaybackResumeTimer = null;
}

function beginNewtabTtsPlayback() {
  newtabTtsPlaybackToken += 1;
  clearNewtabTtsPlaybackResumeTimer();
  newtabTtsPlaybackInFlight = true;
  const oldRecognizer = newtabRecognizer;
  newtabRecognizer = null;
  try {
    oldRecognizer && oldRecognizer.stop();
  } catch (_err) {
    // ignore
  }
  refreshNewtabMicUi();
  return newtabTtsPlaybackToken;
}

function finishNewtabTtsPlayback(token, cooldownMs = 450) {
  if (token !== newtabTtsPlaybackToken) return;
  clearNewtabTtsPlaybackResumeTimer();
  newtabTtsPlaybackResumeTimer = setTimeout(() => {
    if (token !== newtabTtsPlaybackToken) return;
    newtabTtsPlaybackResumeTimer = null;
    newtabTtsPlaybackInFlight = false;
    refreshNewtabMicUi();
    if (newtabVoiceTurnInFlight || !shouldNewtabListen()) return;
    ensureNewtabRecognizer()
      .then((recognizer) => {
        if (!recognizer || newtabVoiceTurnInFlight || !shouldNewtabListen()) return;
        recognizer.start();
      })
      .catch(() => {});
  }, Math.max(0, cooldownMs));
}

function isNewtabVisibleForVoice() {
  try {
    return !document.visibilityState || document.visibilityState === 'visible';
  } catch (_err) {
    return true;
  }
}

function shouldNewtabListen() {
  return !!(
    newtabWantsListening &&
    !newtabVoiceTurnInFlight &&
    !newtabPausedForVisibility &&
    !newtabTtsPlaybackInFlight &&
    isNewtabVisibleForVoice()
  );
}

function maybeRotateNewtabRecognitionLocale() {
  const now = Date.now();
  if (!newtabLastRecognitionResultAt || now - newtabLastRecognitionResultAt > 15000) return false;
  if (now - newtabLastRecognitionLocaleRotateAt < 2500) return false;

  const locales = newtabRecognitionCandidateLocales();
  if (!locales.length) return false;

  const currentKey = String(newtabVoiceLang || '').toLowerCase();
  let currentIndex = -1;
  for (let i = 0; i < locales.length; i += 1) {
    if (String(locales[i] || '').toLowerCase() === currentKey) {
      currentIndex = i;
      break;
    }
  }

  const nextVoiceLang = locales[(currentIndex + 1 + locales.length) % locales.length];
  if (!nextVoiceLang || String(nextVoiceLang).toLowerCase() === currentKey) return false;

  newtabLastRecognitionLocaleRotateAt = now;
  newtabVoiceLang = nextVoiceLang;
  refreshNewtabRecognizer({ restart: true, delayMs: 80 });
  return true;
}

function refreshNewtabMicUi() {
  const { btn, status } = getVoiceStatusEls();
  if (!btn || !status) return;

  if (!newtabVoiceReady) {
    btn.disabled = true;
    btn.textContent = 'Checking voice support…';
    status.textContent = 'Loading voice tools…';
    return;
  }

  const supported = isVoiceSupported();
  if (!supported) {
    btn.disabled = true;
    btn.textContent = 'Voice not available';
    status.textContent = 'Voice input is not available in this browser.';
    return;
  }

  btn.disabled = false;
  if (newtabVoiceTurnInFlight) {
    btn.textContent = 'Working…';
    status.textContent = translate('processing_request');
    return;
  }
  if (newtabTtsPlaybackInFlight) {
    btn.textContent = 'Speaking…';
    status.textContent = 'Playing Navable reply…';
    return;
  }
  if (newtabPausedForVisibility) {
    btn.textContent = 'Listening paused';
    status.textContent = translate('listening_paused_hidden');
    return;
  }
  btn.textContent = newtabWantsListening ? 'Stop listening' : 'Start listening';
  status.textContent = newtabWantsListening ? 'Listening…' : 'Not listening.';
}

function setNewtabMicMessage(text, mode = 'polite') {
  const msg = String(text || '').trim();
  const { status } = getVoiceStatusEls();
  if (status) status.textContent = msg || (newtabWantsListening ? 'Listening…' : 'Not listening.');
  announce(msg, mode);
}

async function loadNewtabVoiceSettings() {
  return new Promise((resolve) => {
    try {
      if (!chrome?.storage?.sync?.get) return resolve({ language: 'en-US', languageMode: 'auto', outputMode: 'screen_reader' });
      chrome.storage.sync.get({ navable_settings: {} }, (res) => {
        const s = (res && res.navable_settings) || {};
        resolve({
          language: s.language || 'en-US',
          languageMode: normalizeLanguageMode(s.languageMode, s.language || 'en-US'),
          outputMode: normalizeOutputMode(s.outputMode)
        });
      });
    } catch (_err) {
      resolve({ language: 'en-US', languageMode: 'auto', outputMode: 'screen_reader' });
    }
  });
}

async function ensureNewtabRecognizer() {
  const settings = await loadNewtabVoiceSettings();
  const previousConfiguredVoiceLang = newtabConfiguredVoiceLang;
  const previousConfiguredOutputLanguage = lockedOutputLanguage() || normalizeOutputLanguage(previousConfiguredVoiceLang || 'en-US');
  newtabOutputMode = normalizeOutputMode(settings.outputMode);
  newtabLanguageMode = normalizeLanguageMode(settings.languageMode, settings.language || 'en-US');
  newtabConfiguredVoiceLang = (() => {
    const configured = newtabRecognitionLocaleFor(settings.language || 'en-US');
    if (newtabLanguageMode === 'auto') return configured;
    if (normalizeOutputLanguage(configured) === newtabLanguageMode) return configured;
    const candidates = recognitionLocalesForLanguage(newtabLanguageMode, configured);
    return candidates[0] || outputLocale(newtabLanguageMode);
  })();
  if (
    !newtabVoiceLang ||
    String(newtabVoiceLang).toLowerCase() === String(previousConfiguredVoiceLang || '').toLowerCase() ||
    !newtabWantsListening
  ) {
    newtabVoiceLang = newtabConfiguredVoiceLang;
  }
  if (
    !newtabOutputLanguage ||
    normalizeOutputLanguage(newtabOutputLanguage) === previousConfiguredOutputLanguage ||
    !newtabWantsListening
  ) {
    newtabOutputLanguage = lockedOutputLanguage() || normalizeOutputLanguage(newtabVoiceLang);
  }

  if (newtabRecognizer) return newtabRecognizer;
  if (!isVoiceSupported()) return null;

  try {
    newtabRecognizer = window.NavableSpeech.createRecognizer({
      lang: newtabVoiceLang,
      interimResults: false,
      continuous: true,
      autoRestart: true
    });

    newtabRecognizer.on('result', (ev) => {
      if (!ev?.transcript) return;
      if (newtabVoiceTurnInFlight) return;
      handleNewtabTranscript(ev.transcript, ev.language || '', ev.provider || '');
    });

    newtabRecognizer.on('error', (e) => {
      const code = String(e?.error || 'unknown');
      const provider = String(e?.provider || '');
      if (code === 'no-speech') {
        if (provider === 'native' && maybeRotateNewtabRecognitionLocale()) return;
        return;
      }

      if (code === 'not-allowed' || code === 'service-not-allowed') {
        newtabWantsListening = false;
        refreshNewtabMicUi();
        setNewtabMicMessage(translate('mic_access_blocked'), 'assertive');
        return;
      }

      if (code === 'audio-capture' || code === 'aborted' || code === 'start-failed') {
        setNewtabMicMessage(translate('mic_busy'), 'polite');
        return;
      }

      if (code === 'network') {
        newtabWantsListening = false;
        refreshNewtabMicUi();
        setNewtabMicMessage(translate('speech_network_issue'), 'assertive');
        return;
      }

      setNewtabMicMessage(translate('speech_problem_retry'), 'assertive');
    });

    newtabRecognizer.on('start', () => {
      refreshNewtabMicUi();
    });

    newtabRecognizer.on('end', () => {
      refreshNewtabMicUi();
    });
  } catch (_err) {
    newtabRecognizer = null;
    return null;
  }

  return newtabRecognizer;
}

function refreshNewtabRecognizer(opts = {}) {
  clearNewtabRecognizerRefreshTimer();

  const shouldResume = opts.restart !== false && shouldNewtabListen();
  const delayMs = typeof opts.delayMs === 'number' ? opts.delayMs : 180;
  const oldRecognizer = newtabRecognizer;

  newtabRecognizer = null;

  if (oldRecognizer) {
    try {
      oldRecognizer.stop({ silent: true });
    } catch (_err) {
      // ignore
    }
  }

  if (!shouldResume) return;

  newtabRecognizerRefreshTimer = setTimeout(() => {
    newtabRecognizerRefreshTimer = null;
    ensureNewtabRecognizer()
      .then((recognizer) => {
        if (!recognizer || !shouldNewtabListen()) return;
        recognizer.start();
      })
      .catch(() => {});
  }, oldRecognizer ? Math.max(0, delayMs) : 0);
}

function maybeRefreshNewtabRecognizerLanguage(transcript, detectedLanguage, provider) {
  if (String(provider || '').toLowerCase() !== 'native') return;
  const nextLanguage = detectNewtabRecognitionLanguage(transcript, detectedLanguage);
  const nextVoiceLang = recognitionLocalesForLanguage(
    nextLanguage,
    newtabConfiguredVoiceLang || newtabVoiceLang || outputLocale(nextLanguage)
  )[0] || newtabRecognitionLocaleFor(nextLanguage);
  if (currentLanguageMode() !== 'auto' && normalizeOutputLanguage(nextVoiceLang) !== currentLanguageMode()) return;
  if (!nextVoiceLang) return;
  if (String(nextVoiceLang).toLowerCase() === String(newtabVoiceLang || '').toLowerCase()) return;
  newtabVoiceLang = nextVoiceLang;
  refreshNewtabRecognizer({ restart: true });
}

function beginNewtabVoiceTurn() {
  if (newtabVoiceTurnInFlight) return false;
  clearNewtabVoiceTurnResumeTimer();
  newtabVoiceTurnInFlight = true;
  if (newtabWantsListening) {
    const oldRecognizer = newtabRecognizer;
    newtabRecognizer = null;
    try {
      oldRecognizer && oldRecognizer.stop();
    } catch (_err) {
      // ignore
    }
    refreshNewtabMicUi();
  }
  setNewtabMicMessage(translate('processing_request'), 'polite');
  return true;
}

function finishNewtabVoiceTurn(opts = {}) {
  clearNewtabVoiceTurnResumeTimer();
  newtabVoiceTurnInFlight = false;
  const delayMs = typeof opts.delayMs === 'number' ? opts.delayMs : 900;
  if (!newtabWantsListening || !shouldNewtabListen()) return;
  newtabVoiceTurnResumeTimer = setTimeout(() => {
    newtabVoiceTurnResumeTimer = null;
    if (newtabVoiceTurnInFlight || !shouldNewtabListen()) return;
    ensureNewtabRecognizer()
      .then((recognizer) => {
        if (!recognizer || newtabVoiceTurnInFlight || !shouldNewtabListen()) return;
        recognizer.start();
      })
      .catch(() => {});
  }, Math.max(0, delayMs));
}

function pauseNewtabListeningForVisibility() {
  if (newtabPausedForVisibility) return;
  newtabPausedForVisibility = true;
  clearNewtabRecognizerRefreshTimer();
  clearNewtabVoiceTurnResumeTimer();
  const oldRecognizer = newtabRecognizer;
  newtabRecognizer = null;
  try {
    oldRecognizer && oldRecognizer.stop({ silent: true });
  } catch (_err) {
    // ignore
  }
  refreshNewtabMicUi();
}

function resumeNewtabListeningFromVisibility() {
  if (!newtabPausedForVisibility) return;
  newtabPausedForVisibility = false;
  if (!shouldNewtabListen()) {
    refreshNewtabMicUi();
    return;
  }
  ensureNewtabRecognizer()
    .then((recognizer) => {
      if (!recognizer || !shouldNewtabListen()) {
        refreshNewtabMicUi();
        return;
      }
      recognizer.start();
    })
    .catch(() => {});
}

async function openSiteFromVoice(query) {
  const q = String(query || '').trim();
  if (!q) return;

  try {
    if (chrome?.runtime?.sendMessage) {
      const res = await chrome.runtime.sendMessage({
        type: 'navable:openSite',
        query: q,
        newTab: false,
        outputLanguage: currentOutputLanguage()
      });
      if (res?.ok) return;
      setNewtabMicMessage(res?.error || translate('open_site_failed'), 'assertive');
      return;
    }
  } catch (_err) {
    // fall through
  }

  const url = resolveQueryToUrl(q);
  if (!url) {
    setNewtabMicMessage(translate('missing_url'), 'assertive');
    return;
  }
  await openUrl(url);
}

async function assistantQuestionFromVoice(questionText, turnContext = {}) {
  const q = String(questionText || '').trim();
  if (!q) return false;
  const sessionContext = buildNewtabAssistantSessionContext();
  const purpose = assistantQuestionPurposeForText(q, sessionContext);

  await ensureOutputLanguageReady();
  setNewtabMicMessage(translate('answering_question'), 'polite');

  if (chrome?.runtime?.sendMessage) {
    try {
      const res = await chrome.runtime.sendMessage({
        type: 'navable:assistant',
        input: q,
        outputLanguage: currentOutputLanguage(),
        purpose,
        pageContext: false,
        autoExecutePlan: false,
        detectedLanguage: turnContext.detectedLanguage || '',
        recognitionProvider: turnContext.recognitionProvider || ''
      });
      if (res?.ok && res.speech) {
        const rememberedPurpose = purpose === 'auto' ? (res.mode === 'page' ? 'page' : 'answer') : purpose;
        rememberNewtabAssistantTurn({
          input: q,
          purpose: rememberedPurpose,
          speech: res.speech,
          answer: res.answer || '',
          outputLanguage: currentOutputLanguage(),
          detectedLanguage: turnContext.detectedLanguage || '',
          recognitionProvider: turnContext.recognitionProvider || ''
        });
        setNewtabMicMessage(String(res.speech), 'assertive');
        return true;
      }
      if (res?.error) {
        console.warn('[Navable] newtab assistant background request returned error', res.error);
      }
    } catch (err) {
      console.warn('[Navable] newtab answer failed', err);
    }
  }

  try {
    const response = await window.fetch('http://localhost:3000/api/assistant', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: q,
        outputLanguage: currentOutputLanguage(),
        purpose,
        sessionContext
      })
    });
    const data = await response.json().catch(() => ({}));
    if (response.ok && data?.action?.type === 'open_site' && data.action.query) {
      await openSiteFromVoice(data.action.query);
      return true;
    }
    if (response.ok && data?.speech) {
      const rememberedPurpose = purpose === 'auto' ? (data.mode === 'page' ? 'page' : 'answer') : purpose;
      rememberNewtabAssistantTurn({
        input: q,
        purpose: rememberedPurpose,
        speech: data.speech,
        answer: data.answer || '',
        outputLanguage: currentOutputLanguage(),
        detectedLanguage: turnContext.detectedLanguage || '',
        recognitionProvider: turnContext.recognitionProvider || ''
      });
      setNewtabMicMessage(String(data.speech), 'assertive');
      return true;
    }
    if (data?.error) {
      setNewtabMicMessage(String(data.error), 'assertive');
      return true;
    }
  } catch (err) {
    console.warn('[Navable] newtab direct assistant request failed', err);
  }

  setNewtabMicMessage(translate('answer_failed'), 'assertive');
  return true;
}

async function handleNewtabTranscript(transcript, detectedLanguage, provider) {
  if (!beginNewtabVoiceTurn()) return false;
  try {
    newtabLastRecognitionResultAt = Date.now();
    maybeRefreshNewtabRecognizerLanguage(transcript, detectedLanguage, provider);
    setNewtabOutputLanguage(transcript, detectedLanguage);
    const languageReady = ensureOutputLanguageReady();
    const cmd = parseVoiceCommand(transcript);
    if (!cmd) {
      if (await assistantQuestionFromVoice(transcript, {
        detectedLanguage: detectedLanguage || '',
        recognitionProvider: provider || ''
      })) return true;
      await languageReady;
      setNewtabMicMessage(translate('newtab_try_open'), 'polite');
      return true;
    }

    if (cmd.type === 'help') {
      await languageReady;
      setNewtabMicMessage(translate('newtab_help_examples'), 'assertive');
      return true;
    }

    if (cmd.type === 'stop') {
      await languageReady;
      stopNewtabListening({ announce: true });
      return true;
    }

    if (cmd.type === 'open_site') {
      languageReady.then(() => {
        setNewtabMicMessage(translate('opening_site', { value: cmd.query }), 'assertive');
      }).catch(() => {});
      await openSiteFromVoice(cmd.query);
    }
    return true;
  } finally {
    finishNewtabVoiceTurn({ delayMs: 900 });
  }
}

async function startNewtabListening() {
  newtabWantsListening = true;
  newtabPausedForVisibility = !isNewtabVisibleForVoice();
  refreshNewtabMicUi();

  if (!shouldNewtabListen()) return;

  if (prefersNewtabChromeTtsOutput()) {
    setNewtabMicMessage(translate('newtab_listening'), 'polite');
    return;
  }

  const recognizer = await ensureNewtabRecognizer();
  if (!recognizer) {
    newtabWantsListening = false;
    newtabVoiceReady = true;
    refreshNewtabMicUi();
    setNewtabMicMessage(translate('voice_unavailable_browser'), 'assertive');
    return;
  }

  recognizer.start();
  setNewtabMicMessage(translate('newtab_listening'), 'polite');
}

function stopNewtabListening(opts = {}) {
  newtabWantsListening = false;
  newtabPausedForVisibility = false;
  refreshNewtabMicUi();
  clearNewtabRecognizerRefreshTimer();
  clearNewtabVoiceTurnResumeTimer();
  newtabVoiceTurnInFlight = false;
  const oldRecognizer = newtabRecognizer;
  newtabRecognizer = null;
  try {
    oldRecognizer && oldRecognizer.stop();
  } catch (_err) {
    // ignore
  }
  if (opts.announce) setNewtabMicMessage(translate('stopped_listening'), 'polite');
}

async function toggleNewtabListening() {
  if (newtabWantsListening) {
    stopNewtabListening({ announce: true });
    return;
  }
  await startNewtabListening();
}

function wireNewtabVoice() {
  newtabVoiceReady = true;
  loadNewtabVoiceSettings().then((settings) => {
    newtabOutputMode = normalizeOutputMode(settings.outputMode);
  }).catch(() => {});
  refreshNewtabMicUi();

  const { btn } = getVoiceStatusEls();
  if (btn) {
    btn.addEventListener('click', () => {
      toggleNewtabListening().catch((err) => {
        console.warn('[Navable] newtab voice toggle failed', err);
      });
    });
  }

  document.addEventListener(
    'keydown',
    (e) => {
      if (e.altKey && e.shiftKey && (e.key === 'm' || e.key === 'M')) {
        e.preventDefault();
        toggleNewtabListening().catch(() => {});
      }
    },
    { capture: true }
  );

  document.addEventListener(
    'visibilitychange',
    () => {
      if (document.visibilityState !== 'visible') {
        if (newtabWantsListening) pauseNewtabListeningForVisibility();
        return;
      }
      if (newtabPausedForVisibility) resumeNewtabListeningFromVisibility();
    },
    { capture: true }
  );

  window.addEventListener(
    'pagehide',
    () => {
      requestNewtabChromeTtsStop();
      if (newtabWantsListening) stopNewtabListening({ announce: false });
    },
    { capture: true }
  );

  if (chrome?.storage?.onChanged?.addListener) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'sync' || !changes.navable_settings) return;
      const nextSettings = changes.navable_settings.newValue || {};
      const nextOutputMode = normalizeOutputMode(nextSettings.outputMode);
      if (nextOutputMode !== newtabOutputMode) requestNewtabChromeTtsStop();
      newtabOutputMode = nextOutputMode;
    });
  }

  if (!isVoiceSupported()) {
    const { btn: btn2 } = getVoiceStatusEls();
    if (btn2) btn2.disabled = true;
    setNewtabMicMessage(translate('voice_unavailable_browser'), 'polite');
  }
}

function wireNewtab() {
  updateHeader();
  setInterval(updateHeader, 10_000);

  const searchForm = document.getElementById('searchForm');
  const searchInput = document.getElementById('searchInput');

  if (searchForm && searchInput) {
    searchForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const url = resolveQueryToUrl(searchInput.value);
      await openUrl(url);
    });
  }

  document.querySelectorAll('[data-open]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const url = btn.getAttribute('data-open');
      await openUrl(url);
    });
  });

  const openWikipedia = document.getElementById('openWikipedia');
  if (openWikipedia) openWikipedia.addEventListener('click', () => openUrl('https://wikipedia.org'));

  const openExample = document.getElementById('openExample');
  if (openExample) openExample.addEventListener('click', () => openUrl('https://example.com'));

  const openShortcuts = document.getElementById('openShortcuts');
  if (openShortcuts) {
    openShortcuts.addEventListener('click', async () => {
      try {
        if (chrome?.tabs?.create) {
          await chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
          return;
        }
      } catch (_err) {
        // fall through
      }
      window.open('chrome://extensions/shortcuts', '_blank', 'noopener,noreferrer');
    });
  }

  wireNewtabVoice();
}

document.addEventListener('DOMContentLoaded', wireNewtab);

window.NavableNewtabTools = {
  handleTranscript: handleNewtabTranscript,
  assistantQuestionFromVoice
};
