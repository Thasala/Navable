// Hybrid speech layer for Navable:
// - primary: backend multilingual transcription via MediaRecorder + /api/transcribe
// - fallback: browser Web Speech API when backend capture/transcription is unavailable
(function () {
  if (typeof window === 'undefined' || window.NavableSpeech) return;

  var DEFAULT_TRANSCRIBE_URL = 'http://localhost:3000/api/transcribe';
  var DEFAULT_HEALTH_URL = 'http://localhost:3000/health';

  function getSpeechEnv() {
    return window.__NavableSpeechEnv || {};
  }

  function getNativeRecognitionCtor() {
    var env = getSpeechEnv();
    return (
      env.SpeechRecognition ||
      window.SpeechRecognition ||
      window.webkitSpeechRecognition ||
      window.mozSpeechRecognition ||
      window.msSpeechRecognition
    );
  }

  function getAudioContextCtor() {
    var env = getSpeechEnv();
    return env.AudioContext || window.AudioContext || window.webkitAudioContext;
  }

  function getMediaRecorderCtor() {
    var env = getSpeechEnv();
    return env.MediaRecorder || window.MediaRecorder;
  }

  function getMediaDevices() {
    var env = getSpeechEnv();
    return env.mediaDevices || (window.navigator && window.navigator.mediaDevices);
  }

  function getFetchImpl() {
    var env = getSpeechEnv();
    return env.fetch || window.fetch;
  }

  function supportsNativeRecognition() {
    return !!getNativeRecognitionCtor();
  }

  function supportsBackendRecognition() {
    var MediaRecorderCtor = getMediaRecorderCtor();
    var AudioContextCtor = getAudioContextCtor();
    var mediaDevices = getMediaDevices();
    var fetchImpl = getFetchImpl();
    return !!(
      fetchImpl &&
      MediaRecorderCtor &&
      AudioContextCtor &&
      mediaDevices &&
      typeof mediaDevices.getUserMedia === 'function'
    );
  }

  function supportsRecognition() {
    return supportsBackendRecognition() || supportsNativeRecognition();
  }

  function createEmitter(extraEvents) {
    var listeners = {
      result: [],
      error: [],
      start: [],
      end: []
    };

    (extraEvents || []).forEach(function (name) {
      listeners[name] = [];
    });

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

    function on(type, handler) {
      if (!listeners[type] || typeof handler !== 'function') return api;
      listeners[type].push(handler);
      return api;
    }

    var api = {
      emit: emit,
      on: on
    };

    return api;
  }

  function createNativeRecognizer(options) {
    options = options || {};
    var NativeRecognition = getNativeRecognitionCtor();
    if (!NativeRecognition) {
      throw new Error('Speech recognition not supported');
    }

    var emitter = createEmitter();
    var recognizer = new NativeRecognition();
    recognizer.lang = options.lang || 'en-US';
    recognizer.interimResults = !!options.interimResults;
    recognizer.continuous = !!options.continuous;

    var autoRestart = !!options.autoRestart;
    var restartDelayMs = typeof options.restartDelayMs === 'number' ? options.restartDelayMs : 250;
    var shouldRestart = autoRestart;
    var isStarting = false;
    var isStarted = false;
    var restartTimer = null;
    var suppressNextEnd = false;

    function clearRestartTimer() {
      if (!restartTimer) return;
      try {
        clearTimeout(restartTimer);
      } catch (_err) {
        // ignore
      }
      restartTimer = null;
    }

    function emitStartError(err) {
      var name = err && err.name ? String(err.name) : '';
      if (name === 'InvalidStateError') return;
      var code = (name === 'NotAllowedError' || name === 'SecurityError') ? 'not-allowed' : 'start-failed';
      emitter.emit('error', { error: code, message: String(err || ''), raw: err });
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
      if (!isFinal && options.onlyFinal !== false && !options.interimResults) return;
      emitter.emit('result', {
        transcript: transcript,
        isFinal: isFinal,
        raw: event,
        provider: 'native'
      });
    };

    recognizer.onerror = function (event) {
      var code = event && event.error ? String(event.error) : 'unknown';
      if (code === 'not-allowed' || code === 'service-not-allowed' || code === 'network') {
        shouldRestart = false;
      }
      isStarting = false;
      emitter.emit('error', {
        error: code,
        message: event && event.message ? String(event.message) : '',
        raw: event,
        provider: 'native'
      });
    };

    recognizer.onstart = function () {
      clearRestartTimer();
      isStarting = false;
      isStarted = true;
      emitter.emit('start', { provider: 'native' });
    };

    recognizer.onend = function (event) {
      clearRestartTimer();
      isStarting = false;
      isStarted = false;
      if (suppressNextEnd) {
        suppressNextEnd = false;
        return;
      }
      emitter.emit('end', { raw: event, provider: 'native' });
      if (autoRestart && shouldRestart) {
        isStarting = true;
        restartTimer = setTimeout(function () {
          if (!(autoRestart && shouldRestart)) {
            isStarting = false;
            return;
          }
          try {
            recognizer.start();
          } catch (_err) {
            isStarting = false;
            shouldRestart = false;
          }
        }, Math.max(0, restartDelayMs));
      }
    };

    return {
      start: function () {
        shouldRestart = autoRestart;
        if (isStarted || isStarting) return;
        clearRestartTimer();
        isStarting = true;
        try {
          recognizer.start();
        } catch (err) {
          isStarting = false;
          emitStartError(err);
        }
      },
      stop: function (opts) {
        opts = opts || {};
        shouldRestart = false;
        clearRestartTimer();
        isStarting = false;
        suppressNextEnd = !!opts.silent;
        try {
          recognizer.stop();
        } catch (err) {
          emitter.emit('error', { error: 'stop-failed', message: String(err || ''), raw: err, provider: 'native' });
        }
      },
      on: emitter.on
    };
  }

  function pickRecorderMimeType() {
    var MediaRecorderCtor = getMediaRecorderCtor();
    if (!MediaRecorderCtor || typeof MediaRecorderCtor.isTypeSupported !== 'function') {
      return '';
    }
    var candidates = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/ogg;codecs=opus',
      'audio/mp4'
    ];
    for (var i = 0; i < candidates.length; i++) {
      if (MediaRecorderCtor.isTypeSupported(candidates[i])) return candidates[i];
    }
    return '';
  }

  function blobToBase64(blob) {
    return new Promise(function (resolve, reject) {
      try {
        var reader = new window.FileReader();
        reader.onloadend = function () {
          var result = String(reader.result || '');
          var commaIndex = result.indexOf(',');
          resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result);
        };
        reader.onerror = function () {
          reject(reader.error || new Error('Failed to read audio blob'));
        };
        reader.readAsDataURL(blob);
      } catch (err) {
        reject(err);
      }
    });
  }

  function fetchWithTimeout(url, init, timeoutMs) {
    return new Promise(function (resolve, reject) {
      var done = false;
      var timer = setTimeout(function () {
        if (done) return;
        done = true;
        reject(new Error('Timed out'));
      }, Math.max(0, timeoutMs || 0));

      getFetchImpl()(url, init).then(function (response) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(response);
      }).catch(function (err) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  function createBackendRecognizer(options) {
    options = options || {};
    var emitter = createEmitter(['unavailable']);
    var transcribeUrl = options.transcribeUrl || DEFAULT_TRANSCRIBE_URL;
    var healthUrl = options.healthUrl || DEFAULT_HEALTH_URL;
    var levelThreshold = typeof options.levelThreshold === 'number' ? options.levelThreshold : 0.012;
    var silenceMs = typeof options.silenceMs === 'number' ? options.silenceMs : 900;
    var minSpeechMs = typeof options.minSpeechMs === 'number' ? options.minSpeechMs : 250;
    var maxRecordingMs = typeof options.maxRecordingMs === 'number' ? options.maxRecordingMs : 12000;
    var checkIntervalMs = typeof options.checkIntervalMs === 'number' ? options.checkIntervalMs : 60;
    var forceTranscribeMs = typeof options.forceTranscribeMs === 'number' ? options.forceTranscribeMs : 2200;
    var AudioContextCtor = getAudioContextCtor();
    var MediaRecorderCtor = getMediaRecorderCtor();

    var mediaStream = null;
    var audioContext = null;
    var sourceNode = null;
    var analyserNode = null;
    var levelData = null;
    var monitorTimer = null;
    var recorder = null;
    var recordedChunks = [];
    var started = false;
    var starting = false;
    var shouldRun = false;
    var healthChecked = false;
    var healthAvailable = false;
    var recordingStartedAt = 0;
    var lastSpeechAt = 0;
    var sawSpeech = false;
    var pendingTranscription = false;
    var discardPendingBlob = false;
    var suppressEnd = false;

    function cleanupNodes() {
      if (monitorTimer) {
        try {
          clearInterval(monitorTimer);
        } catch (_err) {
          // ignore
        }
        monitorTimer = null;
      }
      try {
        if (sourceNode) sourceNode.disconnect();
      } catch (_err2) {
        // ignore
      }
      try {
        if (analyserNode) analyserNode.disconnect();
      } catch (_err3) {
        // ignore
      }
      sourceNode = null;
      analyserNode = null;
      levelData = null;

      if (audioContext) {
        try {
          audioContext.close();
        } catch (_err4) {
          // ignore
        }
      }
      audioContext = null;

      if (mediaStream) {
        try {
          mediaStream.getTracks().forEach(function (track) {
            try {
              track.stop();
            } catch (_err5) {
              // ignore
            }
          });
        } catch (_err6) {
          // ignore
        }
      }
      mediaStream = null;
    }

    function finalizeStop() {
      cleanupNodes();
      started = false;
      starting = false;
      recorder = null;
      recordedChunks = [];
      recordingStartedAt = 0;
      lastSpeechAt = 0;
      sawSpeech = false;
      discardPendingBlob = false;
      pendingTranscription = false;
      if (suppressEnd) {
        suppressEnd = false;
        return;
      }
      emitter.emit('end', { provider: 'backend' });
    }

    function emitUnavailable(message, errorCode) {
      emitter.emit('unavailable', {
        error: errorCode || 'backend-unavailable',
        message: String(message || ''),
        provider: 'backend'
      });
    }

    async function probeBackend() {
      if (healthChecked) return healthAvailable;
      healthChecked = true;
      try {
        var response = await fetchWithTimeout(healthUrl, { method: 'GET' }, 1500);
        healthAvailable = !!(response && response.ok);
      } catch (_err) {
        healthAvailable = false;
      }
      return healthAvailable;
    }

    function getAudioLevel() {
      if (!analyserNode || !levelData) return 0;
      analyserNode.getByteTimeDomainData(levelData);
      var sum = 0;
      for (var i = 0; i < levelData.length; i++) {
        var centered = (levelData[i] - 128) / 128;
        sum += centered * centered;
      }
      return Math.sqrt(sum / levelData.length);
    }

    function resetRecordingState() {
      recorder = null;
      recordedChunks = [];
      recordingStartedAt = 0;
      lastSpeechAt = 0;
      sawSpeech = false;
      discardPendingBlob = false;
    }

    async function transcribeBlob(blob) {
      pendingTranscription = true;
      try {
        var audioBase64 = await blobToBase64(blob);
        var response = await getFetchImpl()(transcribeUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            audioBase64: audioBase64,
            mimeType: blob.type || 'audio/webm'
          })
        });
        if (!response.ok) {
          throw new Error('Transcription failed with status ' + response.status);
        }
        var payload = await response.json();
        var transcript = payload && payload.text ? String(payload.text).trim() : '';
        if (!transcript) {
          emitter.emit('error', { error: 'no-speech', message: '', provider: 'backend', raw: payload });
          return;
        }
        emitter.emit('result', {
          transcript: transcript,
          isFinal: true,
          language: payload && payload.language ? String(payload.language) : '',
          raw: payload,
          provider: 'backend'
        });
      } catch (err) {
        emitUnavailable(err && err.message ? err.message : 'Backend transcription unavailable', 'network');
      } finally {
        pendingTranscription = false;
      }
    }

    function stopRecorder() {
      if (!recorder || recorder.state === 'inactive') return;
      try {
        recorder.stop();
      } catch (err) {
        emitter.emit('error', { error: 'stop-failed', message: String(err || ''), raw: err, provider: 'backend' });
      }
    }

    function startRecorder() {
      if (!mediaStream || recorder || pendingTranscription) return;

      recordedChunks = [];
      discardPendingBlob = false;

      var recorderOptions = {};
      var mimeType = pickRecorderMimeType();
      if (mimeType) recorderOptions.mimeType = mimeType;

      try {
        recorder = new MediaRecorderCtor(mediaStream, recorderOptions);
      } catch (err) {
        emitter.emit('error', { error: 'start-failed', message: String(err || ''), raw: err, provider: 'backend' });
        return;
      }

      recordingStartedAt = Date.now();
      lastSpeechAt = recordingStartedAt;
      sawSpeech = false;

      recorder.ondataavailable = function (event) {
        if (event && event.data && event.data.size > 0) {
          recordedChunks.push(event.data);
        }
      };

      recorder.onerror = function (event) {
        emitter.emit('error', {
          error: 'audio-capture',
          message: event && event.error ? String(event.error.message || event.error.name || '') : '',
          raw: event,
          provider: 'backend'
        });
      };

      recorder.onstop = function () {
        var shouldDiscard = discardPendingBlob || !shouldRun;
        var blob = new window.Blob(recordedChunks, { type: recorder && recorder.mimeType ? recorder.mimeType : mimeType || 'audio/webm' });
        resetRecordingState();
        if (shouldDiscard || blob.size === 0) {
          if (shouldRun && started && !pendingTranscription && !recorder) {
            startRecorder();
            return;
          }
          if (!shouldRun && !pendingTranscription) finalizeStop();
          return;
        }
        transcribeBlob(blob).finally(function () {
          if (shouldRun && started && !recorder) {
            startRecorder();
            return;
          }
          if (!shouldRun && !recorder) finalizeStop();
        });
      };

      try {
        recorder.start(100);
      } catch (err2) {
        recorder = null;
        emitter.emit('error', { error: 'start-failed', message: String(err2 || ''), raw: err2, provider: 'backend' });
      }
    }

    function monitorAudio() {
      if (!shouldRun || !started || pendingTranscription) return;
      if (!recorder) {
        startRecorder();
        return;
      }
      var level = getAudioLevel();
      var now = Date.now();

      if (level >= levelThreshold) {
        lastSpeechAt = now;
        sawSpeech = true;
        return;
      }

      if (!sawSpeech && now - recordingStartedAt >= forceTranscribeMs) {
        stopRecorder();
        return;
      }

      if (now - recordingStartedAt >= maxRecordingMs) {
        stopRecorder();
        return;
      }

      if (sawSpeech && now - lastSpeechAt >= silenceMs && now - recordingStartedAt >= minSpeechMs) {
        stopRecorder();
      }
    }

    function mapCaptureError(err) {
      var name = err && err.name ? String(err.name) : '';
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        return { error: 'not-allowed', message: String(err && err.message ? err.message : '') };
      }
      if (name === 'NotFoundError' || name === 'NotReadableError' || name === 'AbortError') {
        return { error: 'audio-capture', message: String(err && err.message ? err.message : '') };
      }
      return { error: 'start-failed', message: String(err && err.message ? err.message : '') };
    }

    return {
      start: function () {
        if (started || starting) return;
        shouldRun = true;
        starting = true;

        probeBackend().then(function (available) {
          if (!available) {
            shouldRun = false;
            starting = false;
            emitUnavailable('Backend transcription unavailable');
            return;
          }

          return getMediaDevices().getUserMedia({ audio: true }).then(function (stream) {
            if (!shouldRun) {
              try {
                stream.getTracks().forEach(function (track) { track.stop(); });
              } catch (_err) {
                // ignore
              }
              starting = false;
              return;
            }

            mediaStream = stream;
            audioContext = new AudioContextCtor();
            return Promise.resolve(audioContext.resume && audioContext.resume()).catch(function () {
              return undefined;
            }).then(function () {
              sourceNode = audioContext.createMediaStreamSource(mediaStream);
              analyserNode = audioContext.createAnalyser();
              analyserNode.fftSize = 2048;
              analyserNode.smoothingTimeConstant = 0.1;
              levelData = new Uint8Array(analyserNode.fftSize);
              sourceNode.connect(analyserNode);
              started = true;
              starting = false;
              startRecorder();
              emitter.emit('start', { provider: 'backend' });
              monitorTimer = setInterval(monitorAudio, Math.max(40, checkIntervalMs));
            });
          });
        }).catch(function (err) {
          shouldRun = false;
          starting = false;
          var mapped = mapCaptureError(err);
          emitter.emit('error', {
            error: mapped.error,
            message: mapped.message,
            raw: err,
            provider: 'backend'
          });
        });
      },
      stop: function (opts) {
        opts = opts || {};
        shouldRun = false;
        suppressEnd = !!opts.silent;
        discardPendingBlob = true;
        if (recorder && recorder.state !== 'inactive') {
          stopRecorder();
          return;
        }
        finalizeStop();
      },
      on: emitter.on
    };
  }

  function createRecognizer(options) {
    options = options || {};
    var emitter = createEmitter();
    var nativeRecognizer = supportsNativeRecognition() ? createNativeRecognizer(options) : null;
    var backendRecognizer = supportsBackendRecognition() && options.preferBackend !== false
      ? createBackendRecognizer(options)
      : null;
    var activeRecognizer = null;
    var desiredRunning = false;
    var backendDisabled = !backendRecognizer;
    var suppressBackendEnd = false;

    function switchToNativeFromBackend() {
      if (!nativeRecognizer) return false;
      backendDisabled = true;
      suppressBackendEnd = true;
      if (activeRecognizer === backendRecognizer) {
        backendRecognizer.stop({ silent: true });
      }
      activeRecognizer = nativeRecognizer;
      nativeRecognizer.start();
      return true;
    }

    function forward(recognizer, type) {
      if (!recognizer) return;
      recognizer.on(type, function (payload) {
        if (recognizer === backendRecognizer && type === 'error') {
          var code = payload && payload.error ? String(payload.error) : '';
          if (code === 'no-speech') {
            if (desiredRunning && switchToNativeFromBackend()) {
              return;
            }
          }
        }
        if (type === 'start' || type === 'end') {
          if (recognizer !== activeRecognizer) return;
          if (type === 'end' && suppressBackendEnd && recognizer === backendRecognizer) {
            suppressBackendEnd = false;
            return;
          }
        }
        emitter.emit(type, payload);
      });
    }

    forward(nativeRecognizer, 'result');
    forward(nativeRecognizer, 'error');
    forward(nativeRecognizer, 'start');
    forward(nativeRecognizer, 'end');
    forward(backendRecognizer, 'result');
    forward(backendRecognizer, 'error');
    forward(backendRecognizer, 'start');
    forward(backendRecognizer, 'end');

    if (backendRecognizer) {
      backendRecognizer.on('unavailable', function (payload) {
        backendDisabled = true;
        if (desiredRunning && switchToNativeFromBackend()) {
          return;
        }
        emitter.emit('error', payload);
      });
    }

    return {
      start: function () {
        desiredRunning = true;
        if (!backendDisabled && backendRecognizer) {
          activeRecognizer = backendRecognizer;
          backendRecognizer.start();
          return;
        }
        if (nativeRecognizer) {
          activeRecognizer = nativeRecognizer;
          nativeRecognizer.start();
          return;
        }
        throw new Error('Speech recognition not supported');
      },
      stop: function (opts) {
        desiredRunning = false;
        if (!activeRecognizer) return;
        activeRecognizer.stop(opts || {});
        activeRecognizer = null;
      },
      on: emitter.on
    };
  }

  function speak(text, opts) {
    return new Promise(function (resolve) {
      try {
        var synth = window.speechSynthesis;
        if (!synth || typeof window.SpeechSynthesisUtterance === 'undefined') {
          return resolve();
        }
        var utterance = new window.SpeechSynthesisUtterance(String(text || ''));
        var lang = opts && opts.lang ? String(opts.lang).trim() : '';
        if (lang) utterance.lang = lang;
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
    supportsBackendRecognition: supportsBackendRecognition,
    supportsNativeRecognition: supportsNativeRecognition,
    createRecognizer: createRecognizer,
    speak: speak
  };
})();
