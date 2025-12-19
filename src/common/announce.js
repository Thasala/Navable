(function () {
  const timersByMode = { polite: null, assertive: null };

  function ensureLiveRegion(mode) {
    const m = mode === 'assertive' ? 'assertive' : 'polite';
    const id = 'navable-live-region-' + m;
    let region = document.getElementById(id);
    if (!region) {
      region = document.createElement('div');
      region.id = id;
      // VoiceOver (and some other AT) is more reliable with role=alert for assertive announcements.
      region.setAttribute('role', m === 'assertive' ? 'alert' : 'status');
      region.setAttribute('aria-live', m);
      region.setAttribute('aria-atomic', 'true');
      region.setAttribute('aria-relevant', 'additions text');
      // Changed to "0" to make the region keyboard and screen reader navigable
      region.setAttribute('tabindex', '0');
      // Give the region an accessible name for screen readers
      region.setAttribute('aria-label', 'Navable extension notifications');
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
      // Removed pointer-events: none to allow screen reader interaction
      region.style.zIndex = '2147483647';
      // Add outline for when focused
      region.style.outline = '2px solid #4A90E2';
      region.style.outlineOffset = '2px';
      // Append to body (preferred for some screen readers); fall back to documentElement.
      (document.body || document.documentElement).appendChild(region);
    }
    return region;
  }

  function setAnnounceText(region, mode, text) {
    const m = mode === 'assertive' ? 'assertive' : 'polite';

    // A clear-then-set with small delays is more reliably announced by VoiceOver and NVDA.
    if (timersByMode[m]) {
      clearTimeout(timersByMode[m]);
    }
    timersByMode[m] = setTimeout(() => {
      try {
        region.textContent = '';
      } catch (_e) {
        // ignore
      }
      setTimeout(() => {
        try {
          const textToAnnounce = String(text || '');
          region.textContent = textToAnnounce;
          // Focus the region so screen readers immediately read it and users can navigate to it
          if (textToAnnounce) {
            region.focus();
          }
        } catch (_e) {
          // ignore
        }
      }, 20);
    }, 30);
  }

  // Expose a tiny helper
  window.NavableAnnounce = {
    speak(text, opts) {
      const mode = opts && opts.mode === 'assertive' ? 'assertive' : 'polite';
      const region = ensureLiveRegion(mode);
      setAnnounceText(region, mode, text);
    }
  };
})();
