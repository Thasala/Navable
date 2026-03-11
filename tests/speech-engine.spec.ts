import { expect, test } from '@playwright/test';

test('speech engine uses backend transcription when available', async ({ page }) => {
  await page.setContent('<main>Speech test</main>');

  await page.evaluate(() => {
    let analyserReads = 0;

    class FakeAudioContext {
      createMediaStreamSource() {
        return { connect() {}, disconnect() {} };
      }
      createAnalyser() {
        return {
          fftSize: 2048,
          smoothingTimeConstant: 0.1,
          connect() {},
          disconnect() {},
          getByteTimeDomainData(arr: Uint8Array) {
            analyserReads += 1;
            const sample = analyserReads <= 3 ? 160 : 128;
            for (let i = 0; i < arr.length; i += 1) arr[i] = sample;
          }
        };
      }
      resume() {
        return Promise.resolve();
      }
      close() {
        return Promise.resolve();
      }
    }

    class FakeMediaRecorder {
      static isTypeSupported() {
        return true;
      }

      state = 'inactive';
      mimeType = 'audio/webm';
      ondataavailable: ((ev: any) => void) | null = null;
      onstop: (() => void) | null = null;
      onerror: ((ev: any) => void) | null = null;

      start() {
        this.state = 'recording';
      }

      stop() {
        this.state = 'inactive';
        if (this.ondataavailable) {
          this.ondataavailable({ data: new Blob(['voice'], { type: 'audio/webm' }) });
        }
        if (this.onstop) this.onstop();
      }
    }

    // @ts-ignore
    window.__NavableSpeechEnv = {
      fetch: async (url: string) => {
        if (String(url).endsWith('/health')) {
          return new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        }
        return new Response(JSON.stringify({ text: 'ouvre youtube', language: 'fr' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      },
      mediaDevices: {
        getUserMedia() {
          return Promise.resolve({
            getTracks() {
              return [{ stop() {} }];
            }
          });
        }
      },
      AudioContext: FakeAudioContext,
      MediaRecorder: FakeMediaRecorder
    };
  });

  await page.addScriptTag({ path: 'src/common/speech.js' });

  const result = await page.evaluate(async () => {
    // @ts-ignore
    const recognizer = window.NavableSpeech.createRecognizer({
      silenceMs: 20,
      minSpeechMs: 5,
      checkIntervalMs: 10
    });
    return await new Promise((resolve) => {
      recognizer.on('result', (ev: any) => {
        recognizer.stop();
        resolve({ transcript: ev.transcript, language: ev.language, provider: ev.provider });
      });
      recognizer.on('error', (ev: any) => resolve({ error: ev.error, provider: ev.provider }));
      recognizer.start();
    });
  });

  expect(result).toEqual({ transcript: 'ouvre youtube', language: 'fr', provider: 'backend' });
});

test('speech engine still transcribes quiet backend audio', async ({ page }) => {
  await page.setContent('<main>Quiet speech test</main>');

  await page.evaluate(() => {
    class FakeAudioContext {
      createMediaStreamSource() {
        return { connect() {}, disconnect() {} };
      }
      createAnalyser() {
        return {
          fftSize: 2048,
          smoothingTimeConstant: 0.1,
          connect() {},
          disconnect() {},
          getByteTimeDomainData(arr: Uint8Array) {
            for (let i = 0; i < arr.length; i += 1) arr[i] = 129;
          }
        };
      }
      resume() {
        return Promise.resolve();
      }
      close() {
        return Promise.resolve();
      }
    }

    class FakeMediaRecorder {
      static isTypeSupported() {
        return true;
      }

      state = 'inactive';
      mimeType = 'audio/webm';
      ondataavailable: ((ev: any) => void) | null = null;
      onstop: (() => void) | null = null;

      start() {
        this.state = 'recording';
      }

      stop() {
        this.state = 'inactive';
        if (this.ondataavailable) {
          this.ondataavailable({ data: new Blob(['quiet voice'], { type: 'audio/webm' }) });
        }
        if (this.onstop) this.onstop();
      }
    }

    // @ts-ignore
    window.__NavableSpeechEnv = {
      fetch: async (url: string) => {
        if (String(url).endsWith('/health')) {
          return new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        }
        return new Response(JSON.stringify({ text: 'what is the moon', language: 'en' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      },
      mediaDevices: {
        getUserMedia() {
          return Promise.resolve({
            getTracks() {
              return [{ stop() {} }];
            }
          });
        }
      },
      AudioContext: FakeAudioContext,
      MediaRecorder: FakeMediaRecorder
    };
  });

  await page.addScriptTag({ path: 'src/common/speech.js' });

  const result = await page.evaluate(async () => {
    // @ts-ignore
    const recognizer = window.NavableSpeech.createRecognizer({
      forceTranscribeMs: 40,
      maxRecordingMs: 200,
      minSpeechMs: 5,
      checkIntervalMs: 10
    });
    return await new Promise((resolve) => {
      recognizer.on('result', (ev: any) => {
        recognizer.stop();
        resolve({ transcript: ev.transcript, language: ev.language, provider: ev.provider });
      });
      recognizer.on('error', (ev: any) => resolve({ error: ev.error, provider: ev.provider }));
      recognizer.start();
    });
  });

  expect(result).toEqual({ transcript: 'what is the moon', language: 'en', provider: 'backend' });
});

test('speech engine falls back to native recognition when backend is unavailable', async ({ page }) => {
  await page.setContent('<main>Speech fallback test</main>');

  await page.evaluate(() => {
    class FakeRecognition {
      lang = 'en-US';
      interimResults = false;
      continuous = true;
      onresult: ((ev: any) => void) | null = null;
      onerror: ((ev: any) => void) | null = null;
      onstart: (() => void) | null = null;
      onend: (() => void) | null = null;

      start() {
        if (this.onstart) this.onstart();
        setTimeout(() => {
          if (this.onresult) {
            this.onresult({
              resultIndex: 0,
              results: [
                { 0: { transcript: 'open youtube' }, isFinal: true }
              ]
            });
          }
        }, 10);
      }

      stop() {
        if (this.onend) this.onend();
      }
    }

    // @ts-ignore
    window.__NavableSpeechEnv = {
      fetch: async () =>
        new Response(JSON.stringify({ error: 'offline' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' }
        }),
      SpeechRecognition: FakeRecognition
    };
  });

  await page.addScriptTag({ path: 'src/common/speech.js' });

  const result = await page.evaluate(async () => {
    // @ts-ignore
    const recognizer = window.NavableSpeech.createRecognizer({ checkIntervalMs: 10 });
    return await new Promise((resolve) => {
      recognizer.on('result', (ev: any) => {
        recognizer.stop();
        resolve({ transcript: ev.transcript, provider: ev.provider });
      });
      recognizer.on('error', (ev: any) => resolve({ error: ev.error, provider: ev.provider }));
      recognizer.start();
    });
  });

  expect(result).toEqual({ transcript: 'open youtube', provider: 'native' });
});

test('speech engine falls back to native recognition when backend returns no speech', async ({ page }) => {
  await page.setContent('<main>Speech fallback test</main>');

  await page.evaluate(() => {
    let requestCount = 0;
    let analyserReads = 0;

    class FakeAudioContext {
      createMediaStreamSource() {
        return { connect() {}, disconnect() {} };
      }
      createAnalyser() {
        return {
          fftSize: 2048,
          smoothingTimeConstant: 0.1,
          connect() {},
          disconnect() {},
          getByteTimeDomainData(arr: Uint8Array) {
            analyserReads += 1;
            const sample = analyserReads <= 3 ? 160 : 128;
            for (let i = 0; i < arr.length; i += 1) arr[i] = sample;
          }
        };
      }
      resume() {
        return Promise.resolve();
      }
      close() {
        return Promise.resolve();
      }
    }

    class FakeMediaRecorder {
      static isTypeSupported() {
        return true;
      }

      state = 'inactive';
      mimeType = 'audio/webm';
      ondataavailable: ((ev: any) => void) | null = null;
      onstop: (() => void) | null = null;

      start() {
        this.state = 'recording';
      }

      stop() {
        this.state = 'inactive';
        if (this.ondataavailable) {
          this.ondataavailable({ data: new Blob(['voice'], { type: 'audio/webm' }) });
        }
        if (this.onstop) this.onstop();
      }
    }

    class FakeRecognition {
      lang = 'en-US';
      interimResults = false;
      continuous = true;
      onresult: ((ev: any) => void) | null = null;
      onerror: ((ev: any) => void) | null = null;
      onstart: (() => void) | null = null;
      onend: (() => void) | null = null;

      start() {
        if (this.onstart) this.onstart();
        setTimeout(() => {
          if (this.onresult) {
            this.onresult({
              resultIndex: 0,
              results: [
                { 0: { transcript: 'open youtube' }, isFinal: true }
              ]
            });
          }
        }, 10);
      }

      stop() {
        if (this.onend) this.onend();
      }
    }

    // @ts-ignore
    window.__NavableSpeechEnv = {
      fetch: async (url: string) => {
        if (String(url).endsWith('/health')) {
          return new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        }
        requestCount += 1;
        return new Response(JSON.stringify({ text: '', language: '' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      },
      mediaDevices: {
        getUserMedia() {
          return Promise.resolve({
            getTracks() {
              return [{ stop() {} }];
            }
          });
        }
      },
      AudioContext: FakeAudioContext,
      MediaRecorder: FakeMediaRecorder,
      SpeechRecognition: FakeRecognition
    };
  });

  await page.addScriptTag({ path: 'src/common/speech.js' });

  const result = await page.evaluate(async () => {
    // @ts-ignore
    const recognizer = window.NavableSpeech.createRecognizer({
      silenceMs: 20,
      minSpeechMs: 5,
      checkIntervalMs: 10
    });
    return await new Promise((resolve) => {
      recognizer.on('result', (ev: any) => {
        recognizer.stop();
        resolve({ transcript: ev.transcript, provider: ev.provider });
      });
      recognizer.on('error', (ev: any) => resolve({ error: ev.error, provider: ev.provider }));
      recognizer.start();
    });
  });

  expect(result).toEqual({ transcript: 'open youtube', provider: 'native' });
});
