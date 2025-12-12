function loadSettings() {
  if (!chrome || !chrome.storage || !chrome.storage.sync) return;
  chrome.storage.sync.get({ navable_settings: {} }, (res) => {
    const s = res.navable_settings || {};
    const language = document.getElementById('language');
    const continuous = document.getElementById('continuous');
    const aiEnabled = document.getElementById('aiEnabled');
    const aiMode = document.getElementById('aiMode');
    const noFormFields = document.getElementById('noFormFields');
    const noSensitiveSites = document.getElementById('noSensitiveSites');

    if (language) language.value = s.language || 'en-US';
    if (continuous) continuous.checked = !!s.autostart;
    if (aiEnabled) aiEnabled.checked = !!s.aiEnabled;
    if (aiMode) aiMode.value = s.aiMode || 'off';
    if (noFormFields) noFormFields.checked = true; // always enforced by design
    if (noSensitiveSites) noSensitiveSites.checked = !!s.noSensitiveSites;
  });
}

function saveSettings() {
  if (!chrome || !chrome.storage || !chrome.storage.sync) return;
  const language = document.getElementById('language');
  const continuous = document.getElementById('continuous');
  const aiEnabled = document.getElementById('aiEnabled');
  const aiMode = document.getElementById('aiMode');
  const noSensitiveSites = document.getElementById('noSensitiveSites');
  const saveStatus = document.getElementById('saveStatus');

  const navable_settings = {
    language: language ? language.value : 'en-US',
    overlay: false,
    autostart: continuous ? continuous.checked : false,
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
      (e.target.id === 'language' ||
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
