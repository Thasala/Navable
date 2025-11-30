const DEFAULTS = { language: 'en-US', overlay: false, autostart: false };

function loadSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get({ navable_settings: DEFAULTS }, (res) => {
      resolve(res.navable_settings || { ...DEFAULTS });
    });
  });
}

function saveSettings(settings) {
  return new Promise((resolve) => {
    chrome.storage.sync.set({ navable_settings: settings }, () => resolve());
  });
}

async function init() {
  const s = await loadSettings();
  const elAutostart = document.getElementById('opt-autostart');
  const elOverlay = document.getElementById('opt-overlay');
  const elLang = document.getElementById('opt-lang');

  elAutostart.checked = !!s.autostart;
  elOverlay.checked = !!s.overlay;
  elLang.value = s.language || DEFAULTS.language;

  async function onChange() {
    const updated = {
      language: elLang.value,
      overlay: !!elOverlay.checked,
      autostart: !!elAutostart.checked
    };
    await saveSettings(updated);
  }

  elAutostart.addEventListener('change', onChange);
  elOverlay.addEventListener('change', onChange);
  elLang.addEventListener('change', onChange);
}

document.addEventListener('DOMContentLoaded', init);

