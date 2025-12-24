// Test fallback: if chrome is missing (non-extension env), create a minimal shim so tests can run.
if (typeof window !== 'undefined' && typeof chrome === 'undefined') {
  window.chrome = {
    commands: {
      _listeners: [],
      onCommand: {
        addListener(fn) {
          chrome.commands._listeners.push(fn);
        }
      },
      _trigger(command) {
        (this._listeners || []).forEach((fn) => {
          try { fn(command); } catch (_e) { /* ignore */ }
        });
      }
    },
    tabs: {
      _created: [],
      onCreated: { addListener() {} },
      onUpdated: { addListener() {} },
      query() { return Promise.resolve([{ id: 1 }]); },
      create(createProperties) {
        const url = createProperties && createProperties.url ? String(createProperties.url) : 'about:blank';
        chrome.tabs._created.push(url);
        return Promise.resolve({ id: chrome.tabs._created.length + 1, url });
      },
      update(tabId, updateProperties) {
        // Support both update(tabId, props) and update(props) signatures in tests.
        let props = updateProperties;
        if (typeof tabId === 'object' && tabId) {
          props = tabId;
        }
        const url = props && props.url ? String(props.url) : undefined;
        return Promise.resolve({ id: typeof tabId === 'number' ? tabId : 1, url });
      },
      sendMessage(_tabId, payload) {
        return new Promise((resolve) => {
          const listeners = (chrome.runtime._listeners || []);
          let responded = false;
          const sendResponse = (res) => {
            responded = true;
            resolve(res);
          };
          listeners.forEach((fn) => {
            try {
              const maybeAsync = fn(payload, { tab: { id: _tabId } }, sendResponse);
              if (maybeAsync === true) {
                // async response allowed
              }
            } catch (_e) {
              // ignore listener errors
            }
          });
          if (!responded) {
            setTimeout(() => resolve(undefined), 0);
          }
        });
      }
    },
    runtime: {
      _listeners: [],
      onMessage: {
        addListener(fn) {
          chrome.runtime._listeners.push(fn);
        }
      }
    },
    storage: {
      sync: {
        get(defaults, cb) { cb(defaults); }
      },
      onChanged: { addListener() {} }
    }
  };
}

const NAVABLE_NEW_TAB_URL = (() => {
  try {
    return chrome && chrome.runtime && chrome.runtime.getURL
      ? String(chrome.runtime.getURL('src/newtab/newtab.html'))
      : '';
  } catch (_err) {
    return '';
  }
})();

function isInternalNewTabUrl(url) {
  const u = String(url || '');
  if (!u) return false;
  if (u === 'chrome://newtab/' || u === 'chrome://newtab') return true;
  if (u === 'edge://newtab/' || u === 'edge://newtab') return true;
  if (u === 'about:newtab' || u === 'about:newtab#' || u === 'about:home') return true;
  if (u.startsWith('chrome-search://local-ntp')) return true;
  if (u.startsWith('chrome://new-tab-page')) return true;
  return false;
}

async function redirectNewTabToNavable(tabId, url) {
  if (!NAVABLE_NEW_TAB_URL || !tabId) return;
  if (!isInternalNewTabUrl(url)) return;
  try {
    await chrome.tabs.update(tabId, { url: NAVABLE_NEW_TAB_URL });
  } catch (err) {
    console.warn('[Navable] new tab redirect failed', err);
  }
}

// Send message to the active tab
async function sendToActiveTab(payload) {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id) throw new Error('No active tab');
  return chrome.tabs.sendMessage(tab.id, payload);
}

async function tryExecutePlan(plan) {
  try {
    await sendToActiveTab({ type: 'navable:executePlan', plan });
  } catch (_e) {
    // ignore; we will try local execution next
  }
  // Also run locally in page/test context when available to ensure commands work without messaging.
  if (typeof window !== 'undefined' && (window).NavableTools && (window).NavableTools.runPlan) {
    try {
      await (window).NavableTools.runPlan(plan);
      return true;
    } catch (_err) {
      return false;
    }
  }
  return false;
}

