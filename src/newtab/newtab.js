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
      window.NavableAnnounce.speak(msg, { mode: mode === 'assertive' ? 'assertive' : 'polite' });
    }
  } catch (_err) {
    // ignore
  }
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

  // Arabic: "افتح <شيء>"
  const ar = s.match(/^افتح\s+(.+)$/);
  if (ar && ar[1]) return String(ar[1]).trim();

  // English: "open (me) <site>"
  if (!/^(open|navigate to|go to|take me to)\b/.test(s)) return null;

  const q = s
    .replace(/^(open(\s+up)?|navigate to|go to|take me to)\b/, '')
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

function parseVoiceCommand(transcript) {
  const t = String(transcript || '').trim();
  const low = t.toLowerCase();
  if (!low) return null;

  if (/^(help|commands|show commands|what can i say\??)$/.test(low) || /مساعدة/.test(low)) {
    return { type: 'help' };
  }

  if (/^(stop|stop listening|cancel)$/.test(low)) {
    return { type: 'stop' };
  }

  const searchMatch = low.match(/^(search|google)\s+(for\s+)?(.+)$/);
  if (searchMatch && searchMatch[3]) {
    return { type: 'open_site', query: `search for ${searchMatch[3]}` };
  }

  const q = extractOpenSiteQuery(t);
  if (q) return { type: 'open_site', query: q };

  return null;
}

let newtabRecognizer = null;
let newtabWantsListening = false;
let newtabVoiceReady = false;
let newtabVoiceLang = 'en-US';

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

  try {
    newtabRecognizer = window.NavableSpeech.createRecognizer({
      lang: newtabVoiceLang,
      interimResults: false,
      continuous: true,
      autoRestart: true
    });

    newtabRecognizer.on('result', (ev) => {
      if (!ev?.transcript) return;
      handleNewtabTranscript(ev.transcript);
    });

    newtabRecognizer.on('error', (e) => {
      const code = String(e?.error || 'unknown');
      if (code === 'no-speech') return;

      if (code === 'not-allowed' || code === 'service-not-allowed') {
        newtabWantsListening = false;
        refreshNewtabMicUi();
        setNewtabMicMessage('Microphone access is blocked. Allow microphone for this extension to use voice.', 'assertive');
        return;
      }

      if (code === 'audio-capture' || code === 'aborted' || code === 'start-failed') {
        setNewtabMicMessage('Microphone is busy. Close other apps/tabs using the mic, then try again.', 'polite');
        return;
      }

      if (code === 'network') {
        newtabWantsListening = false;
        refreshNewtabMicUi();
        setNewtabMicMessage('Speech recognition is unavailable due to a network issue.', 'assertive');
        return;
      }

      setNewtabMicMessage('Speech recognition had a problem. Please try again.', 'assertive');
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
      const res = await chrome.runtime.sendMessage({ type: 'navable:openSite', query: q, newTab: false });
      if (res?.ok) return;
      setNewtabMicMessage(res?.error || 'Could not open that website.', 'assertive');
      return;
    }
  } catch (_err) {
    // fall through
  }

  const url = resolveQueryToUrl(q);
  if (!url) {
    setNewtabMicMessage('Missing website name or URL.', 'assertive');
    return;
  }
  await openUrl(url);
}

async function handleNewtabTranscript(transcript) {
  const cmd = parseVoiceCommand(transcript);
  if (!cmd) {
    setNewtabMicMessage('I did not catch that. Try: “Open YouTube”.', 'polite');
    return;
  }

  if (cmd.type === 'help') {
    setNewtabMicMessage('Try: “Open YouTube”, “Open example dot com”, “Search for weather”.', 'assertive');
    return;
  }

  if (cmd.type === 'stop') {
    stopNewtabListening({ announce: true });
    return;
  }

  if (cmd.type === 'open_site') {
    setNewtabMicMessage(`Opening ${cmd.query}…`, 'assertive');
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
    setNewtabMicMessage('Voice input is not available in this browser.', 'assertive');
    return;
  }

  recognizer.start();
  setNewtabMicMessage('Listening… Say “Open YouTube”.', 'polite');
}

function stopNewtabListening(opts = {}) {
  newtabWantsListening = false;
  refreshNewtabMicUi();
  try {
    newtabRecognizer && newtabRecognizer.stop();
  } catch (_err) {
    // ignore
  }
  if (opts.announce) setNewtabMicMessage('Stopped listening.', 'polite');
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
    setNewtabMicMessage('Voice input is not available in this browser.', 'polite');
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
