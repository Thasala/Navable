let currentLanguageLocale = 'en-US';

function normalizeLanguageMode(mode, _locale) {
  const raw = String(mode || '').trim().toLowerCase();
  if (raw === 'auto') return 'auto';
  if (!raw) return 'auto';
  if (raw === 'en' || raw === 'english' || raw.startsWith('en-')) return 'en';
  if (raw === 'ar' || raw === 'arabic' || raw.startsWith('ar-')) return 'ar';
  return 'auto';
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
    const continuous = document.getElementById('continuous');
    const aiEnabled = document.getElementById('aiEnabled');
    const aiMode = document.getElementById('aiMode');
    const noFormFields = document.getElementById('noFormFields');
    const noSensitiveSites = document.getElementById('noSensitiveSites');

    currentLanguageLocale = s.language || 'en-US';
    if (languageMode) languageMode.value = normalizeLanguageMode(s.languageMode, currentLanguageLocale);
    if (continuous) continuous.checked = typeof s.autostart === 'boolean' ? s.autostart : true;
    if (aiEnabled) aiEnabled.checked = !!s.aiEnabled;
    if (aiMode) aiMode.value = s.aiMode || 'off';
    if (noFormFields) noFormFields.checked = true; // always enforced by design
    if (noSensitiveSites) noSensitiveSites.checked = !!s.noSensitiveSites;
  });
}

function saveSettings() {
  if (!chrome || !chrome.storage || !chrome.storage.sync) return;
  const languageMode = document.getElementById('languageMode');
  const continuous = document.getElementById('continuous');
  const aiEnabled = document.getElementById('aiEnabled');
  const aiMode = document.getElementById('aiMode');
  const noSensitiveSites = document.getElementById('noSensitiveSites');
  const saveStatus = document.getElementById('saveStatus');
  const normalizedLanguageMode = normalizeLanguageMode(languageMode ? languageMode.value : 'auto', currentLanguageLocale);
  currentLanguageLocale = localeForLanguageMode(normalizedLanguageMode, currentLanguageLocale);

  const navable_settings = {
    language: currentLanguageLocale,
    languageMode: normalizedLanguageMode,
    overlay: false,
    autostart: continuous ? continuous.checked : true,
    aiEnabled: aiEnabled ? aiEnabled.checked : false,
    aiMode: aiMode ? aiMode.value : 'off',
    noSensitiveSites: noSensitiveSites ? noSensitiveSites.checked : false
  };

  chrome.storage.sync.set({ navable_settings }, () => {
    if (saveStatus) {
      saveStatus.textContent = 'Settings saved.';
      setTimeout(() => { saveStatus.textContent = ''; }, 1500);
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  document.body.addEventListener('change', (e) => {
    if (
      e.target &&
      (e.target.id === 'languageMode' ||
        e.target.id === 'continuous' ||
        e.target.id === 'aiEnabled' ||
        e.target.id === 'aiMode' ||
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
});
