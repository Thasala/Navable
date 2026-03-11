function setStatus(text, isError) {
  const status = document.getElementById('statusText');
  if (!status) return;
  status.textContent = text || '';
  status.classList.remove('error');
  if (isError) status.classList.add('error');
}

async function getVoiceStatus() {
  try {
    const res = await chrome.runtime.sendMessage({ type: 'voice:getStatus' });
    return res || { ok: false, error: 'No response from extension.' };
  } catch (err) {
    return { ok: false, error: String(err || 'Voice status failed.') };
  }
}

function describeStatus(status) {
  if (!status || status.ok !== true) return 'Voice status is unavailable.';
  if (!status.supports) return 'Voice recognition is not supported in this browser.';
  if (!status.permissionGranted) return 'Microphone is not enabled yet.';
  if (status.listening) return 'Microphone enabled. Navable is listening.';
  return 'Microphone enabled. Press Start listening when you are ready.';
}

async function refreshStatus() {
  const status = await getVoiceStatus();
  setStatus(describeStatus(status), status.ok !== true);
}

async function enableMicOnce() {
  setStatus('Requesting microphone permission…');
  try {
    const res = await chrome.runtime.sendMessage({ type: 'voice:requestPermission' });
    if (!res || res.ok !== true || !res.permissionGranted) {
      setStatus('Microphone permission was not granted. You can try again.', true);
      return;
    }
    setStatus('Microphone permission granted. You will not be asked again on each website.');
  } catch (err) {
    setStatus(String(err || 'Microphone setup failed.'), true);
  }
  await refreshStatus();
}

async function startListening() {
  setStatus('Starting voice listening…');
  try {
    const res = await chrome.runtime.sendMessage({ type: 'voice:start' });
    if (!res || res.ok !== true || !res.listening) {
      setStatus('Could not start listening. Enable microphone first if needed.', true);
      return;
    }
    setStatus('Listening started. You can now use voice commands on webpages.');
  } catch (err) {
    setStatus(String(err || 'Could not start listening.'), true);
  }
  await refreshStatus();
}

function wireOnboarding() {
  const enable = document.getElementById('btnEnableMic');
  const start = document.getElementById('btnStartVoice');

  if (enable) enable.addEventListener('click', () => { enableMicOnce(); });
  if (start) start.addEventListener('click', () => { startListening(); });

  refreshStatus();
}

document.addEventListener('DOMContentLoaded', wireOnboarding);
