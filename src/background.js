// Send message to the active tab
async function sendToActiveTab(payload) {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id) throw new Error('No active tab');
  return chrome.tabs.sendMessage(tab.id, payload);
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

// Keyboard commands → tools on active tab
chrome.commands.onCommand.addListener(async (command) => {
  try {
    if (command === 'scroll-down') {
      await sendToActiveTab({
        type: 'navable:executePlan',
        plan: { steps: [{ action: 'scroll', direction: 'down' }] }
      });
      return;
    }
    if (command === 'scroll-up') {
      await sendToActiveTab({
        type: 'navable:executePlan',
        plan: { steps: [{ action: 'scroll', direction: 'up' }] }
      });
      return;
    }
    if (command === 'next-heading') {
      await sendToActiveTab({
        type: 'navable:executePlan',
        plan: { steps: [{ action: 'move_heading', direction: 'next' }] }
      });
      return;
    }
    if (command === 'prev-heading') {
      await sendToActiveTab({
        type: 'navable:executePlan',
        plan: { steps: [{ action: 'move_heading', direction: 'prev' }] }
      });
      return;
    }
  } catch (err) {
    console.warn('[Navable] command handler failed', command, err);
  }
});

// Planner + bus bridge
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
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
