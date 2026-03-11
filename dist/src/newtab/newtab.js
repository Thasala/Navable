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
  updateNewtabMicUiFromStatus(status);
}

function extractOpenSiteQuery(transcript) {
  const s = String(transcript || '').trim().toLowerCase();
  if (!s) return null;

  const ar = s.match(/^ط§ظپطھط­\s+(.+)$/);
  if (ar && ar[1]) return String(ar[1]).trim();
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

function parseVoiceCommand(transcript) {
  const spokenText = String(transcript || '').trim();
  const low = spokenText.toLowerCase();
  if (!low) return null;

  if (/^(help|commands|show commands|what can i say\??)$/.test(low) || /ظ…ط³ط§ط¹ط¯ط©/.test(low)) {
    return { type: 'help' };
  }

  if (/^(stop|stop listening|cancel)$/.test(low)) {
    return { type: 'stop' };
  }

  const compoundSiteSearchQuery = extractCompoundSiteSearchQuery(spokenText);
  if (compoundSiteSearchQuery) {
    return { type: 'open_site', query: compoundSiteSearchQuery };
  }

  const searchMatch = low.match(/^(search|google)\s+(for\s+)?(.+)$/);
  if (searchMatch && searchMatch[3]) {
    return { type: 'open_site', query: spokenText };
  }

  const q = extractOpenSiteQuery(spokenText);
  if (q) return { type: 'open_site', query: q };

  return null;
}

async function openSiteFromVoice(query) {
  const q = String(query || '').trim();
  if (!q) return;

  try {
    const res = await chrome.runtime.sendMessage({ type: 'navable:openSite', query: q, newTab: false });
    if (res?.ok) return;
    setNewtabMicMessage(res?.error || 'Could not open that website.', 'assertive');
    return;
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

async function handleNewtabVoiceCommand(text) {
  const cmd = parseVoiceCommand(text);
  if (!cmd) {
    setNewtabMicMessage('I did not catch that. Try: "Open YouTube".', 'polite');
    return;
  }

  if (cmd.type === 'help') {
    setNewtabMicMessage('Try: "Open YouTube", "Open example dot com", "Search for weather".', 'assertive');
    return;
  }

  if (cmd.type === 'stop') {
    await chrome.runtime.sendMessage({ type: 'voice:stop' }).catch(() => {});
    await refreshNewtabMicStatus();
    return;
  }

  if (cmd.type === 'open_site') {
    setNewtabMicMessage(`Opening ${cmd.query}...`, 'assertive');
    await openSiteFromVoice(cmd.query);
  }
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
