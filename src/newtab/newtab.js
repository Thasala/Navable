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
    if (window.NavableAnnounce && typeof window.NavableAnnounce.speak === 'function') {
      window.NavableAnnounce.speak(msg, {
        mode: mode === 'assertive' ? 'assertive' : 'polite',
        lang: outputLocale(currentOutputLanguage())
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

function currentOutputLanguage() {
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
  if (detectedLanguage) {
    newtabOutputLanguage = normalizeOutputLanguage(detectedLanguage);
    return newtabOutputLanguage;
  }
  newtabOutputLanguage = resolveTranscriptLanguage(transcript);
  return newtabOutputLanguage;
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

function extractOpenSiteQuery(transcript) {
  const s = String(transcript || '').trim().toLowerCase();
  if (!s) return null;

  // Arabic website intents.
  const ar = s.match(/^(افتح|اذهب\s+إلى|اذهب\s+الى|روح\s+على|روح\s+إلى|روح\s+الى|انتقل\s+إلى|انتقل\s+الى)\s+(.+)$/);
  if (ar && ar[2]) return String(ar[2]).trim();

  // French website intents.
  const fr = s.match(/^(ouvre|va(?:s)?\s+(?:a|à)|aller?\s+(?:a|à)|visite|lance)\s+(.+)$/);
  if (fr && fr[2]) {
    return String(fr[2])
      .trim()
      .replace(/^(le|la|les|un|une)\b/, '')
      .trim()
      .replace(/^(site|page|onglet)\b/, '')
      .trim();
  }

  // English: flexible website intents.
  if (!/^(open|navigate to|go to|take me to|visit|bring up|launch)\b/.test(s)) return null;

  const q = s
    .replace(/^(open(\s+up)?|navigate to|go to|take me to|visit|bring up|launch)\b/, '')
    .trim()
    .replace(/^(me|for me)\b/, '')
    .trim()
    .replace(/^(a|an|the)\b/, '')
    .trim()
    .replace(/^(new\s+)?tab\b/, '')
    .trim()
    .replace(/^(website|site|page)\b/, '')
    .trim()
    .replace(/\bplease\b/g, '')
    .trim();

  return q || null;
}

function extractSearchQuery(transcript) {
  const s = String(transcript || '').trim().toLowerCase();
  if (!s) return null;

  const en = s.match(/^(search|google|look up|find)\s+(for\s+)?(.+)$/);
  if (en && en[3]) return `search for ${String(en[3]).trim()}`;

  const fr = s.match(/^(cherche|recherche)\s+(.+)$/);
  if (fr && fr[2]) return `search for ${String(fr[2]).trim()}`;

  const ar = s.match(/^(ابحث|فتش)(\s+عن)?\s+(.+)$/);
  if (ar && ar[3]) return `search for ${String(ar[3]).trim()}`;

  return null;
}

function parseVoiceCommand(transcript) {
  const t = String(transcript || '').trim();
  const low = t.toLowerCase();
  if (!low) return null;

  if (
    /^(help|commands|show commands|what can i say\??|aide|montre les commandes|que puis-je dire\??)$/.test(low) ||
    /مساعدة/.test(low)
  ) {
    return { type: 'help' };
  }

  if (/^(stop|stop listening|cancel|arr[êe]te|stoppe|توقف|قف)$/.test(low)) {
    return { type: 'stop' };
  }

  const searchQuery = extractSearchQuery(low);
  if (searchQuery) return { type: 'open_site', query: searchQuery };

  const q = extractOpenSiteQuery(t);
  if (q) return { type: 'open_site', query: q };

  return null;
}

let newtabRecognizer = null;
let newtabWantsListening = false;
let newtabVoiceReady = false;
let newtabVoiceLang = 'en-US';
let newtabOutputLanguage = 'en';

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
      if (!chrome?.storage?.sync?.get) return resolve({ language: 'en-US' });
      chrome.storage.sync.get({ navable_settings: {} }, (res) => {
        const s = (res && res.navable_settings) || {};
        resolve({ language: s.language || 'en-US' });
      });
    } catch (_err) {
      resolve({ language: 'en-US' });
    }
  });
}

async function ensureNewtabRecognizer() {
  if (newtabRecognizer) return newtabRecognizer;
  if (!isVoiceSupported()) return null;

  const settings = await loadNewtabVoiceSettings();
  newtabVoiceLang = settings.language || 'en-US';
  newtabOutputLanguage = normalizeOutputLanguage(newtabVoiceLang);

  try {
    newtabRecognizer = window.NavableSpeech.createRecognizer({
      lang: newtabVoiceLang,
      interimResults: false,
      continuous: true,
      autoRestart: true
    });

    newtabRecognizer.on('result', (ev) => {
      if (!ev?.transcript) return;
      handleNewtabTranscript(ev.transcript, ev.language || '');
    });

    newtabRecognizer.on('error', (e) => {
      const code = String(e?.error || 'unknown');
      if (code === 'no-speech') return;

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

async function assistantQuestionFromVoice(questionText) {
  const q = String(questionText || '').trim();
  if (!q) return false;

  await ensureOutputLanguageReady();
  setNewtabMicMessage(translate('answering_question'), 'polite');

  if (chrome?.runtime?.sendMessage) {
    try {
      const res = await chrome.runtime.sendMessage({
        type: 'navable:assistant',
        input: q,
        outputLanguage: currentOutputLanguage(),
        pageContext: false,
        autoExecutePlan: false
      });
      if (res?.ok && res.speech) {
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
        outputLanguage: currentOutputLanguage()
      })
    });
    const data = await response.json().catch(() => ({}));
    if (response.ok && data?.speech) {
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

async function handleNewtabTranscript(transcript, detectedLanguage) {
  setNewtabOutputLanguage(transcript, detectedLanguage);
  const languageReady = ensureOutputLanguageReady();
  const cmd = parseVoiceCommand(transcript);
  if (!cmd) {
    if (await assistantQuestionFromVoice(transcript)) return;
    await languageReady;
    setNewtabMicMessage(translate('newtab_try_open'), 'polite');
    return;
  }

  if (cmd.type === 'help') {
    await languageReady;
    setNewtabMicMessage(translate('newtab_help_examples'), 'assertive');
    return;
  }

  if (cmd.type === 'stop') {
    await languageReady;
    stopNewtabListening({ announce: true });
    return;
  }

  if (cmd.type === 'open_site') {
    languageReady.then(() => {
      setNewtabMicMessage(translate('opening_site', { value: cmd.query }), 'assertive');
    }).catch(() => {});
    await openSiteFromVoice(cmd.query);
  }
}

async function startNewtabListening() {
  newtabWantsListening = true;
  refreshNewtabMicUi();

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
  refreshNewtabMicUi();
  try {
    newtabRecognizer && newtabRecognizer.stop();
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
      if (document.visibilityState !== 'visible' && newtabWantsListening) {
        stopNewtabListening({ announce: false });
      }
    },
    { capture: true }
  );

  window.addEventListener(
    'pagehide',
    () => {
      if (newtabWantsListening) stopNewtabListening({ announce: false });
    },
    { capture: true }
  );

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
