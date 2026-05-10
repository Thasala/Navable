function isSupportedTab(tab) {
  if (!tab || !tab.id || !tab.url) return false;
  return /^https?:/i.test(tab.url) || /^file:/i.test(tab.url);
}

async function getActiveTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    return tab || null;
  } catch (_err) {
    return null;
  }
}

function navableExtensionPageInfo(tab) {
  if (!tab || !tab.url) return null;
  try {
    const activeUrl = new URL(tab.url);
    const rootUrl = new URL(chrome.runtime.getURL(''));
    if (activeUrl.origin !== rootUrl.origin) return null;
    const path = activeUrl.pathname;
    if (path === '/src/newtab/newtab.html') return { kind: 'newtab', path };
    if (path === '/src/options/index.html') return { kind: 'options', path };
  } catch (_err) {
    return null;
  }
  return null;
}

function canUseActivePageTools(tab) {
  return isSupportedTab(tab) || !!navableExtensionPageInfo(tab);
}

function navableStartUrl(params = {}) {
  const url = new URL(chrome.runtime.getURL('src/newtab/newtab.html'));
  Object.entries(params).forEach(([key, value]) => {
    const text = String(value || '').trim();
    if (text) url.searchParams.set(key, text);
  });
  return url.toString();
}

async function openNavableStartFallback(params = {}) {
  const url = navableStartUrl(params);
  try {
    if (chrome?.tabs?.create) {
      await chrome.tabs.create({ url });
      return true;
    }
  } catch (_err) {
    // fall through
  }
  try {
    window.open(url, '_blank', 'noopener,noreferrer');
    return true;
  } catch (_err) {
    return false;
  }
}

async function sendToNewtabPage(payload) {
  try {
    return await chrome.runtime.sendMessage({
      ...payload,
      target: 'navable:newtab'
    });
  } catch (_err) {
    return null;
  }
}

async function sendToExtensionPage(payload, tab) {
  const info = navableExtensionPageInfo(tab);
  if (!info) return null;
  if (info.kind === 'newtab') return sendToNewtabPage(payload);
  try {
    return await chrome.runtime.sendMessage({
      ...payload,
      target: 'navable:extension-page',
      pagePath: info.path
    });
  } catch (_err) {
    return null;
  }
}

async function sendToActiveTab(payload) {
  const tab = await getActiveTab();
  if (navableExtensionPageInfo(tab)) return sendToExtensionPage(payload, tab);
  if (!isSupportedTab(tab)) return null;
  try {
    return await chrome.tabs.sendMessage(tab.id, payload);
  } catch (_err) {
    return null;
  }
}

function setStatus(text, isError = false) {
  const el = document.getElementById('status');
  if (!el) return;
  el.textContent = text || '';
  el.classList.remove('ok', 'error');
  el.classList.add(isError ? 'error' : 'ok');
}

function setDescription(text) {
  const el = document.getElementById('description');
  if (!el) return;
  el.textContent = text || '';
}

function setButtonLabel(button, label) {
  if (!button) return;
  const text = String(label || '');
  button.setAttribute('aria-label', text);
  button.setAttribute('title', text);
  const textTarget = button.querySelector('[data-button-label]');
  if (textTarget) {
    textTarget.textContent = text;
  } else if (!button.querySelector('svg')) {
    button.textContent = text;
  }
}

function setTypedCommandAvailability(enabled, hintText) {
  const input = document.getElementById('typedCommandInput');
  const button = document.getElementById('btnTypedSend');
  const hint = document.getElementById('typedCommandHint');
  if (input) input.disabled = !enabled;
  if (button) button.disabled = !enabled;
  if (hint && hintText) hint.textContent = hintText;
}

function setHelpPanelState(helpBtn, helpPanel, open) {
  if (!helpBtn || !helpPanel) return;
  const isOpen = !!open;
  helpPanel.style.display = isOpen ? 'flex' : 'none';
  helpPanel.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
  helpBtn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
  const label = isOpen ? 'Hide examples' : 'Show examples';
  helpBtn.setAttribute('aria-label', label);
  helpBtn.setAttribute('title', label);
  helpBtn.classList.toggle('is-active', isOpen);
  const textTarget = helpBtn.querySelector('[data-help-label]');
  if (textTarget) {
    textTarget.textContent = label;
  } else if (!helpBtn.querySelector('svg')) {
    helpBtn.textContent = label;
  }
}

