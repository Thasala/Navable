async function sendToActiveTab(payload) {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (tab?.id) {
    return chrome.tabs.sendMessage(tab.id, payload);
  }
  throw new Error('No active tab');
}

function setStatus(text, isError = false) {
  const el = document.getElementById('status');
  if (!el) return;
  el.textContent = text || '';
  el.style.color = isError ? '#c00' : '#0b5';
}

function setDescription(text) {
  const el = document.getElementById('description');
  if (!el) return;
  el.textContent = text || '';
}

async function runPlannerFromPopup() {
  const input = document.getElementById('txtCommand');
  const value = input?.value?.trim() || '';
  if (!value) {
    setStatus('Enter a command to send.');
    return;
  }
  try {
    setStatus('Sending to planner…');
    setDescription('');
    const res = await chrome.runtime.sendMessage({ type: 'planner:run', command: value });
    if (res?.ok) {
      const steps = (res.plan && res.plan.steps && res.plan.steps.length) || 0;
      setStatus(`Plan dispatched (${steps} step${steps === 1 ? '' : 's'}).`);
      if (res.plan?.description) setDescription(res.plan.description);
      else if (res.description) setDescription(res.description);
    } else {
      setStatus(res?.error || 'Planner failed.', true);
    }
  } catch (e) {
    console.error(e);
    setStatus('Planner request failed.', true);
  }
}

document.getElementById('btnAnnounce').addEventListener('click', async () => {
  try {
    await sendToActiveTab({
      type: 'announce',
      text: 'Navable: popup test announcement.',
      mode: 'polite'
    });
    window.close();
  } catch (e) {
    console.error(e);
  }
});

document.getElementById('btnSendAI').addEventListener('click', runPlannerFromPopup);

const input = document.getElementById('txtCommand');
if (input) {
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      runPlannerFromPopup();
    }
  });
}
document.getElementById('btnMicToggle').addEventListener('click', async () => {
  try {
    await sendToActiveTab({ type: 'speech', action: 'toggle' });
    window.close();
  } catch (e) {
    console.error(e);
  }
});
