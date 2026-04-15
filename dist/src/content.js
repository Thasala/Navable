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
      if (msg && msg.type === 'navable:runTypedCommand') {
        handleTranscript(msg.text || '', msg.detectedLanguage || '', 'typed').then(function (handled) {
          sendResponse && sendResponse({ ok: !!handled, speech: lastSpoken || '' });
        }).catch(function (err) {
          sendResponse && sendResponse({ ok: false, error: String(err || 'typed command failed') });
        });
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
    if (!el.ownerDocument) return true;
    var rootNode = getRootNodeForElement(el);
    if (rootNode && rootNode.nodeType === 11) {
      if (!rootNode.host || !rootNode.host.isConnected) return true;
    } else if (!el.ownerDocument.documentElement.contains(el)) {
      return true;
    }
    var style = el.ownerDocument.defaultView.getComputedStyle(el);
    if (!style) return false;
    if (style.display === 'none' || style.visibility === 'hidden') return true;
    return false;
  }

  function escapeAttributeValue(value) {
    return String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  function getRootNodeForElement(el) {
    try {
      return el && el.getRootNode ? el.getRootNode() : null;
    } catch (_err) {
      return null;
    }
  }

  function getContextRootsForElement(el) {
    var roots = [];
    if (!el) return roots;
    var rootNode = getRootNodeForElement(el);
    if (rootNode) roots.push(rootNode);
    if (el.ownerDocument && roots.indexOf(el.ownerDocument) < 0) roots.push(el.ownerDocument);
    return roots;
  }

  function findElementByIdInRoot(root, id) {
    if (!root || !id) return null;
    try {
      if (typeof root.getElementById === 'function') return root.getElementById(id);
      if (root.querySelector) return root.querySelector('[id="' + escapeAttributeValue(id) + '"]');
    } catch (_err) {
      return null;
    }
    return null;
  }

  function findElementByIdScoped(el, id) {
    if (!id) return null;
    var roots = getContextRootsForElement(el);
    for (var i = 0; i < roots.length; i++) {
      var found = findElementByIdInRoot(roots[i], id);
      if (found) return found;
    }
    return null;
  }

  function findAssociatedLabelForControl(el) {
    var id = el && el.id ? String(el.id).trim() : '';
    if (!id) return null;
    var roots = getContextRootsForElement(el);
    for (var i = 0; i < roots.length; i++) {
      var root = roots[i];
      if (!root || !root.querySelector) continue;
      try {
        var label = root.querySelector('label[for="' + escapeAttributeValue(id) + '"]');
        if (label) return label;
      } catch (_err) {
        // ignore selector failures
      }
    }
    return null;
  }

  function getSameOriginFrameDocument(frameEl) {
    try {
      if (!frameEl || (frameEl.tagName || '').toLowerCase() !== 'iframe') return null;
      var childDoc = frameEl.contentDocument;
      if (!childDoc || !childDoc.documentElement) return null;
      return childDoc;
    } catch (_err) {
      return null;
    }
  }

  function forEachDescendantElement(root, callback) {
    if (!root || !callback) return;
    try {
      var ownerDoc = root.nodeType === 9 ? root : root.ownerDocument;
      if (!ownerDoc || !ownerDoc.createTreeWalker) return;
      var walker = ownerDoc.createTreeWalker(root, 1, null);
      var node = walker.nextNode();
      while (node) {
        callback(node);
        node = walker.nextNode();
      }
    } catch (_err) {
      // ignore traversal failures
    }
  }

  function collectSearchRoots(startRoot) {
    var roots = [];
    var seen = new Set();

    function visit(root) {
      if (!root || seen.has(root)) return;
      seen.add(root);
      roots.push(root);
      forEachDescendantElement(root, function (el) {
        if (el && el.shadowRoot) visit(el.shadowRoot);
        var childDoc = getSameOriginFrameDocument(el);
        if (childDoc) visit(childDoc);
      });
    }

    visit(startRoot || document);
    return roots;
  }

  function getGlobalClientRect(el) {
    if (!el || !el.getBoundingClientRect) return null;
    var rect = el.getBoundingClientRect();
    var left = rect.left;
    var top = rect.top;
    var win = el.ownerDocument && el.ownerDocument.defaultView;
    try {
      while (win && win.frameElement) {
        var frameRect = win.frameElement.getBoundingClientRect();
        left += frameRect.left;
        top += frameRect.top;
        win = win.parent;
      }
    } catch (_err) {
      // ignore frame coordinate failures
    }
    return {
      left: left,
      top: top,
      width: rect.width,
      height: rect.height
    };
  }

  function getDeepActiveElement(startDoc) {
    var active = startDoc && startDoc.activeElement ? startDoc.activeElement : null;
    var seen = new Set();
    while (active && !seen.has(active)) {
      seen.add(active);
      if (active.shadowRoot && active.shadowRoot.activeElement) {
        active = active.shadowRoot.activeElement;
        continue;
      }
      var childDoc = getSameOriginFrameDocument(active);
      if (childDoc && childDoc.activeElement && childDoc.activeElement !== childDoc.body && childDoc.activeElement !== childDoc.documentElement) {
        active = childDoc.activeElement;
        continue;
      }
      break;
    }
    return active;
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
        var n = findElementByIdScoped(el, id);
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
        var lab = findAssociatedLabelForControl(el);
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
    // svg title if present
    var svgTitle = el.querySelector && el.querySelector('svg title');
    if (svgTitle && svgTitle.textContent) {
      t = String(svgTitle.textContent || '').replace(/\s+/g, ' ').trim();
      if (t) return t;
    }
    // button-like input values
    if (el.tagName === 'INPUT') {
      var inputType = String((el.getAttribute && el.getAttribute('type')) || '').toLowerCase();
      if (inputType === 'button' || inputType === 'submit' || inputType === 'reset') {
        var buttonValue = el.getAttribute('value');
        if (buttonValue) return buttonValue.trim();
      }
    }
    var nameAttr = el.getAttribute && el.getAttribute('name');
    if (nameAttr) {
      t = humanizeIdentifier(nameAttr);
      if (t) return t;
    }
    var elementId = el.id || '';
    if (elementId) {
      t = humanizeIdentifier(elementId);
      if (t) return t;
    }
    if (el.tagName === 'A' && el.getAttribute) {
      t = humanizeUrlFragment(el.getAttribute('href') || '');
      if (t) return t;
    }
    t = fallbackLabelForElement(el);
    if (t) return t;
    return '';
  }

  function normalizeMatchText(text) {
    var raw = String(text || '');
    if (!raw) return '';
    raw = raw.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ');
    if (typeof raw.normalize === 'function') {
      try {
        raw = raw.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
      } catch (_err) {
        // ignore normalize failures
      }
    }
    return raw.toLowerCase().replace(/[^\w\u0600-\u06FF\s]+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function humanizeIdentifier(value) {
    var normalized = normalizeMatchText(value);
    if (!normalized) return '';
    return normalized.replace(/\b(btn|cta|lnk|nav|icon|field|input)\b/g, '').replace(/\s+/g, ' ').trim();
  }

  function humanizeUrlFragment(value) {
    var raw = String(value || '').trim();
    if (!raw) return '';
    try {
      if (/^(https?:)?\/\//i.test(raw)) {
        var url = new URL(raw, location.href);
        var path = url.pathname || '';
        var segs = path.split('/').filter(Boolean);
        var lastSeg = segs.length ? segs[segs.length - 1] : '';
        if (lastSeg) return humanizeIdentifier(lastSeg);
        if (url.hash) return humanizeIdentifier(url.hash.replace(/^#/, ''));
        return humanizeIdentifier(url.hostname.replace(/^www\./, ''));
      }
    } catch (_err) {
      // ignore URL parse failures
    }
    if (raw.charAt(0) === '#') return humanizeIdentifier(raw.slice(1));
    return humanizeIdentifier(raw);
  }

  function fallbackLabelForElement(el) {
    if (!el) return '';
    var type = getType(el);
    if (type === 'link') {
      var href = el.getAttribute && el.getAttribute('href');
      var hrefLabel = humanizeUrlFragment(href);
      if (hrefLabel) return hrefLabel;
      return 'unlabeled link';
    }
    if (type === 'button') {
      var buttonType = String((el.getAttribute && el.getAttribute('type')) || '').toLowerCase();
      if (buttonType === 'submit') return 'submit button';
      if (buttonType === 'reset') return 'reset button';
      return 'unlabeled button';
    }
    if (type === 'input') {
      var inputType = String((el.getAttribute && el.getAttribute('type')) || (el.tagName || '')).toLowerCase();
      if (inputType) return humanizeIdentifier(inputType) || 'input';
      return 'input';
    }
    return '';
  }

  var DEFAULT_AUTO_TARGET_ORDER = ['link', 'button', 'heading', 'input'];
  var ACTION_RETRY_DELAYS_MS = [0, 120, 350, 800, 1400];
  var ACTIONABLE_BUTTON_ROLES = {
    button: true,
    menuitem: true,
    tab: true,
    option: true,
    radio: true,
    checkbox: true,
    switch: true
  };
  var BUTTON_LIKE_INPUT_TYPES = {
    button: true,
    submit: true,
    reset: true,
    checkbox: true,
    radio: true,
    image: true
  };
  var FIELD_LIKE_TOKENS = ['password', 'email', 'username', 'search', 'phone', 'code', 'otp', 'pin', 'field', 'input', 'box'];
  var BUTTON_LIKE_TOKENS = ['button', 'submit', 'continue', 'confirm', 'save', 'send'];
  var LINK_LIKE_TOKENS = ['link', 'pricing', 'docs', 'documentation', 'login', 'signin', 'sign in', 'sign-in', 'learn more', 'read more'];
  var HEADING_LIKE_TOKENS = ['heading', 'section', 'title', 'part'];
  var EMAIL_FIELD_TOKENS = ['email', 'e mail', 'mail'];
  var LONG_TEXT_FIELD_TOKENS = ['description', 'message', 'comment', 'comments', 'bio', 'about', 'notes', 'details', 'summary', 'experience', 'objective', 'cover letter'];
  var FORM_CONFIRMATION_MAX_CORRECTIONS = 3;
  var EMAIL_SEGMENT_MAX_CORRECTIONS = 2;
  var SPELLED_VALUE_TOKEN_MAP = {
    dot: '.',
    period: '.',
    point: '.',
    at: '@',
    underscore: '_',
    dash: '-',
    hyphen: '-',
    minus: '-',
    plus: '+',
    slash: '/',
    backslash: '\\',
    space: ' '
  };
  var SUPPORTED_COMMAND_VERBS = ['click', 'focus', 'open', 'press', 'activate', 'read', 'scroll', 'fill', 'type', 'enter', 'select', 'choose', 'pick', 'check', 'submit'];
  var COMMAND_VERB_ALIASES = {
    lick: 'click',
    clik: 'click',
    focu: 'focus',
    scrol: 'scroll',
    pres: 'press',
    activte: 'activate',
    phil: 'fill',
    fll: 'fill',
    selct: 'select',
    chek: 'check',
    submt: 'submit'
  };
  var SUMMARY_VERB_ALIASES = {
    discribe: 'describe',
    dicribe: 'describe',
    descrbe: 'describe',
    descripe: 'describe',
    desribe: 'describe',
    summerize: 'summarize',
    sumarize: 'summarize',
    summrize: 'summarize',
    summarise: 'summarize'
  };

  function splitCommandWords(text) {
    return String(text || '').trim().split(/\s+/).filter(Boolean);
  }

  function isEditDistanceAtMostOne(a, b) {
    var left = String(a || '');
    var right = String(b || '');
    if (!left || !right) return false;
    if (left === right) return true;
    if (Math.abs(left.length - right.length) > 1) return false;

    var i = 0;
    var j = 0;
    var edits = 0;
    while (i < left.length && j < right.length) {
      if (left.charCodeAt(i) === right.charCodeAt(j)) {
        i += 1;
        j += 1;
        continue;
      }
      edits += 1;
      if (edits > 1) return false;
      if (left.length > right.length) i += 1;
      else if (right.length > left.length) j += 1;
      else {
        i += 1;
        j += 1;
      }
    }
    if (i < left.length || j < right.length) edits += 1;
    return edits <= 1;
  }

  function hasPlausibleCommandRemainder(parts) {
    if (!parts || !parts.length) return false;
    var filtered = parts.filter(function (part) {
      return /[a-z0-9\u0600-\u06FF]/i.test(part) && !/^(the|a|an|to|for|please|me|this)$/i.test(part);
    });
    return filtered.length > 0;
  }

  function recoverLeadingVerb(token, remainderWords) {
    var raw = String(token || '').trim().toLowerCase();
    if (!raw) return raw;
    if (COMMAND_VERB_ALIASES[raw] && hasPlausibleCommandRemainder(remainderWords)) return COMMAND_VERB_ALIASES[raw];
    for (var i = 0; i < SUPPORTED_COMMAND_VERBS.length; i++) {
      var verb = SUPPORTED_COMMAND_VERBS[i];
      if (raw === verb) return raw;
      if (!hasPlausibleCommandRemainder(remainderWords)) continue;
      if (isEditDistanceAtMostOne(raw, verb)) return verb;
      if (verb.length === raw.length + 1 && verb.indexOf(raw) === 1) return verb;
    }
    return raw;
  }

  function normalizeCommandTextForIntent(text) {
    var words = splitCommandWords(String(text || '').trim().toLowerCase());
    if (!words.length) return '';
    words[0] = recoverLeadingVerb(words[0], words.slice(1));
    return words.join(' ').trim();
  }

  function normalizeLeadingVerbPreserveRemainder(text) {
    var raw = String(text || '').trim();
    if (!raw) return '';
    var parts = raw.split(/\s+/).filter(Boolean);
    if (!parts.length) return '';
    var loweredParts = parts.map(function (part) { return String(part || '').toLowerCase(); });
    var recovered = recoverLeadingVerb(loweredParts[0], loweredParts.slice(1));
    parts[0] = recovered !== loweredParts[0] ? recovered : parts[0];
    return parts.join(' ').trim();
  }

  function hasCurrentPageReferenceText(text) {
    var normalized = normalizeMatchText(text);
    if (!normalized) return false;
    return (
      /\b(?:this|current|the)\s+(?:page|screen|site|website|app)\b/.test(normalized) ||
      /\b(?:on|in)\s+(?:this|the|the current)\s+(?:page|screen|site|website|app)\b/.test(normalized) ||
      /\b(?:sur|dans)\s+(?:cette|la)\s+(?:page|ecran|site)\b/.test(normalized) ||
      /(?:في|على|ب)\s+(?:هاي|هذه|هاد|هذي)\s+(?:الصفحة|الشاشة|الموقع)/.test(normalized) ||
      /(?:الصفحة|الشاشة|الموقع)\s+(?:الحالية|هاي|هذه)/.test(normalized)
    );
  }

  function normalizeCurrentContextIntentText(text) {
    var raw = normalizeLeadingVerbPreserveRemainder(text);
    if (!raw || !hasCurrentPageReferenceText(raw)) return raw;
    var parts = raw.split(/\s+/).filter(Boolean);
    if (!parts.length) return raw;
    var first = normalizeMatchText(parts[0]);
    if (!first || !SUMMARY_VERB_ALIASES[first]) return raw;
    parts[0] = SUMMARY_VERB_ALIASES[first];
    return parts.join(' ').trim();
  }

  function hasAnyIntentToken(tokens, candidates) {
    if (!tokens || !tokens.length || !candidates || !candidates.length) return false;
    for (var i = 0; i < candidates.length; i++) {
      var candidate = normalizeMatchText(candidates[i]);
      if (!candidate) continue;
      for (var j = 0; j < tokens.length; j++) {
        if (tokens[j] === candidate) return true;
      }
    }
    return false;
  }

  function inferPreferredTargetTypes(label, actionType) {
    var normalized = normalizeMatchText(label);
    var tokens = normalized ? normalized.split(' ').filter(Boolean) : [];
    var hasField = hasAnyIntentToken(tokens, FIELD_LIKE_TOKENS);
    var hasButton = hasAnyIntentToken(tokens, BUTTON_LIKE_TOKENS);
    var hasLink = hasAnyIntentToken(tokens, LINK_LIKE_TOKENS);
    var hasHeading = hasAnyIntentToken(tokens, HEADING_LIKE_TOKENS);

    if (actionType === 'focus') {
      if (hasField) return ['input', 'button', 'link', 'heading'];
      if (hasButton) return ['button', 'link', 'input', 'heading'];
      if (hasLink) return ['link', 'button', 'heading', 'input'];
      if (hasHeading) return ['heading', 'link', 'button', 'input'];
      return ['button', 'link', 'input', 'heading'];
    }
    if (actionType === 'activate' || actionType === 'click') {
      if (hasButton) return ['button', 'link', 'input', 'heading'];
      if (hasField) return ['button', 'input', 'link', 'heading'];
      return ['link', 'button', 'heading', 'input'];
    }
    if (actionType === 'open') {
      if (hasField) return ['input', 'link', 'button', 'heading'];
      return ['link', 'button', 'heading', 'input'];
    }
    if (actionType === 'read') {
      if (hasHeading) return ['heading', 'link', 'button', 'input'];
      if (hasField) return ['input', 'button', 'link', 'heading'];
    }
    return DEFAULT_AUTO_TARGET_ORDER.slice();
  }

  function preferredTypeFromExplicitLanguage(label) {
    var normalized = normalizeMatchText(label);
    var tokens = normalized ? normalized.split(' ').filter(Boolean) : [];
    if (hasAnyIntentToken(tokens, FIELD_LIKE_TOKENS)) return 'input';
    if (hasAnyIntentToken(tokens, BUTTON_LIKE_TOKENS)) return 'button';
    if (hasAnyIntentToken(tokens, HEADING_LIKE_TOKENS)) return 'heading';
    if (hasAnyIntentToken(tokens, LINK_LIKE_TOKENS)) return 'link';
    return '';
  }

  function nextId() {
    return 'n' + idCounter++;
  }

  function normalizedRole(el) {
    if (!el || !el.getAttribute) return '';
    return String(el.getAttribute('role') || '').toLowerCase().trim();
  }

  function getTabIndexValue(el) {
    if (!el || !el.getAttribute) return null;
    var raw = el.getAttribute('tabindex');
    if (raw == null || raw === '') return null;
    var parsed = parseInt(raw, 10);
    return isNaN(parsed) ? null : parsed;
  }

  function hasPointerCursor(el) {
    try {
      var view = el && el.ownerDocument && el.ownerDocument.defaultView;
      var style = view && view.getComputedStyle ? view.getComputedStyle(el) : null;
      return !!(style && style.cursor === 'pointer');
    } catch (_err) {
      return false;
    }
  }

  function getParentElementOrHost(el) {
    if (!el) return null;
    if (el.parentElement) return el.parentElement;
    var rootNode = getRootNodeForElement(el);
    return rootNode && rootNode.host ? rootNode.host : null;
  }

  function hasInteractiveStateAttributes(el) {
    if (!el || !el.getAttribute) return false;
    return !!(
      el.hasAttribute('aria-expanded') ||
      el.hasAttribute('aria-pressed') ||
      el.hasAttribute('aria-selected') ||
      el.hasAttribute('aria-checked') ||
      el.hasAttribute('aria-controls') ||
      el.hasAttribute('aria-haspopup') ||
      el.hasAttribute('aria-current')
    );
  }

  function hasCompactActionableFootprint(el, label) {
    if (!el || !el.getBoundingClientRect) return false;
    try {
      var rect = el.getBoundingClientRect();
      if (!rect || rect.width < 24 || rect.height < 16) return false;
      if (rect.height > 160) return false;
      if (rect.width > window.innerWidth * 0.98 && rect.height > 120) return false;
      if ((el.childElementCount || 0) > 12) return false;
      if (String(label || '').trim().length > 120) return false;
      return true;
    } catch (_err) {
      return false;
    }
  }

  function isImplicitPointerActionable(el, label) {
    if (!el || el.nodeType !== 1) return false;
    if (!hasPointerCursor(el)) return false;
    if (!hasCompactActionableFootprint(el, label)) return false;
    var text = String(label || '').trim();
    if (text && text.split(/\s+/).length <= 12) return true;
    return hasInteractiveStateAttributes(el);
  }

  function quickGenericActionableLabel(el) {
    if (!el || !el.getAttribute) return '';
    var aria = el.getAttribute('aria-label');
    if (aria) return aria.trim();
    var title = el.getAttribute('title');
    if (title) return title.trim();
    var directText = String(el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
    if (directText) return directText.slice(0, 120);
    return '';
  }

  function isButtonLikeInput(el) {
    if (!el || (el.tagName || '').toLowerCase() !== 'input') return false;
    var inputType = String((el.getAttribute && el.getAttribute('type')) || '').toLowerCase();
    return !!BUTTON_LIKE_INPUT_TYPES[inputType];
  }

  function isSemanticallyDiscoverableActionable(el) {
    if (!el || el.nodeType !== 1) return false;
    var tag = (el.tagName || '').toLowerCase();
    var role = normalizedRole(el);
    if (tag === 'button' || tag === 'summary') return true;
    if (tag === 'label' && el.getAttribute && el.getAttribute('for')) {
      var labeledControl = resolveLabelProxyTarget(el);
      return getType(labeledControl) === 'button';
    }
    if (role === 'link' || ACTIONABLE_BUTTON_ROLES[role]) return true;
    if (isButtonLikeInput(el)) return true;
    if (hasInteractiveStateAttributes(el)) return true;
    if (el.hasAttribute && el.hasAttribute('onclick')) return true;
    if (getTabIndexValue(el) >= 0 && hasPointerCursor(el)) return true;
    return isImplicitPointerActionable(el, quickGenericActionableLabel(el));
  }

  function isNativelyFocusable(el) {
    if (!el || el.nodeType !== 1) return false;
    var tag = (el.tagName || '').toLowerCase();
    if (/^(input|select|textarea|button|summary)$/.test(tag)) return true;
    if (tag === 'a' && el.hasAttribute && el.hasAttribute('href')) return true;
    return getTabIndexValue(el) != null;
  }

  function resolveLabelProxyTarget(el) {
    if (!el || (el.tagName || '').toLowerCase() !== 'label' || !el.getAttribute) return null;
    var forId = el.getAttribute('for');
    if (!forId) return null;
    try {
      return findElementByIdScoped(el, forId);
    } catch (_err) {
      return null;
    }
  }

  function focusElementForNavigation(el) {
    if (!el) return false;
    var focusTarget = resolveLabelProxyTarget(el) || el;
    if (!focusTarget || typeof focusTarget.focus !== 'function') return false;
    if (!isNativelyFocusable(focusTarget) && focusTarget.setAttribute) {
      focusTarget.setAttribute('tabindex', '-1');
    }
    focusTarget.focus();
    return true;
  }

  function getType(el) {
    var tag = (el.tagName || '').toLowerCase();
    var role = normalizedRole(el);
    if (tag === 'a' || role === 'link') return 'link';
    if (/^h[1-6]$/.test(tag)) return 'heading';
    if (tag === 'input') return isButtonLikeInput(el) ? 'button' : 'input';
    if (tag === 'select' || tag === 'textarea') return 'input';
    if (isSemanticallyDiscoverableActionable(el)) return 'button';
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
      'summary',
      'label[for]',
      '[role="button"]',
      '[role="menuitem"]',
      '[role="tab"]',
      '[role="option"]',
      '[role="radio"]',
      '[role="checkbox"]',
      '[role="switch"]',
      '[aria-expanded]',
      '[aria-pressed]',
      '[aria-selected]',
      '[aria-checked]',
      '[aria-controls]',
      '[aria-haspopup]',
      'input',
      'select',
      'textarea',
      '[onclick]',
      '[style*="cursor: pointer"]',
      '[tabindex]:not([tabindex="-1"])',
      'h1, h2, h3, h4, h5, h6'
    ].join(',');
    collectSearchRoots(d).forEach(function (root) {
      var nodes = [];
      try {
        nodes = Array.prototype.slice.call(root.querySelectorAll(selector));
      } catch (_err) {
        nodes = [];
      }
      nodes.forEach(function (el) {
        if (seen.has(el)) return;
        seen.add(el);
        if (isHidden(el)) return;
        if (isNavableUiElement(el)) return;
        var item = buildIndexedItemForElement(el);
        if (!item) return;
        items.push(item);
      });
    });
    index.items = items;
    return index;
  }

  function getIndexedElement(itemOrId) {
    var item = itemOrId;
    if (!itemOrId) return null;
    if (typeof itemOrId === 'string') {
      item = index.items.find(function (entry) { return entry.id === itemOrId; }) || null;
    }
    if (!item) return null;
    if (item.element && item.element.isConnected) return item.element;
    if (item.id) {
      var refreshed = index.items.find(function (entry) { return entry.id === item.id; });
      if (refreshed && refreshed.element && refreshed.element.isConnected) return refreshed.element;
    }
    return null;
  }

  function buildIndexedItemForElement(el, labelOverride, typeOverride) {
    if (!el || el.nodeType !== 1) return null;
    var label = String(labelOverride || textOf(el) || '').trim();
    if (!label) return null;
    if (!el.dataset.navableId) el.dataset.navableId = nextId();
    el.dataset.navableLabel = label;
    var type = typeOverride || getType(el);
    if (type === 'other') return null;
    el.dataset.navableType = type;
    var tag = (el.tagName || '').toLowerCase();
    var item = {
      id: el.dataset.navableId,
      label: label,
      tag: tag,
      type: type,
      aliases: collectAliasesForElement(el, label),
      inputType: type === 'input' ? String((el.getAttribute && el.getAttribute('type')) || tag).toLowerCase() : '',
      name: type === 'input' ? String((el.getAttribute && el.getAttribute('name')) || '') : '',
      placeholder: type === 'input' ? String((el.getAttribute && el.getAttribute('placeholder')) || '') : '',
      href: type === 'link' ? String((el.getAttribute && el.getAttribute('href')) || '') : ''
    };
    Object.defineProperty(item, 'element', { value: el, enumerable: false, configurable: true });
    return item;
  }

  function collectAliasesForElement(el, label) {
    var aliases = [];

    function pushAlias(value) {
      var normalized = normalizeMatchText(value);
      if (!normalized) return;
      if (aliases.indexOf(normalized) >= 0) return;
      aliases.push(normalized);
    }

    pushAlias(label);
    if (!el || !el.getAttribute) return aliases;
    pushAlias(el.getAttribute('aria-label'));
    pushAlias(el.getAttribute('title'));
    pushAlias(el.getAttribute('placeholder'));
    pushAlias(el.getAttribute('value'));
    pushAlias(humanizeIdentifier(el.getAttribute('name')));
    pushAlias(humanizeIdentifier(el.id || ''));
    if ((el.tagName || '').toLowerCase() === 'a') pushAlias(humanizeUrlFragment(el.getAttribute('href')));
    return aliases;
  }

  function clearOverlay() {
    overlayMarkers.forEach(function (n) { n.remove(); });
    overlayMarkers = [];
  }

  function drawOverlay() {
    clearOverlay();
    index.items.forEach(function (it) {
      var el = getIndexedElement(it);
      if (!el) return;
      var r = getGlobalClientRect(el);
      if (!r) return;
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
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-label', 'aria-labelledby', 'title', 'hidden', 'aria-hidden', 'style', 'class', 'role', 'tabindex', 'onclick', 'for', 'href', 'type', 'name', 'placeholder'] });
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
    var seen = new Set();
    var landmarks = [];
    collectSearchRoots(doc || document).forEach(function (root) {
      var nodes = [];
      try {
        nodes = Array.prototype.slice.call(root.querySelectorAll(selectors.join(',')));
      } catch (_err) {
        nodes = [];
      }
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
    });
    return landmarks;
  }

  function extractExcerpt(doc) {
    var maxChars = 1200;
    var total = 0;
    var parts = [];
    var seenText = new Set();
    collectSearchRoots(doc || document).forEach(function (searchRoot) {
      if (parts.length >= 24 || total >= maxChars) return;
      var root = (searchRoot && searchRoot.querySelector && (searchRoot.querySelector('main') || searchRoot.querySelector('article'))) || searchRoot.body || searchRoot;
      if (!root || !root.querySelectorAll) return;
      var nodes = [];
      try {
        nodes = Array.prototype.slice.call(
          root.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li,label,legend,button,[role="radio"],[role="checkbox"],[role="option"]')
        );
      } catch (_err) {
        nodes = [];
      }
      for (var i = 0; i < nodes.length; i++) {
        if (parts.length >= 24) break;
        var el = nodes[i];
        if (isHidden(el) || isNavableUiElement(el)) continue;
        var tag = (el.tagName || '').toLowerCase();
        if (tag === 'label') {
          var control = null;
          var forId = el.getAttribute && el.getAttribute('for');
          if (forId) control = findElementByIdScoped(el, forId);
          if (!control) control = el.querySelector && el.querySelector('input,select,textarea');
          if (control && isSensitiveInput(control)) continue;
        }
        var text = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
        var role = (el.getAttribute && el.getAttribute('role')) || '';
        var minChars = (tag === 'label' || tag === 'legend' || tag === 'button' || role === 'radio' || role === 'checkbox' || role === 'option') ? 3 : 12;
        if (!text || text.length < minChars) continue;
        var dedupeKey = text.toLowerCase();
        if (seenText.has(dedupeKey)) continue;
        var remaining = maxChars - total;
        if (remaining <= 0) break;
        if (text.length > remaining) text = text.slice(0, remaining);
        parts.push(text);
        total += text.length;
        seenText.add(dedupeKey);
      }
    });
    return parts.join(' ');
  }

  function buildPageStructure() {
    rescan();
    var active = getDeepActiveElement(document);
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
        var linkEl = getIndexedElement(it);
        if (linkEl && linkEl.getAttribute) {
          entry.href = linkEl.getAttribute('href') || '';
        } else {
          entry.href = '';
        }
        links.push(entry);
      } else if (it.type === 'button') {
        buttons.push(entry);
      } else if (it.type === 'input') {
        var el = getIndexedElement(it);
        if (el) {
          var sensitiveInput = isSensitiveInput(el);
          var paymentInput = isPaymentLikeInput(el);
          if (paymentInput) {
            // Exclude high-risk payment fields from the snapshot.
            sensitiveInputCount += 1;
            return;
          }
          if (sensitiveInput) sensitiveInputCount += 1;
          entry.inputType = (el.getAttribute && el.getAttribute('type')) || (el.tagName || '').toLowerCase();
          entry.name = sensitiveInput ? '' : ((el.getAttribute && el.getAttribute('name')) || '');
          entry.required = !!(el.hasAttribute && el.hasAttribute('required'));
          entry.placeholder = sensitiveInput ? '' : ((el.getAttribute && el.getAttribute('placeholder')) || '');
          if (sensitiveInput) entry.sensitive = true;
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

  function listButtonsText(structure) {
    if (!structure || !structure.buttons || !structure.buttons.length) {
      return 'No buttons on this page.';
    }
    var items = structure.buttons.slice(0, 10).map(function (b, idx) {
      var label = b.label || 'Unnamed button';
      return (idx + 1) + '. ' + label + '.';
    });
    var more = structure.buttons.length > 10 ? ' And more buttons not listed.' : '';
    return 'Buttons: ' + items.join(' ') + more;
  }

  function listInputsText(structure) {
    if (!structure || !structure.inputs || !structure.inputs.length) {
      return 'No input fields on this page.';
    }
    var items = structure.inputs.slice(0, 10).map(function (input, idx) {
      var label = input.label || input.name || input.placeholder || 'Unnamed input';
      return (idx + 1) + '. ' + label + '.';
    });
    var more = structure.inputs.length > 10 ? ' And more input fields not listed.' : '';
    return 'Inputs: ' + items.join(' ') + more;
  }

  function listTargetText(target, structure) {
    if (target === 'heading') return listHeadingsText(structure);
    if (target === 'button') return listButtonsText(structure);
    if (target === 'input') return listInputsText(structure);
    return listLinksText(structure);
  }

  function isPasswordInput(el) {
    if (!el) return false;
    var type = String((el.getAttribute && el.getAttribute('type')) || '').toLowerCase();
    var name = String((el.getAttribute && el.getAttribute('name')) || '').toLowerCase();
    var id = String(el.id || '').toLowerCase();
    return type === 'password' || name.indexOf('password') >= 0 || id.indexOf('password') >= 0;
  }

  function isPaymentLikeInput(el) {
    if (!el) return false;
    var type = (el.getAttribute && el.getAttribute('type')) || '';
    var name = (el.getAttribute && el.getAttribute('name')) || '';
    var id = el.id || '';
    var hay = (type + ' ' + name + ' ' + id).toLowerCase();
    if (hay.includes('card') || hay.includes('credit')) return true;
    return false;
  }

  function isSensitiveInput(el) {
    return isPasswordInput(el) || isPaymentLikeInput(el);
  }

  var activeFormSession = null;

  function getEligibleFormControlElements() {
    var controls = [];
    var seen = new Set();
    collectSearchRoots(document).forEach(function (root) {
      var nodes = [];
      try {
        nodes = Array.prototype.slice.call(root.querySelectorAll('input,select,textarea'));
      } catch (_err) {
        nodes = [];
      }
      nodes.forEach(function (el) {
        if (!el || seen.has(el)) return;
        seen.add(el);
        if (isHidden(el) || isNavableUiElement(el)) return;
        var tag = (el.tagName || '').toLowerCase();
        var inputType = String((el.getAttribute && el.getAttribute('type')) || '').toLowerCase();
        if (tag === 'input' && /^(hidden|button|submit|reset|image|file)$/.test(inputType)) return;
        controls.push(el);
      });
    });
    return controls;
  }

  function getFormContainerForControl(el) {
    if (!el) return null;
    if (el.form) return el.form;
    return el.closest ? (el.closest('form,[role="form"],dialog,[role="dialog"],main,section,article') || document.body) : document.body;
  }

  function getFormControlLabel(el) {
    var label = textOf(el);
    if (label) return label;
    var aria = el.getAttribute && el.getAttribute('aria-label');
    if (aria) return aria.trim();
    return 'Unnamed input';
  }

  function getLegendLabelForControl(el) {
    var fieldset = el && el.closest ? el.closest('fieldset') : null;
    if (!fieldset) return '';
    var legend = fieldset.querySelector && fieldset.querySelector('legend');
    return legend ? String(textOf(legend) || '').trim() : '';
  }

  function buildRadioGroupField(radios) {
    var first = radios[0];
    var label = getLegendLabelForControl(first) || getFormControlLabel(first) || 'Choices';
    var required = radios.some(function (radio) { return !!(radio.hasAttribute && radio.hasAttribute('required')); });
    var options = radios.map(function (radio, index) {
      var optionLabel = getFormControlLabel(radio) || ('Option ' + (index + 1));
      return {
        label: optionLabel,
        value: String((radio.getAttribute && radio.getAttribute('value')) || optionLabel),
        element: radio
      };
    });
    return {
      kind: 'radio',
      label: label,
      required: required,
      options: options,
      elements: radios,
      history: [],
      focusElement: function () {
        var checked = radios.find(function (radio) { return !!radio.checked; }) || radios[0];
        return focusElementForNavigation(checked);
      }
    };
  }

  function buildFormFieldDescriptor(el) {
    if (!el) return null;
    var tag = (el.tagName || '').toLowerCase();
    var inputType = String((el.getAttribute && el.getAttribute('type')) || tag).toLowerCase();
    if (inputType === 'radio') return null;
    if (inputType === 'checkbox') {
      return {
        kind: 'checkbox',
        label: getFormControlLabel(el),
        required: !!(el.hasAttribute && el.hasAttribute('required')),
        options: [],
        elements: [el],
        history: [],
        focusElement: function () { return focusElementForNavigation(el); }
      };
    }
    if (tag === 'select') {
      var selectOptions = Array.prototype.slice.call(el.options || []).map(function (option) {
        return {
          label: String(option.textContent || option.label || option.value || '').replace(/\s+/g, ' ').trim(),
          value: String(option.value || option.textContent || '').trim(),
          option: option
        };
      }).filter(function (option) { return !!option.label; });
      return {
        kind: 'select',
        label: getFormControlLabel(el),
        required: !!(el.hasAttribute && el.hasAttribute('required')),
        options: selectOptions,
        elements: [el],
        history: [],
        focusElement: function () { return focusElementForNavigation(el); }
      };
    }
    return {
      kind: 'text',
      label: getFormControlLabel(el),
      required: !!(el.hasAttribute && el.hasAttribute('required')),
      options: [],
      inputType: inputType,
      elements: [el],
      history: [],
      focusElement: function () { return focusElementForNavigation(el); }
    };
  }

  function scoreFormGroup(group) {
    if (!group || !Array.isArray(group.controls)) return -1;
    var score = group.controls.length * 10 + (group.requiredCount || 0) * 8;
    var container = group.container;
    if (container && (container.tagName || '').toLowerCase() === 'form') score += 12;
    group.controls.forEach(function (control) {
      var tag = (control.tagName || '').toLowerCase();
      var inputType = String((control.getAttribute && control.getAttribute('type')) || '').toLowerCase();
      if (inputType === 'password') score += 40;
      if (inputType === 'email') score += 24;
      if (tag === 'select' || inputType === 'checkbox' || inputType === 'radio') score += 6;
      if (control.hasAttribute && control.hasAttribute('required')) score += 10;
    });
    return score;
  }

  function chooseBestFormGroup(groups) {
    if (!groups.length) return null;
    var active = getDeepActiveElement(document);
    if (active) {
      for (var i = 0; i < groups.length; i++) {
        if (groups[i].controls.some(function (control) { return control === active || (control.contains && control.contains(active)); })) {
          return groups[i];
        }
      }
    }
    groups.sort(function (a, b) {
      var scoreDiff = scoreFormGroup(b) - scoreFormGroup(a);
      if (scoreDiff !== 0) return scoreDiff;
      if (b.controls.length !== a.controls.length) return b.controls.length - a.controls.length;
      return b.requiredCount - a.requiredCount;
    });
    return groups[0];
  }

  function buildFormSession() {
    var controls = getEligibleFormControlElements();
    if (!controls.length) return null;
    var groups = [];
    var byContainer = new Map();
    controls.forEach(function (control) {
      var container = getFormContainerForControl(control);
      var entry = byContainer.get(container);
      if (!entry) {
        entry = { container: container, controls: [], requiredCount: 0 };
        byContainer.set(container, entry);
        groups.push(entry);
      }
      entry.controls.push(control);
      if (control.hasAttribute && control.hasAttribute('required')) entry.requiredCount += 1;
    });
    var group = chooseBestFormGroup(groups);
    if (!group || !group.controls.length) return null;

    var fields = [];
    var seenRadioGroups = new Set();
    group.controls.forEach(function (control) {
      var inputType = String((control.getAttribute && control.getAttribute('type')) || '').toLowerCase();
      if (inputType === 'radio') {
        var radioName = String(control.name || control.getAttribute('name') || '').trim();
        var radioKey = radioName || String(control.dataset.navableId || nextId());
        if (seenRadioGroups.has(radioKey)) return;
        seenRadioGroups.add(radioKey);
        var radios = group.controls.filter(function (candidate) {
          return candidate.tagName === 'INPUT' && String((candidate.getAttribute && candidate.getAttribute('type')) || '').toLowerCase() === 'radio' &&
            String(candidate.name || candidate.getAttribute('name') || '') === String(control.name || control.getAttribute('name') || '');
        });
        if (!radios.length) radios = [control];
        fields.push(buildRadioGroupField(radios));
        return;
      }
      var descriptor = buildFormFieldDescriptor(control);
      if (descriptor) fields.push(descriptor);
    });

    if (!fields.length) return null;
    return {
      createdAt: Date.now(),
      container: group.container,
      fields: fields,
      currentIndex: 0
    };
  }

  function ensureFormSession(opts) {
    opts = opts || {};
    var existing = getCurrentFormSession();
    if (existing) return existing;
    var session = buildFormSession();
    if (!session) {
      if (opts.speakFailure !== false) speak(translate('form_mode_empty'));
      return null;
    }
    activeFormSession = session;
    focusCurrentFormField(session);
    if (opts.announce !== false) {
      speak(translate('form_mode_started', { summary: describeFormField(session, currentFormField(session)) }));
    }
    return session;
  }

  function getCurrentFormSession() {
    if (!activeFormSession || !Array.isArray(activeFormSession.fields) || !activeFormSession.fields.length) return null;
    return activeFormSession;
  }

  function clearFormSession() {
    activeFormSession = null;
  }

  function currentFormField(session) {
    if (!session || !Array.isArray(session.fields) || !session.fields.length) return null;
    var idx = Math.max(0, Math.min(session.fields.length - 1, Number(session.currentIndex || 0)));
    return session.fields[idx] || null;
  }

  function getPendingFormConfirmation(session) {
    if (!session || !session.pendingConfirmation || typeof session.pendingConfirmation !== 'object') return null;
    return session.pendingConfirmation;
  }

  function clearPendingFormConfirmation(session) {
    if (!session || !session.pendingConfirmation) return;
    delete session.pendingConfirmation;
  }

  function currentPendingFormField(session) {
    if (!session) return null;
    var pending = getPendingFormConfirmation(session);
    if (!pending || pending.fieldIndex == null) return currentFormField(session);
    var index = Math.max(0, Math.min(session.fields.length - 1, Number(pending.fieldIndex || 0)));
    return session.fields[index] || currentFormField(session);
  }

  function fieldAliases(field) {
    var aliases = [];
    function pushAlias(value) {
      var normalized = normalizeMatchText(value);
      if (!normalized) return;
      if (aliases.indexOf(normalized) >= 0) return;
      aliases.push(normalized);
    }
    if (!field) return aliases;
    pushAlias(field.label);
    (field.elements || []).forEach(function (el) {
      if (!el || !el.getAttribute) return;
      pushAlias(el.getAttribute('name'));
      pushAlias(el.getAttribute('id'));
      pushAlias(el.getAttribute('placeholder'));
      pushAlias(el.getAttribute('aria-label'));
    });
    return aliases;
  }

  function fieldAliasListText(field) {
    return fieldAliases(field).join(' ');
  }

  function isEmailLikeFormField(field) {
    if (!field || field.kind !== 'text') return false;
    if (String(field.inputType || '').toLowerCase() === 'email') return true;
    var aliasText = fieldAliasListText(field);
    return EMAIL_FIELD_TOKENS.some(function (token) {
      return aliasText.indexOf(normalizeMatchText(token)) >= 0;
    });
  }

  function isLongTextFormField(field) {
    if (!field || field.kind !== 'text') return false;
    var element = field.elements && field.elements[0];
    if (!element) return false;
    var tag = String(element.tagName || '').toLowerCase();
    if (tag === 'textarea' || !!element.isContentEditable) return true;
    var rows = Number((element.getAttribute && element.getAttribute('rows')) || 0);
    if (rows >= 3) return true;
    var aliasText = fieldAliasListText(field);
    return LONG_TEXT_FIELD_TOKENS.some(function (token) {
      return aliasText.indexOf(normalizeMatchText(token)) >= 0;
    });
  }

  function normalizeEmailSpeechText(text) {
    var raw = String(text || '').trim().toLowerCase();
    if (!raw) return '';
    return raw
      .replace(/\bat sign\b/g, ' @ ')
      .replace(/\bat\b/g, ' @ ')
      .replace(/\bfull stop\b/g, ' . ')
      .replace(/\bperiod\b/g, ' . ')
      .replace(/\bpoint\b/g, ' . ')
      .replace(/\bdot\b/g, ' . ')
      .replace(/\bunderscore\b/g, ' _ ')
      .replace(/\bplus sign\b/g, ' + ')
      .replace(/\bplus\b/g, ' + ')
      .replace(/\bhyphen\b/g, ' - ')
      .replace(/\bdash\b/g, ' - ')
      .replace(/\bminus\b/g, ' - ')
      .replace(/\bslash\b/g, ' / ')
      .replace(/\bbackslash\b/g, ' \\ ')
      .replace(/\s*([@._+\-/\\])\s*/g, '$1')
      .replace(/\s+/g, '')
      .trim();
  }

  function sanitizeEmailLocalPartText(text) {
    return String(text || '')
      .replace(/@.*$/g, '')
      .replace(/[^a-z0-9._+\-/\\]/g, '')
      .trim();
  }

  function sanitizeEmailDomainLabelText(text) {
    var raw = String(text || '');
    if (!raw) return '';
    if (raw.indexOf('@') >= 0) raw = raw.slice(raw.indexOf('@') + 1);
    if (raw.indexOf('.') >= 0) raw = raw.slice(0, raw.indexOf('.'));
    return raw
      .replace(/[^a-z0-9-]/g, '')
      .replace(/^-+/g, '')
      .replace(/-+$/g, '')
      .trim();
  }

  function sanitizeEmailSuffixText(text) {
    var raw = String(text || '');
    if (!raw) return '';
    if (raw.indexOf('@') >= 0) raw = raw.slice(raw.indexOf('@') + 1);
    if (raw.indexOf('.') >= 0) raw = raw.slice(raw.lastIndexOf('.') + 1);
    return raw
      .replace(/[^a-z0-9.-]/g, '')
      .replace(/^\.+/g, '')
      .replace(/\.+$/g, '')
      .trim();
  }

  function cloneEmailParts(parts) {
    return {
      local: String(parts && parts.local || ''),
      domain: String(parts && parts.domain || ''),
      suffix: String(parts && parts.suffix || '')
    };
  }

  function buildEmailFieldValue(parts) {
    var emailParts = cloneEmailParts(parts);
    if (!emailParts.local) return '';
    var value = emailParts.local;
    if (emailParts.domain) value += '@' + emailParts.domain;
    if (emailParts.domain && emailParts.suffix) value += '.' + emailParts.suffix;
    return value;
  }

  function buildEmailFieldValueUpToSegment(parts, segment) {
    var emailParts = cloneEmailParts(parts);
    if (!emailParts.local) return '';
    if (segment === 'local') return emailParts.local;
    if (segment === 'domain') return buildEmailFieldValue({ local: emailParts.local, domain: emailParts.domain });
    return buildEmailFieldValue(emailParts);
  }

  function parseEmailParts(text) {
    var normalized = normalizeEmailSpeechText(text);
    if (!normalized) return null;
    var atIndex = normalized.indexOf('@');
    if (atIndex < 0) return null;
    var local = sanitizeEmailLocalPartText(normalized.slice(0, atIndex));
    if (!local) return null;
    var afterAt = normalized.slice(atIndex + 1);
    var lastDot = afterAt.lastIndexOf('.');
    var domain = lastDot >= 0
      ? sanitizeEmailDomainLabelText(afterAt.slice(0, lastDot))
      : sanitizeEmailDomainLabelText(afterAt);
    var suffix = lastDot >= 0 ? sanitizeEmailSuffixText(afterAt.slice(lastDot + 1)) : '';
    return {
      local: local,
      domain: domain,
      suffix: suffix
    };
  }

  function extractEmailSegmentValue(text, segment) {
    var parsed = parseEmailParts(text);
    if (parsed && parsed[segment]) return parsed[segment];
    var normalized = normalizeEmailSpeechText(text);
    if (!normalized) return '';
    if (segment === 'local') return sanitizeEmailLocalPartText(normalized);
    if (segment === 'domain') return sanitizeEmailDomainLabelText(normalized);
    return sanitizeEmailSuffixText(normalized);
  }

  function nextEmailSegment(segment) {
    if (segment === 'local') return 'domain';
    if (segment === 'domain') return 'suffix';
    return '';
  }

  function emailSegmentTranslationKey(segment) {
    if (segment === 'local') return 'form_email_segment_local';
    if (segment === 'domain') return 'form_email_segment_domain';
    return 'form_email_segment_suffix';
  }

  function translateEmailSegment(segment) {
    return translate(emailSegmentTranslationKey(segment));
  }

  function normalizeLongTextSegment(text) {
    var raw = String(text || '').trim();
    if (!raw) return '';
    raw = raw
      .replace(/\bnew paragraph\b/gi, '\n\n')
      .replace(/\bnew line\b/gi, '\n')
      .replace(/\bexclamation mark\b/gi, '!')
      .replace(/\bexclamation point\b/gi, '!')
      .replace(/\bquestion mark\b/gi, '?')
      .replace(/\bsemicolon\b/gi, ';')
      .replace(/\bcolon\b/gi, ':')
      .replace(/\bcomma\b/gi, ',')
      .replace(/\bfull stop\b/gi, '.')
      .replace(/\bperiod\b/gi, '.')
      .replace(/\bpoint\b/gi, '.')
      .replace(/\bdot\b/gi, '.');
    raw = raw
      .replace(/\s+([,.;:!?])/g, '$1')
      .replace(/([,.;:!?])([^\s\n])/g, '$1 $2')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n[ \t]+/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]+/g, ' ')
      .replace(/ ?\n ?/g, '\n')
      .trim();
    return raw;
  }

  function composeLongTextValue(previousValue, segmentText) {
    var previous = String(previousValue || '');
    var segment = String(segmentText || '').trim();
    if (!segment) return previous;
    if (!previous) return segment;
    if (segment.charAt(0) === '\n') return previous.replace(/[ \t]+$/g, '') + segment;
    if (/\n$/.test(previous)) return previous + segment;
    return previous.replace(/[ \t]+$/g, '') + ' ' + segment;
  }

  function getFormFieldCurrentState(field) {
    if (!field) return null;
    if (field.kind === 'checkbox') {
      var checkbox = field.elements && field.elements[0];
      return { checked: !!(checkbox && checkbox.checked) };
    }
    if (field.kind === 'radio') {
      var selected = (field.options || []).find(function (option) { return option.element && option.element.checked; });
      return { value: selected ? String(selected.value || '') : '' };
    }
    if (field.kind === 'select') {
      var selectEl = field.elements && field.elements[0];
      return { value: selectEl && selectEl.value != null ? String(selectEl.value) : '' };
    }
    var textEl = field.elements && field.elements[0];
    return { value: textEl && textEl.value != null ? String(textEl.value) : '' };
  }

  function restoreFormFieldState(field, state) {
    if (!field) return false;
    var snapshot = state || {};
    if (field.kind === 'checkbox') {
      var checkbox = field.elements && field.elements[0];
      if (!checkbox) return false;
      checkbox.checked = !!snapshot.checked;
      try { checkbox.dispatchEvent(new Event('input', { bubbles: true })); } catch (_err) { }
      try { checkbox.dispatchEvent(new Event('change', { bubbles: true })); } catch (_err2) { }
      return true;
    }
    if (field.kind === 'radio') {
      var desiredValue = String(snapshot.value || '');
      (field.options || []).forEach(function (option) {
        if (!option || !option.element) return;
        option.element.checked = desiredValue ? String(option.value || '') === desiredValue : false;
      });
      var checkedOption = (field.options || []).find(function (option) { return option && option.element && option.element.checked; });
      var radioEl = checkedOption && checkedOption.element;
      if (radioEl) {
        try { radioEl.dispatchEvent(new Event('input', { bubbles: true })); } catch (_err3) { }
        try { radioEl.dispatchEvent(new Event('change', { bubbles: true })); } catch (_err4) { }
      }
      return true;
    }
    if (field.kind === 'select') {
      var selectEl = field.elements && field.elements[0];
      if (!selectEl) return false;
      selectEl.value = String(snapshot.value || '');
      try { selectEl.dispatchEvent(new Event('input', { bubbles: true })); } catch (_err5) { }
      try { selectEl.dispatchEvent(new Event('change', { bubbles: true })); } catch (_err6) { }
      return true;
    }
    var textEl = field.elements && field.elements[0];
    if (!textEl) return false;
    return applyTextValueToElement(textEl, String(snapshot.value || ''));
  }

  function resolveFormFieldIndex(session, label, supportedKinds) {
    if (!session || !Array.isArray(session.fields) || !session.fields.length) return -1;
    var normalizedQuery = normalizeMatchText(label);
    if (!normalizedQuery) return -1;
    var queryTokens = normalizedQuery.split(' ').filter(Boolean);
    var ranked = session.fields.map(function (field, index) {
      if (Array.isArray(supportedKinds) && supportedKinds.length && supportedKinds.indexOf(field.kind) < 0) return null;
      var best = 0;
      fieldAliases(field).forEach(function (alias) {
        if (!alias) return;
        if (alias === normalizedQuery) best = Math.max(best, 1000);
        else if (alias.indexOf(normalizedQuery) === 0) best = Math.max(best, 860);
        else if (alias.indexOf(normalizedQuery) >= 0) best = Math.max(best, 720);
        if (queryTokens.length) {
          var aliasTokens = alias.split(' ').filter(Boolean);
          var matchedTokens = countMatchingTokens(queryTokens, aliasTokens);
          if (matchedTokens === queryTokens.length) best = Math.max(best, 620 + matchedTokens);
          else if (matchedTokens >= Math.max(1, Math.ceil(queryTokens.length * 0.6))) best = Math.max(best, 420 + matchedTokens);
        }
      });
      return best > 0 ? { index: index, score: best } : null;
    }).filter(Boolean).sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      return a.index - b.index;
    });
    return ranked.length ? ranked[0].index : -1;
  }

  function moveToResolvedFormField(session, label, supportedKinds) {
    if (!session) return null;
    var targetIndex = resolveFormFieldIndex(session, label, supportedKinds);
    if (targetIndex < 0) return null;
    session.currentIndex = targetIndex;
    focusCurrentFormField(session);
    return currentFormField(session);
  }

  function isSensitiveFormField(field) {
    if (!field || !Array.isArray(field.elements) || !field.elements.length) return false;
    return field.elements.some(function (el) { return isSensitiveInput(el); });
  }

  function formFieldValueText(field) {
    if (!field) return translate('form_value_empty');
    if (field.kind === 'checkbox') {
      var checkbox = field.elements && field.elements[0];
      return translate(checkbox && checkbox.checked ? 'form_value_checked' : 'form_value_unchecked');
    }
    if (field.kind === 'radio') {
      var selected = (field.options || []).find(function (option) { return option.element && option.element.checked; });
      return selected ? (selected.label || selected.value) : translate('form_value_not_selected');
    }
    if (field.kind === 'select') {
      var selectEl = field.elements && field.elements[0];
      if (!selectEl || !selectEl.options) return translate('form_value_not_selected');
      var selectedOption = selectEl.options[selectEl.selectedIndex];
      var label = selectedOption ? String(selectedOption.textContent || selectedOption.label || selectedOption.value || '').replace(/\s+/g, ' ').trim() : '';
      return label || translate('form_value_not_selected');
    }
    var el = field.elements && field.elements[0];
    var value = el && el.value != null ? String(el.value).trim() : '';
    return value || translate('form_value_empty');
  }

  function buildFormReviewMessage(session) {
    if (!session || !Array.isArray(session.fields) || !session.fields.length) return translate('form_mode_empty');
    var parts = [translate('form_review_intro')];
    session.fields.forEach(function (field) {
      if (!field) return;
      if (isSensitiveFormField(field)) {
        parts.push(translate('form_review_item_sensitive', { label: field.label || translate('target_input') }));
      } else {
        parts.push(translate('form_review_item', {
          label: field.label || translate('target_input'),
          value: formFieldValueText(field)
        }));
      }
    });
    parts.push(translate('form_review_prompt'));
    return parts.join(' ').trim();
  }

  function reviewActiveForm() {
    var session = getCurrentFormSession();
    if (!session) {
      speak(translate('form_mode_not_active'));
      return false;
    }
    if (getPendingFormConfirmation(session)) {
      promptPendingFormConfirmation(session);
      return false;
    }
    speak(buildFormReviewMessage(session));
    return true;
  }

  function isFormContextCommand(cmd) {
    if (!cmd) return false;
    return (
      cmd.type === 'form_mode' ||
      cmd.type === 'form_move' ||
      cmd.type === 'form_current' ||
      cmd.type === 'form_fill' ||
      cmd.type === 'form_select' ||
      cmd.type === 'form_check' ||
      cmd.type === 'form_submit' ||
      cmd.type === 'form_review' ||
      cmd.type === 'help' ||
      cmd.type === 'repeat' ||
      cmd.type === 'stop'
    );
  }

  function formFieldKindLabel(field) {
    if (!field) return translate('target_input');
    if (field.kind === 'select') return translate('form_field_type_select');
    if (field.kind === 'checkbox') return translate('form_field_type_checkbox');
    if (field.kind === 'radio') return translate('form_field_type_radio');
    return translate('form_field_type_text');
  }

  function formFieldActionHint(field) {
    if (!field) return '';
    if (isLongTextFormField(field)) return translate('form_field_hint_longtext');
    if (isEmailLikeFormField(field)) return translate('form_field_hint_email');
    if (field.kind === 'select' || field.kind === 'radio') return translate('form_field_hint_select');
    if (field.kind === 'checkbox') return translate('form_field_hint_checkbox');
    return translate('form_field_hint_text');
  }

  function describeFormField(session, field) {
    if (!session || !field) return translate('form_mode_empty');
    var count = session.fields.length;
    var index = Math.max(0, Math.min(count - 1, Number(session.currentIndex || 0))) + 1;
    var message = translate('form_field_intro', {
      index: index,
      count: count,
      label: field.label || translate('target_input'),
      status: field.required ? translate('form_field_status_required') : translate('form_field_status_optional'),
      kind: formFieldKindLabel(field)
    });
    if ((field.kind === 'select' || field.kind === 'radio') && Array.isArray(field.options) && field.options.length) {
      var optionLabels = field.options.slice(0, 6).map(function (option) { return option.label; }).join(', ');
      message += ' ' + translate('form_field_options', { options: optionLabels });
    }
    var hint = formFieldActionHint(field);
    if (hint) message += ' ' + hint;
    if (index === count) message += ' ' + translate('form_field_submit_hint');
    return message.trim();
  }

  function isAffirmativeFormResponse(text) {
    var normalized = normalizeMatchText(text);
    if (!normalized) return false;
    return /^(yes|yeah|yep|correct|right|that s right|thats right|confirm|confirmed|ok|okay|keep it|looks good|good|oui|نعم|ايوه|أيوه|ايوا|صح|تمام)$/.test(normalized);
  }

  function isNegativeFormResponse(text) {
    var normalized = normalizeMatchText(text);
    if (!normalized) return false;
    return /^(no|nope|nah|wrong|incorrect|change|change it|edit|not right|that s wrong|thats wrong|try again|redo|non|لا|غلط|مو صح)$/.test(normalized);
  }

  function parseSpelledFieldValue(text) {
    var normalized = normalizeMatchText(text);
    if (!normalized) return '';
    normalized = normalized
      .replace(/\bat sign\b/g, ' at ')
      .replace(/\bfull stop\b/g, ' dot ')
      .replace(/\bperiod\b/g, ' dot ')
      .replace(/\bpoint\b/g, ' dot ')
      .replace(/^(please\s+)?(?:spell|letters?|letter by letter|spell it|say)\s+/, '')
      .trim();
    if (!normalized) return '';
    var tokens = normalized.split(/\s+/).filter(Boolean);
    if (!tokens.length) return '';
    if (tokens.length === 1) return tokens[0];
    var parts = [];
    for (var i = 0; i < tokens.length; i += 1) {
      var token = tokens[i];
      if (Object.prototype.hasOwnProperty.call(SPELLED_VALUE_TOKEN_MAP, token)) {
        parts.push(SPELLED_VALUE_TOKEN_MAP[token]);
        continue;
      }
      if (/^[a-z0-9]$/i.test(token) || /^[\u0600-\u06FF]$/.test(token)) {
        parts.push(token);
        continue;
      }
      if (/^[a-z0-9]+$/i.test(token)) {
        parts.push(token);
        continue;
      }
      return normalized;
    }
    return parts.join('');
  }

  function setPendingFormConfirmation(session, field, details) {
    if (!session || !field) return null;
    var options = details || {};
    var fieldIndex = typeof options.fieldIndex === 'number'
      ? options.fieldIndex
      : Math.max(0, Math.min(session.fields.length - 1, Number(session.currentIndex || 0)));
    session.pendingConfirmation = {
      fieldIndex: fieldIndex,
      fieldKind: field.kind || 'text',
      label: field.label || translate('target_input'),
      mode: options.mode || 'confirm',
      correctionCount: Math.max(0, Number(options.correctionCount || 0)),
      sensitive: !!options.sensitive,
      speechValue: String(options.speechValue || '').trim(),
      checked: options.checked === true ? true : (options.checked === false ? false : null),
      previousState: options.previousState || null,
      fullValue: typeof options.fullValue === 'string' ? options.fullValue : '',
      segmentText: String(options.segmentText || '').trim(),
      longText: !!options.longText,
      emailSegment: String(options.emailSegment || '').trim(),
      emailParts: cloneEmailParts(options.emailParts || null)
    };
    return session.pendingConfirmation;
  }

  function restorePendingFormConfirmationState(session) {
    var pending = getPendingFormConfirmation(session);
    var field = currentPendingFormField(session);
    if (!pending || !field || !pending.previousState) return false;
    return restoreFormFieldState(field, pending.previousState);
  }

  function buildPendingFormConfirmationMessage(session) {
    var pending = getPendingFormConfirmation(session);
    var field = currentPendingFormField(session);
    if (!pending || !field) return translate('form_mode_not_active');
    var label = pending.label || field.label || translate('target_input');
    if (pending.emailSegment) {
      if (pending.mode === 'await_spelling') {
        return translate('form_email_spelling_segment', {
          label: label,
          segment: translateEmailSegment(pending.emailSegment)
        });
      }
      if (pending.mode === 'await_email_segment') {
        return translate('form_email_prompt_segment', {
          label: label,
          segment: translateEmailSegment(pending.emailSegment)
        });
      }
      return translate('form_email_confirmation_segment', {
        label: label,
        segment: translateEmailSegment(pending.emailSegment),
        value: trimAssistantMemoryText(pending.speechValue || '', 80)
      });
    }
    if (pending.mode === 'await_spelling') {
      return translate('form_confirmation_spelling', { label: label });
    }
    if (pending.mode === 'await_retry') {
      if (field.kind === 'checkbox') return translate('form_confirmation_retry_checkbox', { label: label });
      if (field.kind === 'select' || field.kind === 'radio') return translate('form_confirmation_retry_option', { label: label });
      return translate('form_confirmation_retry_text', { label: label });
    }
    if (field.kind === 'checkbox') {
      return translate(pending.checked ? 'form_confirmation_checked' : 'form_confirmation_unchecked', { label: label });
    }
    if (field.kind === 'select' || field.kind === 'radio') {
      return translate('form_confirmation_choice', {
        label: label,
        value: trimAssistantMemoryText(pending.speechValue || '', 80)
      });
    }
    if (pending.sensitive) {
      return translate('form_confirmation_sensitive', { label: label });
    }
    return translate('form_confirmation_value', {
      label: label,
      value: trimAssistantMemoryText(pending.speechValue || '', 80)
    });
  }

  function promptPendingFormConfirmation(session) {
    if (!session) return false;
    speak(buildPendingFormConfirmationMessage(session));
    return true;
  }

  function shouldForceSpelling(field, correctionCount, pending) {
    if (!(field && field.kind === 'text' && !isLongTextFormField(field))) return false;
    var limit = pending && pending.emailSegment ? EMAIL_SEGMENT_MAX_CORRECTIONS : FORM_CONFIRMATION_MAX_CORRECTIONS;
    return Number(correctionCount || 0) >= limit;
  }

  function requestPendingFormCorrection(session) {
    var pending = getPendingFormConfirmation(session);
    var field = currentPendingFormField(session);
    if (!pending || !field) return false;
    restorePendingFormConfirmationState(session);
    pending.correctionCount = Math.max(0, Number(pending.correctionCount || 0)) + 1;
    pending.mode = shouldForceSpelling(field, pending.correctionCount, pending)
      ? 'await_spelling'
      : (pending.emailSegment ? 'await_email_segment' : 'await_retry');
    promptPendingFormConfirmation(session);
    return true;
  }

  function setPendingEmailSegment(session, field, segment, segmentValue, details) {
    if (!session || !field || !segment) return false;
    var options = details || {};
    clearPendingFormConfirmation(session);
    setPendingFormConfirmation(session, field, {
      fieldIndex: Number(options.fieldIndex != null ? options.fieldIndex : session.currentIndex || 0),
      mode: options.mode || 'confirm',
      correctionCount: Math.max(0, Number(options.correctionCount || 0)),
      previousState: options.previousState || null,
      speechValue: String(segmentValue || '').trim(),
      emailSegment: segment,
      emailParts: options.emailParts || null
    });
    focusCurrentFormField(session);
    promptPendingFormConfirmation(session);
    return true;
  }

  function applyEmailSegmentValue(session, field, segment, rawSegmentValue, details) {
    if (!session || !field || !segment) return false;
    var emailParts = cloneEmailParts(details && details.emailParts || null);
    var normalizedSegment = extractEmailSegmentValue(rawSegmentValue, segment);
    if (!normalizedSegment) {
      speak(translate('form_fill_missing_value'));
      return false;
    }
    emailParts[segment] = normalizedSegment;
    var previousState = details && details.previousState ? details.previousState : getFormFieldCurrentState(field);
    var nextValue = buildEmailFieldValueUpToSegment(emailParts, segment);
    var el = field.elements && field.elements[0];
    if (!el || !applyTextValueToElement(el, nextValue)) {
      speak(translate('not_found_generic', { target: translate('target_input') }));
      return false;
    }
    return setPendingEmailSegment(session, field, segment, normalizedSegment, {
      fieldIndex: Number(details && details.fieldIndex != null ? details.fieldIndex : session.currentIndex || 0),
      correctionCount: Math.max(0, Number(details && details.correctionCount || 0)),
      previousState: previousState,
      emailParts: emailParts
    });
  }

  function promptForNextEmailSegment(session, field, segment, emailParts) {
    if (!session || !field || !segment) return false;
    return setPendingEmailSegment(session, field, segment, '', {
      fieldIndex: Number(session.currentIndex || 0),
      mode: 'await_email_segment',
      correctionCount: 0,
      previousState: getFormFieldCurrentState(field),
      emailParts: emailParts
    });
  }

  function startEmailFieldEntry(session, field, rawValue, opts) {
    var emailParts = cloneEmailParts(parseEmailParts(rawValue));
    if (!emailParts.local) emailParts.local = extractEmailSegmentValue(rawValue, 'local');
    if (!emailParts.local) {
      speak(translate('form_fill_missing_value'));
      return false;
    }
    return applyEmailSegmentValue(session, field, 'local', emailParts.local, {
      fieldIndex: Number(session.currentIndex || 0),
      correctionCount: Math.max(0, Number(opts && opts.correctionCount || 0)),
      previousState: getFormFieldCurrentState(field),
      emailParts: emailParts
    });
  }

  function confirmPendingEmailSegment(session, pending, field) {
    var previousIndex = Math.max(0, Math.min(session.fields.length - 1, Number(pending.fieldIndex || session.currentIndex || 0)));
    var currentSegment = String(pending.emailSegment || '');
    var emailParts = cloneEmailParts(pending.emailParts);
    var nextSegment = nextEmailSegment(currentSegment);
    session.currentIndex = previousIndex;
    clearPendingFormConfirmation(session);
    if (nextSegment) {
      var savedSegment = translate('form_email_segment_saved', {
        label: field.label || translate('target_input'),
        segment: translateEmailSegment(currentSegment)
      });
      if (emailParts[nextSegment]) {
        speak(savedSegment);
        return applyEmailSegmentValue(session, field, nextSegment, emailParts[nextSegment], {
          fieldIndex: previousIndex,
          correctionCount: 0,
          previousState: getFormFieldCurrentState(field),
          emailParts: emailParts
        });
      }
      speak(savedSegment);
      return promptForNextEmailSegment(session, field, nextSegment, emailParts);
    }
    maybeAdvanceFormField(session);
    focusCurrentFormField(session);
    var confirmed = translate('form_confirmation_saved', { label: field.label || translate('target_input') });
    if (session.currentIndex !== previousIndex) {
      speak((confirmed + ' ' + describeFormField(session, currentFormField(session))).trim());
      return true;
    }
    speak((confirmed + ' ' + translate('form_confirmation_last_field')).trim());
    return true;
  }

  function confirmPendingFormEntry(session) {
    var pending = getPendingFormConfirmation(session);
    var field = currentPendingFormField(session);
    if (!pending || !field) return false;
    if (pending.emailSegment) {
      return confirmPendingEmailSegment(session, pending, field);
    }
    if (pending.longText) {
      if (Array.isArray(field.history)) {
        field.history.push({
          previousState: pending.previousState || null,
          value: String(pending.fullValue || ''),
          segmentText: String(pending.segmentText || pending.speechValue || '')
        });
      }
      clearPendingFormConfirmation(session);
      focusCurrentFormField(session);
      speak(translate('form_longtext_chunk_saved', { label: field.label || translate('target_input') }) + ' ' + translate('form_longtext_ready', { label: field.label || translate('target_input') }));
      return true;
    }
    var previousIndex = Math.max(0, Math.min(session.fields.length - 1, Number(pending.fieldIndex || session.currentIndex || 0)));
    session.currentIndex = previousIndex;
    clearPendingFormConfirmation(session);
    maybeAdvanceFormField(session);
    focusCurrentFormField(session);
    var confirmed = translate('form_confirmation_saved', { label: field.label || translate('target_input') });
    if (session.currentIndex !== previousIndex) {
      speak((confirmed + ' ' + describeFormField(session, currentFormField(session))).trim());
      return true;
    }
    speak((confirmed + ' ' + translate('form_confirmation_last_field')).trim());
    return true;
  }

  function isLongTextReviewCommandText(text) {
    var normalized = normalizeMatchText(text);
    if (!normalized) return false;
    return /^(review field|review text|read back|read it back|read the field|what have you written|what did you write|review description|read description)$/.test(normalized);
  }

  function isLongTextUndoCommandText(text) {
    var normalized = normalizeMatchText(text);
    if (!normalized) return false;
    return /^(undo|undo last|undo last chunk|undo last sentence|remove last|delete last|remove that|undo that)$/.test(normalized);
  }

  function readLongTextFieldValue(session) {
    var field = currentFormField(session);
    if (!field || !isLongTextFormField(field)) return false;
    var state = getFormFieldCurrentState(field);
    var value = String(state && state.value ? state.value : '').trim();
    if (!value) {
      speak(translate('form_longtext_empty', { label: field.label || translate('target_input') }));
      return true;
    }
    speak(translate('form_longtext_review', {
      label: field.label || translate('target_input'),
      value: trimAssistantMemoryText(value, 500)
    }));
    return true;
  }

  function undoLastLongTextChunk(session) {
    var field = currentFormField(session);
    if (!field || !isLongTextFormField(field)) return false;
    if (!Array.isArray(field.history) || !field.history.length) {
      speak(translate('form_longtext_nothing_to_undo', { label: field.label || translate('target_input') }));
      return true;
    }
    var last = field.history.pop();
    restoreFormFieldState(field, last && last.previousState ? last.previousState : { value: '' });
    focusCurrentFormField(session);
    speak(translate('form_longtext_undo', { label: field.label || translate('target_input') }) + ' ' + translate('form_longtext_ready', { label: field.label || translate('target_input') }));
    return true;
  }

  function focusCurrentFormField(session) {
    var field = currentFormField(session);
    if (!field || typeof field.focusElement !== 'function') return false;
    try {
      return field.focusElement() !== false;
    } catch (_err) {
      return false;
    }
  }

  function startFormMode() {
    return !!ensureFormSession({ announce: true, speakFailure: true });
  }

  function stopFormMode() {
    if (!getCurrentFormSession()) {
      speak(translate('form_mode_not_active'));
      return false;
    }
    clearFormSession();
    speak(translate('form_mode_stopped'));
    return true;
  }

  function moveFormField(direction) {
    var session = getCurrentFormSession();
    if (!session) {
      speak(translate('form_mode_not_active'));
      return false;
    }
    if (getPendingFormConfirmation(session)) {
      promptPendingFormConfirmation(session);
      return false;
    }
    var nextIndex = Number(session.currentIndex || 0) + (direction === 'prev' ? -1 : 1);
    nextIndex = Math.max(0, Math.min(session.fields.length - 1, nextIndex));
    session.currentIndex = nextIndex;
    focusCurrentFormField(session);
    speak(describeFormField(session, currentFormField(session)));
    return true;
  }

  function readCurrentFormField() {
    var session = getCurrentFormSession();
    if (!session) {
      speak(translate('form_mode_not_active'));
      return false;
    }
    if (getPendingFormConfirmation(session)) {
      promptPendingFormConfirmation(session);
      return false;
    }
    focusCurrentFormField(session);
    speak(describeFormField(session, currentFormField(session)));
    return true;
  }

  function applyTextValueToElement(el, value) {
    if (!el) return false;
    var tag = (el.tagName || '').toLowerCase();
    var isInput = tag === 'input' || tag === 'textarea';
    var isSelect = tag === 'select';
    var isContentEditable = !!el.isContentEditable;
    if (!isInput && !isSelect && !isContentEditable) return false;
    if (isInput || isSelect) el.value = value;
    else el.textContent = value;
    try { el.dispatchEvent(new Event('input', { bubbles: true })); } catch (_err) { }
    try { el.dispatchEvent(new Event('change', { bubbles: true })); } catch (_err2) { }
    return true;
  }

  function maybeAdvanceFormField(session) {
    if (!session) return;
    if (session.currentIndex < session.fields.length - 1) session.currentIndex += 1;
  }

  function applyCurrentFormValue(value, fieldLabel, opts) {
    opts = opts || {};
    var session = ensureFormSession({ announce: false, speakFailure: true });
    if (!session) {
      return false;
    }
    if (fieldLabel && !moveToResolvedFormField(session, fieldLabel, ['text'])) {
      speak(translate('not_found_generic', { target: translate('target_input') }));
      return false;
    }
    var field = currentFormField(session);
    if (!field) {
      speak(translate('form_mode_empty'));
      return false;
    }
    var rawValue = String(value || '').trim();
    if (!rawValue) {
      speak(translate('form_fill_missing_value'));
      return false;
    }
    if (field.kind !== 'text') {
      if (field.kind === 'select' || field.kind === 'radio') {
        return selectCurrentFormOption(rawValue, fieldLabel || '', opts);
      }
      speak(translate('form_fill_missing_value'));
      return false;
    }
    var previousState = getFormFieldCurrentState(field);
    var normalizedValue = rawValue;
    var longTextField = isLongTextFormField(field);
    if (isEmailLikeFormField(field)) {
      return startEmailFieldEntry(session, field, normalizedValue, opts);
    } else if (longTextField) normalizedValue = normalizeLongTextSegment(normalizedValue);
    if (!normalizedValue) {
      speak(translate('form_fill_missing_value'));
      return false;
    }
    var nextValue = longTextField
      ? composeLongTextValue(previousState && previousState.value ? previousState.value : '', normalizedValue)
      : normalizedValue;
    var el = field.elements && field.elements[0];
    if (!el || !applyTextValueToElement(el, nextValue)) {
      speak(translate('not_found_generic', { target: translate('target_input') }));
      return false;
    }
    clearPendingFormConfirmation(session);
    setPendingFormConfirmation(session, field, {
      fieldIndex: Number(session.currentIndex || 0),
      correctionCount: Math.max(0, Number(opts.correctionCount || 0)),
      sensitive: isSensitiveFormField(field),
      speechValue: trimAssistantMemoryText(longTextField ? normalizedValue : nextValue, 140),
      previousState: previousState,
      fullValue: longTextField ? nextValue : '',
      segmentText: longTextField ? normalizedValue : '',
      longText: longTextField
    });
    focusCurrentFormField(session);
    promptPendingFormConfirmation(session);
    return true;
  }

  function findBestFieldOption(field, value) {
    if (!field || !Array.isArray(field.options)) return null;
    var normalizedQuery = normalizeMatchText(value);
    if (!normalizedQuery) return null;
    var queryTokens = normalizedQuery.split(' ').filter(Boolean);
    var ranked = field.options.map(function (option, index) {
      var normalizedLabel = normalizeMatchText(option.label || option.value || '');
      var aliases = [normalizedLabel, normalizeMatchText(option.value || '')].filter(Boolean);
      var best = 0;
      aliases.forEach(function (alias) {
        if (!alias) return;
        if (alias === normalizedQuery) best = Math.max(best, 1000);
        else if (alias.indexOf(normalizedQuery) === 0) best = Math.max(best, 860);
        else if (alias.indexOf(normalizedQuery) >= 0) best = Math.max(best, 720);
        if (queryTokens.length) {
          var aliasTokens = alias.split(' ').filter(Boolean);
          var matchedTokens = countMatchingTokens(queryTokens, aliasTokens);
          if (matchedTokens === queryTokens.length) best = Math.max(best, 620 + matchedTokens);
        }
      });
      return { option: option, index: index, score: best };
    }).filter(function (entry) { return entry.score > 0; }).sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      return a.index - b.index;
    });
    return ranked.length ? ranked[0].option : null;
  }

  function selectCurrentFormOption(value, fieldLabel, opts) {
    opts = opts || {};
    var session = ensureFormSession({ announce: false, speakFailure: true });
    if (!session) {
      return false;
    }
    if (fieldLabel && !moveToResolvedFormField(session, fieldLabel, ['select', 'radio'])) {
      speak(translate('not_found_generic', { target: translate('target_input') }));
      return false;
    }
    var field = currentFormField(session);
    if (!field) return false;
    var normalizedValue = String(value || '').trim();
    if (!normalizedValue) {
      speak(translate('form_select_missing_value'));
      return false;
    }
    var previousState = getFormFieldCurrentState(field);
    var option = findBestFieldOption(field, normalizedValue);
    if (!option) {
      speak(translate('form_option_not_found', { label: field.label || translate('target_input') }));
      return false;
    }
    if (field.kind === 'select') {
      var selectEl = field.elements && field.elements[0];
      if (!selectEl) return false;
      selectEl.value = option.value;
      try { selectEl.dispatchEvent(new Event('input', { bubbles: true })); } catch (_err) { }
      try { selectEl.dispatchEvent(new Event('change', { bubbles: true })); } catch (_err2) { }
    } else if (field.kind === 'radio') {
      try { option.element.focus(); } catch (_err3) { }
      option.element.click();
    } else {
      return false;
    }
    clearPendingFormConfirmation(session);
    setPendingFormConfirmation(session, field, {
      fieldIndex: Number(session.currentIndex || 0),
      correctionCount: Math.max(0, Number(opts.correctionCount || 0)),
      speechValue: option.label || option.value,
      previousState: previousState
    });
    focusCurrentFormField(session);
    promptPendingFormConfirmation(session);
    return true;
  }

  function setCurrentCheckboxState(checked, fieldLabel, opts) {
    opts = opts || {};
    var session = ensureFormSession({ announce: false, speakFailure: true });
    if (!session) {
      return false;
    }
    if (fieldLabel && !moveToResolvedFormField(session, fieldLabel, ['checkbox'])) {
      speak(translate('form_checkbox_not_supported'));
      return false;
    }
    var field = currentFormField(session);
    if (!field || field.kind !== 'checkbox') {
      speak(translate('form_checkbox_not_supported'));
      return false;
    }
    var previousState = getFormFieldCurrentState(field);
    var checkbox = field.elements && field.elements[0];
    if (!checkbox) return false;
    if (!!checkbox.checked !== !!checked) checkbox.click();
    clearPendingFormConfirmation(session);
    setPendingFormConfirmation(session, field, {
      fieldIndex: Number(session.currentIndex || 0),
      correctionCount: Math.max(0, Number(opts.correctionCount || 0)),
      checked: !!checked,
      previousState: previousState
    });
    focusCurrentFormField(session);
    promptPendingFormConfirmation(session);
    return true;
  }

  function findSubmitControlInSession(session) {
    if (!session || !session.container) return null;
    var container = session.container;
    var selectors = 'button,input[type="submit"],input[type="button"],[role="button"],summary,[onclick],[tabindex]:not([tabindex="-1"])';
    var candidates = [];
    try {
      candidates = Array.prototype.slice.call(container.querySelectorAll(selectors));
    } catch (_err) {
      candidates = [];
    }
    var submitWords = ['submit', 'continue', 'sign in', 'log in', 'login', 'send', 'save', 'finish', 'done'];
    var ranked = candidates.map(function (el, index) {
      if (!el || isHidden(el) || isNavableUiElement(el)) return null;
      var label = textOf(el) || String((el.getAttribute && el.getAttribute('value')) || '').trim();
      var normalized = normalizeMatchText(label);
      if (!normalized) return null;
      var score = 0;
      if ((el.tagName || '').toLowerCase() === 'input' && String((el.getAttribute && el.getAttribute('type')) || '').toLowerCase() === 'submit') score += 100;
      submitWords.forEach(function (word) {
        var normalizedWord = normalizeMatchText(word);
        if (normalized === normalizedWord) score += 60;
        else if (normalized.indexOf(normalizedWord) >= 0) score += 30;
      });
      return score > 0 ? { element: el, score: score, index: index } : null;
    }).filter(Boolean).sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      return a.index - b.index;
    });
    return ranked.length ? ranked[0].element : null;
  }

  function submitActiveForm() {
    var session = ensureFormSession({ announce: false, speakFailure: true });
    if (!session) {
      return false;
    }
    if (getPendingFormConfirmation(session)) {
      promptPendingFormConfirmation(session);
      return false;
    }
    var currentField = currentFormField(session);
    var formEl = currentField && currentField.elements && currentField.elements[0] && currentField.elements[0].form;
    if (formEl && typeof formEl.requestSubmit === 'function') {
      formEl.requestSubmit();
      clearFormSession();
      speak(translate('form_submit_done'));
      return true;
    }
    var submitControl = findSubmitControlInSession(session);
    if (!submitControl) {
      speak(translate('form_submit_missing'));
      return false;
    }
    try { submitControl.focus(); } catch (_err2) { }
    submitControl.click();
    clearFormSession();
    speak(translate('form_submit_done'));
    return true;
  }

  function tryHandleActiveFormUtterance(text) {
    var session = getCurrentFormSession();
    if (!session) return false;
    var raw = String(text || '').trim();
    if (!raw) return false;
    var normalized = normalizeMatchText(raw);
    if (!normalized) return false;
    var pending = getPendingFormConfirmation(session);
    var field = pending ? currentPendingFormField(session) : currentFormField(session);
    if (!field) return false;

    if (!pending && isLongTextFormField(field)) {
      if (isLongTextReviewCommandText(raw)) return readLongTextFieldValue(session);
      if (isLongTextUndoCommandText(raw)) return undoLastLongTextChunk(session);
    }

    if (/^(what|who|when|where|why|how|tell me|could you|can you|would you|is there|are there)\b/i.test(raw) || /\?$/.test(raw)) {
      return false;
    }

    if (pending) {
      var correctionCount = Math.max(0, Number(pending.correctionCount || 0));
      if (pending.mode === 'confirm') {
        if (isAffirmativeFormResponse(raw)) {
          return confirmPendingFormEntry(session);
        }
        if (isNegativeFormResponse(raw)) {
          return requestPendingFormCorrection(session);
        }
        speak((translate('form_confirmation_wait', {
          label: pending.label || field.label || translate('target_input')
        }) + ' ' + buildPendingFormConfirmationMessage(session)).trim());
        return true;
      } else if (pending.mode === 'await_retry') {
        if (field.kind === 'checkbox') {
          if (/^(yes|yeah|yep|check|tick|enable|agree|accept|true|oui|نعم|ايوه|أيوه|ايوا|صح|تمام)$/i.test(normalized)) {
            return setCurrentCheckboxState(true, pending.label || field.label || '', { correctionCount: correctionCount });
          }
          if (/^(no|nope|nah|uncheck|untick|disable|skip|false|non|لا|غلط|مو صح)$/i.test(normalized)) {
            return setCurrentCheckboxState(false, pending.label || field.label || '', { correctionCount: correctionCount });
          }
          promptPendingFormConfirmation(session);
          return true;
        }
        if (isAffirmativeFormResponse(raw) || isNegativeFormResponse(raw)) {
          promptPendingFormConfirmation(session);
          return true;
        }
      } else if (pending.mode === 'await_spelling') {
        correctionCount = Math.max(correctionCount, pending.emailSegment ? EMAIL_SEGMENT_MAX_CORRECTIONS : FORM_CONFIRMATION_MAX_CORRECTIONS);
      }

      if (pending.emailSegment && (pending.mode === 'await_email_segment' || pending.mode === 'await_spelling')) {
        if (isAffirmativeFormResponse(raw) || isNegativeFormResponse(raw)) {
          promptPendingFormConfirmation(session);
          return true;
        }
        return applyEmailSegmentValue(session, field, pending.emailSegment, pending.mode === 'await_spelling' ? (parseSpelledFieldValue(raw) || raw) : raw, {
          fieldIndex: Number(pending.fieldIndex != null ? pending.fieldIndex : session.currentIndex || 0),
          correctionCount: correctionCount,
          previousState: getFormFieldCurrentState(field),
          emailParts: pending.emailParts
        });
      }

      if (field.kind === 'text') {
        var replacementValue = pending.mode === 'await_spelling'
          ? (parseSpelledFieldValue(raw) || raw)
          : raw;
        return applyCurrentFormValue(replacementValue, pending.label || field.label || '', { correctionCount: correctionCount });
      }
      if (field.kind === 'select' || field.kind === 'radio') {
        return selectCurrentFormOption(raw, pending.label || field.label || '', { correctionCount: correctionCount });
      }
      if (field.kind === 'checkbox') {
        if (/^(yes|yeah|yep|check|tick|enable|agree|accept|true|oui|نعم|ايوه|أيوه|ايوا|صح|تمام)$/i.test(normalized)) {
          return setCurrentCheckboxState(true, pending.label || field.label || '', { correctionCount: correctionCount });
        }
        if (/^(no|nope|nah|uncheck|untick|disable|skip|false|non|لا|غلط|مو صح)$/i.test(normalized)) {
          return setCurrentCheckboxState(false, pending.label || field.label || '', { correctionCount: correctionCount });
        }
        promptPendingFormConfirmation(session);
        return true;
      }
      return false;
    }

    if (field.kind === 'text') {
      return applyCurrentFormValue(raw);
    }
    if (field.kind === 'select' || field.kind === 'radio') {
      return selectCurrentFormOption(raw);
    }
    if (field.kind === 'checkbox') {
      if (/^(yes|yeah|yep|check|tick|enable|agree|accept|true)$/i.test(normalized)) {
        return setCurrentCheckboxState(true);
      }
      if (/^(no|nope|uncheck|untick|disable|skip|false)$/i.test(normalized)) {
        return setCurrentCheckboxState(false);
      }
    }
    return false;
  }

  async function runToolStep(step) {
    step = step || {};
    var action = step.action;
    if (!action) return { ok: false, message: 'No action' };
    if (action === 'scroll') {
      await execCommand({ type: 'scroll', dir: step.direction || step.dir || 'down' });
      return { ok: true, message: 'Scrolled ' + (step.direction || step.dir || 'down') };
    }
    if (action === 'announce') {
      speak(step.message || '');
      return { ok: true, message: 'Announced' };
    }
    if (action === 'read_title') {
      await execCommand({ type: 'read', what: 'title' });
      return { ok: true, message: 'Read title' };
    }
    if (action === 'read_selection') {
      await execCommand({ type: 'read', what: 'selection' });
      return { ok: true, message: 'Read selection' };
    }
    if (action === 'read_focused') {
      await execCommand({ type: 'read', what: 'focused' });
      return { ok: true, message: 'Read focused' };
    }
    if (action === 'read_heading') {
      if (step.label) {
        await execCommand({ type: 'read', target: 'heading', label: step.label });
      } else {
        await execCommand({ type: 'read', target: 'heading', n: step.n || 1 });
      }
      return { ok: true, message: 'Read heading' };
    }
    if (action === 'focus_element') {
      var focused = await performElementActionWithRetry(step.targetType || step.target, step.label, step.n, step, function (el) {
        if (!el.isConnected) return false;
        return focusElementForNavigation(el);
      });
      if (!focused.ok || !focused.element) {
        return { ok: false, message: resolutionFailureMessage(step.targetType || step.target, focused.resolution, step.label, step) };
      }
      return { ok: true, message: 'Focused element' };
    }
    if (action === 'click_element') {
      var clicked = await performElementActionWithRetry(step.targetType || step.target, step.label, step.n, step, function (el) {
        if (!el.isConnected) return false;
        el.click();
        return true;
      });
      if (!clicked.ok || !clicked.element) {
        return { ok: false, message: resolutionFailureMessage(step.targetType || step.target, clicked.resolution, step.label, step) };
      }
      return { ok: true, message: 'Clicked element' };
    }
    if (action === 'fill_text') {
      var fillResolution = await resolveElementReferenceWithRetry(step.targetType || step.target || 'input', step.label, step.n, step);
      if (!fillResolution.ok || !fillResolution.element) {
        return { ok: false, message: resolutionFailureMessage(step.targetType || step.target || 'input', fillResolution, step.label, step) };
      }
      var elin = fillResolution.element;
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
      await execCommand({ type: 'move', target: 'heading', dir: dir === 'prev' ? 'prev' : 'next' });
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
        var res = await runToolStep(step);
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
    var raw = normalizeCurrentContextIntentText(text);
    var t = String(raw || '').toLowerCase();
    var normalized = normalizeMatchText(raw);
    if (!t) return false;
    return (
      t.includes('summarize') ||
      t.includes('summary') ||
      t.includes('describe this page') ||
      /\b(?:describe|summarize|explain)\s+(?:this|the|current)?\s*(?:page|screen|site|website|app)\b/.test(normalized) ||
      /\b(?:tell me about|show me)\s+(?:this|the|current)?\s*(?:page|screen|site|website|app)\b/.test(normalized) ||
      /\b(?:what s|whats|what is)\s+(?:on|in)\s+(?:this|the|current)?\s*(?:page|screen|site|website|app)\b/.test(normalized) ||
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

  function isCurrentPageReferenceText(text) {
    return hasCurrentPageReferenceText(text);
  }

  function isPageQuestionRequestText(text) {
    var t = String(text || '').trim().toLowerCase();
    if (!t || !isCurrentPageReferenceText(t)) return false;
    return (
      /\b(answer|correct answer|question|quiz|exercise|problem|prompt|choice|choices|option|options|solve|read|explain)\b/.test(t) ||
      /\b(r[ée]ponse|question|quiz|exercice|probl[èe]me|choix|option|options|r[ée]soudre|lire|explique)\b/.test(t) ||
      /(سؤال|اسئلة|أسئلة|جواب|الجواب|إجابة|اجابة|حل|خيارات|خيار|اختيار|اقر[أا]|اشرح)/.test(t)
    );
  }

  function isPageAssistantQuestionText(text) {
    var raw = normalizeCurrentContextIntentText(text);
    var t = String(raw || '').trim().toLowerCase();
    var normalized = normalizeMatchText(raw);
    if (!t) return false;
    if (isSummaryCommandText(t)) return true;
    if (isPageQuestionRequestText(t)) return true;
    return (
      /\b(where am i|help me here|help on this page|help on the page|help on this site|help on the site|what can i do here|what can i do on this page|what can i do on the page|what can i do on this site|what is important here|what's important here|what is important on this page|what's important on this page|tell me about this page|tell me about the page|tell me about the current page|guide me here|what am i looking at|what is on this screen|what's on this screen|what is here|what's here)\b/.test(t) ||
      /\b(?:help|guide)\s+me\s+(?:on|through)\s+(?:this|the|current)\s+(?:page|screen|site)\b/.test(normalized) ||
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
  var pendingDisambiguation = null;
  var PENDING_DISAMBIGUATION_TTL_MS = 30000;

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

  function clearPendingDisambiguation() {
    pendingDisambiguation = null;
  }

  function getPendingDisambiguation() {
    if (!pendingDisambiguation) return null;
    if (Date.now() - Number(pendingDisambiguation.createdAt || 0) > PENDING_DISAMBIGUATION_TTL_MS) {
      pendingDisambiguation = null;
      return null;
    }
    return pendingDisambiguation;
  }

  function isOrdinalFollowUpText(text) {
    var normalized = normalizeMatchText(text);
    if (!normalized) return false;
    return /^(?:option\s+)?(?:\d+|first|1st|one|second|2nd|two|third|3rd|three|fourth|4th|four|fifth|5th|five|last)(?:\s+one)?$/.test(normalized);
  }

  function scorePendingOptionSelection(option, query, queryTokens) {
    if (!option) return 0;
    var aliases = Array.isArray(option.aliases) ? option.aliases : [];
    var best = 0;
    for (var i = 0; i < aliases.length; i++) {
      var alias = normalizeMatchText(aliases[i]);
      if (!alias) continue;
      if (alias === query) best = Math.max(best, 1000);
      else if (alias.indexOf(query) === 0) best = Math.max(best, 860);
      else if (alias.indexOf(query) >= 0) best = Math.max(best, 720);
      if (queryTokens.length) {
        var aliasTokens = alias.split(' ').filter(Boolean);
        var matchedTokens = countMatchingTokens(queryTokens, aliasTokens);
        if (matchedTokens === queryTokens.length) best = Math.max(best, 620 + matchedTokens);
        else if (matchedTokens >= Math.max(1, Math.ceil(queryTokens.length * 0.6))) best = Math.max(best, 420 + matchedTokens);
      }
    }
    return best;
  }

  function resolvePendingDisambiguationChoice(text, pending) {
    if (!pending || !Array.isArray(pending.options) || !pending.options.length) return null;
    var normalized = normalizeMatchText(text);
    if (!normalized) return null;

    var numericChoice = isOrdinalFollowUpText(normalized) ? extractNumber(normalized) : null;
    if (numericChoice != null) {
      var numericIndex = numericChoice === -1 ? pending.options.length : numericChoice;
      if (numericIndex >= 1 && numericIndex <= pending.options.length) {
        return { matched: true, option: pending.options[numericIndex - 1] };
      }
      return { matched: false, ambiguous: false };
    }

    var queryTokens = normalized.split(' ').filter(Boolean);
    var ranked = pending.options.map(function (option) {
      return { option: option, score: scorePendingOptionSelection(option, normalized, queryTokens) };
    }).filter(function (entry) {
      return entry.score > 0;
    }).sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      return Number(a.option.index || 0) - Number(b.option.index || 0);
    });

    if (!ranked.length) return null;
    if (ranked.length > 1 && ranked[0].score === ranked[1].score) {
      return { matched: false, ambiguous: true };
    }
    return { matched: true, option: ranked[0].option };
  }

  function buildCommandFromPendingOption(pending, option) {
    if (!pending || !pending.command || !pending.command.type || !option) return null;
    var nextCommand = Object.assign({}, pending.command);
    nextCommand.label = pending.label || nextCommand.label || '';
    nextCommand.n = option.index != null ? Number(option.index) : nextCommand.n;
    return nextCommand;
  }

  async function tryPendingDisambiguationFollowUp(text) {
    var pending = getPendingDisambiguation();
    if (!pending) return false;
    var selection = resolvePendingDisambiguationChoice(text, pending);
    if (!selection) return false;
    if (!selection.matched) {
      if (selection.ambiguous || isOrdinalFollowUpText(text)) {
        speak(pending.message || translate('ambiguous_target', {
          count: pending.options.length,
          target: targetPlural(pending.targetType || 'element'),
          value: pending.label || ''
        }));
        return true;
      }
      return false;
    }
    var nextCommand = buildCommandFromPendingOption(pending, selection.option);
    if (!nextCommand) {
      speak(pending.message || translate('unknown_command'));
      return true;
    }
    clearPendingDisambiguation();
    await execCommand(nextCommand);
    return true;
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

  function extractTrailingPhraseAfterVerb(t, verbPattern) {
    var raw = String(t || '').trim();
    if (!raw) return '';
    var next = raw.replace(verbPattern, '').trim();
    next = next.replace(/^(on|onto|to|the|a|an)\s+/, '').trim();
    return next;
  }

  function stripLeadingTargetFillers(text) {
    var next = String(text || '').trim();
    if (!next) return '';
    next = next.replace(/^(on|onto|to)\s+/, '').trim();
    next = next.replace(/^(the|a|an)\s+/, '').trim();
    return next;
  }

  function parseListTarget(text) {
    var t = String(text || '').trim().toLowerCase();
    if (!t) return '';
    if (!/^(list|show|read out|read|what are|what's|whats|which)\b/.test(t)) return '';
    if (/\b(headings?|titles?)\b/.test(t)) return 'heading';
    if (/\b(buttons?|actions?|controls?)\b/.test(t)) return 'button';
    if (/\b(inputs?|fields?|forms?)\b/.test(t)) return 'input';
    if (/\b(links?|urls?)\b/.test(t)) return 'link';
    return '';
  }

  function isFormModeStartText(text) {
    var normalized = normalizeMatchText(text);
    if (!normalized) return false;
    if (/^(?:form mode|filling mode|fill mode|start form|start form mode|begin form|begin form mode|open form|open form mode)$/.test(normalized)) {
      return true;
    }
    if (/^(?:fill(?: out)?|guide me(?: through)?|help me fill(?: out)?|walk me through|walk through|go through|go over|take me through|help me with|let s fill(?: out)?|let s go through|let s walk through)\s+(?:this|the|current)?\s*form$/.test(normalized)) {
      return true;
    }
    return /\bform\b/.test(normalized) && /\b(help|guide|walk|go|through|fill|start|begin|open|mode|complete)\b/.test(normalized);
  }

  function parseFormCommand(text) {
    var raw = normalizeCurrentContextIntentText(text);
    var t = String(raw || '').trim().toLowerCase();
    if (!t) return null;
    var formModeActive = !!getCurrentFormSession();
    if (isFormModeStartText(raw)) {
      return { type: 'form_mode', action: 'start' };
    }
    if (/^(exit|leave|stop|cancel|close) form( mode)?$/.test(t)) {
      return { type: 'form_mode', action: 'stop' };
    }
    if (/^(next field|next input|next form field|next question)$/.test(t) || (formModeActive && /^(next|continue|skip)$/.test(t))) return { type: 'form_move', dir: 'next' };
    if (/^(previous field|prev field|previous input|prev input|back field)$/.test(t) || (formModeActive && /^(previous|prev|back|go back)$/.test(t))) return { type: 'form_move', dir: 'prev' };
    if (/^(current field|repeat field|what field am i on|where am i in this form|read current field|where am i)$/.test(t)) return { type: 'form_current' };

    var fillNamedMatch = raw.match(/^(?:fill|type|enter|set)\s+(.+?)\s+(?:with|to)\s+(.+)$/i);
    if (fillNamedMatch) return { type: 'form_fill', fieldLabel: String(fillNamedMatch[1] || '').trim(), value: String(fillNamedMatch[2] || '').trim() };
    var fillIntoMatch = raw.match(/^(?:type|enter)\s+(.+?)\s+(?:in|into)\s+(.+)$/i);
    if (fillIntoMatch) return { type: 'form_fill', fieldLabel: String(fillIntoMatch[2] || '').trim(), value: String(fillIntoMatch[1] || '').trim() };
    var fillMatch = raw.match(/^(fill|type|enter)\s+(.+)$/i);
    if (fillMatch) return { type: 'form_fill', value: String(fillMatch[2] || '').trim() };

    var selectLabeledMatch = raw.match(/^(?:select|choose|pick)\s+(.+?)\s+(?:for|in|from)\s+(.+)$/i);
    if (selectLabeledMatch) return { type: 'form_select', value: String(selectLabeledMatch[1] || '').trim(), fieldLabel: String(selectLabeledMatch[2] || '').trim() };
    var selectMatch = raw.match(/^(select|choose|pick)\s+(.+)$/i);
    if (selectMatch) return { type: 'form_select', value: String(selectMatch[2] || '').trim() };

    var checkNamedMatch = raw.match(/^(check|tick|enable)\s+(.+)$/i);
    if (checkNamedMatch) return { type: 'form_check', checked: true, fieldLabel: String(checkNamedMatch[2] || '').trim() };
    var uncheckNamedMatch = raw.match(/^(uncheck|untick|disable)\s+(.+)$/i);
    if (uncheckNamedMatch) return { type: 'form_check', checked: false, fieldLabel: String(uncheckNamedMatch[2] || '').trim() };
    if (/^(check|tick|enable)$/.test(t)) return { type: 'form_check', checked: true };
    if (/^(uncheck|untick|disable)$/.test(t)) return { type: 'form_check', checked: false };

    if (/^(review( form)?|finish( form)?|done with form|what did you fill|what did you enter|review what you filled)$/.test(t) || (formModeActive && /^(review|finish|done)$/.test(t))) return { type: 'form_review' };
    if (/^(submit( form)?|send( form)?)$/.test(t) || (formModeActive && /^(submit|send)$/.test(t))) return { type: 'form_submit' };
    return null;
  }

  function parseCommand(text) {
    var original = normalizeCurrentContextIntentText(text);
    var t = normalizeCommandTextForIntent(String(original || '').trim().toLowerCase());
    if (!t) return null;
    var num = extractNumber(t);
    var label;
    var inferredType;

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

    var formCmd = parseFormCommand(original);
    if (formCmd) return formCmd;

    var searchQuery = extractSearchSiteQuery(t);
    if (searchQuery) return { type: 'open_site', query: searchQuery, newTab: true };

    // Open a new website (dynamic) in a new tab.
    var siteQuery = extractOpenSiteQuery(t);
    if (siteQuery) return { type: 'open_site', query: siteQuery, newTab: true };

    if (matchesAnyPattern(t, [/(scroll )?down/, /scroll down/, /\bdescend(s)?\b/, /plus bas/, /انزل|نز[ّل]|مرر.*(للأسفل|للاسفل|لتحت)|لتحت|تحت شوي|كم[ّ]?ل لتحت/])) return { type: 'scroll', dir: 'down' };
    if (matchesAnyPattern(t, [/(scroll )?up/, /scroll up/, /\bmonte\b/, /plus haut/, /اطلع|طلع|اصعد|مرر.*(للأعلى|للاعلى|لفوق)|لفوق|فوق شوي|كم[ّ]?ل لفوق/])) return { type: 'scroll', dir: 'up' };
    if (matchesAnyPattern(t, [/\btop\b/, /scroll (to )?top/, /en haut/, /أعلى الصفحة|اعلى الصفحة|لفوق للاخر|اطلع فوق/])) return { type: 'scroll', dir: 'top' };
    if (matchesAnyPattern(t, [/\bbottom\b/, /scroll (to )?bottom/, /en bas/, /أسفل الصفحة|اسفل الصفحة|لتحت للاخر|انزل تحت/])) return { type: 'scroll', dir: 'bottom' };
    var listTarget = parseListTarget(t);
    if (listTarget) return { type: 'list', target: listTarget };
    if (matchesAnyPattern(t, [/read (the )?title/, /read title/, /lis le titre/, /quel est le titre/, /اقر[أا] العنوان|ما عنوان الصفحة|شو عنوان الصفحة|ايش عنوان الصفحة/])) return { type: 'read', what: 'title' };
    if (matchesAnyPattern(t, [/^read (the )?selection/, /^read selected/, /lis la s[ée]lection/, /اقر[أا] التحديد/])) return { type: 'read', what: 'selection' };
    if (matchesAnyPattern(t, [/^read (the )?(focus|focused|this)$/, /sur quoi suis[- ]je/, /ما العنصر المحدد|على ماذا انا|على ماذا أنا|شو العنصر الحالي|ايش العنصر الحالي|وين انا واقف|على شو انا/])) return { type: 'read', what: 'focused' };

    // Explicit label-based intents first
    if ((/^open/.test(t) || /^click/.test(t)) && /link/.test(t) && (label = extractLabel(t, 'link'))) return { type: 'open', target: 'link', label: label, n: num != null ? num : null };
    if ((/^focus/.test(t) || /focus .*button/.test(t)) && /button/.test(t) && (label = extractLabel(t, 'button'))) return { type: 'focus', target: 'button', label: label, n: num != null ? num : null };
    if (/^read/.test(t) && /heading/.test(t) && (label = extractLabel(t, 'heading'))) return { type: 'read', target: 'heading', label: label, n: num != null ? num : null };
    if ((/^press/.test(t) || /^activate/.test(t)) && /button/.test(t) && (label = extractLabel(t, 'button'))) return { type: 'activate', target: 'button', label: label, n: num != null ? num : null };

    // activate focused or this element
    if (/^(activate|press|click)( (the )?(focus|focused|this))?$/.test(t)) return { type: 'activate', target: 'focused' };

    // Shorthand label forms (“go to pricing”, “click docs”, “press continue”)
    if (/^go to /.test(t)) {
      label = stripLeadingTargetFillers(t.replace(/^go to\s+/, '').trim());
      return {
        type: 'open',
        target: 'auto',
        label: label,
        n: num != null ? num : null,
        preferredTypes: inferPreferredTargetTypes(label, 'open')
      };
    }
    if (/^click\s+/.test(t) && !/link|button|heading/.test(t)) {
      label = stripLeadingTargetFillers(t.replace(/^click\s+/, '').trim());
      return {
        type: 'activate',
        target: 'auto',
        label: label,
        n: num != null ? num : null,
        preferredTypes: inferPreferredTargetTypes(label, 'click')
      };
    }
    if (/^press\s+/.test(t) && !/link|button|heading/.test(t)) {
      label = stripLeadingTargetFillers(t.replace(/^press\s+/, '').trim());
      return {
        type: 'activate',
        target: 'auto',
        label: label,
        n: num != null ? num : null,
        preferredTypes: inferPreferredTargetTypes(label, 'activate')
      };
    }
    if (/^focus\s+/.test(t) && !/button|heading|focus .*button/.test(t)) {
      label = extractTrailingPhraseAfterVerb(t, /^focus\s+/);
      inferredType = preferredTypeFromExplicitLanguage(label);
      return {
        type: 'focus',
        target: inferredType || 'auto',
        label: label,
        n: num != null ? num : null,
        preferredTypes: inferPreferredTargetTypes(label, 'focus')
      };
    }

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
    return getIndexedElement(chosen);
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

  function countMatchingTokens(queryTokens, candidateTokens) {
    if (!queryTokens.length || !candidateTokens.length) return 0;
    var count = 0;
    for (var i = 0; i < queryTokens.length; i++) {
      if (candidateTokens.indexOf(queryTokens[i]) >= 0) count += 1;
    }
    return count;
  }

  function scoreItemMatch(item, query, queryTokens, preferredTypes) {
    if (!item) return 0;
    var best = 0;
    var aliases = Array.isArray(item.aliases) ? item.aliases : [];
    for (var i = 0; i < aliases.length; i++) {
      var alias = aliases[i];
      if (!alias) continue;
      if (alias === query) best = Math.max(best, i === 0 ? 1000 : 920);
      else if (alias.indexOf(query) === 0) best = Math.max(best, i === 0 ? 860 : 780);
      else if (alias.indexOf(query) >= 0) best = Math.max(best, i === 0 ? 720 : 640);
      if (queryTokens.length) {
        var aliasTokens = alias.split(' ').filter(Boolean);
        var matchedTokens = countMatchingTokens(queryTokens, aliasTokens);
        if (matchedTokens === queryTokens.length) best = Math.max(best, 560 + matchedTokens);
        else if (matchedTokens >= Math.max(1, Math.ceil(queryTokens.length * 0.6))) best = Math.max(best, 360 + matchedTokens);
      }
    }
    if (best > 0 && Array.isArray(preferredTypes) && preferredTypes.length) {
      var typeIndex = preferredTypes.indexOf(item.type);
      if (typeIndex >= 0) best += Math.max(0, 90 - typeIndex * 20);
    }
    if (best > 0 && item.type === 'input') {
      var normalizedInputType = String(item.inputType || '').toLowerCase();
      if (queryTokens.indexOf('password') >= 0 && normalizedInputType === 'password') best += 180;
      if (queryTokens.indexOf('email') >= 0 && normalizedInputType === 'email') best += 160;
      if ((queryTokens.indexOf('search') >= 0 || queryTokens.indexOf('query') >= 0) && normalizedInputType === 'search') best += 150;
    }
    return best;
  }

  function targetPlural(type) {
    if (type === 'link') return 'links';
    if (type === 'button') return 'buttons';
    if (type === 'heading') return 'headings';
    if (type === 'input') return 'inputs';
    return 'elements';
  }

  function getFrameContextLabelForElement(el) {
    try {
      var win = el && el.ownerDocument && el.ownerDocument.defaultView;
      if (!win || !win.frameElement) return '';
      var frame = win.frameElement;
      return textOf(frame) || String((frame.getAttribute && (frame.getAttribute('title') || frame.getAttribute('name') || frame.getAttribute('aria-label'))) || '').trim();
    } catch (_err) {
      return '';
    }
  }

  function cleanDisambiguationText(text, blocked) {
    var raw = String(text || '').replace(/\s+/g, ' ').trim();
    if (!raw) return '';
    var normalized = normalizeMatchText(raw);
    if (!normalized) return '';
    var blockedValues = Array.isArray(blocked) ? blocked : [];
    if (blockedValues.indexOf(normalized) >= 0) return '';
    if (/^(button|link|heading|input|submit button|unlabeled button|unlabeled link)$/i.test(raw)) return '';
    if (normalized.length < 2) return '';
    return trimAssistantMemoryText(raw, 80);
  }

  function summarizeContextNodeText(el, blocked) {
    if (!el || isHidden(el) || isNavableUiElement(el)) return '';
    var highlighted = el.querySelector && el.querySelector('h1,h2,h3,h4,h5,h6,legend,[role="heading"],strong,b,[aria-label]');
    var text = highlighted ? textOf(highlighted) : '';
    if (!text) text = textOf(el);
    if (!text) text = String(el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
    return cleanDisambiguationText(text, blocked);
  }

  function collectCandidateContextPhrases(item, allMatches) {
    var element = getIndexedElement(item);
    if (!element) return [];
    var blocked = [];
    var matches = Array.isArray(allMatches) ? allMatches : [];
    matches.forEach(function (match) {
      var normalizedLabel = normalizeMatchText(match && match.label ? match.label : '');
      if (normalizedLabel && blocked.indexOf(normalizedLabel) < 0) blocked.push(normalizedLabel);
    });
    var results = [];

    function pushText(value) {
      var cleaned = cleanDisambiguationText(value, blocked);
      if (!cleaned) return;
      if (results.indexOf(cleaned) >= 0) return;
      results.push(cleaned);
    }

    var describedBy = String((element.getAttribute && element.getAttribute('aria-describedby')) || '').trim();
    if (describedBy) {
      describedBy.split(/\s+/).forEach(function (id) {
        var node = findElementByIdScoped(element, id);
        if (node) pushText(textOf(node) || node.textContent || '');
      });
    }

    var current = element;
    for (var depth = 0; depth < 4 && current; depth++) {
      var container = current.parentElement;
      if (!container) {
        var rootNode = getRootNodeForElement(current);
        container = rootNode && rootNode.host ? rootNode.host : null;
      }
      if (!container) break;
      if (container !== element) {
        pushText(summarizeContextNodeText(container, blocked));
        pushText(container.getAttribute && (container.getAttribute('aria-label') || container.getAttribute('title')));
      }
      if (depth === 0 && container.children && container.children.length) {
        Array.prototype.slice.call(container.children).forEach(function (child) {
          if (!child || child === current) return;
          if (child.contains && child.contains(current)) return;
          if (current.contains && current.contains(child)) return;
          pushText(summarizeContextNodeText(child, blocked));
        });
      }
      current = container;
    }

    pushText(getFrameContextLabelForElement(element));
    return results;
  }

  function buildDisambiguationOptions(matches, label) {
    var rawOptions = (Array.isArray(matches) ? matches : []).map(function (item) {
      var contexts = collectCandidateContextPhrases(item, matches);
      var aliases = [];
      function pushAlias(value) {
        var normalized = normalizeMatchText(value);
        if (!normalized) return;
        if (aliases.indexOf(normalized) >= 0) return;
        aliases.push(normalized);
      }
      contexts.forEach(pushAlias);
      if (Array.isArray(item.aliases)) item.aliases.forEach(pushAlias);
      pushAlias(item.label);
      return {
        id: item.id,
        item: item,
        contexts: contexts,
        aliases: aliases,
        summary: ''
      };
    });

    rawOptions.forEach(function (option) {
      var summary = '';
      for (var i = 0; i < option.contexts.length; i++) {
        var candidate = option.contexts[i];
        var normalizedCandidate = normalizeMatchText(candidate);
        var isUnique = rawOptions.every(function (other) {
          return other === option || other.contexts.every(function (ctx) {
            return normalizeMatchText(ctx) !== normalizedCandidate;
          });
        });
        if (isUnique) {
          summary = candidate;
          break;
        }
      }
      if (!summary && option.contexts.length) summary = option.contexts[0];
      if (!summary) {
        var fallbackLabel = String(option.item && option.item.label ? option.item.label : '').trim();
        var normalizedFallback = normalizeMatchText(fallbackLabel);
        var normalizedBase = normalizeMatchText(label || '');
        summary = fallbackLabel && normalizedFallback !== normalizedBase ? fallbackLabel : localizeTarget(option.item && option.item.type ? option.item.type : 'element');
      }
      option.summary = trimAssistantMemoryText(summary, 90);
    });

    return rawOptions;
  }

  function buildAmbiguousResolution(type, resolution, label, cmd) {
    var matches = resolution && Array.isArray(resolution.matches) ? resolution.matches : [];
    if (!matches.length) {
      return {
        message: translate('ambiguous_target', {
          count: resolution && resolution.count ? resolution.count : 0,
          target: targetPlural(type || 'element'),
          value: String(label || '').trim()
        }),
        pending: null
      };
    }
    var options = buildDisambiguationOptions(matches, label);
    var intro = translate('ambiguous_target_intro', {
      count: options.length,
      target: targetPlural(type || 'element'),
      value: String(label || '').trim()
    });
    var optionMessages = options.map(function (option, index) {
      return translate('ambiguity_option', {
        index: index + 1,
        value: option.summary || localizeTarget(option.item && option.item.type ? option.item.type : 'element')
      });
    });
    var followUp = translate('ambiguity_follow_up');
    return {
      message: [intro].concat(optionMessages).concat([followUp]).join(' ').trim(),
      pending: {
        createdAt: Date.now(),
        command: Object.assign({}, cmd || {}),
        targetType: type || 'element',
        label: String(label || '').trim(),
        options: options.map(function (option, index) {
          return {
            id: option.id,
            index: index + 1,
            summary: option.summary,
            aliases: option.aliases,
            type: option.item && option.item.type ? option.item.type : '',
            label: option.item && option.item.label ? option.item.label : ''
          };
        }),
        message: [intro].concat(optionMessages).concat([followUp]).join(' ').trim()
      }
    };
  }

  function resolutionFailureMessage(type, resolution, label, cmd) {
    if (!resolution || resolution.reason === 'not_found') {
      if (type === 'heading') return translate('not_found_heading');
      if (type === 'link') return translate('not_found_link');
      if (type === 'button') return translate('not_found_button');
      if (type === 'element') return translate('not_found_actionable');
      return translate('not_found_generic', { target: localizeTarget(type || 'element') });
    }
    if (resolution.reason === 'ambiguous') {
      var ambiguous = buildAmbiguousResolution(type, resolution, label, cmd);
      pendingDisambiguation = ambiguous.pending;
      return ambiguous.message;
    }
    return translate('not_found_generic', { target: localizeTarget(type || 'element') });
  }

  function findFallbackActionableCandidate(startEl) {
    var current = startEl;
    for (var depth = 0; depth < 5 && current; depth++) {
      if (!isHidden(current) && !isNavableUiElement(current)) {
        var type = getType(current);
        if (type !== 'other') return { element: current, type: type };
        if (hasInteractiveStateAttributes(current) || isImplicitPointerActionable(current, textOf(current))) {
          return { element: current, type: 'button' };
        }
      }
      current = getParentElementOrHost(current);
    }
    return null;
  }

  function findFallbackActionableItems(type, label, preferredTypes) {
    var normalizedQuery = normalizeMatchText(label);
    if (!normalizedQuery) return [];
    var queryTokens = normalizedQuery.split(' ').filter(Boolean);
    var allowCrossType = !type || type === 'auto';
    var items = [];
    var seen = new Set();

    collectSearchRoots(document).forEach(function (root) {
      forEachDescendantElement(root, function (el) {
        if (!el || el.nodeType !== 1) return;
        if (isHidden(el) || isNavableUiElement(el)) return;
        var rawLabel = textOf(el);
        if (!rawLabel) return;
        var tempItem = buildIndexedItemForElement(el, rawLabel, getType(el) || 'other');
        if (!tempItem) {
          tempItem = {
            label: rawLabel,
            type: 'button',
            aliases: collectAliasesForElement(el, rawLabel),
            inputType: '',
            name: '',
            placeholder: '',
            href: ''
          };
        }
        if (!scoreItemMatch(tempItem, normalizedQuery, queryTokens, preferredTypes)) return;
        var candidate = findFallbackActionableCandidate(el);
        if (!candidate || !candidate.element) return;
        if (!allowCrossType && candidate.type !== type) return;
        if (allowCrossType && Array.isArray(preferredTypes) && preferredTypes.length && preferredTypes.indexOf(candidate.type) < 0) return;
        if (seen.has(candidate.element)) return;
        seen.add(candidate.element);
        var item = buildIndexedItemForElement(candidate.element, textOf(candidate.element) || rawLabel, candidate.type);
        if (!item) return;
        if (!scoreItemMatch(item, normalizedQuery, queryTokens, preferredTypes)) return;
        items.push(item);
      });
    });

    return items;
  }

  function resolveElementReference(type, label, n, opts) {
    rescan();
    var preferredTypes =
      opts && Array.isArray(opts.preferredTypes) && opts.preferredTypes.length
        ? opts.preferredTypes.slice()
        : (type && type !== 'auto' ? [type] : DEFAULT_AUTO_TARGET_ORDER.slice());
    var allowCrossType = !type || type === 'auto';
    var items = index.items.filter(function (it) {
      if (allowCrossType) return preferredTypes.indexOf(it.type) >= 0;
      return it.type === type;
    });
    if (!items.length) {
      return { ok: false, reason: 'not_found', count: 0, matches: [] };
    }
    if (!label) {
      var idx = (n === -1) ? (items.length - 1) : (Math.max(1, n || 1) - 1);
      var chosen = items[idx];
      if (!chosen) return { ok: false, reason: 'not_found', count: 0, matches: [] };
      return {
        ok: true,
        item: chosen,
        element: getIndexedElement(chosen)
      };
    }

    var normalizedQuery = normalizeMatchText(label);
    if (!normalizedQuery) return { ok: false, reason: 'not_found', count: 0, matches: [] };
    var queryTokens = normalizedQuery.split(' ').filter(Boolean);
    var ranked = items.map(function (item, indexInType) {
      return { item: item, index: indexInType, score: scoreItemMatch(item, normalizedQuery, queryTokens, preferredTypes) };
    }).filter(function (entry) {
      return entry.score > 0;
    }).sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      var aTypeRank = preferredTypes.indexOf(a.item.type);
      var bTypeRank = preferredTypes.indexOf(b.item.type);
      if (aTypeRank !== bTypeRank) return aTypeRank - bTypeRank;
      return a.index - b.index;
    });

    if (!ranked.length) {
      var fallbackItems = findFallbackActionableItems(type, label, preferredTypes);
      if (!fallbackItems.length) return { ok: false, reason: 'not_found', count: 0, matches: [] };
      ranked = fallbackItems.map(function (item, indexInType) {
        return { item: item, index: indexInType, score: scoreItemMatch(item, normalizedQuery, queryTokens, preferredTypes) };
      }).filter(function (entry) {
        return entry.score > 0;
      }).sort(function (a, b) {
        if (b.score !== a.score) return b.score - a.score;
        var aTypeRank = preferredTypes.indexOf(a.item.type);
        var bTypeRank = preferredTypes.indexOf(b.item.type);
        if (aTypeRank !== bTypeRank) return aTypeRank - bTypeRank;
        return a.index - b.index;
      });
      if (!ranked.length) return { ok: false, reason: 'not_found', count: 0, matches: [] };
    }

    var bestScore = ranked[0].score;
    var topMatches = ranked.filter(function (entry) { return entry.score === bestScore; });
    if (n != null) {
      var resolvedIndex = n === -1 ? (topMatches.length - 1) : (Math.max(1, n) - 1);
      var exactChoice = topMatches[resolvedIndex];
      if (!exactChoice) {
        return {
          ok: false,
          reason: 'ambiguous',
          count: topMatches.length,
          matches: topMatches.map(function (entry) { return entry.item; })
        };
      }
      return {
        ok: true,
        item: exactChoice.item,
        element: getIndexedElement(exactChoice.item)
      };
    }

    if (topMatches.length > 1) {
      return {
        ok: false,
        reason: 'ambiguous',
        count: topMatches.length,
        matches: topMatches.map(function (entry) { return entry.item; })
      };
    }

    return {
      ok: true,
      item: topMatches[0].item,
      element: getIndexedElement(topMatches[0].item)
    };
  }

  function waitFor(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, Math.max(0, ms || 0)); });
  }

  async function resolveElementReferenceWithRetry(type, label, n, opts) {
    var lastResolution = { ok: false, reason: 'not_found', count: 0, matches: [] };
    for (var i = 0; i < ACTION_RETRY_DELAYS_MS.length; i++) {
      var delay = ACTION_RETRY_DELAYS_MS[i];
      if (delay > 0) await waitFor(delay);
      rescan();
      var resolution = resolveElementReference(type, label, n, opts);
      lastResolution = resolution;
      if (!resolution.ok) {
        if (resolution.reason === 'ambiguous') return resolution;
        continue;
      }
      if (!resolution.element || !resolution.element.isConnected) {
        lastResolution = { ok: false, reason: 'not_found', count: 0, matches: [] };
        continue;
      }
      return resolution;
    }
    return lastResolution;
  }

  async function performElementActionWithRetry(type, label, n, opts, actionFn) {
    var lastResolution = { ok: false, reason: 'not_found', count: 0, matches: [] };
    for (var i = 0; i < ACTION_RETRY_DELAYS_MS.length; i++) {
      var delay = ACTION_RETRY_DELAYS_MS[i];
      if (delay > 0) await waitFor(delay);
      rescan();
      var resolution = resolveElementReference(type, label, n, opts);
      lastResolution = resolution;
      if (!resolution.ok) {
        if (resolution.reason === 'ambiguous') return { ok: false, resolution: resolution };
        continue;
      }
      var element = resolution.element;
      if (!element || !element.isConnected) {
        lastResolution = { ok: false, reason: 'not_found', count: 0, matches: [] };
        continue;
      }
      try {
        var actionResult = actionFn(element, resolution);
        if (actionResult === false) {
          lastResolution = { ok: false, reason: 'not_found', count: 0, matches: [] };
          continue;
        }
        return { ok: true, resolution: resolution, element: element };
      } catch (_err) {
        lastResolution = { ok: false, reason: 'not_found', count: 0, matches: [] };
      }
    }
    return { ok: false, resolution: lastResolution };
  }

  function commandTargetType(cmd, fallbackType) {
    if (cmd && cmd.target && cmd.target !== 'auto') return cmd.target;
    return fallbackType || 'element';
  }

  function failureTargetTypeForCommand(cmd, fallbackType) {
    if (cmd && cmd.target && cmd.target !== 'auto') return cmd.target;
    if (cmd && (cmd.type === 'activate' || cmd.type === 'open')) return 'element';
    return fallbackType || 'element';
  }

  async function resolveCommandElement(cmd, fallbackType, actionKind) {
    var targetType = cmd && cmd.target ? cmd.target : fallbackType;
    var preferredTypes =
      cmd && Array.isArray(cmd.preferredTypes) && cmd.preferredTypes.length
        ? cmd.preferredTypes
        : inferPreferredTargetTypes(cmd && cmd.label ? cmd.label : '', actionKind || 'focus');
    return resolveElementReferenceWithRetry(targetType || fallbackType || 'auto', cmd && cmd.label ? cmd.label : '', cmd && cmd.n, {
      preferredTypes: preferredTypes
    });
  }

  var lastIndexByType = {};

  function moveBy(type, dir) {
    rescan();
    var items = index.items.filter(function (it) { return it.type === type; });
    if (!items.length) return null;
    var currentIdx = lastIndexByType[type];
    if (typeof currentIdx !== 'number') {
      // try activeElement
      var ae = getDeepActiveElement(document);
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
    return getIndexedElement(chosen);
  }

  async function execCommand(cmd) {
    if (!cmd) {
      var now = Date.now();
      if (now - lastUnknownCmdAt < 5000) return;
      lastUnknownCmdAt = now;
      speakTransient(translate('unknown_command'), 3200);
      return;
    }
    if (cmd.type === 'help') { speakHelp(); return; }
    if (cmd.type === 'open_site') {
      await openSiteRequest(cmd.query, cmd.newTab !== false);
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
    if (cmd.type === 'list') {
      var listStructure = buildPageStructure();
      speak(listTargetText(cmd.target || 'link', listStructure));
      console.log('[Navable] Action: list', cmd.target);
      return;
    }
    if (cmd.type === 'form_mode') {
      if (cmd.action === 'stop') stopFormMode();
      else startFormMode();
      console.log('[Navable] Action: form mode', cmd.action || 'start');
      return;
    }
    if (cmd.type === 'form_move') {
      moveFormField(cmd.dir === 'prev' ? 'prev' : 'next');
      console.log('[Navable] Action: form move', cmd.dir);
      return;
    }
    if (cmd.type === 'form_current') {
      readCurrentFormField();
      console.log('[Navable] Action: form current');
      return;
    }
    if (cmd.type === 'form_fill') {
      applyCurrentFormValue(cmd.value || '', cmd.fieldLabel || '', { correctionCount: Number(cmd.correctionCount || 0) });
      console.log('[Navable] Action: form fill');
      return;
    }
    if (cmd.type === 'form_select') {
      selectCurrentFormOption(cmd.value || '', cmd.fieldLabel || '', { correctionCount: Number(cmd.correctionCount || 0) });
      console.log('[Navable] Action: form select');
      return;
    }
    if (cmd.type === 'form_check') {
      setCurrentCheckboxState(!!cmd.checked, cmd.fieldLabel || '', { correctionCount: Number(cmd.correctionCount || 0) });
      console.log('[Navable] Action: form checkbox', !!cmd.checked);
      return;
    }
    if (cmd.type === 'form_review') {
      reviewActiveForm();
      console.log('[Navable] Action: form review');
      return;
    }
    if (cmd.type === 'form_submit') {
      submitActiveForm();
      console.log('[Navable] Action: form submit');
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
      var fe = getDeepActiveElement(document);
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
      var headingResolution = await resolveCommandElement(cmd, 'heading', 'read');
      if (!headingResolution.ok || !headingResolution.element) { speak(resolutionFailureMessage('heading', headingResolution, cmd.label, cmd)); return; }
      var elhL = headingResolution.element;
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
      var openResult = await performElementActionWithRetry('link', cmd.label, cmd.n, {
        preferredTypes: cmd.preferredTypes || ['link']
      }, function (el) {
        if (!el.isConnected) return false;
        el.click();
        return true;
      });
      if (!openResult.ok || !openResult.element) { speak(resolutionFailureMessage('link', openResult.resolution, cmd.label, cmd)); return; }
      var ellL = openResult.element;
      var lbllL = ellL.dataset.navableLabel || ellL.innerText || ellL.textContent || '';
      speak(translate('opening_value', { value: lbllL.trim() || translate('target_link') }));
      console.log('[Navable] Action: open link by label', cmd.label);
      return;
    }
    if (cmd.type === 'open' && cmd.target === 'auto' && cmd.label) {
      var autoOpenResult = await performElementActionWithRetry('auto', cmd.label, cmd.n, {
        preferredTypes: cmd.preferredTypes || inferPreferredTargetTypes(cmd.label, 'open')
      }, function (el) {
        if (!el.isConnected) return false;
        el.click();
        return true;
      });
      if (!autoOpenResult.ok || !autoOpenResult.element) {
        speak(resolutionFailureMessage(failureTargetTypeForCommand(cmd, 'element'), autoOpenResult.resolution, cmd.label, cmd));
        return;
      }
      var autoOpen = autoOpenResult.element;
      var autoOpenLabel = autoOpen.dataset.navableLabel || autoOpen.innerText || autoOpen.textContent || '';
      speak(translate('opening_value', { value: autoOpenLabel.trim() || translate('target_link') }));
      console.log('[Navable] Action: open auto target', cmd.label);
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
      var focusButtonResult = await performElementActionWithRetry('button', cmd.label, cmd.n, {
        preferredTypes: cmd.preferredTypes || ['button']
      }, function (el) {
        if (!el.isConnected) return false;
        return focusElementForNavigation(el);
      });
      if (!focusButtonResult.ok || !focusButtonResult.element) { speak(resolutionFailureMessage('button', focusButtonResult.resolution, cmd.label, cmd)); return; }
      var elbL = focusButtonResult.element;
      var lblbL = elbL.dataset.navableLabel || elbL.innerText || elbL.textContent || '';
      speak(translate('focused_value', { value: lblbL.trim() || translate('target_button') }));
      console.log('[Navable] Action: focus button by label', cmd.label);
      return;
    }
    if (cmd.type === 'focus' && cmd.label && (cmd.target === 'input' || cmd.target === 'auto')) {
      var focusResolution = await performElementActionWithRetry(cmd.target === 'input' ? 'input' : 'auto', cmd.label, cmd.n, {
        preferredTypes: cmd.preferredTypes || inferPreferredTargetTypes(cmd.label, 'focus')
      }, function (el) {
        if (!el.isConnected) return false;
        return focusElementForNavigation(el);
      });
      var focusType = commandTargetType(cmd, 'input');
      if (!focusResolution.ok || !focusResolution.element) { speak(resolutionFailureMessage(failureTargetTypeForCommand(cmd, focusType), focusResolution.resolution, cmd.label, cmd)); return; }
      var focusElement = focusResolution.element;
      var focusLabel = focusElement.dataset.navableLabel || focusElement.innerText || focusElement.textContent || '';
      speak(translate('focused_value', { value: focusLabel.trim() || localizeTarget(focusType) }));
      console.log('[Navable] Action: focus target by label', cmd.label);
      return;
    }
    if (cmd.type === 'focus' && cmd.target === 'button' && !cmd.label) {
      var elb = pickNth('button', cmd.n || 1);
      if (!elb) { speak(translate('not_found_generic', { target: localizeTarget('button') })); return; }
      try { focusElementForNavigation(elb); } catch (_err) { /* focus failed */ }
      var lblb = elb.dataset.navableLabel || elb.innerText || elb.textContent || '';
      speak(translate('focused_value', { value: lblb.trim() || translate('target_button') }));
      console.log('[Navable] Action: focus button', cmd.n);
      return;
    }
    if (cmd.type === 'activate' && cmd.target === 'focused') {
      var aef = getDeepActiveElement(document);
      if (!aef) { speak(translate('no_focused_element')); return; }
      var labf = (aef.dataset && aef.dataset.navableLabel) || aef.getAttribute && aef.getAttribute('aria-label') || aef.innerText || aef.textContent || '';
      labf = String(labf || '').trim();
      try { aef.click(); } catch (_err) { /* click failed */ }
      speak(translate('activated_value', { value: labf || translate('target_element') }));
      console.log('[Navable] Action: activate focused');
      return;
    }
    if (cmd.type === 'activate' && cmd.target === 'button' && cmd.label) {
      var activateResult = await performElementActionWithRetry('button', cmd.label, cmd.n, {
        preferredTypes: cmd.preferredTypes || ['button']
      }, function (el) {
        if (!el.isConnected) return false;
        el.focus();
        el.click();
        return true;
      });
      if (!activateResult.ok || !activateResult.element) { speak(resolutionFailureMessage('button', activateResult.resolution, cmd.label, cmd)); return; }
      var ab = activateResult.element;
      var labb = ab.dataset.navableLabel || ab.innerText || ab.textContent || '';
      speak(translate('activated_value', { value: String(labb || translate('target_button')).trim() }));
      console.log('[Navable] Action: activate button by label', cmd.label);
      return;
    }
    if (cmd.type === 'activate' && cmd.target === 'auto' && cmd.label) {
      var autoActivateResolution = await performElementActionWithRetry('auto', cmd.label, cmd.n, {
        preferredTypes: cmd.preferredTypes || inferPreferredTargetTypes(cmd.label, 'activate')
      }, function (el) {
        if (!el.isConnected) return false;
        el.focus();
        el.click();
        return true;
      });
      if (!autoActivateResolution.ok || !autoActivateResolution.element) {
        speak(resolutionFailureMessage(failureTargetTypeForCommand(cmd, 'element'), autoActivateResolution.resolution, cmd.label, cmd));
        return;
      }
      var autoActivate = autoActivateResolution.element;
      var autoActivateLabel = autoActivate.dataset.navableLabel || autoActivate.innerText || autoActivate.textContent || '';
      speak(translate('activated_value', { value: String(autoActivateLabel || translate('target_element')).trim() }));
      console.log('[Navable] Action: activate auto target', cmd.label);
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
    var cmdText = normalizeCurrentContextIntentText((commandText && String(commandText).trim()) || 'Summarize this page');
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
    var q = normalizeCurrentContextIntentText(questionText).trim();
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
      var formSession = getCurrentFormSession();
      if (formSession) {
        var pendingFormConfirmation = getPendingFormConfirmation(formSession);
        if (
          pendingFormConfirmation &&
          cmd &&
          (cmd.type === 'form_fill' || cmd.type === 'form_select' || cmd.type === 'form_check')
        ) {
          cmd.correctionCount = pendingFormConfirmation.mode === 'confirm'
            ? Math.max(0, Number(pendingFormConfirmation.correctionCount || 0)) + 1
            : Math.max(0, Number(pendingFormConfirmation.correctionCount || 0));
        }
        if (cmd && cmd.type === 'summarize') {
          await languageReady;
          if (pendingFormConfirmation) promptPendingFormConfirmation(formSession);
          else speak(translate('form_mode_locked') + ' ' + describeFormField(formSession, currentFormField(formSession)));
          return true;
        }
        if (cmd && isFormContextCommand(cmd)) {
          clearPendingDisambiguation();
          await execCommand(cmd);
          return true;
        }
        if (await tryHandleActiveFormUtterance(text)) return true;
        await languageReady;
        if (pendingFormConfirmation) promptPendingFormConfirmation(formSession);
        else speak(translate('form_mode_locked') + ' ' + describeFormField(formSession, currentFormField(formSession)));
        return true;
      }
      if (cmd && cmd.type === 'summarize') {
        clearPendingDisambiguation();
        await runSummaryRequest(cmd.command, pageStructure);
        return true;
      }
      if (cmd) {
        clearPendingDisambiguation();
        await execCommand(cmd);
        return true;
      }
      if (await tryPendingDisambiguationFollowUp(text)) return true;
      if (await tryIntentFallback(text, pageStructure)) return true;
      if (await assistantRequest(text, pageStructure, {
        detectedLanguage: detectedLanguage || '',
        recognitionProvider: provider || ''
      })) return true;
      await languageReady;
      await execCommand(null);
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
