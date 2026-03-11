(function () {
  var VOICE_STATE_STORAGE_KEY = 'navable_voice_state';
  var speech = window.NavableSpeech || {};
  var recognizer = null;
  var listening = false;
  var wantsListening = false;
  var permissionGranted = false;
  var lastError = '';
  var currentLanguage = 'en-US';
  var recognizerLanguage = '';
  var storedStateLoaded = false;
  var storedStatePromise = null;

  function supportsRecognition() {
    return !!(speech && speech.supportsRecognition && speech.supportsRecognition());
  }

  function statusPayload() {
    return {
      ok: true,
      supports: supportsRecognition(),
      permissionGranted: !!permissionGranted,
      listening: !!listening,
      lastError: lastError || '',
      language: currentLanguage || 'en-US'
    };
  }

  function fireAndForgetToBackground(payload) {
    try {
      if (!chrome || !chrome.runtime || !chrome.runtime.sendMessage) return;
      var maybe = chrome.runtime.sendMessage(payload);
      if (maybe && typeof maybe.catch === 'function') {
        maybe.catch(function () {});
      }
    } catch (_err) {
      // ignore
    }
  }

  function broadcastStatus() {
    fireAndForgetToBackground({ type: 'voice:state', status: statusPayload() });
  }

  function readLocalStorage(defaults) {
    return new Promise(function (resolve) {
      try {
        if (!chrome || !chrome.storage || !chrome.storage.local || !chrome.storage.local.get) {
          resolve(defaults || {});
          return;
        }
        chrome.storage.local.get(defaults || {}, function (res) {
          resolve(res || defaults || {});
        });
      } catch (_err) {
        resolve(defaults || {});
      }
    });
  }

  function writeLocalStorage(values) {
    return new Promise(function (resolve) {
      try {
        if (!chrome || !chrome.storage || !chrome.storage.local || !chrome.storage.local.set) {
          resolve();
          return;
        }
        chrome.storage.local.set(values || {}, function () {
          resolve();
        });
      } catch (_err) {
        resolve();
      }
    });
  }

  async function hydrateStoredState() {
    if (storedStateLoaded) return;
    if (storedStatePromise) return storedStatePromise;

    storedStatePromise = (async function () {
      var defaults = {};
      defaults[VOICE_STATE_STORAGE_KEY] = {};
      var res = await readLocalStorage(defaults);
      var stored = res && res[VOICE_STATE_STORAGE_KEY] ? res[VOICE_STATE_STORAGE_KEY] : {};
      permissionGranted = !!stored.permissionGranted;
      if (stored && stored.language) currentLanguage = String(stored.language || currentLanguage || 'en-US');
      storedStateLoaded = true;
      storedStatePromise = null;
    })();

    return storedStatePromise;
  }

  async function patchStoredVoiceState(patch) {
    try {
      var defaults = {};
      defaults[VOICE_STATE_STORAGE_KEY] = {};
      var res = await readLocalStorage(defaults);
      var stored = res && res[VOICE_STATE_STORAGE_KEY] ? res[VOICE_STATE_STORAGE_KEY] : {};
      var next = Object.assign({}, stored || {}, patch || {});
      var out = {};
      out[VOICE_STATE_STORAGE_KEY] = next;
      await writeLocalStorage(out);
    } catch (_err) {
      // ignore storage failures
    }
  }

  function mediaErrorCode(err) {
    var name = err && err.name ? String(err.name) : '';
    if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') {
      return 'not-allowed';
    }
    if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
      return 'no-device';
    }
    if (name === 'NotReadableError' || name === 'TrackStartError') {
      return 'audio-busy';
    }
    return name ? name.toLowerCase() : 'unknown';
  }

  function stopStreamTracks(stream) {
    if (!stream || !stream.getTracks) return;
    var tracks = stream.getTracks();
    for (var i = 0; i < tracks.length; i++) {
      try { tracks[i].stop(); } catch (_err) { /* ignore */ }
    }
  }

  async function requestMicrophonePermission() {
    await hydrateStoredState();
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      lastError = 'media-devices-unavailable';
      permissionGranted = false;
      await patchStoredVoiceState({ permissionGranted: false, lastError: lastError });
      broadcastStatus();
      return { ok: false, status: statusPayload(), error: lastError };
    }

    try {
      var stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      permissionGranted = true;
      lastError = '';
      stopStreamTracks(stream);
      await patchStoredVoiceState({ permissionGranted: true, lastError: '' });
      broadcastStatus();
      return { ok: true, status: statusPayload() };
    } catch (err) {
      permissionGranted = false;
      lastError = mediaErrorCode(err);
      await patchStoredVoiceState({ permissionGranted: false, lastError: lastError });
      broadcastStatus();
      return { ok: false, status: statusPayload(), error: lastError };
    }
  }

  function teardownRecognizer() {
    if (!recognizer) return;
    try { recognizer.stop(); } catch (_err) { /* ignore */ }
    recognizer = null;
    listening = false;
  }

  function ensureRecognizer() {
    if (!supportsRecognition()) {
      lastError = 'speech-not-supported';
      return null;
    }

    if (recognizer && recognizerLanguage === currentLanguage) {
      return recognizer;
    }

    teardownRecognizer();

    recognizerLanguage = currentLanguage;
    recognizer = speech.createRecognizer({
      lang: currentLanguage || 'en-US',
      interimResults: false,
      continuous: true,
      autoRestart: true
    });

    recognizer.on('result', function (ev) {
      if (!ev || !ev.transcript) return;
      fireAndForgetToBackground({ type: 'voice:transcript', text: String(ev.transcript) });
    });

    recognizer.on('start', function () {
      listening = true;
      lastError = '';
      broadcastStatus();
    });

    recognizer.on('end', function () {
      listening = false;
      broadcastStatus();
    });

    recognizer.on('error', function (err) {
      var code = err && err.error ? String(err.error) : 'unknown';
      lastError = code;
      if (code === 'not-allowed' || code === 'service-not-allowed') {
        permissionGranted = false;
        wantsListening = false;
        listening = false;
        patchStoredVoiceState({ permissionGranted: false, lastError: code });
      }
      if (code === 'network') {
        wantsListening = false;
      }
      broadcastStatus();
    });

    return recognizer;
  }

  async function startListening(language) {
    await hydrateStoredState();
    currentLanguage = String(language || currentLanguage || 'en-US');
    wantsListening = true;

    if (!permissionGranted) {
      var perm = await requestMicrophonePermission();
      if (!perm.ok) {
        listening = false;
        wantsListening = false;
        return { ok: false, status: statusPayload(), error: perm.error || 'mic-permission-required' };
      }
    }

    var rec = ensureRecognizer();
    if (!rec) {
      listening = false;
      wantsListening = false;
      broadcastStatus();
      return { ok: false, status: statusPayload(), error: lastError || 'speech-not-supported' };
    }

    try {
      rec.start();
      return { ok: true, status: statusPayload() };
    } catch (err) {
      listening = false;
      wantsListening = false;
      lastError = err && err.name ? String(err.name) : 'start-failed';
      broadcastStatus();
      return { ok: false, status: statusPayload(), error: lastError };
    }
  }

  function stopListening() {
    wantsListening = false;
    listening = false;
    if (recognizer) {
      try { recognizer.stop(); } catch (_err) { /* ignore */ }
    }
    broadcastStatus();
    return { ok: true, status: statusPayload() };
  }

  chrome.runtime.onMessage.addListener(function (msg, _sender, sendResponse) {
    if (!msg || msg.type !== 'voice:offscreen') return undefined;

    if (msg.action === 'getStatus') {
      hydrateStoredState().then(function () {
        sendResponse({ ok: true, status: statusPayload() });
      }).catch(function () {
        sendResponse({ ok: true, status: statusPayload() });
      });
      return true;
    }

    if (msg.action === 'requestPermission') {
      requestMicrophonePermission().then(function (res) {
        sendResponse(res);
      }).catch(function (err) {
        lastError = String(err || 'mic-permission-failed');
        sendResponse({ ok: false, status: statusPayload(), error: lastError });
      });
      return true;
    }

    if (msg.action === 'start') {
      startListening(msg.payload && msg.payload.language).then(function (res) {
        sendResponse(res);
      }).catch(function (err) {
        lastError = String(err || 'voice-start-failed');
        sendResponse({ ok: false, status: statusPayload(), error: lastError });
      });
      return true;
    }

    if (msg.action === 'stop') {
      sendResponse(stopListening());
      return true;
    }

    sendResponse({ ok: false, status: statusPayload(), error: 'unknown-offscreen-action' });
    return true;
  });

  hydrateStoredState().then(function () {
    broadcastStatus();
  }).catch(function () {
    broadcastStatus();
  });
})();
