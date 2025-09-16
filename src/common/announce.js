(function () {
  function ensureLiveRegion() {
    let region = document.getElementById('navable-live-region-polite');
    if (!region) {
      region = document.createElement('div');
      region.id = 'navable-live-region-polite';
      region.setAttribute('role', 'status');
      region.setAttribute('aria-live', 'polite');
      region.style.position = 'fixed';
      region.style.bottom = '8px';
      region.style.right = '8px';
      region.style.padding = '4px 8px';
      region.style.background = 'rgba(0,0,0,0.6)';
      region.style.color = '#fff';
      region.style.fontSize = '12px';
      region.style.zIndex = '2147483647';
      document.documentElement.appendChild(region);
    }
    return region;
  }

  // Expose a tiny helper
  window.NavableAnnounce = {
    speak(text) {
      const region = ensureLiveRegion();
      region.textContent = text;
    }
  };
})();