function stubPlanner(command, structure) {
  const text = String(command || '').toLowerCase();
  const steps = [];
  let description = '';
  const orientation = buildFriendlyOrientation(structure);

  if (text.includes('describe') || text.includes('summarize') || text.includes('summary')) {
    description = orientation;
  } else if (text.includes('scroll up')) {
    steps.push({ action: 'scroll', direction: 'up' });
  } else if (text.includes('scroll')) {
    steps.push({ action: 'scroll', direction: 'down' });
  } else if (text.includes('read title')) {
    steps.push({ action: 'read_title' });
  } else if (text.includes('read selection')) {
    steps.push({ action: 'read_selection' });
  } else if (text.includes('read heading')) {
    steps.push({ action: 'read_heading', n: 1 });
  } else {
    // fallback guidance
    description = 'Try commands like: describe this page, scroll down, read title, read heading.';
  }

  return { description, steps };
}

function buildFriendlyOrientation(structure) {
  if (!structure) return 'Page summary is unavailable.';
  const counts = structure.counts || {};
  const title = structure.title ? `Title: ${structure.title}.` : 'No title found.';
  const basics = `Headings ${counts.headings || 0}, links ${counts.links || 0}, buttons ${counts.buttons || 0}.`;
  const topHeading =
    structure.headings && structure.headings.length ? `Top heading: ${structure.headings[0].label}.` : '';
  const excerpt = structure.excerpt ? `Page snippet: ${structure.excerpt.slice(0, 220)}.` : '';
  return [title, basics, topHeading, excerpt].filter(Boolean).join(' ');
}

const summaryCache = { url: null, ts: 0, result: null };

async function loadSettings() {
  return new Promise((resolve) => {
    if (!chrome.storage || !chrome.storage.sync) {
      resolve({});
      return;
    }
    chrome.storage.sync.get({ navable_settings: {} }, (res) => {
      resolve(res && res.navable_settings ? res.navable_settings : {});
    });
  });
}

async function runPlanner(command) {
  const structureRes = await sendToActiveTab({ type: 'navable:getStructure' });
  const structure = structureRes && structureRes.structure ? structureRes.structure : null;
  const text = String(command || '').toLowerCase();

  // If the user asks to summarize/summary, prefer backend AI + plan where allowed by settings.
  if (text.includes('summarize') || text.includes('summary')) {
    const settings = await loadSettings();
    const aiEnabled = !!settings.aiEnabled;
    const aiMode = settings.aiMode || 'off';
    const canUseCache =
      summaryCache.url &&
      structure &&
      structure.url &&
      summaryCache.url === structure.url &&
      Date.now() - summaryCache.ts < 2 * 60 * 1000;

    if (aiEnabled && aiMode !== 'off') {
      if (canUseCache && summaryCache.result) {
        const cached = summaryCache.result;
        if (cached.description) {
          await sendToActiveTab({
            type: 'navable:announce',
            text: cached.description,
            mode: 'polite'
          });
        }
        if (aiMode === 'summary_plan' && cached.plan && cached.plan.steps && cached.plan.steps.length) {
          await sendToActiveTab({
            type: 'navable:executePlan',
            plan: cached.plan
          });
        }
        return { ...cached, structure, cached: true, ok: true };
      }

      let aiResult = null;
      try {
        const response = await fetch('http://localhost:3000/api/summarize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            command: command || 'Summarize this page',
            pageStructure: structure
          })
        });
        if (response.ok) {
          const data = await response.json();
          aiResult = {
            summary: data.friendlySummary || '',
            suggestions: Array.isArray(data.suggestions) ? data.suggestions : [],
            plan: data.plan && Array.isArray(data.plan.steps) ? data.plan : { steps: [] }
          };
        }
      } catch (err) {
        console.warn('[Navable] summarize backend failed', err);
      }

      if (aiResult && aiResult.summary) {
        const summaryText = aiResult.summary.trim();
        const suggestionsText =
          aiResult.suggestions && aiResult.suggestions.length
            ? ' Suggestions: ' + aiResult.suggestions.join(' ')
            : '';
        const description = (summaryText + suggestionsText).trim();

        if (description) {
          await sendToActiveTab({
            type: 'navable:announce',
            text: description,
            mode: 'assertive'
          });
        }
        if (aiMode === 'summary_plan' && aiResult.plan && aiResult.plan.steps && aiResult.plan.steps.length) {
          await sendToActiveTab({
            type: 'navable:executePlan',
            plan: aiResult.plan
          });
        }

        const result = {
          ok: true,
          plan: aiResult.plan,
          structure,
          description,
          summary: aiResult.summary,
          suggestions: aiResult.suggestions
        };
        summaryCache.url = structure && structure.url ? structure.url : null;
        summaryCache.ts = Date.now();
        summaryCache.result = result;
        return result;
      }
      // If AI path fails, fall back to local stub planner.
    } else {
      // AI disabled: give a friendly orientation and tell the user how to enable AI.
      const description = `${buildFriendlyOrientation(structure)} AI summaries are off. Enable AI in options for a richer summary.`;
      await sendToActiveTab({ type: 'navable:announce', text: description, mode: 'assertive' });
      return {
        ok: true,
        plan: { steps: [] },
        structure,
        description,
        summary: description,
        suggestions: []
      };
    }
  }

  const plan = stubPlanner(command, structure);

  if (plan.description) {
    await sendToActiveTab({ type: 'navable:announce', text: plan.description, mode: 'polite' });
  }
  if (plan.steps && plan.steps.length) {
    await sendToActiveTab({ type: 'navable:executePlan', plan: { steps: plan.steps } });
  }

  return { ok: true, plan, structure };
}

