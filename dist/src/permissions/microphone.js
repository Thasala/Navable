/* global chrome, navigator */
(function () {
  function getStatusEl() {
    return document.getElementById('micStatus');
  }

  function setStatus(text, type) {
    var status = getStatusEl();
    if (!status) return;
    status.textContent = text || '';
    status.classList.remove('ok', 'error');
    if (type) status.classList.add(type);
  }

  function stopStream(stream) {
    try {
      if (stream && stream.getTracks) {
        stream.getTracks().forEach(function (track) {
          try { track.stop(); } catch (_err) { /* ignore */ }
        });
      }
    } catch (_err2) {
      // ignore cleanup failures
    }
  }

  async function rememberGrant() {
    try {
      if (chrome && chrome.storage && chrome.storage.local) {
        await chrome.storage.local.set({ navable_microphone_allowed: Date.now() });
      }
    } catch (_err) {
      // storage is best-effort here
    }
  }

  async function requestMicrophone() {
    var button = document.getElementById('allowMic');
    if (button) button.disabled = true;
    setStatus('Requesting microphone access...', '');

    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
      setStatus('Microphone access is not available in this browser.', 'error');
      if (button) button.disabled = false;
      return;
    }

    try {
      var stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stopStream(stream);
      await rememberGrant();
      setStatus('Microphone allowed. You can return to the website and start Navable voice again.', 'ok');
      if (button) button.textContent = 'Microphone allowed';
    } catch (err) {
      var name = err && err.name ? String(err.name) : '';
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        setStatus('Microphone is still blocked. Use the browser prompt or site settings for this extension and set microphone to Allow.', 'error');
      } else if (name === 'NotFoundError') {
        setStatus('No microphone was found on this device.', 'error');
      } else {
        setStatus('Microphone setup failed. Check Chrome microphone permission and try again.', 'error');
      }
      if (button) button.disabled = false;
    }
  }

  async function refreshPermissionState() {
    try {
      if (!navigator.permissions || typeof navigator.permissions.query !== 'function') return false;
      var permission = await navigator.permissions.query({ name: 'microphone' });
      if (permission && permission.state === 'granted') {
        await rememberGrant();
        setStatus('Microphone already allowed. You can return to the website and start Navable voice again.', 'ok');
        var button = document.getElementById('allowMic');
        if (button) {
          button.textContent = 'Microphone allowed';
          button.disabled = true;
        }
        return true;
      }
      return false;
    } catch (_err) {
      return false;
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    var button = document.getElementById('allowMic');
    if (button) button.addEventListener('click', requestMicrophone);
    refreshPermissionState().then(function (alreadyAllowed) {
      if (!alreadyAllowed) requestMicrophone();
    });
  });
})();
