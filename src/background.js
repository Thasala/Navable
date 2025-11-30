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

  if (text.includes('describe')) {
    steps.push({ action: 'describe_page' });
    if (structure) {
      description =
        (structure.title ? `Title ${structure.title}. ` : '') +
        `Headings ${structure.counts?.headings || 0}, links ${structure.counts?.links || 0}, buttons ${structure.counts?.buttons || 0}.`;
    }
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

async function runPlanner(command) {
  const structureRes = await sendToActiveTab({ type: 'navable:getStructure' });
  const structure = structureRes && structureRes.structure ? structureRes.structure : null;
  const plan = stubPlanner(command, structure);

  if (plan.description) {
    await sendToActiveTab({ type: 'navable:announce', text: plan.description, mode: 'polite' });
  }
  if (plan.steps && plan.steps.length) {
    await sendToActiveTab({ type: 'navable:executePlan', plan: { steps: plan.steps } });
  }

  return { ok: true, plan, structure };
}

// Keyboard command → announce
chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'announce-test') {
    try {
      await sendToActiveTab({
        type: 'announce',
        text: 'Navable is ready. Press H for help in later phases.',
        mode: 'polite'
      });
    } catch (err) {
      console.warn('[Navable] announce-test failed', err);
    }
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