function normalizeSpokenUrl(query) {
  let s = String(query || '').trim();
  if (!s) return '';
  s = s.replace(/^[\s"'“”‘’]+|[\s"'“”‘’]+$/g, '').trim();
  s = s.replace(/\s+/g, ' ');
  const lower = s.toLowerCase();

  // If the user speaks a URL: "example dot com slash login"
  let out = lower;
  out = out.replace(/\s+dot\s+/g, '.');
  out = out.replace(/\s+point\s+/g, '.');
  out = out.replace(/\s+slash\s+/g, '/');
  out = out.replace(/\s+colon\s+/g, ':');
  out = out.replace(/\s*\/\s*/g, '/');
  out = out.replace(/\s*\.\s*/g, '.');
  out = out.replace(/\s*:\s*/g, ':');
  return out.trim();
}

function tryParseHttpUrl(candidate) {
  try {
    const u = new URL(candidate);
    if (u.protocol === 'http:' || u.protocol === 'https:') return u.toString();
  } catch (_e) {
    // ignore
  }
  return null;
}

function looksLikeHostWithOptionalPath(candidate) {
  if (!candidate) return false;
  if (/\s/.test(candidate)) return false;
  const host = candidate.split(/[/?#]/)[0] || '';
  if (!host || host.length > 255) return false;
  const parts = host.split('.');
  if (parts.length < 2) return false;
  const tld = parts[parts.length - 1] || '';
  if (tld.length < 2) return false;
  for (const part of parts) {
    if (!part || part.length > 63) return false;
    if (!/^[a-z0-9-]+$/i.test(part)) return false;
    if (part.startsWith('-') || part.endsWith('-')) return false;
  }
  return true;
}

function resolveOpenQueryToUrl(query) {
  const raw = String(query || '').trim();
  if (!raw) return null;

  const normalized = normalizeSpokenUrl(raw);

  // Explicit search intent: "search for <x>"
  const searchMatch = normalized.match(/^(search|google)\s+(for\s+)?(.+)$/);
  if (searchMatch && searchMatch[3]) {
    return `https://www.google.com/search?q=${encodeURIComponent(searchMatch[3])}`;
  }

  // Full URL
  const direct = tryParseHttpUrl(normalized);
  if (direct) return direct;

  // Domain (with optional path), missing scheme
  if (looksLikeHostWithOptionalPath(normalized)) {
    return tryParseHttpUrl(`https://${normalized}`);
  }

  // Single token like "facebook" -> assume .com
  if (!/\s/.test(normalized) && /^[a-z0-9-]{2,}$/i.test(normalized) && !normalized.includes('.')) {
    return `https://www.${normalized}.com/`;
  }

  // Fallback to search (works for any phrase)
  return `https://www.google.com/search?q=${encodeURIComponent(raw)}`;
}

function friendlyUrlForSpeech(url) {
  try {
    const u = new URL(url);
    const host = u.hostname || url;
    const path = u.pathname && u.pathname !== '/' ? u.pathname : '';
    return (host + path).replace(/^www\./i, '');
  } catch (_e) {
    return String(url || '');
  }
}

async function openSiteInBrowser(query, newTab) {
  const url = resolveOpenQueryToUrl(query);
  if (!url) return { ok: false, error: 'Missing website name or URL.' };

  try {
    await sendToActiveTab({
      type: 'navable:announce',
      text: `Opening ${friendlyUrlForSpeech(url)}.`,
      mode: 'assertive'
    });
  } catch (_e) {
    // ignore announce failures (e.g., unsupported active tab)
  }

  try {
    if (newTab === false) {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (tab && tab.id) {
        await chrome.tabs.update(tab.id, { url });
      } else {
        await chrome.tabs.create({ url });
      }
    } else {
      await chrome.tabs.create({ url });
    }
    return { ok: true, url };
  } catch (err) {
    console.warn('[Navable] openSite failed', err);
    return { ok: false, error: 'Could not open that website.' };
  }
}

// Keyboard commands → tools on active tab
chrome.commands.onCommand.addListener(async (command) => {
  try {
    if (command === 'scroll-down') {
      const ok = await tryExecutePlan({ steps: [{ action: 'scroll', direction: 'down' }] });
      if (!ok && typeof window !== 'undefined' && window.scrollBy) {
        window.scrollBy({ top: Math.floor(window.innerHeight * 0.8), behavior: 'auto' });
      }
      return;
    }
    if (command === 'scroll-up') {
      const ok = await tryExecutePlan({ steps: [{ action: 'scroll', direction: 'up' }] });
      if (!ok && typeof window !== 'undefined' && window.scrollBy) {
        window.scrollBy({ top: -Math.floor(window.innerHeight * 0.8), behavior: 'auto' });
      }
      return;
    }
    if (command === 'next-heading') {
      const ok = await tryExecutePlan({ steps: [{ action: 'move_heading', direction: 'next' }] });
      if (!ok && typeof window !== 'undefined' && (window).NavableTools?.runPlan) {
        await (window).NavableTools.runPlan({ steps: [{ action: 'move_heading', direction: 'next' }] });
      }
      return;
    }
    if (command === 'prev-heading') {
      const ok = await tryExecutePlan({ steps: [{ action: 'move_heading', direction: 'prev' }] });
      if (!ok && typeof window !== 'undefined' && (window).NavableTools?.runPlan) {
        await (window).NavableTools.runPlan({ steps: [{ action: 'move_heading', direction: 'prev' }] });
      }
      return;
    }
  } catch (err) {
    console.warn('[Navable] command handler failed', command, err);
  }
});

// Ensure Navable is usable "from the beginning" by redirecting internal new tab pages
// (where extensions cannot inject content scripts) to Navable's New Tab page.
try {
  if (chrome?.tabs?.onCreated?.addListener) {
    chrome.tabs.onCreated.addListener((tab) => {
      const url = tab && (tab.pendingUrl || tab.url) ? String(tab.pendingUrl || tab.url) : '';
      if (!tab || !tab.id) return;
      redirectNewTabToNavable(tab.id, url);
    });
  }
  if (chrome?.tabs?.onUpdated?.addListener) {
    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      const url =
        (changeInfo && changeInfo.url) ||
        (tab && (tab.pendingUrl || tab.url) ? String(tab.pendingUrl || tab.url) : '');
      redirectNewTabToNavable(tabId, url);
    });
  }
} catch (_err) {
  // ignore in test contexts
}

// Planner + bus bridge
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === 'navable:openSite') {
    openSiteInBrowser(msg.query || '', msg.newTab).then((res) => {
      sendResponse(res);
    }).catch((err) => {
      sendResponse({ ok: false, error: String(err || 'open site failed') });
    });
    return true;
  }
  if (msg && msg.type === 'planner:run') {
    runPlanner(msg.command || '').then((res) => {
      sendResponse(res);
    }).catch((err) => {
      sendResponse({ ok: false, error: String(err || 'planner failed') });
    });
    return true;
  }
  if (msg && msg.type === 'bus:request') {
    if (msg.kind === 'planner:run') {
      runPlanner(msg.payload?.command || '').then((res) => sendResponse(res)).catch((err) => {
        sendResponse({ ok: false, error: String(err || 'planner failed') });
      });
      return true;
    }
    if (msg.kind === 'navable:getStructure') {
      sendToActiveTab({ type: 'navable:getStructure' }).then((res) => sendResponse(res)).catch((err) => {
        sendResponse({ ok: false, error: String(err || 'structure failed') });
      });
      return true;
    }
  }
  return undefined;
});
