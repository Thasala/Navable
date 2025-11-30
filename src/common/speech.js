(function(){
  function speak(text, opts){
    try {
      if (!('speechSynthesis' in window)) return Promise.resolve(false);
      const utter = new window.SpeechSynthesisUtterance(String(text || ''));
      if (opts && opts.lang) utter.lang = opts.lang;
      if (opts && typeof opts.rate === 'number') utter.rate = opts.rate;
      if (opts && typeof opts.pitch === 'number') utter.pitch = opts.pitch;
      if (opts && typeof opts.volume === 'number') utter.volume = opts.volume;
      return new Promise((resolve) => {
        utter.onend = () => resolve(true);
        utter.onerror = () => resolve(false);
        window.speechSynthesis.cancel(); // keep it snappy for prototype
        window.speechSynthesis.speak(utter);
      });
    } catch (_) {
      return Promise.resolve(false);
    }
  }

  function supportsRecognition(){
    return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  }

  function createRecognizer(options){
    options = options || {};
    const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Rec) {
      const noop = () => {};
      return {
        start: noop,
        stop: noop,
        abort: noop,
        isListening: () => false,
        on: noop,
        off: noop
      };
    }

    const rec = new Rec();
    rec.lang = options.lang || 'en-US';
    rec.interimResults = !!options.interimResults;
    rec.continuous = options.continuous !== false; // default true

    let listening = false;
    const handlers = new Map(); // event -> Set

    function emit(evt, payload){
      const set = handlers.get(evt);
      if (!set) return;
      set.forEach((fn) => { try { fn(payload); } catch(_err){ /* listener error swallowed */ } });
    }

    rec.onstart = () => { listening = true; emit('start'); };
    rec.onend = () => { listening = false; emit('end'); if (rec.continuous && options.autoRestart !== false) safeStart(); };
    rec.onerror = (e) => emit('error', e);
    rec.onresult = (e) => {
      let transcript = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        transcript += e.results[i][0].transcript;
      }
      emit('result', { raw: e, transcript: transcript.trim(), isFinal: e.results[e.results.length-1].isFinal });
    };

    function safeStart(){ try { rec.start(); } catch(_err){ /* start failed */ } }

    return {
      start: () => safeStart(),
      stop: () => { try { rec.stop(); } catch(_err){ /* stop failed */ } },
      abort: () => { try { rec.abort(); } catch(_err){ /* abort failed */ } },
      isListening: () => listening,
      on: (evt, fn) => { const set = handlers.get(evt) || new Set(); set.add(fn); handlers.set(evt, set); },
      off: (evt, fn) => { const set = handlers.get(evt); if (set) set.delete(fn); }
    };
  }

  window.NavableSpeech = { speak, supportsRecognition, createRecognizer };
})();
