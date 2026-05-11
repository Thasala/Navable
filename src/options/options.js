let currentLanguageLocale = 'en-US';

function normalizeLanguageMode(mode, _locale) {
  const raw = String(mode || '').trim().toLowerCase();
  if (raw === 'auto') return 'auto';
  if (!raw) return 'auto';
  if (raw === 'en' || raw === 'english' || raw.startsWith('en-')) return 'en';
  if (raw === 'ar' || raw === 'arabic' || raw.startsWith('ar-')) return 'ar';
  return 'auto';
}

function normalizeOutputMode(mode) {
  const raw = String(mode || '').trim().toLowerCase();
  if (raw === 'chrome_tts' || raw === 'chrome-tts' || raw === 'chrome tts') return 'chrome_tts';
  return 'screen_reader';
}

function localeForLanguageMode(mode, locale) {
  const normalized = normalizeLanguageMode(mode, locale);
  const current = String(locale || '').trim();
  if (normalized === 'ar') return current.toLowerCase().startsWith('ar') ? current : 'ar-JO';
  if (normalized === 'en') return current.toLowerCase().startsWith('en') ? current : 'en-US';
  return current || 'en-US';
}

function loadSettings() {
  if (!chrome || !chrome.storage || !chrome.storage.sync) return;
  chrome.storage.sync.get({ navable_settings: {} }, (res) => {
    const s = res.navable_settings || {};
    const languageMode = document.getElementById('languageMode');
    const outputMode = document.getElementById('outputMode');
    const continuous = document.getElementById('continuous');
    const aiEnabled = document.getElementById('aiEnabled');
    const noFormFields = document.getElementById('noFormFields');
    const noSensitiveSites = document.getElementById('noSensitiveSites');

    currentLanguageLocale = s.language || 'en-US';
    if (languageMode) languageMode.value = normalizeLanguageMode(s.languageMode, currentLanguageLocale);
    if (outputMode) outputMode.value = normalizeOutputMode(s.outputMode);
    if (continuous) continuous.checked = typeof s.autostart === 'boolean' ? s.autostart : true;
    if (aiEnabled) aiEnabled.checked = !!s.aiEnabled;
    if (noFormFields) noFormFields.checked = true; // always enforced by design
    if (noSensitiveSites) noSensitiveSites.checked = !!s.noSensitiveSites;
  });
}

function saveSettings() {
  if (!chrome || !chrome.storage || !chrome.storage.sync) return;
  const languageMode = document.getElementById('languageMode');
  const outputMode = document.getElementById('outputMode');
  const continuous = document.getElementById('continuous');
  const aiEnabled = document.getElementById('aiEnabled');
  const noSensitiveSites = document.getElementById('noSensitiveSites');
  const saveStatus = document.getElementById('saveStatus');
  const normalizedLanguageMode = normalizeLanguageMode(languageMode ? languageMode.value : 'auto', currentLanguageLocale);
  currentLanguageLocale = localeForLanguageMode(normalizedLanguageMode, currentLanguageLocale);

  const navable_settings = {
    language: currentLanguageLocale,
    languageMode: normalizedLanguageMode,
    outputMode: normalizeOutputMode(outputMode ? outputMode.value : 'screen_reader'),
    overlay: false,
    autostart: continuous ? continuous.checked : true,
    aiEnabled: aiEnabled ? aiEnabled.checked : false,
    noSensitiveSites: noSensitiveSites ? noSensitiveSites.checked : false
  };

  chrome.storage.sync.set({ navable_settings }, () => {
    if (saveStatus) {
      saveStatus.textContent = 'Settings saved.';
      setTimeout(() => { saveStatus.textContent = ''; }, 1500);
    }
  });
}

function setButtonLabel(button, label) {
  if (!button) return;
  const text = String(label || '');
  button.setAttribute('aria-label', text);
  button.setAttribute('title', text);
  const labelTarget = button.querySelector('[data-button-label]');
  if (labelTarget) labelTarget.textContent = text;
  else if (!button.querySelector('svg')) button.textContent = text;
}

