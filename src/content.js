(function () {
  console.log('[Navable] content script loaded on', location.href);

  // Marker so tests can verify injection
  let m = document.getElementById('navable-marker');
  if (!m) {
    m = document.createElement('meta');
    m.id = 'navable-marker';
    m.setAttribute('data-injected', 'true');
    document.documentElement.appendChild(m);
  }

  // Announce helper wrapper
  function announce(text, opts) {
    try {
      const options = opts || { mode: 'polite' };
      if (typeof window.NavableAnnounce === 'function') {
        window.NavableAnnounce(text, options);
        return;
      }
      if (window.NavableAnnounce && typeof window.NavableAnnounce.speak === 'function') {
        window.NavableAnnounce.speak(text, options);
        return;
      }
      if (window.NavableAnnounce && typeof window.NavableAnnounce.output === 'function') {
        window.NavableAnnounce.output(text, options);
      }
    } catch (_e) {
      // no-op
    }
  }

  var i18n = window.NavableI18n || null;

  function normalizeOutputLanguage(lang) {
    if (i18n && typeof i18n.normalizeLanguage === 'function') {
      return i18n.normalizeLanguage(lang);
    }
    return String(lang || 'en').toLowerCase().split(/[-_]/)[0] || 'en';
  }

  function outputLocale(lang) {
    if (i18n && typeof i18n.localeForLanguage === 'function') {
      return i18n.localeForLanguage(lang);
    }
    return String(lang || 'en-US');
  }

  function normalizeLanguageMode(mode, fallbackLanguage) {
    if (i18n && typeof i18n.normalizeLanguageMode === 'function') {
      return i18n.normalizeLanguageMode(mode, fallbackLanguage);
    }
    if (!String(mode || '').trim()) return 'auto';
    var normalized = normalizeOutputLanguage(mode || fallbackLanguage || 'en-US');
    return normalized === 'ar' || normalized === 'en' ? normalized : 'auto';
  }

  function configuredLanguageMode(state) {
    var source = state || settings || {};
    return normalizeLanguageMode(source.languageMode, source.language || 'en-US');
  }

  function lockedOutputLanguage(state) {
    var mode = configuredLanguageMode(state);
    return mode === 'auto' ? '' : mode;
  }

  function recognitionLocalesForLanguage(language, preferredLocale) {
    if (i18n && typeof i18n.recognitionLocalesForLanguage === 'function') {
      return i18n.recognitionLocalesForLanguage(language, preferredLocale);
    }
    return [recognitionLocaleFor(preferredLocale || outputLocale(language))];
  }

  function configuredRecognitionLocale(state) {
    var source = state || settings || {};
    var mode = configuredLanguageMode(source);
    var configuredLocale = recognitionLocaleFor(source.language || 'en-US');
    if (mode === 'auto') return configuredLocale;
    if (normalizeOutputLanguage(configuredLocale) === mode) return configuredLocale;
    var candidates = recognitionLocalesForLanguage(mode, configuredLocale);
    return candidates[0] || outputLocale(mode);
  }

  function currentOutputLanguage() {
    var locked = lockedOutputLanguage();
    if (locked) return locked;
    return normalizeOutputLanguage(outputLanguage || settings.language || recogLang || 'en-US');
  }

  function translate(key, params, lang) {
    var resolvedLang = normalizeOutputLanguage(lang || currentOutputLanguage());
    if (i18n && typeof i18n.t === 'function') {
      return i18n.t(key, resolvedLang, params);
    }
    return key;
  }

  function ensureOutputLanguageReady(lang) {
    var resolvedLang = normalizeOutputLanguage(lang || currentOutputLanguage());
    if (i18n && typeof i18n.ensureLanguage === 'function') {
      return i18n.ensureLanguage(resolvedLang);
    }
    return Promise.resolve();
  }

  function resolveTranscriptLanguage(text) {
    if (i18n && typeof i18n.resolveOutputLanguage === 'function') {
      return i18n.resolveOutputLanguage({
        transcript: text,
        fallbackLanguage: currentOutputLanguage()
      });
    }
    return currentOutputLanguage();
  }

  function localizeTarget(target, lang) {
    var resolved = normalizeOutputLanguage(lang || currentOutputLanguage());
    if (target === 'link') return translate('target_link', null, resolved);
    if (target === 'button') return translate('target_button', null, resolved);
    if (target === 'heading') return translate('target_heading', null, resolved);
    if (target === 'input') return translate('target_input', null, resolved);
    return translate('target_element', null, resolved);
  }

  function setOutputLanguageFromTranscript(text, detectedLanguage) {
    var locked = lockedOutputLanguage();
    if (locked) {
      outputLanguage = locked;
      return outputLanguage;
    }
    if (detectedLanguage) {
      outputLanguage = normalizeOutputLanguage(detectedLanguage);
      return outputLanguage;
    }
    outputLanguage = resolveTranscriptLanguage(text);
    return outputLanguage;
  }

  function detectRecognitionLanguage(text, detectedLanguage) {
    var locked = lockedOutputLanguage();
    if (locked) return locked;
    if (detectedLanguage) {
      return normalizeOutputLanguage(detectedLanguage);
    }
    if (i18n && typeof i18n.detectLanguage === 'function') {
      return i18n.detectLanguage(text, normalizeOutputLanguage(recogLang || settings.language || 'en-US'));
    }
    return normalizeOutputLanguage(recogLang || settings.language || 'en-US');
  }

  function recognitionLocaleFor(lang) {
    var raw = String(lang || '').trim();
    if (!raw) return String(recogLang || settings.language || 'en-US');
    if (raw.indexOf('-') >= 0 || raw.indexOf('_') >= 0) return raw.replace(/_/g, '-');
    return outputLocale(raw);
  }

  function recognitionCandidateLocales() {
    var seen = {};
    var list = [];
    var mode = configuredLanguageMode();

    function pushLocale(locale) {
      var normalized = recognitionLocaleFor(locale);
      var key = String(normalized || '').toLowerCase();
      if (!key || seen[key]) return;
      seen[key] = true;
      list.push(normalized);
    }

    function pushLanguage(language, preferredLocale) {
      var locales = recognitionLocalesForLanguage(language, preferredLocale);
      for (var i = 0; i < locales.length; i++) pushLocale(locales[i]);
    }

    pushLocale(recogLang || configuredRecognitionLocale());
    pushLocale(configuredRecognitionLocale());

    if (mode === 'auto') {
      var primary = normalizeOutputLanguage(recogLang || currentOutputLanguage() || settings.language || 'en-US');
      var secondary = primary === 'ar' ? 'en' : 'ar';
      pushLanguage(secondary, secondary === normalizeOutputLanguage(settings.language || '') ? settings.language : outputLocale(secondary));
      pushLanguage(primary, settings.language || outputLocale(primary));
      pushLanguage(currentOutputLanguage(), recogLang || settings.language || 'en-US');
    } else {
      pushLanguage(mode, settings.language || outputLocale(mode));
    }

    return list;
  }

  function maybeRotateRecognitionLocale() {
    var now = Date.now();
    if (!lastRecognitionResultAt || now - lastRecognitionResultAt > 15000) return false;
    if (now - lastRecognitionLocaleRotateAt < 2500) return false;

    var locales = recognitionCandidateLocales();
    if (!locales.length) return false;

    var currentKey = String(recogLang || '').toLowerCase();
    var currentIndex = -1;
    for (var i = 0; i < locales.length; i++) {
      if (String(locales[i] || '').toLowerCase() === currentKey) {
        currentIndex = i;
        break;
      }
    }

    var nextLocale = locales[(currentIndex + 1 + locales.length) % locales.length];
    if (!nextLocale || String(nextLocale).toLowerCase() === currentKey) return false;

    lastRecognitionLocaleRotateAt = now;
    recogLang = nextLocale;
    refreshRecognizer({ restart: true, delayMs: 80 });
    return true;
  }

  // Fallback hotkey: Alt+Shift+;
  document.addEventListener(
    'keydown',
    (e) => {
      if (e.altKey && e.shiftKey && e.key === ';') {
        announce(translate('navable_test_announcement'), {
          mode: 'polite',
          lang: outputLocale(currentOutputLanguage())
        });
      }
    },
    { capture: true }
  );

  // Runtime messaging (guarded for non-extension test runs)
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg && msg.type === 'announce') {
        announce(msg.text || translate('generic_announcement'), {
          mode: msg.mode || 'polite',
          priority: !!msg.priority,
          lang: msg.lang || outputLocale(currentOutputLanguage())
        });
        return;
      }
      if (msg && msg.type === 'navable:announce') {
        if (msg.lang) outputLanguage = normalizeOutputLanguage(msg.lang);
        ensureOutputLanguageReady(outputLanguage).finally(function () {
          announce(msg.text || translate('generic_announcement'), {
            mode: msg.mode || 'polite',
            priority: !!msg.priority,
            lang: msg.lang || outputLocale(currentOutputLanguage())
          });
          sendResponse && sendResponse({ ok: true });
        });
        return true;
      }
      if (msg && msg.type === 'navable:getStructure') {
        try {
          var structure = buildPageStructure();
          sendResponse && sendResponse({ ok: true, structure: structure });
        } catch (err) {
          sendResponse && sendResponse({ ok: false, error: String(err || 'structure failed') });
        }
        return true;
      }
      if (msg && msg.type === 'navable:executePlan') {
        runPlan(msg.plan || { steps: [] }, { silentOutput: !!msg.silentOutput }).then(function (res) {
          sendResponse && sendResponse(res);
        }).catch(function (err) {
          sendResponse && sendResponse({ ok: false, error: String(err || 'plan failed') });
        });
        return true;
      }
      if (msg && msg.type === 'navable:listHeadings') {
        try {
          var structH = buildPageStructure();
          var textH = listHeadingsText(structH);
          speak(textH);
          sendResponse && sendResponse({ ok: true, text: textH });
        } catch (err) {
          sendResponse && sendResponse({ ok: false, error: String(err || 'list headings failed') });
        }
        return true;
      }
      if (msg && msg.type === 'navable:listLinks') {
        try {
          var structL = buildPageStructure();
          var textL = listLinksText(structL);
          speak(textL);
          sendResponse && sendResponse({ ok: true, text: textL });
        } catch (err) {
          sendResponse && sendResponse({ ok: false, error: String(err || 'list links failed') });
        }
        return true;
      }
      if (msg && msg.type === 'navable:readFocused') {
        try {
          execCommand({ type: 'read', what: 'focused' });
          sendResponse && sendResponse({ ok: true });
        } catch (err) {
          sendResponse && sendResponse({ ok: false, error: String(err || 'read focused failed') });
        }
        return true;
      }
      if (msg && msg.type === 'navable:getSpeechStatus') {
        try {
          var supports = !!(speech && speech.supportsRecognition && speech.supportsRecognition());
          sendResponse && sendResponse({ ok: true, supports: supports, listening: !!listening });
        } catch (err) {
          sendResponse && sendResponse({ ok: false, error: String(err || 'status failed') });
        }
        return true;
      }
    });
  }

  // Speak on activation (top window only)
  try {
    if (window.top === window) {
      announce(translate('navable_ready'), {
        mode: 'polite',
        lang: outputLocale(currentOutputLanguage())
      });
    }
  } catch (_e) {
    // ignore cross-origin frame access errors
  }

  // -------------------------------
  // Basic DOM walker + labeling
  // -------------------------------

  var idCounter = 1;
  var index = { items: [] };
  var overlayOn = false;
  var overlayMarkers = [];
  var observer; // mutation observer
  var scanDebounce;
  var settings = { language: 'en-US', languageMode: 'auto', overlay: false, autostart: true };

  function isHidden(el) {
    if (!el || !el.isConnected) return true;
    if (el.hidden) return true;
    var ariaHidden = el.getAttribute && el.getAttribute('aria-hidden');
    if (ariaHidden === 'true') return true;
    // detached or no layout
    if (!el.ownerDocument || !el.ownerDocument.documentElement.contains(el)) return true;
    var style = el.ownerDocument.defaultView.getComputedStyle(el);
    if (!style) return false;
    if (style.display === 'none' || style.visibility === 'hidden') return true;
    return false;
  }

  function textOf(el) {
    if (!el) return '';
    var t = '';
    // aria-label first
    var aria = el.getAttribute && el.getAttribute('aria-label');
    if (aria) return aria.trim();
    // aria-labelledby
    var labelledby = el.getAttribute && el.getAttribute('aria-labelledby');
    if (labelledby) {
      var parts = labelledby.split(/\s+/).map(function (id) {
        var n = el.ownerDocument.getElementById(id);
        return n ? n.textContent : '';
      });
      t = parts.join(' ').trim();
      if (t) return t;
    }
    // inputs: associated <label>
    if (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA') {
      // by for=
      var id = el.id && el.id.trim();
      if (id) {
        var lab = el.ownerDocument.querySelector('label[for="' + id.replace(/"/g, '') + '"]');
        if (lab && lab.textContent) return lab.textContent.trim();
      }
      // wrapped label
      var p = el.parentElement;
      while (p && p !== el.ownerDocument.body) {
        if (p.tagName === 'LABEL' && p.textContent) return p.textContent.trim();
        p = p.parentElement;
      }
      // placeholder or value/title
      var ph = el.getAttribute('placeholder');
      if (ph) return ph.trim();
      var val = el.getAttribute('value');
      if (val) return val.trim();
      var ti = el.getAttribute('title');
      if (ti) return ti.trim();
    }
    // title attribute
    var title = el.getAttribute && el.getAttribute('title');
    if (title) return title.trim();
    // text content
    if (el.innerText) {
      t = el.innerText.replace(/\s+/g, ' ').trim();
      if (t) return t;
    }
    // alt text if image link/button
    var img = el.querySelector && el.querySelector('img[alt]');
    if (img && img.getAttribute('alt')) return img.getAttribute('alt').trim();
    return '';
  }

  function nextId() {
    return 'n' + idCounter++;
  }

  function getType(el) {
    var tag = (el.tagName || '').toLowerCase();
    var role = (el.getAttribute && el.getAttribute('role')) || '';
    if (tag === 'a' || role === 'link') return 'link';
    if (tag === 'button' || role === 'button') return 'button';
    if (/^h[1-6]$/.test(tag)) return 'heading';
    if (tag === 'input' || tag === 'select' || tag === 'textarea') return 'input';
    return 'other';
  }

  function isNavableUiElement(el) {
    if (!el || el.nodeType !== 1) return false;
    var node = el;
    if (node.id === 'navable-marker') return true;
    if (node.id === 'navable-output-panel' || node.id === 'navable-output-box' || node.id === 'navable-output-title' || node.id === 'navable-output-text' || node.id === 'navable-output-close') {
      return true;
    }
    if (typeof node.id === 'string' && node.id.indexOf('navable-live-region-') === 0) {
      return true;
    }
    if (node.closest && node.closest('#navable-output-panel, [id^="navable-live-region-"], #navable-marker')) {
      return true;
    }
    return false;
  }

  function buildIndex(doc) {
    var d = doc || document;
    var items = [];
    var seen = new Set();
    var selector = [
      'a[href]', '[role="link"]',
      'button',
      '[role="button"]',
      'input',
      'select',
      'textarea',
      '[tabindex]:not([tabindex="-1"])',
      'h1, h2, h3, h4, h5, h6'
    ].join(',');
    var nodes = Array.prototype.slice.call(d.querySelectorAll(selector));
    nodes.forEach(function (el) {
      if (seen.has(el)) return;
      seen.add(el);
      if (isHidden(el)) return;
      if (isNavableUiElement(el)) return;
      var label = textOf(el);
      if (!label) return; // skip unlabeled entries for now
      if (!el.dataset.navableId) el.dataset.navableId = nextId();
      el.dataset.navableLabel = label;
      var type = getType(el);
      el.dataset.navableType = type;
      items.push({ id: el.dataset.navableId, label: label, tag: el.tagName.toLowerCase(), type: type });
    });
    index.items = items;
    return index;
  }

  function clearOverlay() {
    overlayMarkers.forEach(function (n) { n.remove(); });
    overlayMarkers = [];
  }

  function drawOverlay() {
    clearOverlay();
    index.items.forEach(function (it) {
      var el = document.querySelector('[data-navable-id="' + it.id + '"]');
      if (!el) return;
      var r = el.getBoundingClientRect();
      var m = document.createElement('div');
      m.textContent = it.id.replace(/^n/, '');
      Object.assign(m.style, {
        position: 'absolute',
        left: Math.max(0, window.scrollX + r.left) + 'px',
        top: Math.max(0, window.scrollY + r.top) + 'px',
        background: 'rgba(0,0,0,0.7)',
        color: '#fff',
        fontSize: '10px',
        padding: '0 3px',
        borderRadius: '2px',
        pointerEvents: 'none',
        zIndex: 2147483647
      });
      document.body.appendChild(m);
      overlayMarkers.push(m);
    });
  }

  function rescan() {
    buildIndex(document);
    if (overlayOn) drawOverlay();
  }

  function scheduleRescan() {
    clearTimeout(scanDebounce);
    scanDebounce = setTimeout(rescan, 60);
  }

  function startObserver() {
    if (!('MutationObserver' in window)) return;
    if (!document.body) return;
    if (observer) observer.disconnect();
    observer = new MutationObserver(scheduleRescan);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-label', 'aria-labelledby', 'title', 'hidden', 'style'] });
  }

  // Initial scan
  rescan();
  startObserver();

  // Expose for tests/devtools
  window.NavableIndex = {
    scan: rescan,
    getIndex: function () { return index; },
    enableOverlay: function () { overlayOn = true; drawOverlay(); },
    disableOverlay: function () { overlayOn = false; clearOverlay(); }
  };

  // -------------------------------
  // Tool layer + page structure
  // -------------------------------

  function extractLandmarks(doc) {
    var roles = ['main', 'navigation', 'banner', 'contentinfo', 'search', 'form', 'complementary', 'region'];
    var selectors = roles.map(function (r) { return '[role="' + r + '"]'; }).concat(['main', 'nav', 'header', 'footer', 'form']);
    var nodes = Array.prototype.slice.call((doc || document).querySelectorAll(selectors.join(',')));
    var seen = new Set();
    var landmarks = [];
    nodes.forEach(function (el) {
      if (seen.has(el) || isHidden(el) || isNavableUiElement(el)) return;
      seen.add(el);
      var role = el.getAttribute && el.getAttribute('role');
      var tag = (el.tagName || '').toLowerCase();
      var label = textOf(el);
      if (!label) {
        var h = el.querySelector && el.querySelector('h1,h2,h3,h4,h5,h6');
        if (h) label = textOf(h);
      }
      landmarks.push({ role: role || tag, tag: tag, label: label || '' });
    });
    return landmarks;
  }

  function extractExcerpt(doc) {
    var root = (doc && doc.querySelector && (doc.querySelector('main') || doc.querySelector('article'))) || (doc && doc.body);
    if (!root) return '';
    var nodes = Array.prototype.slice.call(root.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li'));
    var maxChars = 1200;
    var total = 0;
    var parts = [];
    for (var i = 0; i < nodes.length; i++) {
      if (parts.length >= 24) break;
      var el = nodes[i];
      if (isHidden(el) || isNavableUiElement(el)) continue;
      var text = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
      if (!text || text.length < 12) continue;
      var remaining = maxChars - total;
      if (remaining <= 0) break;
      if (text.length > remaining) text = text.slice(0, remaining);
      parts.push(text);
      total += text.length;
    }
    return parts.join(' ');
  }

  function buildPageStructure() {
    rescan();
    var active = document.activeElement;
    if (isNavableUiElement(active)) active = null;
    var activeId = active && active.dataset ? active.dataset.navableId : null;
    var activeLabel = '';
    var sensitiveInputCount = 0;
    if (active) activeLabel = textOf(active);
    var headings = [];
    var links = [];
    var buttons = [];
    var inputs = [];
    index.items.forEach(function (it) {
      var entry = {
        id: it.id,
        label: it.label,
        tag: it.tag,
        type: it.type
      };
      if (it.type === 'heading') {
        var m = (it.tag || '').match(/^h([1-6])$/);
        if (m) entry.level = parseInt(m[1], 10);
        headings.push(entry);
      } else if (it.type === 'link') {
        var linkEl = document.querySelector('[data-navable-id="' + it.id + '"]');
        if (linkEl && linkEl.getAttribute) {
          entry.href = linkEl.getAttribute('href') || '';
        } else {
          entry.href = '';
        }
        links.push(entry);
      } else if (it.type === 'button') {
        buttons.push(entry);
      } else if (it.type === 'input') {
        var el = document.querySelector('[data-navable-id="' + it.id + '"]');
        if (el) {
          if (isSensitiveInput(el)) {
            // Exclude sensitive fields (e.g., passwords, card numbers) from the snapshot.
            sensitiveInputCount += 1;
            return;
          }
          entry.inputType = (el.getAttribute && el.getAttribute('type')) || (el.tagName || '').toLowerCase();
          entry.name = (el.getAttribute && el.getAttribute('name')) || '';
          entry.required = !!(el.hasAttribute && el.hasAttribute('required'));
          entry.placeholder = (el.getAttribute && el.getAttribute('placeholder')) || '';
        }
        inputs.push(entry);
      }
    });
    var landmarks = extractLandmarks(document);
    return {
      title: document.title || '',
      url: location.href,
      lang: (document.documentElement && document.documentElement.lang) || '',
      activeId: activeId,
      activeLabel: activeLabel || '',
      landmarks: landmarks,
      privacy: {
        sensitiveInputCount: sensitiveInputCount,
        sensitivePage: sensitiveInputCount > 0
      },
      counts: {
        headings: headings.length,
        links: links.length,
        buttons: buttons.length,
        inputs: inputs.length,
        landmarks: landmarks.length
      },
      headings: headings,
      links: links,
      buttons: buttons,
      inputs: inputs,
      excerpt: extractExcerpt(document)
    };
  }

  function describeStructure(structure) {
    if (!structure) return 'No page data available.';
    var parts = [];
    if (structure.title) parts.push('Title ' + structure.title + '.');
    parts.push('Headings ' + structure.counts.headings + ', links ' + structure.counts.links + ', buttons ' + structure.counts.buttons + '.');
    if (structure.headings && structure.headings.length) {
      parts.push('Top heading: ' + structure.headings[0].label + '.');
    }
    return parts.join(' ');
  }

  function listHeadingsText(structure) {
    if (!structure || !structure.headings || !structure.headings.length) {
      return 'No headings on this page.';
    }
    var items = structure.headings.slice(0, 10).map(function (h, idx) {
      var label = h.label || 'Unnamed heading';
      var level = h.level != null ? ' (level ' + h.level + ')' : '';
      return (idx + 1) + '. ' + label + level + '.';
    });
    var more = structure.headings.length > 10 ? ' And more headings not listed.' : '';
    return 'Headings: ' + items.join(' ') + more;
  }

  function listLinksText(structure) {
    if (!structure || !structure.links || !structure.links.length) {
      return 'No links on this page.';
    }
    var items = structure.links.slice(0, 10).map(function (l, idx) {
      var label = l.label || l.href || 'Unnamed link';
      return (idx + 1) + '. ' + label + '.';
    });
    var more = structure.links.length > 10 ? ' And more links not listed.' : '';
    return 'Links: ' + items.join(' ') + more;
  }

  function getElementByRef(type, label, n) {
    if (label) return findByLabel(type, label);
    return pickNth(type, n || 1);
  }

  function isSensitiveInput(el) {
    if (!el) return false;
    var type = (el.getAttribute && el.getAttribute('type')) || '';
    var name = (el.getAttribute && el.getAttribute('name')) || '';
    var id = el.id || '';
    var hay = (type + ' ' + name + ' ' + id).toLowerCase();
    if (type.toLowerCase() === 'password') return true;
    if (hay.includes('password')) return true;
    if (hay.includes('card') || hay.includes('credit')) return true;
    return false;
  }

  function runToolStep(step) {
    step = step || {};
    var action = step.action;
    if (!action) return { ok: false, message: 'No action' };
    if (action === 'scroll') {
      execCommand({ type: 'scroll', dir: step.direction || step.dir || 'down' });
      return { ok: true, message: 'Scrolled ' + (step.direction || step.dir || 'down') };
    }
    if (action === 'announce') {
      speak(step.message || '');
      return { ok: true, message: 'Announced' };
    }
    if (action === 'read_title') {
      execCommand({ type: 'read', what: 'title' });
      return { ok: true, message: 'Read title' };
    }
    if (action === 'read_selection') {
      execCommand({ type: 'read', what: 'selection' });
      return { ok: true, message: 'Read selection' };
    }
    if (action === 'read_focused') {
      execCommand({ type: 'read', what: 'focused' });
      return { ok: true, message: 'Read focused' };
    }
    if (action === 'read_heading') {
      if (step.label) {
        execCommand({ type: 'read', target: 'heading', label: step.label });
      } else {
        execCommand({ type: 'read', target: 'heading', n: step.n || 1 });
      }
      return { ok: true, message: 'Read heading' };
    }
    if (action === 'focus_element') {
      var el = getElementByRef(step.targetType || step.target, step.label, step.n);
      if (!el) return { ok: false, message: 'Element not found' };
      try { el.focus(); } catch (_err) { /* ignore */ }
      return { ok: true, message: 'Focused element' };
    }
    if (action === 'click_element') {
      var elc = getElementByRef(step.targetType || step.target, step.label, step.n);
      if (!elc) return { ok: false, message: 'Element not found' };
      try { elc.click(); } catch (_err) { /* ignore */ }
      return { ok: true, message: 'Clicked element' };
    }
    if (action === 'fill_text') {
      var elin = getElementByRef(step.targetType || step.target || 'input', step.label, step.n);
      if (!elin) return { ok: false, message: 'Element not found' };
      var isInput = elin.tagName === 'INPUT' || elin.tagName === 'TEXTAREA';
      var isContentEditable = elin.isContentEditable;
      if (!isInput && !isContentEditable) return { ok: false, message: 'Target not fillable' };
      if (isSensitiveInput(elin)) return { ok: false, message: 'Refused to fill sensitive field' };
      var value = step.value != null ? String(step.value) : '';
      if (isInput) {
        elin.value = value;
        try { elin.dispatchEvent(new Event('input', { bubbles: true })); } catch (_err) { }
        try { elin.dispatchEvent(new Event('change', { bubbles: true })); } catch (_err) { }
      } else if (isContentEditable) {
        elin.textContent = value;
      }
      return { ok: true, message: 'Filled text' };
    }
    if (action === 'describe_page') {
      var struct = buildPageStructure();
      var desc = describeStructure(struct);
      speak(desc);
      return { ok: true, message: desc };
    }
    if (action === 'move_heading') {
      var dir = step.direction || step.dir || 'next';
      execCommand({ type: 'move', target: 'heading', dir: dir === 'prev' ? 'prev' : 'next' });
      return { ok: true, message: 'Moved heading ' + (dir === 'prev' ? 'previous' : 'next') };
    }
    if (action === 'wait_for_user_input') {
      speak(step.prompt || translate('wait_for_user_input'));
      return { ok: true, message: 'Waiting for user input' };
    }
    return { ok: false, message: 'Unknown action ' + action };
  }

  function buildPageContextSnapshot() {
    try {
      return buildPageStructure();
    } catch (_err) {
      return null;
    }
  }

  async function runPlan(plan, opts) {
    if (!plan || !Array.isArray(plan.steps)) return { ok: false, error: 'Invalid plan' };
    var silentOutput = !!(opts && opts.silentOutput);
    if (silentOutput) suppressedSpeechDepth += 1;
    try {
      for (var i = 0; i < plan.steps.length; i++) {
        var step = plan.steps[i];
        var res = runToolStep(step);
        if (!res.ok) return { ok: false, error: res.message || 'Step failed', step: step };
        if (step.pauseMs) {
          await new Promise(function (resolve) { setTimeout(resolve, step.pauseMs); });
        }
      }
    } finally {
      if (silentOutput) suppressedSpeechDepth = Math.max(0, suppressedSpeechDepth - 1);
    }
    return { ok: true };
  }

  window.NavableTools = {
    buildPageStructure: buildPageStructure,
    runPlan: runPlan,
    runStep: runToolStep
  };

  // -------------------------------
  // Voice input/output (prototype)
  // -------------------------------

  var speech = window.NavableSpeech || {};
  var recognizer = null;
  var listening = false; // desired state for this tab (when active)
  var manualListening = null; // null = follow autostart; true = force on; false = force off
  var settingsLoaded = false;
  var lastSpoken = '';
  var lastUnknownCmdAt = 0;
  var lastMicBusyAt = 0;
  var recogLang = 'en-US';
  var outputLanguage = 'en';
  var transientRestoreTimer = null;
  var startRetryTimer = null;
  var startRetryCount = 0;
  var outputOpen = false;
  var recognizerRefreshTimer = null;
  var lastRecognitionResultAt = 0;
  var lastRecognitionLocaleRotateAt = 0;
  var voiceTurnInFlight = false;
  var voiceTurnResumeTimer = null;
  var suppressedSpeechDepth = 0;

  function clearTransientRestoreTimer() {
    if (!transientRestoreTimer) return;
    try { clearTimeout(transientRestoreTimer); } catch (_err) { /* ignore */ }
    transientRestoreTimer = null;
  }

  function clearStartRetryTimer() {
    if (!startRetryTimer) return;
    try { clearTimeout(startRetryTimer); } catch (_err) { /* ignore */ }
    startRetryTimer = null;
  }

  function clearRecognizerRefreshTimer() {
    if (!recognizerRefreshTimer) return;
    try { clearTimeout(recognizerRefreshTimer); } catch (_err) { /* ignore */ }
    recognizerRefreshTimer = null;
  }

  function clearVoiceTurnResumeTimer() {
    if (!voiceTurnResumeTimer) return;
    try { clearTimeout(voiceTurnResumeTimer); } catch (_err) { /* ignore */ }
    voiceTurnResumeTimer = null;
  }

  function getLiveRegion(mode) {
    var m = mode === 'assertive' ? 'assertive' : 'polite';
    return document.getElementById('navable-live-region-' + m);
  }

  function speak(text, opts) {
    opts = opts || {};
    if (suppressedSpeechDepth > 0) return;
    var mode = opts && opts.mode === 'assertive' ? 'assertive' : 'polite';
    var msg = String(text || '');
    var isTransient = !!opts.transient;
    var restoreMs = typeof opts.restoreMs === 'number' ? opts.restoreMs : 2500;
    var lang = opts && opts.lang ? String(opts.lang) : outputLocale(currentOutputLanguage());

    if (!isTransient) {
      lastSpoken = msg;
      clearTransientRestoreTimer();
      // Rely on the ARIA live region + screen reader; do not use browser text-to-speech.
      announce(lastSpoken, { mode: mode, lang: lang });
      return;
    }

    // Do not override the "last spoken" stable message for repeat/long-term display.
    var previousText = '';
    try {
      var existingRegion = getLiveRegion(mode);
      previousText = existingRegion ? String(existingRegion.textContent || '') : '';
    } catch (_err) {
      previousText = '';
    }
    announce(msg, { mode: mode, lang: lang });

    clearTransientRestoreTimer();
    transientRestoreTimer = setTimeout(function () {
      try {
        var region = getLiveRegion(mode);
        if (!region) return;
        // Only restore if nothing else has updated the live region since the transient message.
        if (String(region.textContent || '') !== msg) return;
        region.textContent = previousText;
      } catch (_err2) {
        // ignore
      }
    }, Math.max(0, restoreMs));
  }

  function speakTransient(text, restoreMs) {
    speak(text, { transient: true, restoreMs: restoreMs });
  }

  function isVoiceSupported() {
    return !!(speech && speech.supportsRecognition && speech.supportsRecognition());
  }

  function isPageActiveForVoice() {
    try {
      if (document.visibilityState && document.visibilityState !== 'visible') return false;
      return true;
    } catch (_err) {
      return true;
    }
  }

  function computeShouldListen() {
    if (outputOpen) return false;
    if (voiceTurnInFlight) return false;
    if (!isPageActiveForVoice()) return false;
    if (manualListening === true) return true;
    if (manualListening === false) return false;
    // Avoid auto-starting before we've checked stored settings.
    if (
      !settingsLoaded &&
      typeof chrome !== 'undefined' &&
      chrome.storage &&
      chrome.storage.sync
    ) {
      return false;
    }
    return !!(settings && settings.autostart);
  }

  function beginVoiceTurn() {
    if (voiceTurnInFlight) return false;
    clearVoiceTurnResumeTimer();
    voiceTurnInFlight = true;
    syncListening({ announce: false });
    return true;
  }

  function finishVoiceTurn(opts) {
    opts = opts || {};
    clearVoiceTurnResumeTimer();
    voiceTurnInFlight = false;
    var delayMs = typeof opts.delayMs === 'number' ? opts.delayMs : 900;
    if (delayMs <= 0) {
      syncListening({ announce: false });
      return;
    }
    voiceTurnResumeTimer = setTimeout(function () {
      voiceTurnResumeTimer = null;
      if (!voiceTurnInFlight) {
        syncListening({ announce: false });
      }
    }, Math.max(0, delayMs));
  }

  function refreshRecognizer(opts) {
    opts = opts || {};
    clearStartRetryTimer();
    clearRecognizerRefreshTimer();
    startRetryCount = 0;

    var shouldResume = opts.restart !== false && computeShouldListen();
    var delayMs = typeof opts.delayMs === 'number' ? opts.delayMs : 180;
    var oldRecognizer = recognizer;

    recognizer = null;
    listening = false;

    if (oldRecognizer) {
      try { oldRecognizer.stop({ silent: true }); } catch (_err) { /* ignore */ }
    }

    if (!shouldResume) return;

    recognizerRefreshTimer = setTimeout(function () {
      recognizerRefreshTimer = null;
      if (computeShouldListen()) startListening({ announce: false });
    }, oldRecognizer ? Math.max(0, delayMs) : 0);
  }

  function maybeRefreshRecognizerLanguage(text, detectedLanguage, provider) {
    if (String(provider || '').toLowerCase() !== 'native') return;
    var nextLanguage = detectRecognitionLanguage(text, detectedLanguage);
    var languageCandidates = recognitionLocalesForLanguage(nextLanguage, settings.language || recogLang || outputLocale(nextLanguage));
    var nextLocale = languageCandidates[0] || recognitionLocaleFor(nextLanguage);
    var mode = configuredLanguageMode();
    if (mode !== 'auto' && normalizeOutputLanguage(nextLocale) !== mode) return;
    if (!nextLocale) return;
    if (String(recogLang || '').toLowerCase() === String(nextLocale).toLowerCase()) return;
    recogLang = nextLocale;
    refreshRecognizer({ restart: true });
  }

  function ensureRecognizer() {
    if (recognizer || !isVoiceSupported()) return recognizer;
    recognizer = speech.createRecognizer({ lang: recogLang || 'en-US', interimResults: false, continuous: true, autoRestart: true });
    recognizer.on('result', function (ev) {
      if (!ev || !ev.transcript) return;
      if (voiceTurnInFlight) return;
      handleTranscript(ev.transcript, ev.language || '', ev.provider || '');
    });
    recognizer.on('error', function (e) {
      try {
        var code = e && e.error ? String(e.error) : 'unknown';
        var provider = e && e.provider ? String(e.provider) : '';
        if (code !== 'no-speech') {
          console.warn('[Navable] speech error', code);
        }
        if (code === 'start-failed' || code === 'audio-capture' || code === 'aborted') {
          // Common when another tab/window is still holding the mic. Retry quietly while we still want to listen.
          if (computeShouldListen()) {
            var now2 = Date.now();
            if (now2 - lastMicBusyAt > 15000) {
              lastMicBusyAt = now2;
              speakTransient(translate('microphone_busy_retry'), 3500);
            }
            clearStartRetryTimer();
            startRetryCount = Math.min(10, startRetryCount + 1);
            var backoff = Math.min(2000, 150 * startRetryCount);
            startRetryTimer = setTimeout(function () {
              if (!computeShouldListen()) return;
              try { ensureRecognizer(); if (recognizer) recognizer.start(); } catch (_err) { /* ignore */ }
            }, backoff);
            return;
          }
          return;
        }
	        if (code === 'no-speech') {
	          // If native fallback was just working in another language, try the next locale.
	          if (provider === 'native' && maybeRotateRecognitionLocale()) return;
	          return;
	        } else if (code === 'not-allowed' || code === 'service-not-allowed') {
	          listening = false;
	          manualListening = false;
	          speak(translate('speech_not_allowed'));
	        } else if (code === 'network') {
	          listening = false;
	          manualListening = false;
	          speak(translate('speech_network_issue'));
	        } else {
	          speak(translate('speech_problem_retry'));
	        }
      } catch (_err) {
        // ignore secondary failures
      }
    });
    recognizer.on('start', function () {
      startRetryCount = 0;
      clearStartRetryTimer();
      console.log('[Navable] listening');
    });
    recognizer.on('end', function () { console.log('[Navable] speech recognition ended'); });
    return recognizer;
  }

  function startListening(opts) {
    opts = opts || {};
    clearStartRetryTimer();
    startRetryCount = 0;
    ensureRecognizer();
    if (!recognizer) {
      if (opts.announce !== false) speak(translate('speech_not_available'));
      listening = false;
      return;
    }
    listening = true;
    if (opts.announce) speak(translate('listening_help'));
    try { recognizer.start(); } catch (_err) { /* errors are handled via recognizer error events */ }
  }

  function stopListening(opts) {
    opts = opts || {};
    listening = false;
    clearStartRetryTimer();
    startRetryCount = 0;
    if (opts.announce) speak(translate('stopped_listening'));
    try { if (recognizer) recognizer.stop(); } catch (_err) { /* ignore */ }
  }

  function syncListening(opts) {
    opts = opts || {};
    var should = computeShouldListen();
    if (should && !listening) startListening(opts);
    else if (!should && listening) stopListening(opts);
  }

  function toggleListening() {
    var currentlyOn = computeShouldListen();
    manualListening = currentlyOn ? false : true;
    syncListening({ announce: true });
  }

  // Pause listening while the Navable output overlay is open to avoid SR/TTS feedback loops.
  try {
    window.addEventListener(
      'navable:output-open',
      function (e) {
        try {
          outputOpen = !!(e && e.detail && e.detail.open);
        } catch (_err) {
          outputOpen = false;
        }
        syncListening({ announce: false });
      },
      { capture: true }
    );
  } catch (_e) {
    // ignore
  }

  // Auto-pause/resume based on tab visibility/focus so multiple open tabs don't contend for speech recognition.
  try {
    document.addEventListener('visibilitychange', function () {
      syncListening({ announce: false });
    }, { capture: true });
    window.addEventListener('focus', function () { syncListening({ announce: false }); }, { capture: true });
    window.addEventListener('blur', function () { syncListening({ announce: false }); }, { capture: true });
    window.addEventListener('pagehide', function () { stopListening({ announce: false }); }, { capture: true });
  } catch (_err) {
    // ignore
  }

  function matchesAnyPattern(text, patterns) {
    for (var i = 0; i < patterns.length; i++) {
      if (patterns[i].test(text)) return true;
    }
    return false;
  }

  function extractSearchSiteQuery(t) {
    var s = String(t || '').trim().toLowerCase();
    if (!s) return null;

    var en = s.match(/^(search|google|look up|find|search up|check)\s+(for\s+)?(.+)$/);
    if (en && en[3]) return 'search for ' + String(en[3]).trim();

    var fr = s.match(/^(cherche|recherche)\s+(.+)$/);
    if (fr && fr[2]) return 'search for ' + String(fr[2]).trim();

    var ar = s.match(/^(ابحث|فتش|دو[ّو]?ر|طل[ّ]?ع)(\s+عن)?\s+(.+)$/);
    if (ar && ar[3]) return 'search for ' + String(ar[3]).trim();

    return null;
  }

  function stripOpenIntentPrefixes(t) {
    var s = String(t || '').trim().toLowerCase();
    if (!s) return '';

    var patterns = [
      /^(?:hey\s+navable|navable|please|pls)\b[\s,]*/,
      /^(?:can you|could you|would you|will you)\b[\s,]*/,
      /^(?:peux[- ]?tu|pourrais[- ]?tu|tu peux|svp|stp|s['’]?il te pla[îi]t)\b[\s,]*/,
      /^(?:لو سمحت|من فضلك|رجاءً?|رجاء|ممكن|بتقدر|تقدر)\b[\s،]*/
    ];

    var changed = true;
    while (changed) {
      changed = false;
      for (var i = 0; i < patterns.length; i += 1) {
        var next = s.replace(patterns[i], '').trim();
        if (next !== s) {
          s = next;
          changed = true;
        }
      }
    }

    return s;
  }

  function extractOpenSiteQuery(t) {
    var s = stripOpenIntentPrefixes(t);
    if (!s) return null;

    // Avoid conflicting with in-page intents like "open first link" or "press button".
    if (/\b(link|button|heading|lien|bouton|titre)\b|رابط|زر|عنوان/.test(s)) return null;

    // Arabic website intents.
    var ar = s.match(/^(افتح(?:\s+لي)?|خذني\s+على|خذني\s+إلى|خذني\s+الى|وديني\s+على|وديني\s+إلى|وديني\s+الى|اذهب\s+إلى|اذهب\s+الى|روح\s+على|روح\s+إلى|روح\s+الى|انتقل\s+إلى|انتقل\s+الى|خليني\s+أروح\s+على|خليني\s+اروح\s+على|خلينا\s+نروح\s+على)\s+(.+)$/);
    if (ar && ar[2]) return String(ar[2]).trim();

    // French website intents.
    var fr = s.match(/^(ouvre|va(?:s)?\s+(?:a|à)|aller?\s+(?:a|à)|visite|lance)\s+(.+)$/);
    if (fr && fr[2]) {
      return String(fr[2])
        .trim()
        .replace(/^(le|la|les|un|une)\b/, '')
        .trim()
        .replace(/^(site|page|onglet|application|appli)\b/, '')
        .trim();
    }

    // English: flexible website intents.
    if (!/^(open|open up|navigate to|take me to|go to|visit|bring up|launch|pull up)\b/.test(s)) return null;

    var q = s
      .replace(/^(open(\s+up)?|navigate to|take me to|go to|visit|bring up|launch|pull up)\b/, '')
      .trim()
      .replace(/^(me|for me)\b/, '')
      .trim()
      .replace(/^(a|an|the)\b/, '')
      .trim()
      .replace(/^(new\s+)?tab\b/, '')
      .trim()
      .replace(/^(website|site|page|app)\b/, '')
      .trim()
      .replace(/\bfor me\b/g, '')
      .trim()
      .replace(/\bplease\b/g, '')
      .trim();

    if (!q) return null;
    // If the remainder looks like another command, ignore.
    if (/^(scroll|read|focus|press|activate|next|previous|prev|repeat|stop)\b/.test(q)) return null;
    return q;
  }

  function isSummaryCommandText(text) {
    var t = String(text || '').toLowerCase();
    if (!t) return false;
    return (
      t.includes('summarize') ||
      t.includes('summary') ||
      t.includes('describe this page') ||
      t.includes('what is this page') ||
      t.includes("what's on this page") ||
      t.includes('what is on this page') ||
      t.includes("what's this page") ||
      /r[ée]sum[ée]?.*cette page/.test(t) ||
      /d[ée]cri(s|re).*cette page/.test(t) ||
      /c[' ]?est quoi cette page/.test(t) ||
      /qu[' ]?est[- ]ce que cette page/.test(t) ||
      /ما هذه الصفحه/.test(t) ||
      /ما هذه الصفحة/.test(t) ||
      /ما هو محتوى الصفحة/.test(t) ||
      /ملخص/.test(t) ||
      /وصف الصفحة|صفحة شو هاي|شو هاي الصفحة|ايش هاي الصفحة|شو موجود هون|احكيلي عن الصفحة|اعطيني ملخص/.test(t)
    );
  }

  function isPageAssistantQuestionText(text) {
    var t = String(text || '').trim().toLowerCase();
    if (!t) return false;
    if (isSummaryCommandText(t)) return true;
    return (
      /\b(where am i|help me here|help on this page|help on this site|what can i do here|what can i do on this page|what can i do on this site|what is important here|what's important here|what is important on this page|what's important on this page|tell me about this page|tell me about the page|guide me here|what am i looking at|what is on this screen|what's on this screen|what is here|what's here)\b/.test(t) ||
      /\b(o[uù] suis[- ]?je|aide[- ]?moi ici|que puis[- ]je faire ici|que puis[- ]je faire sur cette page|qu[' ]?est[- ]ce qui est important ici|qu[' ]?est[- ]ce qui est important sur cette page|parle[- ]?moi de cette page|guide[- ]?moi ici|qu[' ]?y a[- ]t[- ]il ici)\b/.test(t) ||
      /(أين أنا|اين انا|ساعدني هنا|ساعدني هون|ماذا يمكنني أن أفعل هنا|ماذا يمكنني ان افعل هنا|شو المهم هون|ايش المهم هون|شو المهم هنا|ايش المهم هنا|احكيلي عن (?:هاي|هذه) الصفحة|احكيلي عن ه(?:اي|ذا) الموقع|دلني هون|دلني هنا|وجهني هون|وجهني هنا|شو في هون|ايش في هون|شو الموجود هون|ايش الموجود هون)/.test(t)
    );
  }

  function isSessionFollowUpText(text) {
    var t = String(text || '').trim().toLowerCase();
    if (!t) return false;
    return (
      /^(tell me more|more detail|more details|go on|continue|keep going|expand that|what about that|what about it|and then)\b/.test(t) ||
      /^(dis[- ]?m[' ]?en plus|plus de d[ée]tails|continue|vas[- ]?y|et ensuite)\b/.test(t) ||
      /^(احكيلي اكثر|احكيلي المزيد|زيدني|كم[ّ]?ل|كمل|ماذا عن ذلك|شو كمان|ايش كمان)\b/.test(t)
    );
  }

  var localAssistantSession = null;

  function trimAssistantMemoryText(text, maxLen) {
    var raw = String(text || '').replace(/\s+/g, ' ').trim();
    var limit = typeof maxLen === 'number' ? maxLen : 240;
    if (!raw) return '';
    return raw.length > limit ? (raw.slice(0, Math.max(0, limit - 3)).trim() + '...') : raw;
  }

  function extractAssistantEntity(text) {
    var raw = trimAssistantMemoryText(text, 160);
    if (!raw || isSessionFollowUpText(raw)) return '';
    return trimAssistantMemoryText(
      raw
        .replace(/^[“"'`]+|[”"'`]+$/g, '')
        .replace(/^(who|what|when|where|why|how)\s+(is|are|was|were)\s+/i, '')
        .replace(/^(explain|define|compare|tell me about|more about|what about)\s+/i, '')
        .replace(/^(qui|que|qu[' ]?est[- ]?ce que|qu[' ]?est-ce que|explique|definis|définis|compare|parle[- ]?moi de|dis[- ]?moi)\s+/i, '')
        .replace(/^(من|ما هو|ما هي|ما|اشرح|عر[ّ]ف|عرف|احكيلي عن|قل لي عن|خبرني عن|شو هو|ايش هو)\s+/i, '')
        .replace(/^(the|a|an|le|la|les|un|une|ال)\s+/i, '')
        .replace(/[?!.]+$/g, ''),
      80
    );
  }

  function buildLocalAssistantPageMemory(structure, summaryText) {
    if (!structure) return null;
    var privacy = structure && structure.privacy ? structure.privacy : {};
    var sensitive = !!(privacy && (privacy.sensitivePage || Number(privacy.sensitiveInputCount || 0) > 0));
    return {
      url: trimAssistantMemoryText(structure.url, 280),
      host: (function () {
        try { return new URL(String(structure.url || '')).hostname.toLowerCase(); } catch (_err) { return ''; }
      })(),
      title: trimAssistantMemoryText(structure.title, 120),
      topHeading: trimAssistantMemoryText(structure && structure.headings && structure.headings[0] ? structure.headings[0].label : '', 120),
      activeLabel: sensitive ? '' : trimAssistantMemoryText(structure.activeLabel, 120),
      summary: sensitive ? '' : trimAssistantMemoryText(summaryText, 260),
      sensitivePage: sensitive,
      sensitiveInputCount: Math.max(0, Number(privacy.sensitiveInputCount || 0))
    };
  }

  function buildLocalAssistantSessionContext() {
    if (!localAssistantSession) return null;
    return {
      lastPurpose: localAssistantSession.lastPurpose || '',
      lastUserUtterance: localAssistantSession.lastUserUtterance || '',
      lastEntity: localAssistantSession.lastEntity || '',
      lastAssistantReply: localAssistantSession.lastAssistantReply || '',
      lastAnswer: localAssistantSession.lastAnswer || '',
      lastPage: localAssistantSession.lastPage || null,
      lastAction: localAssistantSession.lastAction || '',
      outputLanguage: localAssistantSession.outputLanguage || '',
      detectedLanguage: localAssistantSession.detectedLanguage || '',
      recognitionProvider: localAssistantSession.recognitionProvider || '',
      domainHabits: null
    };
  }

  function rememberLocalAssistantTurn(info) {
    var existing = localAssistantSession || {};
    var purpose = info && info.purpose ? String(info.purpose) : (existing.lastPurpose || '');
    var speech = trimAssistantMemoryText((info && (info.speech || info.description)) || '', 260);
    var answer = trimAssistantMemoryText((info && info.answer) || '', 260);
    var summary = trimAssistantMemoryText((info && info.summary) || '', 260);
    var structure = info && info.structure ? info.structure : null;
    localAssistantSession = {
      lastPurpose: purpose || existing.lastPurpose || '',
      lastUserUtterance: trimAssistantMemoryText(info && info.input, 180) || existing.lastUserUtterance || '',
      lastEntity: extractAssistantEntity(info && info.input) || existing.lastEntity || '',
      lastAssistantReply: speech || answer || summary || existing.lastAssistantReply || '',
      lastAnswer: answer || existing.lastAnswer || '',
      lastPage: structure ? buildLocalAssistantPageMemory(structure, summary || speech) : (existing.lastPage || null),
      lastAction: existing.lastAction || '',
      outputLanguage: trimAssistantMemoryText(info && info.outputLanguage, 24) || existing.outputLanguage || '',
      detectedLanguage: trimAssistantMemoryText(info && info.detectedLanguage, 24) || existing.detectedLanguage || '',
      recognitionProvider: trimAssistantMemoryText(info && info.recognitionProvider, 24) || existing.recognitionProvider || ''
    };
  }

  function assistantPurposeForText(text, sessionContext) {
    if (isSummaryCommandText(text)) return 'summary';
    if (isPageAssistantQuestionText(text)) return 'page';
    if (isSessionFollowUpText(text)) {
      var priorPurpose = sessionContext && sessionContext.lastPurpose ? String(sessionContext.lastPurpose).trim().toLowerCase() : '';
      if (priorPurpose === 'summary' || priorPurpose === 'page') return 'page';
      if (priorPurpose === 'answer') return 'answer';
      return 'auto';
    }
    return 'answer';
  }

  function parseCommand(text) {
    var original = String(text || '');
    var t = original.trim().toLowerCase();
    if (!t) return null;
    var num = extractNumber(t);
    var label;

    // Help / examples.
    if (
      /^(help|help me|commands|show commands|what can i say\??|what can you do\??|aide|montre les commandes|que puis-je dire\??)$/.test(t) ||
      /مساعدة|شو الاوامر|ايش الاوامر|شو بقدر احكي|ايش بقدر احكي/.test(t)
    ) {
      return { type: 'help' };
    }

    // Summary/orientation triggers in English, French, and Arabic.
    if (isSummaryCommandText(t)) {
      return { type: 'summarize', command: original || 'Summarize this page' };
    }

    var searchQuery = extractSearchSiteQuery(t);
    if (searchQuery) return { type: 'open_site', query: searchQuery, newTab: true };

    // Open a new website (dynamic) in a new tab.
    var siteQuery = extractOpenSiteQuery(t);
    if (siteQuery) return { type: 'open_site', query: siteQuery, newTab: true };

    if (matchesAnyPattern(t, [/(scroll )?down/, /scroll down/, /\bdescend(s)?\b/, /plus bas/, /انزل|نز[ّل]|مرر.*(للأسفل|للاسفل|لتحت)|لتحت|تحت شوي|كم[ّ]?ل لتحت/])) return { type: 'scroll', dir: 'down' };
    if (matchesAnyPattern(t, [/(scroll )?up/, /scroll up/, /\bmonte\b/, /plus haut/, /اطلع|طلع|اصعد|مرر.*(للأعلى|للاعلى|لفوق)|لفوق|فوق شوي|كم[ّ]?ل لفوق/])) return { type: 'scroll', dir: 'up' };
    if (matchesAnyPattern(t, [/\btop\b/, /scroll (to )?top/, /en haut/, /أعلى الصفحة|اعلى الصفحة|لفوق للاخر|اطلع فوق/])) return { type: 'scroll', dir: 'top' };
    if (matchesAnyPattern(t, [/\bbottom\b/, /scroll (to )?bottom/, /en bas/, /أسفل الصفحة|اسفل الصفحة|لتحت للاخر|انزل تحت/])) return { type: 'scroll', dir: 'bottom' };
    if (matchesAnyPattern(t, [/read (the )?title/, /read title/, /lis le titre/, /quel est le titre/, /اقر[أا] العنوان|ما عنوان الصفحة|شو عنوان الصفحة|ايش عنوان الصفحة/])) return { type: 'read', what: 'title' };
    if (matchesAnyPattern(t, [/^read (the )?selection/, /^read selected/, /lis la s[ée]lection/, /اقر[أا] التحديد/])) return { type: 'read', what: 'selection' };
    if (matchesAnyPattern(t, [/^read (the )?(focus|focused|this)$/, /sur quoi suis[- ]je/, /ما العنصر المحدد|على ماذا انا|على ماذا أنا|شو العنصر الحالي|ايش العنصر الحالي|وين انا واقف|على شو انا/])) return { type: 'read', what: 'focused' };

    // Explicit label-based intents first
    if ((/^open/.test(t) || /^click/.test(t)) && /link/.test(t) && (label = extractLabel(t, 'link'))) return { type: 'open', target: 'link', label: label };
    if ((/^focus/.test(t) || /focus .*button/.test(t)) && /button/.test(t) && (label = extractLabel(t, 'button'))) return { type: 'focus', target: 'button', label: label };
    if (/^read/.test(t) && /heading/.test(t) && (label = extractLabel(t, 'heading'))) return { type: 'read', target: 'heading', label: label };
    if ((/^press/.test(t) || /^activate/.test(t)) && /button/.test(t) && (label = extractLabel(t, 'button'))) return { type: 'activate', target: 'button', label: label };

    // activate focused or this element
    if (/^(activate|press|click)( (the )?(focus|focused|this))?$/.test(t)) return { type: 'activate', target: 'focused' };

    // Shorthand label forms (“go to pricing”, “click docs”, “press continue”)
    if (/^go to /.test(t)) return { type: 'open', target: 'link', label: t.replace(/^go to\s+/, '').trim() };
    if (/^click\s+/.test(t) && !/link|button|heading/.test(t)) return { type: 'open', target: 'link', label: t.replace(/^click\s+/, '').trim() };
    if (/^press\s+/.test(t) && !/link|button|heading/.test(t)) return { type: 'activate', target: 'button', label: t.replace(/^press\s+/, '').trim() };

    // Heading position (fallback to 1 when no ordinal present)
    if (/read .*heading/.test(t) || /^read heading/.test(t)) {
      return { type: 'read', target: 'heading', n: num != null ? num : 1 };
    }

    // Nth link/button commands (require ordinal/number)
    if ((/^open/.test(t) || /^click/.test(t)) && /link/.test(t) && num != null) {
      return { type: 'open', target: 'link', n: num };
    }
    if ((/^focus/.test(t) || /focus .*button/.test(t)) && /button/.test(t) && num != null) {
      return { type: 'focus', target: 'button', n: num };
    }
    if ((/^press/.test(t) || /^activate/.test(t)) && /button/.test(t) && num != null) {
      return { type: 'activate', target: 'button', n: num };
    }

    // Navigation (next/previous)
    if (/next .*link/.test(t) || /^next link/.test(t)) return { type: 'move', target: 'link', dir: 'next' };
    if (/previous .*link/.test(t) || /^previous link/.test(t) || /prev .*link/.test(t)) return { type: 'move', target: 'link', dir: 'prev' };
    if (/next .*button/.test(t) || /^next button/.test(t)) return { type: 'move', target: 'button', dir: 'next' };
    if (/previous .*button/.test(t) || /^previous button/.test(t) || /prev .*button/.test(t)) return { type: 'move', target: 'button', dir: 'prev' };
    if (/next .*heading/.test(t) || /^next heading/.test(t)) return { type: 'move', target: 'heading', dir: 'next' };
    if (/previous .*heading/.test(t) || /^previous heading/.test(t) || /prev .*heading/.test(t)) return { type: 'move', target: 'heading', dir: 'prev' };

    if (/repeat|say that again|r[ée]p[èe]te|كرر|عيد/.test(t)) return { type: 'repeat' };
    if (/stop|stop listening|cancel|arr[êe]te|stoppe|توقف|قف|وقف|خلاص|اسكت/.test(t)) return { type: 'stop' };
    return null;
  }

  function extractNumber(t) {
    // ordinals
    var ord = {
      'first': 1, '1st': 1, 'one': 1,
      'second': 2, '2nd': 2, 'two': 2,
      'third': 3, '3rd': 3, 'three': 3,
      'fourth': 4, '4th': 4, 'four': 4,
      'fifth': 5, '5th': 5, 'five': 5,
      'sixth': 6, '6th': 6, 'six': 6,
      'seventh': 7, '7th': 7, 'seven': 7,
      'eighth': 8, '8th': 8, 'eight': 8,
      'ninth': 9, '9th': 9, 'nine': 9,
      'tenth': 10, '10th': 10, 'ten': 10,
      'last': -1
    };
    for (var k in ord) { if (t.includes(k)) return ord[k]; }
    var m = t.match(/(\d+)/);
    if (m) return parseInt(m[1], 10);
    return null;
  }

  function pickNth(type, n) {
    rescan();
    var items = index.items.filter(function (it) { return it.type === type; });
    if (!items.length) return null;
    var idx = (n === -1) ? (items.length - 1) : (Math.max(1, n || 1) - 1);
    var chosen = items[idx];
    if (!chosen) return null;
    return document.querySelector('[data-navable-id="' + chosen.id + '"]');
  }

  function extractLabel(t, target) {
    // quoted first
    var m = t.match(/"([^"]+)"|'([^']+)'/);
    var label = (m && (m[1] || m[2])) || '';
    if (!label) {
      var idx = t.indexOf(target);
      if (idx >= 0) {
        label = t.slice(idx + target.length).trim();
        var fillers = ['named', 'called', 'labelled', 'labeled'];
        for (var i = 0; i < fillers.length; i++) {
          var word = fillers[i] + ' ';
          if (label.startsWith(word)) {
            label = label.slice(word.length).trim();
            break;
          }
        }
      }
    }
    label = (label || '').trim();
    if (!label) return null;
    // strip common fillers and ordinals
    label = label.replace(/^(the|a|an)\s+/, '').trim();
    ['first', '1st', 'one', 'second', '2nd', 'two', 'third', '3rd', 'three', 'fourth', '4th', 'four', 'fifth', '5th', 'five', 'last'].forEach(function (k) {
      var re = new RegExp('\\b' + k + '\\b', 'g');
      label = label.replace(re, '').trim();
    });
    return label || null;
  }

  function findByLabel(type, label) {
    rescan();
    var items = index.items.filter(function (it) { return it.type === type; });
    if (!items.length) return null;
    var norm = function (s) { return String(s || '').trim().toLowerCase().replace(/\s+/g, ' '); };
    var L = norm(label);
    var candidate = null;
    // exact match first
    for (var i = 0; i < items.length; i++) { if (norm(items[i].label) === L) { candidate = items[i]; break; } }
    // startswith
    if (!candidate) for (var j = 0; j < items.length; j++) { if (norm(items[j].label).startsWith(L)) { candidate = items[j]; break; } }
    // includes
    if (!candidate) candidate = items.find(function (it) { return norm(it.label).includes(L); }) || null;
    if (!candidate) return null;
    return document.querySelector('[data-navable-id="' + candidate.id + '"]');
  }

  var lastIndexByType = {};

  function moveBy(type, dir) {
    rescan();
    var items = index.items.filter(function (it) { return it.type === type; });
    if (!items.length) return null;
    var currentIdx = lastIndexByType[type];
    if (typeof currentIdx !== 'number') {
      // try activeElement
      var ae = document.activeElement;
      if (ae && ae.dataset && ae.dataset.navableId) {
        var id = ae.dataset.navableId;
        currentIdx = items.findIndex(function (it) { return it.id === id; });
      }
      if (currentIdx == null || currentIdx < 0) currentIdx = 0;
    }
    var delta = dir === 'prev' ? -1 : 1;
    var nextIdx = (currentIdx + delta + items.length) % items.length;
    lastIndexByType[type] = nextIdx;
    var chosen = items[nextIdx];
    return document.querySelector('[data-navable-id="' + chosen.id + '"]');
  }

  function execCommand(cmd) {
    if (!cmd) {
      var now = Date.now();
      if (now - lastUnknownCmdAt < 5000) return;
      lastUnknownCmdAt = now;
      speakTransient(translate('unknown_command'), 3200);
      return;
    }
    if (cmd.type === 'help') { speakHelp(); return; }
    if (cmd.type === 'open_site') {
      openSiteRequest(cmd.query, cmd.newTab !== false);
      return;
    }
    if (cmd.type === 'scroll') {
      var amount = Math.floor(window.innerHeight * 0.8);
      if (cmd.dir === 'down') {
        window.scrollBy({ top: amount, behavior: 'smooth' });
        speak(translate('scrolled_down'));
      } else if (cmd.dir === 'up') {
        window.scrollBy({ top: -amount, behavior: 'smooth' });
        speak(translate('scrolled_up'));
      } else if (cmd.dir === 'top') {
        window.scrollTo({ top: 0, behavior: 'smooth' });
        speak(translate('scrolled_top'));
      } else if (cmd.dir === 'bottom') {
        window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
        speak(translate('scrolled_bottom'));
      } else {
        window.scrollBy({ top: amount, behavior: 'smooth' });
        speak(translate('scrolled_down'));
      }
      console.log('[Navable] Action: scroll', cmd.dir);
      return;
    }
    if (cmd.type === 'read' && cmd.what === 'title') {
      var h1 = document.querySelector('h1');
      var title = (h1 && h1.innerText) || document.title || '';
      speak(translate('title_value', { value: title || translate('value_not_found') }));
      console.log('[Navable] Action: read title');
      return;
    }
    if (cmd.type === 'read' && cmd.what === 'selection') {
      var sel = '';
      try { sel = String(window.getSelection && window.getSelection().toString() || '').trim(); } catch (_err) { /* selection failed */ }
      if (sel) { speak(translate('selection_value', { value: sel })); } else { speak(translate('no_selection')); }
      console.log('[Navable] Action: read selection');
      return;
    }
    if (cmd.type === 'read' && cmd.what === 'focused') {
      var fe = document.activeElement;
      if (fe) {
        var fl = (fe.dataset && fe.dataset.navableLabel) || fe.getAttribute && fe.getAttribute('aria-label') || fe.innerText || fe.textContent || '';
        fl = String(fl || '').trim();
        speak(fl || translate('no_focused_text'));
      } else {
        speak(translate('no_focused_element'));
      }
      console.log('[Navable] Action: read focused');
      return;
    }
    if (cmd.type === 'read' && cmd.target === 'heading' && cmd.label) {
      var elhL = findByLabel('heading', cmd.label);
      if (!elhL) { speak(translate('not_found_heading')); return; }
      var lblhL = elhL.dataset.navableLabel || elhL.innerText || elhL.textContent || '';
      speak(translate('heading_value', { value: lblhL.trim() || translate('unnamed') }));
      console.log('[Navable] Action: read heading by label', cmd.label);
      return;
    }
    if (cmd.type === 'read' && cmd.target === 'heading' && !cmd.label) {
      var elh = pickNth('heading', cmd.n || 1);
      if (!elh) { speak(translate('not_found_generic', { target: localizeTarget('heading') })); return; }
      var lblh = elh.dataset.navableLabel || elh.innerText || elh.textContent || '';
      speak(translate('heading_value', { value: lblh.trim() || translate('unnamed') }));
      console.log('[Navable] Action: read heading', cmd.n);
      return;
    }
    if (cmd.type === 'open' && cmd.target === 'link' && cmd.label) {
      var ellL = findByLabel('link', cmd.label);
      if (!ellL) { speak(translate('not_found_link')); return; }
      var lbllL = ellL.dataset.navableLabel || ellL.innerText || ellL.textContent || '';
      speak(translate('opening_value', { value: lbllL.trim() || translate('target_link') }));
      ellL.click();
      console.log('[Navable] Action: open link by label', cmd.label);
      return;
    }
    if (cmd.type === 'open' && cmd.target === 'link' && !cmd.label) {
      var ell = pickNth('link', cmd.n || 1);
      if (!ell) { speak(translate('not_found_generic', { target: localizeTarget('link') })); return; }
      var lbll = ell.dataset.navableLabel || ell.innerText || ell.textContent || '';
      speak(translate('opening_value', { value: lbll.trim() || translate('target_link') }));
      // Prefer click to follow anchors and SPA handlers
      ell.click();
      console.log('[Navable] Action: open link', cmd.n);
      return;
    }
    if (cmd.type === 'focus' && cmd.target === 'button' && cmd.label) {
      var elbL = findByLabel('button', cmd.label);
      if (!elbL) { speak(translate('not_found_button')); return; }
      try { elbL.focus(); } catch (_err) { /* focus failed */ }
      var lblbL = elbL.dataset.navableLabel || elbL.innerText || elbL.textContent || '';
      speak(translate('focused_value', { value: lblbL.trim() || translate('target_button') }));
      console.log('[Navable] Action: focus button by label', cmd.label);
      return;
    }
    if (cmd.type === 'focus' && cmd.target === 'button' && !cmd.label) {
      var elb = pickNth('button', cmd.n || 1);
      if (!elb) { speak(translate('not_found_generic', { target: localizeTarget('button') })); return; }
      try { elb.focus(); } catch (_err) { /* focus failed */ }
      var lblb = elb.dataset.navableLabel || elb.innerText || elb.textContent || '';
      speak(translate('focused_value', { value: lblb.trim() || translate('target_button') }));
      console.log('[Navable] Action: focus button', cmd.n);
      return;
    }
    if (cmd.type === 'activate' && cmd.target === 'focused') {
      var aef = document.activeElement;
      if (!aef) { speak(translate('no_focused_element')); return; }
      var labf = (aef.dataset && aef.dataset.navableLabel) || aef.getAttribute && aef.getAttribute('aria-label') || aef.innerText || aef.textContent || '';
      labf = String(labf || '').trim();
      try { aef.click(); } catch (_err) { /* click failed */ }
      speak(translate('activated_value', { value: labf || translate('target_element') }));
      console.log('[Navable] Action: activate focused');
      return;
    }
    if (cmd.type === 'activate' && cmd.target === 'button' && cmd.label) {
      var ab = findByLabel('button', cmd.label);
      if (!ab) { speak(translate('not_found_button')); return; }
      var labb = ab.dataset.navableLabel || ab.innerText || ab.textContent || '';
      try { ab.focus(); } catch (_err) { /* focus failed */ }
      try { ab.click(); } catch (_err) { /* click failed */ }
      speak(translate('activated_value', { value: String(labb || translate('target_button')).trim() }));
      console.log('[Navable] Action: activate button by label', cmd.label);
      return;
    }
    if (cmd.type === 'activate' && cmd.target === 'button' && cmd.n != null) {
      var abin = pickNth('button', cmd.n);
      if (!abin) { speak(translate('not_found_generic', { target: localizeTarget('button') })); return; }
      var labbn = abin.dataset.navableLabel || abin.innerText || abin.textContent || '';
      try { abin.focus(); } catch (_err) { /* focus failed */ }
      try { abin.click(); } catch (_err) { /* click failed */ }
      speak(translate('activated_value', { value: String(labbn || translate('target_button')).trim() }));
      console.log('[Navable] Action: activate button', cmd.n);
      return;
    }
    if (cmd.type === 'move' && (cmd.target === 'link' || cmd.target === 'button')) {
      var elmv = moveBy(cmd.target, cmd.dir === 'prev' ? 'prev' : 'next');
      if (!elmv) { speak(translate('not_found_generic', { target: localizeTarget(cmd.target) })); return; }
      try { elmv.focus(); } catch (_err) { /* focus failed */ }
      var lblmv = elmv.dataset.navableLabel || elmv.innerText || elmv.textContent || '';
      speak(translate('focused_value', { value: lblmv.trim() || localizeTarget(cmd.target) }));
      console.log('[Navable] Action: move ' + cmd.target, cmd.dir);
      return;
    }
    if (cmd.type === 'move' && cmd.target === 'heading') {
      var elmh = moveBy('heading', cmd.dir === 'prev' ? 'prev' : 'next');
      if (!elmh) { speak(translate('not_found_generic', { target: localizeTarget('heading') })); return; }
      var lblmh = elmh.dataset.navableLabel || elmh.innerText || elmh.textContent || '';
      if (!elmh.hasAttribute('tabindex')) {
        try { elmh.setAttribute('tabindex', '-1'); } catch (_err) { /* ignore */ }
      }
      try { elmh.focus(); } catch (_err) { /* focus failed */ }
      speak(translate('heading_value', { value: lblmh.trim() || translate('unnamed') }));
      console.log('[Navable] Action: move heading', cmd.dir);
      return;
    }
    if (cmd.type === 'repeat') { if (lastSpoken) speak(lastSpoken); return; }
    if (cmd.type === 'stop') { try { if (window.speechSynthesis) window.speechSynthesis.cancel(); } catch (_err) { /* cancel failed */ } return; }
  }

  async function runSummaryRequest(commandText, pageStructure) {
    var cmdText = (commandText && String(commandText).trim()) || 'Summarize this page';
    announce(translate('summarizing_wait'), {
      mode: 'assertive',
      lang: outputLocale(currentOutputLanguage())
    });
    if (!chrome || !chrome.runtime || !chrome.runtime.sendMessage) {
      announce(translate('summarize_unavailable_page'), {
        mode: 'assertive',
        lang: outputLocale(currentOutputLanguage())
      });
      return;
    }
    try {
      var res = await chrome.runtime.sendMessage({
        type: 'planner:run',
        command: cmdText,
        outputLanguage: currentOutputLanguage(),
        pageStructure: pageStructure || buildPageContextSnapshot()
      });
      if (!res || res.ok !== true) {
        announce((res && res.error) ? String(res.error) : translate('summarize_failed'), {
          mode: 'assertive',
          lang: outputLocale(currentOutputLanguage())
        });
      }
      // On success, the background will announce the summary via the live region.
    } catch (err) {
      console.warn('[Navable] summarize via planner failed', err);
      announce(translate('summarize_request_failed'), {
        mode: 'assertive',
        lang: outputLocale(currentOutputLanguage())
      });
    }
  }

  async function openSiteRequest(query, newTab) {
    var q = String(query || '').trim();
    if (!q) {
      speak(translate('tell_website_to_open'));
      return;
    }
    if (!chrome || !chrome.runtime || !chrome.runtime.sendMessage) {
      speak(translate('open_site_unavailable'));
      return;
    }
    try {
      var res = await chrome.runtime.sendMessage({
        type: 'navable:openSite',
        query: q,
        newTab: newTab !== false,
        outputLanguage: currentOutputLanguage()
      });
      if (!res || res.ok !== true) {
        speak((res && res.error) ? String(res.error) : translate('open_site_failed'));
      }
    } catch (err) {
      console.warn('[Navable] open site via background failed', err);
      speak(translate('open_site_failed'));
    }
  }

  async function assistantRequest(questionText, pageStructure, turnContext) {
    var q = String(questionText || '').trim();
    if (!q) return false;
    var context = turnContext || {};
    var sessionContext = buildLocalAssistantSessionContext();
    var purpose = assistantPurposeForText(q, sessionContext);
    var wantsPageContext = purpose === 'summary' || purpose === 'page';
    var structure = wantsPageContext ? (pageStructure || buildPageContextSnapshot()) : null;

    await ensureOutputLanguageReady();
    speakTransient(translate('answering_question'), 2500);

    if (chrome && chrome.runtime && chrome.runtime.sendMessage) {
      try {
        var res = await chrome.runtime.sendMessage({
          type: 'navable:assistant',
          input: q,
          outputLanguage: currentOutputLanguage(),
          purpose: purpose,
          pageContext: wantsPageContext,
          pageStructure: structure,
          autoExecutePlan: wantsPageContext,
          detectedLanguage: context.detectedLanguage || '',
          recognitionProvider: context.recognitionProvider || '',
          pageUrl: structure && structure.url ? structure.url : location.href
        });
        if (res && res.ok === true && res.speech) {
          var rememberedPurpose = purpose === 'auto' ? (res.mode === 'page' ? 'page' : 'answer') : purpose;
          rememberLocalAssistantTurn({
            input: q,
            purpose: rememberedPurpose,
            structure: structure,
            speech: res.speech,
            summary: res.summary || '',
            answer: res.answer || '',
            outputLanguage: currentOutputLanguage(),
            detectedLanguage: context.detectedLanguage || '',
            recognitionProvider: context.recognitionProvider || ''
          });
          speak(String(res.speech), { mode: 'assertive' });
          return true;
        }
        if (res && res.error) {
          console.warn('[Navable] assistant background request returned error', res.error);
        }
      } catch (err) {
        console.warn('[Navable] assistant message request failed', err);
      }
    }

    try {
      var directResponse = await window.fetch('http://localhost:3000/api/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: q,
          outputLanguage: currentOutputLanguage(),
          pageStructure: structure,
          purpose: purpose,
          sessionContext: sessionContext
        })
      });
      var directData = await directResponse.json().catch(function () { return {}; });
      if (
        directResponse.ok &&
        directData &&
        directData.action &&
        directData.action.type === 'open_site' &&
        directData.action.query
      ) {
        await openSiteRequest(directData.action.query, directData.action.newTab !== false);
        return true;
      }
      if (directResponse.ok && directData && directData.speech) {
        if (wantsPageContext && directData.plan && Array.isArray(directData.plan.steps) && directData.plan.steps.length) {
          await runPlan(directData.plan);
        }
        var directRememberedPurpose = purpose === 'auto' ? (directData.mode === 'page' ? 'page' : 'answer') : purpose;
        rememberLocalAssistantTurn({
          input: q,
          purpose: directRememberedPurpose,
          structure: structure,
          speech: directData.speech,
          summary: directData.summary || '',
          answer: directData.answer || '',
          outputLanguage: currentOutputLanguage(),
          detectedLanguage: context.detectedLanguage || '',
          recognitionProvider: context.recognitionProvider || ''
        });
        speak(String(directData.speech), { mode: 'assertive' });
        return true;
      }
      if (directData && directData.error) {
        speak(String(directData.error), { mode: 'assertive' });
        return true;
      }
    } catch (err2) {
      console.warn('[Navable] assistant direct request failed', err2);
    }

    speak(translate('answer_failed'), { mode: 'assertive' });
    return true;
  }

  async function tryIntentFallback(commandText, pageStructure) {
    if (!chrome || !chrome.runtime || !chrome.runtime.sendMessage) return false;
    try {
      var res = await chrome.runtime.sendMessage({
        type: 'planner:run',
        command: commandText,
        outputLanguage: currentOutputLanguage(),
        preferIntentFallback: true,
        pageStructure: pageStructure || buildPageContextSnapshot()
      });
      return !!(res && res.ok === true && (
        (res.plan && res.plan.steps && res.plan.steps.length) ||
        res.description ||
        res.summary
      ));
    } catch (err) {
      console.warn('[Navable] intent fallback failed', err);
      return false;
    }
  }

  async function handleTranscript(text, detectedLanguage, provider) {
    if (!beginVoiceTurn()) return false;
    console.log('[Navable] Recognized:', text);
    try {
      lastRecognitionResultAt = Date.now();
      maybeRefreshRecognizerLanguage(text, detectedLanguage, provider);
      setOutputLanguageFromTranscript(text, detectedLanguage);
      var languageReady = ensureOutputLanguageReady();
      var cmd = parseCommand(text);
      var pageStructure = buildPageContextSnapshot();
      if (cmd && cmd.type === 'summarize') {
        await runSummaryRequest(cmd.command, pageStructure);
        return true;
      }
      if (cmd) {
        execCommand(cmd);
        return true;
      }
      if (await tryIntentFallback(text, pageStructure)) return true;
      if (await assistantRequest(text, pageStructure, {
        detectedLanguage: detectedLanguage || '',
        recognitionProvider: provider || ''
      })) return true;
      await languageReady;
      execCommand(null);
      return true;
    } finally {
      finishVoiceTurn({ delayMs: 900 });
    }
  }

  window.NavableTools.handleTranscript = handleTranscript;

  // Hotkey to toggle listening: Alt+Shift+M (prototype)
  document.addEventListener('keydown', function (e) {
    if (e.altKey && e.shiftKey && (e.key === 'm' || e.key === 'M')) { toggleListening(); }
  }, { capture: true });

	  // Allow popup/background to toggle listening
	  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
	    chrome.runtime.onMessage.addListener((msg) => {
	      if (msg && msg.type === 'speech') {
	        if (msg.action === 'toggle') toggleListening();
	        if (msg.action === 'start') { manualListening = true; syncListening({ announce: true }); }
	        if (msg.action === 'stop') { manualListening = false; syncListening({ announce: true }); }
	      }
	    });
	  }

	  // Settings: load and react to changes
	  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
	    try {
	      chrome.storage.sync.get({ navable_settings: settings }, (res) => {
	        var s = res && res.navable_settings ? res.navable_settings : settings;
	        var autostart = typeof s.autostart === 'boolean' ? s.autostart : true;
	        var nextLanguageMode = normalizeLanguageMode(s.languageMode, s.language || 'en-US');
	        var nextSettings = {
	          language: s.language || 'en-US',
	          languageMode: nextLanguageMode,
	          overlay: !!s.overlay,
	          autostart: autostart
	        };
	        var nextRecogLang = configuredRecognitionLocale(nextSettings);
	        var recogLangChanged = String(nextRecogLang).toLowerCase() !== String(recogLang || '').toLowerCase();
	        settings = nextSettings;
	        settingsLoaded = true;
	        recogLang = nextRecogLang;
	        outputLanguage = lockedOutputLanguage(settings) || normalizeOutputLanguage(settings.language || 'en-US');
	        if (settings.overlay) { overlayOn = true; drawOverlay(); } else { overlayOn = false; clearOverlay(); }
	        if (recogLangChanged) refreshRecognizer({ restart: true });
	        else syncListening({ announce: false });
	      });
	      chrome.storage.onChanged && chrome.storage.onChanged.addListener((changes, area) => {
	        if (area !== 'sync' || !changes.navable_settings) return;
	        var s2 = changes.navable_settings.newValue || settings;
	        var autostart2 = typeof s2.autostart === 'boolean' ? s2.autostart : true;
	        var nextLanguageMode2 = normalizeLanguageMode(s2.languageMode, s2.language || 'en-US');
	        var nextSettings2 = {
	          language: s2.language || 'en-US',
	          languageMode: nextLanguageMode2,
	          overlay: !!s2.overlay,
	          autostart: autostart2
	        };
	        var nextRecogLang2 = configuredRecognitionLocale(nextSettings2);
	        var recogLangChanged2 = String(nextRecogLang2).toLowerCase() !== String(recogLang || '').toLowerCase();
	        settings = nextSettings2;
	        settingsLoaded = true;
	        recogLang = nextRecogLang2;
	        outputLanguage = lockedOutputLanguage(settings) || normalizeOutputLanguage(settings.language || 'en-US');
	        if (settings.overlay) { overlayOn = true; drawOverlay(); } else { overlayOn = false; clearOverlay(); }
	        if (recogLangChanged2) refreshRecognizer({ restart: true });
	        else syncListening({ announce: false });
	      });
	    } catch (_e) { /* storage not available in tests */ }
	  }

  // Help voice command + hotkey
  function speakHelp() {
    speak(translate('help_examples'));
  }

  document.addEventListener('keydown', function (e) {
    if (e.altKey && e.shiftKey && (e.key === 'h' || e.key === 'H')) { speakHelp(); }
  }, { capture: true });

  // Keyboard shortcuts for scrolling and heading navigation
  // Alt+Shift+ArrowDown  → scroll down
  // Alt+Shift+ArrowUp    → scroll up
  // Alt+Shift+PageDown   → next heading
  // Alt+Shift+PageUp     → previous heading
  document.addEventListener('keydown', function (e) {
    if (!e.altKey || !e.shiftKey) return;
    if (e.key === 'ArrowDown') {
      execCommand({ type: 'scroll', dir: 'down' });
      e.preventDefault();
      return;
    }
    if (e.key === 'ArrowUp') {
      execCommand({ type: 'scroll', dir: 'up' });
      e.preventDefault();
      return;
    }
    if (e.key === 'PageDown') {
      execCommand({ type: 'move', target: 'heading', dir: 'next' });
      e.preventDefault();
      return;
    }
    if (e.key === 'PageUp') {
      execCommand({ type: 'move', target: 'heading', dir: 'prev' });
      e.preventDefault();
    }
  }, { capture: true });
})();
