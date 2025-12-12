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
      if (typeof window.NavableAnnounce === 'function') {
        window.NavableAnnounce(text, opts || { mode: 'polite' });
      } else if (window.NavableAnnounce && typeof window.NavableAnnounce.speak === 'function') {
        window.NavableAnnounce.speak(text);
      }
    } catch (_e) {
      // no-op
    }
  }

  // Fallback hotkey: Alt+Shift+;
  document.addEventListener(
    'keydown',
    (e) => {
      if (e.altKey && e.shiftKey && e.key === ';') {
        announce('Navable: test announcement (fallback hotkey).', { mode: 'polite' });
      }
    },
    { capture: true }
  );

  // Runtime messaging (guarded for non-extension test runs)
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg && msg.type === 'announce') {
        announce(msg.text || 'Navable: announcement.', { mode: msg.mode || 'polite' });
        return;
      }
      if (msg && msg.type === 'navable:announce') {
        announce(msg.text || 'Navable: announcement.', { mode: msg.mode || 'polite' });
        sendResponse && sendResponse({ ok: true });
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
        runPlan(msg.plan || { steps: [] }).then(function (res) {
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
      announce('Navable is ready. Press H for help in later phases.', { mode: 'polite' });
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
  var settings = { language: 'en-US', overlay: false, autostart: false };

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
      if (seen.has(el) || isHidden(el)) return;
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
      if (isHidden(el)) continue;
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
    var activeId = active && active.dataset ? active.dataset.navableId : null;
    var activeLabel = '';
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
        try { elin.dispatchEvent(new Event('input', { bubbles: true })); } catch(_err){}
        try { elin.dispatchEvent(new Event('change', { bubbles: true })); } catch(_err){}
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
      speak(step.prompt || 'Please provide input, then tell me to continue.');
      return { ok: true, message: 'Waiting for user input' };
    }
    return { ok: false, message: 'Unknown action ' + action };
  }

  async function runPlan(plan) {
    if (!plan || !Array.isArray(plan.steps)) return { ok: false, error: 'Invalid plan' };
    for (var i = 0; i < plan.steps.length; i++) {
      var step = plan.steps[i];
      var res = runToolStep(step);
      if (!res.ok) return { ok: false, error: res.message || 'Step failed', step: step };
      if (step.pauseMs) {
        await new Promise(function (resolve) { setTimeout(resolve, step.pauseMs); });
      }
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
  var listening = false;
  var lastSpoken = '';
  var recogLang = 'en-US';

  function speak(text){
    lastSpoken = String(text || '');
    // Rely on the ARIA live region + screen reader; do not use browser text-to-speech.
    announce(lastSpoken, { mode: 'polite' });
  }

  function ensureRecognizer(){
    if (recognizer || !(speech && speech.supportsRecognition && speech.supportsRecognition())) return recognizer;
    recognizer = speech.createRecognizer({ lang: recogLang || 'en-US', interimResults: false, continuous: true, autoRestart: true });
    recognizer.on('result', function(ev){ if (!ev || !ev.transcript) return; handleTranscript(ev.transcript); });
    recognizer.on('error', function(e){
      console.warn('[Navable] speech error', e && e.error);
      try {
        var code = e && e.error ? String(e.error) : 'unknown';
        if (code === 'no-speech') {
          speak('I did not hear anything.');
        } else if (code === 'audio-capture') {
          speak('I could not access the microphone.');
        } else if (code === 'not-allowed' || code === 'service-not-allowed') {
          speak('Speech recognition is not allowed in this browser.');
        } else {
          speak('Speech recognition had a problem. Please try again.');
        }
      } catch (_err) {
        // ignore secondary failures
      }
    });
    recognizer.on('start', function(){ console.log('[Navable] listening'); });
    recognizer.on('end', function(){ console.log('[Navable] stopped listening'); listening = false; });
    return recognizer;
  }

  function toggleListening(){
    ensureRecognizer();
    if (!recognizer){ speak('Speech recognition not available.'); return; }
    if (!listening){ listening = true; speak('Listening'); recognizer.start(); }
    else { listening = false; speak('Stopped listening'); recognizer.stop(); }
  }

  function parseCommand(text){
    var original = String(text || '');
    var t = original.trim().toLowerCase();
    if (!t) return null;
    var num = extractNumber(t);
    var label;

    // English summary triggers + common Arabic phrasing.
    if (
      t.includes('summarize') ||
      t.includes('summary') ||
      t.includes('describe this page') ||
      t.includes('what is this page') ||
      t.includes("what's on this page") ||
      t.includes('what is on this page') ||
      t.includes("what's this page") ||
      /ما هذه الصفحه/.test(t) ||
      /ما هذه الصفحة/.test(t) ||
      /ما هو محتوى الصفحة/.test(t) ||
      /ملخص/.test(t) ||
      /وصف الصفحة/.test(t)
    ) {
      return { type: 'summarize', command: original || 'Summarize this page' };
    }
    if (/(scroll )?down/.test(t) || /scroll down/.test(t)) return { type:'scroll', dir:'down' };
    if (/(scroll )?up/.test(t) || /scroll up/.test(t)) return { type:'scroll', dir:'up' };
    if (/top/.test(t) || /scroll (to )?top/.test(t)) return { type:'scroll', dir:'top' };
    if (/bottom/.test(t) || /scroll (to )?bottom/.test(t)) return { type:'scroll', dir:'bottom' };
    if (/read (the )?title/.test(t) || /read title/.test(t)) return { type:'read', what:'title' };
    if (/^read (the )?selection/.test(t) || /^read selected/.test(t)) return { type:'read', what:'selection' };
    if (/^read (the )?(focus|focused|this)$/.test(t)) return { type:'read', what:'focused' };

    // Explicit label-based intents first
    if ((/^open/.test(t) || /^click/.test(t)) && /link/.test(t) && (label = extractLabel(t, 'link'))) return { type:'open', target:'link', label: label };
    if ((/^focus/.test(t) || /focus .*button/.test(t)) && /button/.test(t) && (label = extractLabel(t, 'button'))) return { type:'focus', target:'button', label: label };
    if (/^read/.test(t) && /heading/.test(t) && (label = extractLabel(t, 'heading'))) return { type:'read', target:'heading', label: label };
    if ((/^press/.test(t) || /^activate/.test(t)) && /button/.test(t) && (label = extractLabel(t, 'button'))) return { type:'activate', target:'button', label: label };

    // activate focused or this element
    if (/^(activate|press|click)( (the )?(focus|focused|this))?$/.test(t)) return { type:'activate', target:'focused' };

    // Shorthand label forms (“go to pricing”, “click docs”, “press continue”)
    if (/^go to /.test(t)) return { type:'open', target:'link', label: t.replace(/^go to\s+/, '').trim() };
    if (/^click\s+/.test(t) && !/link|button|heading/.test(t)) return { type:'open', target:'link', label: t.replace(/^click\s+/, '').trim() };
    if (/^press\s+/.test(t) && !/link|button|heading/.test(t)) return { type:'activate', target:'button', label: t.replace(/^press\s+/, '').trim() };

    // Heading position (fallback to 1 when no ordinal present)
    if (/read .*heading/.test(t) || /^read heading/.test(t)) {
      return { type:'read', target:'heading', n: num != null ? num : 1 };
    }

    // Nth link/button commands (require ordinal/number)
    if ((/^open/.test(t) || /^click/.test(t)) && /link/.test(t) && num != null) {
      return { type:'open', target:'link', n: num };
    }
    if ((/^focus/.test(t) || /focus .*button/.test(t)) && /button/.test(t) && num != null) {
      return { type:'focus', target:'button', n: num };
    }
    if ((/^press/.test(t) || /^activate/.test(t)) && /button/.test(t) && num != null) {
      return { type:'activate', target:'button', n: num };
    }

    // Navigation (next/previous)
    if (/next .*link/.test(t) || /^next link/.test(t)) return { type:'move', target:'link', dir:'next' };
    if (/previous .*link/.test(t) || /^previous link/.test(t) || /prev .*link/.test(t)) return { type:'move', target:'link', dir:'prev' };
    if (/next .*button/.test(t) || /^next button/.test(t)) return { type:'move', target:'button', dir:'next' };
    if (/previous .*button/.test(t) || /^previous button/.test(t) || /prev .*button/.test(t)) return { type:'move', target:'button', dir:'prev' };
    if (/next .*heading/.test(t) || /^next heading/.test(t)) return { type:'move', target:'heading', dir:'next' };
    if (/previous .*heading/.test(t) || /^previous heading/.test(t) || /prev .*heading/.test(t)) return { type:'move', target:'heading', dir:'prev' };

    if (/repeat/.test(t)) return { type:'repeat' };
    if (/stop/.test(t)) return { type:'stop' };
    return null;
  }

  function extractNumber(t){
    // ordinals
    var ord = {
      'first':1,'1st':1,'one':1,
      'second':2,'2nd':2,'two':2,
      'third':3,'3rd':3,'three':3,
      'fourth':4,'4th':4,'four':4,
      'fifth':5,'5th':5,'five':5,
      'sixth':6,'6th':6,'six':6,
      'seventh':7,'7th':7,'seven':7,
      'eighth':8,'8th':8,'eight':8,
      'ninth':9,'9th':9,'nine':9,
      'tenth':10,'10th':10,'ten':10,
      'last':-1
    };
    for (var k in ord) { if (t.includes(k)) return ord[k]; }
    var m = t.match(/(\d+)/);
    if (m) return parseInt(m[1], 10);
    return null;
  }

  function pickNth(type, n){
    rescan();
    var items = index.items.filter(function (it) { return it.type === type; });
    if (!items.length) return null;
    var idx = (n === -1) ? (items.length - 1) : (Math.max(1, n || 1) - 1);
    var chosen = items[idx];
    if (!chosen) return null;
    return document.querySelector('[data-navable-id="' + chosen.id + '"]');
  }

  function extractLabel(t, target){
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
    ['first','1st','one','second','2nd','two','third','3rd','three','fourth','4th','four','fifth','5th','five','last'].forEach(function(k){
      var re = new RegExp('\\b' + k + '\\b', 'g');
      label = label.replace(re, '').trim();
    });
    return label || null;
  }

  function findByLabel(type, label){
    rescan();
    var items = index.items.filter(function (it) { return it.type === type; });
    if (!items.length) return null;
    var norm = function(s){ return String(s||'').trim().toLowerCase().replace(/\s+/g,' '); };
    var L = norm(label);
    var candidate = null;
    // exact match first
    for (var i=0;i<items.length;i++){ if (norm(items[i].label) === L) { candidate = items[i]; break; } }
    // startswith
    if (!candidate) for (var j=0;j<items.length;j++){ if (norm(items[j].label).startsWith(L)) { candidate = items[j]; break; } }
    // includes
    if (!candidate) candidate = items.find(function (it) { return norm(it.label).includes(L); }) || null;
    if (!candidate) return null;
    return document.querySelector('[data-navable-id="' + candidate.id + '"]');
  }

  var lastIndexByType = {};

  function moveBy(type, dir){
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

  function execCommand(cmd){
    if (!cmd) { speak("I didn't catch that."); return; }
    if (cmd.type === 'scroll'){
      var amount = Math.floor(window.innerHeight * 0.8);
      if (cmd.dir === 'down') {
        window.scrollBy({ top: amount, behavior: 'smooth' });
        speak('Scrolled down.');
      } else if (cmd.dir === 'up') {
        window.scrollBy({ top: -amount, behavior: 'smooth' });
        speak('Scrolled up.');
      } else if (cmd.dir === 'top') {
        window.scrollTo({ top: 0, behavior: 'smooth' });
        speak('Scrolled to top.');
      } else if (cmd.dir === 'bottom') {
        window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
        speak('Scrolled to bottom.');
      } else {
        window.scrollBy({ top: amount, behavior: 'smooth' });
        speak('Scrolled down.');
      }
      console.log('[Navable] Action: scroll', cmd.dir);
      return;
    }
    if (cmd.type === 'read' && cmd.what === 'title'){
      var h1 = document.querySelector('h1');
      var title = (h1 && h1.innerText) || document.title || '';
      speak('Title: ' + (title || 'not found'));
      console.log('[Navable] Action: read title');
      return;
    }
    if (cmd.type === 'read' && cmd.what === 'selection'){
      var sel = '';
      try { sel = String(window.getSelection && window.getSelection().toString() || '').trim(); } catch(_err){ /* selection failed */ }
      if (sel) { speak('Selection: ' + sel); } else { speak('No selection.'); }
      console.log('[Navable] Action: read selection');
      return;
    }
    if (cmd.type === 'read' && cmd.what === 'focused'){
      var fe = document.activeElement;
      if (fe) {
        var fl = (fe.dataset && fe.dataset.navableLabel) || fe.getAttribute && fe.getAttribute('aria-label') || fe.innerText || fe.textContent || '';
        fl = String(fl || '').trim();
        speak(fl || 'No focused element text.');
      } else {
        speak('No focused element.');
      }
      console.log('[Navable] Action: read focused');
      return;
    }
    if (cmd.type === 'read' && cmd.target === 'heading' && cmd.label){
      var elhL = findByLabel('heading', cmd.label);
      if (!elhL) { speak('I did not find that heading.'); return; }
      var lblhL = elhL.dataset.navableLabel || elhL.innerText || elhL.textContent || '';
      speak('Heading: ' + (lblhL.trim() || 'unnamed'));
      console.log('[Navable] Action: read heading by label', cmd.label);
      return;
    }
    if (cmd.type === 'read' && cmd.target === 'heading' && !cmd.label){
      var elh = pickNth('heading', cmd.n || 1);
      if (!elh) { speak('I did not find a heading.'); return; }
      var lblh = elh.dataset.navableLabel || elh.innerText || elh.textContent || '';
      speak('Heading: ' + (lblh.trim() || 'unnamed'));
      console.log('[Navable] Action: read heading', cmd.n);
      return;
    }
    if (cmd.type === 'open' && cmd.target === 'link' && cmd.label){
      var ellL = findByLabel('link', cmd.label);
      if (!ellL) { speak('I did not find that link.'); return; }
      var lbllL = ellL.dataset.navableLabel || ellL.innerText || ellL.textContent || '';
      speak('Opening ' + (lbllL.trim() || 'link'));
      ellL.click();
      console.log('[Navable] Action: open link by label', cmd.label);
      return;
    }
    if (cmd.type === 'open' && cmd.target === 'link' && !cmd.label){
      var ell = pickNth('link', cmd.n || 1);
      if (!ell) { speak('I did not find a link.'); return; }
      var lbll = ell.dataset.navableLabel || ell.innerText || ell.textContent || '';
      speak('Opening ' + (lbll.trim() || 'link'));
      // Prefer click to follow anchors and SPA handlers
      ell.click();
      console.log('[Navable] Action: open link', cmd.n);
      return;
    }
    if (cmd.type === 'focus' && cmd.target === 'button' && cmd.label){
      var elbL = findByLabel('button', cmd.label);
      if (!elbL) { speak('I did not find that button.'); return; }
      try { elbL.focus(); } catch(_err){ /* focus failed */ }
      var lblbL = elbL.dataset.navableLabel || elbL.innerText || elbL.textContent || '';
      speak('Focused ' + (lblbL.trim() || 'button'));
      console.log('[Navable] Action: focus button by label', cmd.label);
      return;
    }
    if (cmd.type === 'focus' && cmd.target === 'button' && !cmd.label){
      var elb = pickNth('button', cmd.n || 1);
      if (!elb) { speak('I did not find a button.'); return; }
      try { elb.focus(); } catch(_err){ /* focus failed */ }
      var lblb = elb.dataset.navableLabel || elb.innerText || elb.textContent || '';
      speak('Focused ' + (lblb.trim() || 'button'));
      console.log('[Navable] Action: focus button', cmd.n);
      return;
    }
    if (cmd.type === 'activate' && cmd.target === 'focused'){
      var aef = document.activeElement;
      if (!aef) { speak('No focused element.'); return; }
      var labf = (aef.dataset && aef.dataset.navableLabel) || aef.getAttribute && aef.getAttribute('aria-label') || aef.innerText || aef.textContent || '';
      labf = String(labf || '').trim();
      try { aef.click(); } catch(_err){ /* click failed */ }
      speak('Activated ' + (labf || 'element'));
      console.log('[Navable] Action: activate focused');
      return;
    }
    if (cmd.type === 'activate' && cmd.target === 'button' && cmd.label){
      var ab = findByLabel('button', cmd.label);
      if (!ab) { speak('I did not find that button.'); return; }
      var labb = ab.dataset.navableLabel || ab.innerText || ab.textContent || '';
      try { ab.focus(); } catch(_err){ /* focus failed */ }
      try { ab.click(); } catch(_err){ /* click failed */ }
      speak('Activated ' + (String(labb||'button').trim()));
      console.log('[Navable] Action: activate button by label', cmd.label);
      return;
    }
    if (cmd.type === 'activate' && cmd.target === 'button' && cmd.n != null){
      var abin = pickNth('button', cmd.n);
      if (!abin) { speak('I did not find a button.'); return; }
      var labbn = abin.dataset.navableLabel || abin.innerText || abin.textContent || '';
      try { abin.focus(); } catch(_err){ /* focus failed */ }
      try { abin.click(); } catch(_err){ /* click failed */ }
      speak('Activated ' + (String(labbn || 'button').trim()));
      console.log('[Navable] Action: activate button', cmd.n);
      return;
    }
    if (cmd.type === 'move' && (cmd.target === 'link' || cmd.target === 'button')){
      var elmv = moveBy(cmd.target, cmd.dir === 'prev' ? 'prev' : 'next');
      if (!elmv) { speak('I did not find a ' + cmd.target + '.'); return; }
      try { elmv.focus(); } catch(_err){ /* focus failed */ }
      var lblmv = elmv.dataset.navableLabel || elmv.innerText || elmv.textContent || '';
      speak('Focused ' + (lblmv.trim() || cmd.target));
      console.log('[Navable] Action: move ' + cmd.target, cmd.dir);
      return;
    }
    if (cmd.type === 'move' && cmd.target === 'heading'){
      var elmh = moveBy('heading', cmd.dir === 'prev' ? 'prev' : 'next');
      if (!elmh) { speak('I did not find a heading.'); return; }
      var lblmh = elmh.dataset.navableLabel || elmh.innerText || elmh.textContent || '';
      speak('Heading: ' + (lblmh.trim() || 'unnamed'));
      console.log('[Navable] Action: move heading', cmd.dir);
      return;
    }
    if (cmd.type === 'repeat'){ if (lastSpoken) speak(lastSpoken); return; }
    if (cmd.type === 'stop'){ try { if (window.speechSynthesis) window.speechSynthesis.cancel(); } catch(_err){ /* cancel failed */ } return; }
  }

  async function runSummaryRequest(commandText) {
    var cmdText = (commandText && String(commandText).trim()) || 'Summarize this page';
    speak('Summarizing this page.');
    if (!chrome || !chrome.runtime || !chrome.runtime.sendMessage) {
      speak('Planner is unavailable.');
      return;
    }
    try {
      var res = await chrome.runtime.sendMessage({ type: 'planner:run', command: cmdText });
      if (!res || res.ok !== true) {
        speak('Could not summarize this page.');
      }
      // On success, the background will announce the summary via the live region.
    } catch (err) {
      console.warn('[Navable] summarize via planner failed', err);
      speak('Summarization failed.');
    }
  }

  function handleTranscript(text){
    console.log('[Navable] Recognized:', text);
    var cmd = parseCommand(text);
    if (cmd && cmd.type === 'summarize') {
      runSummaryRequest(cmd.command);
      return;
    }
    execCommand(cmd);
  }

  // Hotkey to toggle listening: Alt+Shift+M (prototype)
  document.addEventListener('keydown', function(e){
    if (e.altKey && e.shiftKey && (e.key === 'm' || e.key === 'M')) { toggleListening(); }
  }, { capture: true });

  // Allow popup/background to toggle listening
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg && msg.type === 'speech') {
        if (msg.action === 'toggle') toggleListening();
        if (msg.action === 'start') { if (!listening) toggleListening(); }
        if (msg.action === 'stop') { if (listening) toggleListening(); }
      }
    });
  }

  // Settings: load and react to changes
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
    try {
      chrome.storage.sync.get({ navable_settings: settings }, (res) => {
        var s = res && res.navable_settings ? res.navable_settings : settings;
        settings = { language: s.language || 'en-US', overlay: !!s.overlay, autostart: !!s.autostart };
        recogLang = settings.language || 'en-US';
        if (settings.overlay) { overlayOn = true; drawOverlay(); } else { overlayOn = false; clearOverlay(); }
        if (settings.autostart) { ensureRecognizer(); if (!listening) toggleListening(); }
      });
      chrome.storage.onChanged && chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'sync' || !changes.navable_settings) return;
        var s2 = changes.navable_settings.newValue || settings;
        settings = { language: s2.language || 'en-US', overlay: !!s2.overlay, autostart: !!s2.autostart };
        recogLang = settings.language || 'en-US';
        if (settings.overlay) { overlayOn = true; drawOverlay(); } else { overlayOn = false; clearOverlay(); }
        // if autostart turned on, start; if off, stop
        if (settings.autostart) { ensureRecognizer(); if (!listening) toggleListening(); }
        else { if (listening) toggleListening(); }
      });
    } catch (_e) { /* storage not available in tests */ }
  }

  // Help voice command + hotkey
  function speakHelp(){
    speak('Try: scroll down, read title, open first link, focus second button, next heading, activate focused, read selection.');
  }

  document.addEventListener('keydown', function(e){
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