function setVoiceStatus(text) {
  const status = document.getElementById('micStatus');
  if (status) status.textContent = text || '';
}

function optionsVoiceTools() {
  return window.NavableTools || null;
}

function optionsSpeechStatus() {
  const tools = optionsVoiceTools();
  if (!tools || typeof tools.getSpeechStatus !== 'function') {
    return { ok: false, supports: false, listening: false };
  }
  return tools.getSpeechStatus();
}

function refreshOptionsVoiceUi() {
  const btn = document.getElementById('btnMicToggle');
  if (!btn) return;
  const status = optionsSpeechStatus();
  if (!status.supports) {
    btn.disabled = true;
    setButtonLabel(btn, 'Voice not available');
    setVoiceStatus('Voice input is not available in this browser.');
    return;
  }
  btn.disabled = false;
  btn.setAttribute('aria-pressed', status.listening ? 'true' : 'false');
  setButtonLabel(btn, status.listening ? 'Stop listening' : 'Start listening');
  setVoiceStatus(status.listening ? 'Listening...' : 'Voice tools are ready for this settings page.');
}

function startOptionsListening() {
  const tools = optionsVoiceTools();
  if (!tools || typeof tools.startListening !== 'function') {
    setVoiceStatus('Voice tools are still loading.');
    return;
  }
  tools.startListening({ announce: true });
  refreshOptionsVoiceUi();
}

function toggleOptionsListening() {
  const tools = optionsVoiceTools();
  if (!tools || typeof tools.toggleListening !== 'function') {
    setVoiceStatus('Voice tools are still loading.');
    return;
  }
  tools.toggleListening();
  setTimeout(refreshOptionsVoiceUi, 80);
}

function consumeStartupVoiceParams() {
  let params;
  try {
    params = new URLSearchParams(window.location.search || '');
  } catch (_err) {
    return;
  }
  const startVoice = params.get('navableVoice') === '1';
  const command = String(params.get('navableCommand') || '').trim();
  if (!startVoice && !command) return;

  try {
    const cleanUrl = `${window.location.origin}${window.location.pathname}`;
    window.history.replaceState({}, document.title, cleanUrl);
  } catch (_err) {
    // ignore
  }

  setTimeout(() => {
    if (startVoice) startOptionsListening();
    if (command && optionsVoiceTools() && typeof optionsVoiceTools().handleTranscript === 'function') {
      optionsVoiceTools().handleTranscript(command, '', 'typed').finally(refreshOptionsVoiceUi);
    }
  }, 250);
}

function wireOptionsVoice() {
  refreshOptionsVoiceUi();
  setTimeout(refreshOptionsVoiceUi, 350);
  setInterval(refreshOptionsVoiceUi, 1500);
  const btn = document.getElementById('btnMicToggle');
  if (btn) btn.addEventListener('click', toggleOptionsListening);
  consumeStartupVoiceParams();
  window.addEventListener('navable:output-open', () => {
    setTimeout(refreshOptionsVoiceUi, 100);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  const backButton = document.getElementById('btnBack');
  if (backButton) {
    backButton.addEventListener('click', () => {
      if (window.history.length > 1) {
        window.history.back();
        return;
      }
      window.location.href = '../newtab/newtab.html';
    });
  }
  document.body.addEventListener('change', (e) => {
    if (
      e.target &&
      (e.target.id === 'languageMode' ||
        e.target.id === 'outputMode' ||
        e.target.id === 'continuous' ||
        e.target.id === 'aiEnabled' ||
        e.target.id === 'noSensitiveSites')
    ) {
      saveSettings();
    }
  });
  const openShortcuts = document.getElementById('openShortcuts');
  if (openShortcuts) {
    openShortcuts.addEventListener('click', () => {
      if (chrome && chrome.tabs && chrome.tabs.create) {
        chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
      }
    });
  }
  wireOptionsVoice();
});
