(function () {
  function ensureLiveRegion(mode) {
    const m = mode === 'assertive' ? 'assertive' : 'polite';
    const id = 'navable-live-region-' + m;
    let region = document.getElementById(id);
    if (!region) {
      region = document.createElement('div');
      region.id = id;
      region.setAttribute('role', 'status');
      region.setAttribute('aria-live', m);
      region.setAttribute('aria-atomic', 'true');
      region.style.position = 'fixed';
      region.style.bottom = '8px';
      region.style.right = '8px';
      region.style.maxWidth = '360px';
      region.style.padding = '8px 10px';
      region.style.background = 'rgba(0,0,0,0.75)';
      region.style.color = '#fff';
      region.style.fontSize = '13px';
      region.style.lineHeight = '1.4';
      region.style.wordBreak = 'break-word';
      region.style.whiteSpace = 'normal';
      region.style.borderRadius = '8px';
      region.style.boxShadow = '0 2px 10px rgba(0,0,0,0.3)';
      region.style.pointerEvents = 'none';
      region.style.zIndex = '2147483647';
      document.documentElement.appendChild(region);
    }
    return region;
  }

  // Expose a tiny helper
  window.NavableAnnounce = {
    speak(text, opts) {
      const mode = opts && opts.mode === 'assertive' ? 'assertive' : 'polite';
      const region = ensureLiveRegion(mode);
      region.textContent = text;
    }
  };
})();
