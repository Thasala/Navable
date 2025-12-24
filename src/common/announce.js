(function () {
  const timersByMode = { polite: null, assertive: null };
  let lastPriorityFocus = null;

  function getRootNode() {
    return document.body || document.documentElement;
  }

  function safeFocus(el) {
    if (!el || typeof el.focus !== 'function') return;
    try {
      el.focus({ preventScroll: true });
      return;
    } catch (_e) {
      // ignore
    }
    try {
      el.focus();
    } catch (_e2) {
      // ignore
    }
  }

  function emitOutputOpen(open) {
    try {
      const ev = new CustomEvent('navable:output-open', { detail: { open: !!open } });
      window.dispatchEvent(ev);
    } catch (_e) {
      // ignore
    }
  }

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
      // Programmatically focusable without adding a persistent tab-stop to every page.
      region.setAttribute('tabindex', '-1');
      // Give the region an accessible name for screen readers.
      region.setAttribute('aria-label', 'Navable notifications');
      // Keep the live region accessible to screen readers, but visually hidden to avoid duplicate UI.
      Object.assign(region.style, {
        position: 'fixed',
        width: '1px',
        height: '1px',
        padding: '0',
        margin: '-1px',
        overflow: 'hidden',
        clip: 'rect(0 0 0 0)',
        whiteSpace: 'nowrap',
        border: '0',
        zIndex: '2147483647'
      });
      // Insert early in the DOM (helps some SR reading order).
      const root = getRootNode();
      if (root && root.firstChild) root.insertBefore(region, root.firstChild);
      else if (root) root.appendChild(region);
    }
    return region;
  }

  function ensurePriorityPanel() {
    const root = getRootNode();
    if (!root) return null;
    let panel = document.getElementById('navable-output-panel');
    if (panel) return panel;

    panel = document.createElement('div');
    panel.id = 'navable-output-panel';
    panel.setAttribute('role', 'alertdialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('tabindex', '-1');

    const title = document.createElement('div');
    title.id = 'navable-output-title';
    title.textContent = 'Navable output';

    const textarea = document.createElement('textarea');
    textarea.id = 'navable-output-text';
    textarea.readOnly = true;
    textarea.setAttribute('aria-label', 'Navable output text');

    const closeBtn = document.createElement('button');
    closeBtn.id = 'navable-output-close';
    closeBtn.type = 'button';
    closeBtn.textContent = 'Close';

    panel.setAttribute('aria-labelledby', title.id);
    panel.setAttribute('aria-describedby', textarea.id);

    const box = document.createElement('div');
    box.id = 'navable-output-box';
    box.appendChild(title);
    box.appendChild(textarea);
    box.appendChild(closeBtn);
    panel.appendChild(box);

    // Lightweight inline styling to avoid relying on page CSS.
    Object.assign(panel.style, {
      position: 'fixed',
      inset: '0',
      zIndex: '2147483647',
      background: 'rgba(0,0,0,0.45)',
      display: 'none'
    });

    Object.assign(box.style, {
      boxSizing: 'border-box',
      position: 'absolute',
      top: '12px',
      left: '50%',
      transform: 'translateX(-50%)',
      width: 'min(720px, calc(100vw - 24px))',
      maxHeight: 'min(70vh, 520px)',
      overflow: 'auto',
      padding: '14px 14px 12px',
      borderRadius: '12px',
      border: '1px solid rgba(255,255,255,0.25)',
      background: 'rgba(20,20,20,0.96)',
      color: '#fff',
      font: '14px/1.4 system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
      boxShadow: '0 10px 30px rgba(0,0,0,0.45)'
    });

    Object.assign(title.style, { fontWeight: '700', margin: '0 0 8px', fontSize: '15px' });

    Object.assign(textarea.style, {
      width: '100%',
      minHeight: '140px',
      maxHeight: '46vh',
      boxSizing: 'border-box',
      resize: 'vertical',
      whiteSpace: 'pre-wrap',
      margin: '0 0 10px',
      outline: '2px solid #4A90E2',
      outlineOffset: '2px',
      borderRadius: '10px',
      padding: '10px 10px',
      background: 'rgba(255,255,255,0.08)',
      color: '#fff',
      border: '1px solid rgba(255,255,255,0.18)',
      font: 'inherit'
    });

    Object.assign(closeBtn.style, {
      padding: '8px 10px',
      borderRadius: '10px',
      border: '1px solid rgba(255,255,255,0.35)',
      background: 'transparent',
      color: '#fff',
      cursor: 'pointer'
    });

    function hidePanel() {
      panel.style.display = 'none';
      emitOutputOpen(false);
      if (lastPriorityFocus && lastPriorityFocus.isConnected) safeFocus(lastPriorityFocus);
      lastPriorityFocus = null;
    }

    closeBtn.addEventListener('click', hidePanel);
    panel.addEventListener('click', (e) => {
      if (e.target === panel) hidePanel();
    });
    panel.addEventListener(
      'keydown',
      (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          hidePanel();
          return;
        }
        if (e.key !== 'Tab') return;
        // Minimal focus trap between textarea and close button.
        const active = document.activeElement;
        const goingBack = !!e.shiftKey;
        if (goingBack && active === textarea) {
          e.preventDefault();
          safeFocus(closeBtn);
          return;
        }
        if (!goingBack && active === closeBtn) {
          e.preventDefault();
          safeFocus(textarea);
        }
      },
      { capture: true }
    );

    // Insert early so SR discovers it first.
    if (root.firstChild) root.insertBefore(panel, root.firstChild);
    else root.appendChild(panel);
    return panel;
  }

  function showPriorityOutput(text) {
    const panel = ensurePriorityPanel();
    if (!panel) return;
    const textarea = document.getElementById('navable-output-text');
    if (!textarea) return;

    const message = String(text || '');
    if (!message) {
      panel.style.display = 'none';
      emitOutputOpen(false);
      return;
    }

    try {
      lastPriorityFocus = document.activeElement;
    } catch (_e) {
      lastPriorityFocus = null;
    }

    panel.style.display = 'block';
    emitOutputOpen(true);
    textarea.value = message;

    // Put the screen reader/keyboard cursor directly on the output text and select it.
    setTimeout(() => {
      safeFocus(textarea);
      try {
        textarea.setSelectionRange(0, textarea.value.length);
      } catch (_e) {
        // ignore
      }
    }, 0);
  }

  function setAnnounceText(region, mode, text, opts) {
    const m = mode === 'assertive' ? 'assertive' : 'polite';
    const shouldFocus = !!(opts && opts.focus === true);

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
          // Do not steal focus by default; SR should still announce via aria-live.
          if (textToAnnounce && shouldFocus) safeFocus(region);
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
      setAnnounceText(region, mode, text, opts);
    },
    output(text) {
      showPriorityOutput(text);
    }
  };
})();
