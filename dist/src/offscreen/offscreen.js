(function () {
  var activeSession = null;

  function cleanPayload(payload) {
    payload = payload || {};
    var safe = {};
    [
      'transcript',
      'isFinal',
      'language',
      'provider',
      'error',
      'message'
    ].forEach(function (key) {
      if (Object.prototype.hasOwnProperty.call(payload, key)) safe[key] = payload[key];
    });
    return safe;
  }

  function postSpeechEvent(session, event, payload) {
    if (!session || !session.sessionId || !session.tabId) return;
    try {
      chrome.runtime.sendMessage({
        type: 'navable:offscreenSpeechEvent',
        sessionId: session.sessionId,
        tabId: session.tabId,
        event: event,
        payload: cleanPayload(payload)
      });
    } catch (_err) {
      // ignore relay failures; the content tab may already be gone
    }
  }

  function stopActiveSession(opts) {
    opts = opts || {};
    if (!activeSession) return;
    var session = activeSession;
    activeSession = null;
    try {
      if (session.recognizer && typeof session.recognizer.stop === 'function') {
        session.recognizer.stop({ silent: !!opts.silent });
      }
    } catch (_err) {
      // ignore stop failures during teardown
    }
  }

  function startSession(msg) {
    var sessionId = String(msg && msg.sessionId ? msg.sessionId : '').trim();
    var tabId = Number(msg && msg.tabId ? msg.tabId : 0);
    if (!sessionId || !tabId) return { ok: false, error: 'Missing voice session' };
    if (!window.NavableSpeech || typeof window.NavableSpeech.createRecognizer !== 'function') {
      return { ok: false, error: 'Voice capture unavailable' };
    }

    if (activeSession && activeSession.sessionId !== sessionId) {
      postSpeechEvent(activeSession, 'end', { provider: 'extension' });
      stopActiveSession({ silent: true });
    } else {
      stopActiveSession({ silent: true });
    }

    var session = {
      sessionId: sessionId,
      tabId: tabId,
      recognizer: null
    };

    try {
      var recognizer = window.NavableSpeech.createRecognizer({
        lang: msg.lang || 'en-US',
        interimResults: false,
        continuous: true,
        autoRestart: true,
        preferBackend: true,
        nativeFallback: false
      });
      session.recognizer = recognizer;
      activeSession = session;

      recognizer.on('result', function (payload) {
        postSpeechEvent(session, 'result', payload);
      });
      recognizer.on('error', function (payload) {
        postSpeechEvent(session, 'error', payload);
      });
      recognizer.on('start', function (payload) {
        postSpeechEvent(session, 'start', payload);
      });
      recognizer.on('end', function (payload) {
        postSpeechEvent(session, 'end', payload);
      });
      recognizer.start();
      return { ok: true };
    } catch (err) {
      activeSession = null;
      return { ok: false, error: String(err || 'Voice capture failed') };
    }
  }

  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener(function (msg, _sender, sendResponse) {
      if (!msg || msg.target !== 'navable:offscreenSpeech') return undefined;
      if (msg.action === 'start') {
        sendResponse(startSession(msg));
        return false;
      }
      if (msg.action === 'stop') {
        if (!msg.sessionId || (activeSession && activeSession.sessionId === String(msg.sessionId))) {
          stopActiveSession({ silent: !!msg.silent });
        }
        sendResponse({ ok: true });
        return false;
      }
      sendResponse({ ok: false, error: 'Unknown voice action' });
      return false;
    });
  }
})();