async function refreshMicStatus() {
  const btn = document.getElementById('btnMicToggle');
  const statusEl = document.getElementById('micStatus');
  if (!btn || !statusEl) return;
  try {
    const tab = await getActiveTab();
    if (!canUseActivePageTools(tab)) {
      btn.disabled = false;
      setButtonLabel(btn, 'Use Navable start page');
      statusEl.textContent = 'This page is unsupported. Use the Navable start page fallback for voice.';
      return;
    }
    const res = await sendToActiveTab({ type: 'navable:getSpeechStatus' });
    if (!res) {
      btn.disabled = true;
      setButtonLabel(btn, 'Open a page to use voice');
      statusEl.textContent = 'Voice tools work on web pages (http/https).';
      return;
    }
    if (!res || !res.ok || !res.supports) {
      btn.disabled = true;
      setButtonLabel(btn, 'Voice not available');
      statusEl.textContent = 'Voice input not available in this browser/page.';
      return;
    }
    btn.disabled = false;
    setButtonLabel(btn, res.listening ? 'Stop listening' : 'Start listening');
    statusEl.textContent = res.listening ? 'Listening…' : 'Not listening.';
  } catch (e) {
    console.error(e);
    const btn2 = document.getElementById('btnMicToggle');
    const status2 = document.getElementById('micStatus');
    if (btn2 && status2) {
      btn2.disabled = true;
      setButtonLabel(btn2, 'Voice not available');
      status2.textContent = 'Voice input not available in this browser/page.';
    }
  }
}

async function refreshTypedCommandState() {
  try {
    const tab = await getActiveTab();
    if (!canUseActivePageTools(tab)) {
      setTypedCommandAvailability(true, 'This page is unsupported. Typed commands will open in the Navable start page fallback.');
      return;
    }
    setTypedCommandAvailability(true, 'Uses the same parser and assistant path as voice. Press Ctrl+Enter or Cmd+Enter to send.');
  } catch (_err) {
    setTypedCommandAvailability(false, 'Open a supported page to send a typed test command.');
  }
}

async function handleSummarizeClick() {
  try {
    setStatus('Summarizing page…');
    setDescription('');
    const res = await chrome.runtime.sendMessage({ type: 'planner:run', command: 'Summarize this page' });
    if (res?.ok) {
      const steps = (res.plan && res.plan.steps && res.plan.steps.length) || 0;
      setStatus(`Summary dispatched (${steps} step${steps === 1 ? '' : 's'}).`);
      if (res.description) setDescription(res.description);
      else if (res.summary) setDescription(res.summary);
    } else {
      setStatus(res?.error || 'Summarization failed.', true);
    }
  } catch (e) {
    console.error(e);
    setStatus('Summarization request failed.', true);
  }
}

async function handleListHeadingsClick() {
  try {
    setStatus('Listing headings…');
    setDescription('');
    const res = await sendToActiveTab({ type: 'navable:listHeadings' });
    if (!res) {
      setStatus('Open a web page to list headings.', true);
      return;
    }
    if (res?.ok) {
      setStatus('Listed headings.');
      if (res.text) setDescription(res.text);
    } else {
      setStatus(res?.error || 'Could not list headings.', true);
    }
  } catch (e) {
    console.error(e);
    setStatus('Listing headings failed.', true);
  }
}

async function handleListLinksClick() {
  try {
    setStatus('Listing links…');
    setDescription('');
    const res = await sendToActiveTab({ type: 'navable:listLinks' });
    if (!res) {
      setStatus('Open a web page to list links.', true);
      return;
    }
    if (res?.ok) {
      setStatus('Listed links.');
      if (res.text) setDescription(res.text);
    } else {
      setStatus(res?.error || 'Could not list links.', true);
    }
  } catch (e) {
    console.error(e);
    setStatus('Listing links failed.', true);
  }
}

