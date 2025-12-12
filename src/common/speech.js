// Lightweight Web Speech API wrapper for Navable
// Exposes window.NavableSpeech with:
// - supportsRecognition(): boolean
// - createRecognizer(opts): { start(), stop(), on(event, handler) }
// - speak(text): Promise<void>
(function () {
  if (typeof window === 'undefined' || window.NavableSpeech) return;

  var NativeRecognition =
    window.SpeechRecognition ||
    window.webkitSpeechRecognition ||
    window.mozSpeechRecognition ||
    window.msSpeechRecognition;

  function supportsRecognition() {
    return !!NativeRecognition;
  }

  function createRecognizer(options) {
    options = options || {};
    if (!NativeRecognition) {
      throw new Error('Speech recognition not supported');
    }

    var recognizer = new NativeRecognition();
    recognizer.lang = options.lang || 'en-US';
    recognizer.interimResults = !!options.interimResults;
    recognizer.continuous = !!options.continuous;

    var autoRestart = !!options.autoRestart;
    var shouldRestart = autoRestart;
    var listeners = {
      result: [],
      error: [],
      start: [],
      end: []
    };

    function emit(type, payload) {
      var list = listeners[type];
      if (!list || !list.length) return;
      list.forEach(function (fn) {
        try {
          fn(payload);
        } catch (_err) {
          // swallow handler errors
        }
      });
    }

    recognizer.onresult = function (event) {
      if (!event || !event.results || event.results.length === 0) return;
      var transcript = '';
      var isFinal = false;
      for (var i = event.resultIndex; i < event.results.length; i++) {
        var res = event.results[i];
        if (!res || !res[0]) continue;
        transcript += res[0].transcript || '';
        if (res.isFinal) isFinal = true;
      }
      transcript = String(transcript || '').trim();
      if (!transcript) return;
      if (!isFinal && options.onlyFinal !== false && !options.interimResults) {
        // Skip interim results when onlyFinal is desired.
        return;
      }
      emit('result', {
        transcript: transcript,
        isFinal: isFinal,
        raw: event
      });
    };

    recognizer.onerror = function (event) {
      var code = event && event.error ? String(event.error) : 'unknown';
      // On hard errors, stop auto-restart to avoid tight loops.
      if (code === 'not-allowed' || code === 'service-not-allowed' || code === 'network') {
        shouldRestart = false;
      }
      emit('error', {
        error: code,
        message: event && event.message ? String(event.message) : '',
        raw: event
      });
    };

    recognizer.onstart = function () {
      emit('start');
    };

    recognizer.onend = function (event) {
      emit('end', { raw: event });
      if (autoRestart && shouldRestart) {
        try {
          recognizer.start();
        } catch (_err) {
          // restart failed; give up
          shouldRestart = false;
        }
      }
    };

    var api = {
      start: function () {
        shouldRestart = autoRestart;
        try {
          recognizer.start();
        } catch (err) {
          emit('error', { error: 'start-failed', message: String(err || ''), raw: err });
        }
      },
      stop: function () {
        shouldRestart = false;
        try {
          recognizer.stop();
        } catch (err) {
          emit('error', { error: 'stop-failed', message: String(err || ''), raw: err });
        }
      },
      on: function (eventName, handler) {
        if (!listeners[eventName]) return api;
        if (typeof handler === 'function') {
          listeners[eventName].push(handler);
        }
        return api;
      }
    };

    return api;
  }

  function speak(text) {
    return new Promise(function (resolve) {
      try {
        var synth = window.speechSynthesis;
        if (!synth || typeof window.SpeechSynthesisUtterance === 'undefined') {
          return resolve();
        }
        var utterance = new window.SpeechSynthesisUtterance(String(text || ''));
        utterance.onend = function () {
          resolve();
        };
        utterance.onerror = function () {
          resolve();
        };
        synth.speak(utterance);
      } catch (_err) {
        resolve();
      }
    });
  }

  window.NavableSpeech = {
    supportsRecognition: supportsRecognition,
    createRecognizer: createRecognizer,
    speak: speak
  };
})();

