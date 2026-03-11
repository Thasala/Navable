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

function getVoiceStatusEls() {
  return {
    btn: document.getElementById('btnMicToggle'),
    status: document.getElementById('micStatus')
  };
}

let lastVoiceStatus = null;

function setNewtabMicMessage(text, mode = 'polite') {
  const msg = String(text || '').trim();
  const { status } = getVoiceStatusEls();
  if (status) status.textContent = msg || 'Not listening.';
  announce(msg, mode);
}

function updateNewtabMicUiFromStatus(status) {
  const { btn, status: statusEl } = getVoiceStatusEls();
  if (!btn || !statusEl) return;

  if (!status || status.ok !== true) {
    btn.disabled = true;
    btn.textContent = 'Voice unavailable';
    statusEl.textContent = (status && status.error) ? String(status.error) : 'Voice status is unavailable.';
    return;
  }

  if (!status.supports) {
    btn.disabled = true;
    btn.textContent = 'Voice not supported';
    statusEl.textContent = 'Voice recognition is not supported in this browser.';
    return;
  }

  btn.disabled = false;
  if (!status.permissionGranted) {
    btn.textContent = 'Enable microphone';
    statusEl.textContent = 'Grant microphone access once for the extension.';
    return;
  }

  btn.textContent = status.listening ? 'Stop listening' : 'Start listening';
  statusEl.textContent = status.listening ? 'Listening...' : 'Not listening.';
}

async function requestVoiceStatus() {
  try {
    const res = await chrome.runtime.sendMessage({ type: 'voice:getStatus' });
    lastVoiceStatus = res || null;
    return lastVoiceStatus;
  } catch (err) {
    lastVoiceStatus = { ok: false, error: String(err || 'voice-status-failed') };
    return lastVoiceStatus;
  }
}

async function refreshNewtabMicStatus() {
  const status = await requestVoiceStatus();
  if (status && status.language) {
    newtabVoiceLang = String(status.language || 'en-US');
    newtabOutputLanguage = normalizeOutputLanguage(status.language || 'en-US');
  }
  updateNewtabMicUiFromStatus(status);
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

function extractCompoundSiteSearchQuery(transcript) {
  const raw = String(transcript || '').trim();
  if (!raw) return null;
  const match = raw.match(/^(?:open|navigate to|go to|take me to)\s+(.+?)\s+and\s+(?:search|google)\s+(?:for\s+)?(.+?)\s*$/i);
  if (!match || !match[1] || !match[2]) return null;

  const siteQuery = String(match[1] || '')
    .replace(/^(a|an|the)\s+/i, '')
    .replace(/^(new\s+)?tab\s+/i, '')
    .replace(/^(website|site|page)\s+/i, '')
    .replace(/\bplease\b/gi, '')
    .trim();
  const searchQuery = String(match[2] || '').trim();
  if (!siteQuery || !searchQuery) return null;
  return `search ${searchQuery} on ${siteQuery}`;
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
  const spokenText = String(transcript || '').trim();
  const low = spokenText.toLowerCase();
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

  const compoundSiteSearchQuery = extractCompoundSiteSearchQuery(spokenText);
  if (compoundSiteSearchQuery) {
    return { type: 'open_site', query: compoundSiteSearchQuery };
  }

  const searchQuery = extractSearchQuery(low);
  if (searchQuery) return { type: 'open_site', query: searchQuery };

  const searchMatch = low.match(/^(search|google)\s+(for\s+)?(.+)$/);
  if (searchMatch && searchMatch[3]) {
    return { type: 'open_site', query: spokenText };
  }

  const q = extractOpenSiteQuery(spokenText);
  if (q) return { type: 'open_site', query: q };

  return null;
}

let newtabVoiceLang = 'en-US';
let newtabOutputLanguage = 'en';
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

async function handleNewtabVoiceCommand(text) {
  const transcript = String(text || '').trim();
  if (!transcript) return false;

  setNewtabOutputLanguage(transcript, '');
  const languageReady = ensureOutputLanguageReady();
  const cmd = parseVoiceCommand(transcript);

  if (!cmd) {
    if (await assistantQuestionFromVoice(transcript)) return true;
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
    await chrome.runtime.sendMessage({ type: 'voice:stop' }).catch(() => {});
    await refreshNewtabMicStatus();
    return true;
  }

  if (cmd.type === 'open_site') {
    await languageReady;
    setNewtabMicMessage(translate('opening_site', { value: cmd.query }), 'assertive');
    await openSiteFromVoice(cmd.query);
    return true;
  }

  return false;
}
function wireNewtabVoice() {
  const { btn } = getVoiceStatusEls();
  if (btn) {
    btn.addEventListener('click', async () => {
      try {
        const { status } = getVoiceStatusEls();
        if (status) status.textContent = 'Updating microphone...';
        const current = lastVoiceStatus || (await requestVoiceStatus());
        const action = (current && current.permissionGranted) ? 'voice:toggle' : 'voice:requestPermission';
        const res = await chrome.runtime.sendMessage({ type: action });
        lastVoiceStatus = res || current || null;
        updateNewtabMicUiFromStatus(lastVoiceStatus);
      } catch (err) {
        updateNewtabMicUiFromStatus({ ok: false, error: String(err || 'voice-toggle-failed') });
      } finally {
        setTimeout(refreshNewtabMicStatus, 200);
      }
    });
  }

  document.addEventListener(
    'keydown',
    (e) => {
      if (e.altKey && e.shiftKey && (e.key === 'm' || e.key === 'M')) {
        e.preventDefault();
        if (!chrome?.runtime?.sendMessage) return;
        chrome.runtime.sendMessage({ type: 'voice:toggle' }).catch(() => {});
        setTimeout(refreshNewtabMicStatus, 200);
      }
    },
    { capture: true }
  );

  if (chrome?.runtime?.onMessage?.addListener) {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg && msg.type === 'voice:status') {
        lastVoiceStatus = msg.status || lastVoiceStatus;
        if (lastVoiceStatus && lastVoiceStatus.language) {
          newtabVoiceLang = String(lastVoiceStatus.language || 'en-US');
          newtabOutputLanguage = normalizeOutputLanguage(lastVoiceStatus.language || 'en-US');
        }
        updateNewtabMicUiFromStatus(lastVoiceStatus);
      }
      if (msg && (msg.type === 'VOICE_COMMAND' || msg.type === 'navable:voiceTranscript')) {
        handleNewtabVoiceCommand(msg.text || '').catch(() => {});
      }
    });
  }

  refreshNewtabMicStatus();
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
  handleTranscript: handleNewtabVoiceCommand,
  assistantQuestionFromVoice
};