async function handleReadFocusedClick() {
  try {
    setStatus('Reading focused element…');
    setDescription('');
    const res = await sendToActiveTab({ type: 'navable:readFocused' });
    if (!res) {
      setStatus('Open a web page to read focused element.', true);
      return;
    }
    if (res?.ok) {
      setStatus('Read focused element.');
    } else {
      setStatus(res?.error || 'Could not read focused element.', true);
    }
  } catch (e) {
    console.error(e);
    setStatus('Read focused failed.', true);
  }
}

async function handleTypedCommandSubmit(event) {
  if (event && typeof event.preventDefault === 'function') event.preventDefault();
  const input = document.getElementById('typedCommandInput');
  const q = input ? String(input.value || '').trim() : '';
  if (!q) {
    setStatus('Type a command or question first.', true);
    return;
  }

  try {
    setStatus('Sending typed command…');
    setDescription('');
    const tab = await getActiveTab();
    if (!canUseActivePageTools(tab)) {
      const opened = await openNavableStartFallback({ navableCommand: q });
      if (opened) {
        setStatus('Opened Navable fallback.');
        setDescription('The typed command will run on the Navable start page.');
      } else {
        setStatus('Could not open Navable fallback.', true);
      }
      return;
    }
    const res = await sendToActiveTab({ type: 'navable:runTypedCommand', text: q });
    if (!res) {
      setStatus('Open a supported page to send a typed test command.', true);
      return;
    }
    if (res.ok) {
      setStatus('Typed command sent.');
      setDescription((res.feedback && res.feedback.message) || res.speech || 'The page handled the typed command.');
      return;
    }
    setStatus(res.error || 'Could not send typed command.', true);
  } catch (e) {
    console.error(e);
    setStatus('Typed command failed.', true);
  }
}

function wirePopup() {
  const micBtn = document.getElementById('btnMicToggle');
  if (micBtn) {
    micBtn.addEventListener('click', async () => {
      try {
        const statusEl = document.getElementById('micStatus');
        const tab = await getActiveTab();
        if (!canUseActivePageTools(tab)) {
          if (statusEl) statusEl.textContent = 'Opening Navable start page fallback…';
          await openNavableStartFallback({ navableVoice: '1' });
          return;
        }
        if (statusEl) statusEl.textContent = 'Toggling microphone…';
        await sendToActiveTab({ type: 'speech', action: 'toggle' });
        setTimeout(refreshMicStatus, 300);
      } catch (e) {
        console.error(e);
      }
    });
  }

  const summarizeBtn = document.getElementById('btnSummarize');
  if (summarizeBtn) summarizeBtn.addEventListener('click', handleSummarizeClick);

  const headingsBtn = document.getElementById('btnListHeadings');
  if (headingsBtn) headingsBtn.addEventListener('click', handleListHeadingsClick);

  const linksBtn = document.getElementById('btnListLinks');
  if (linksBtn) linksBtn.addEventListener('click', handleListLinksClick);

  const readFocusedBtn = document.getElementById('btnReadFocused');
  if (readFocusedBtn) readFocusedBtn.addEventListener('click', handleReadFocusedClick);

  const helpBtn = document.getElementById('btnHelp');
  const helpPanel = document.getElementById('helpPanel');
  if (helpBtn && helpPanel) {
    setHelpPanelState(helpBtn, helpPanel, false);
    helpBtn.addEventListener('click', () => {
      const isOpen = helpPanel.getAttribute('aria-hidden') !== 'false';
      setHelpPanelState(helpBtn, helpPanel, isOpen);
    });
    const helpCloseBtn = document.getElementById('btnHelpClose');
    if (helpCloseBtn) {
      helpCloseBtn.addEventListener('click', () => {
        setHelpPanelState(helpBtn, helpPanel, false);
        helpBtn.focus();
      });
    }
  }

  const typedForm = document.getElementById('typedCommandForm');
  const typedInput = document.getElementById('typedCommandInput');
  if (typedForm) typedForm.addEventListener('submit', handleTypedCommandSubmit);
  if (typedInput) {
    typedInput.addEventListener('keydown', (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        handleTypedCommandSubmit(event);
      }
    });
  }

  refreshMicStatus();
  refreshTypedCommandState();
}

document.addEventListener('DOMContentLoaded', wirePopup);
