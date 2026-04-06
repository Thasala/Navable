import { expect, test } from '@playwright/test';

test('summary output stays visible without stopping an active recognizer', async ({ page }) => {
  await page.setContent(`
    <main>
      <h1>Docs</h1>
      <p>Welcome to the docs.</p>
      <h2>Getting Started</h2>
    </main>
  `);

  await page.evaluate(() => {
    const stats = { start: 0, stop: 0, langs: [] as string[] };

    function createFakeRecognizer() {
      const listeners: Record<string, Array<(payload?: unknown) => void>> = {
        result: [],
        error: [],
        start: [],
        end: []
      };

      return {
        start() {
          stats.start += 1;
          listeners.start.forEach((fn) => fn({ provider: 'native' }));
        },
        stop() {
          stats.stop += 1;
          listeners.end.forEach((fn) => fn({ provider: 'native' }));
        },
        on(type: string, handler: (payload?: unknown) => void) {
          if (!listeners[type]) listeners[type] = [];
          listeners[type].push(handler);
          return this;
        }
      };
    }

    // @ts-ignore
    window.__speechStats = stats;
    // @ts-ignore
    window.NavableSpeech = {
      supportsRecognition: () => true,
      createRecognizer: ({ lang }: { lang: string }) => {
        stats.langs.push(String(lang || ''));
        return createFakeRecognizer();
      }
    };

    window.fetch = async (url, init) => {
      if (!String(url).includes('/api/assistant')) {
        throw new Error(`Unexpected fetch: ${String(url)}`);
      }

      const body = JSON.parse(String(init?.body || '{}'));
      if (body.input !== 'Summarize this page') {
        throw new Error(`Unexpected input: ${String(body.input || '')}`);
      }
      if (body.purpose !== 'summary') {
        throw new Error(`Unexpected purpose: ${String(body.purpose || '')}`);
      }

      return {
        ok: true,
        async json() {
          return {
            mode: 'page',
            speech: 'This page is documentation with a Getting Started section.',
            summary: 'This page is documentation with a Getting Started section.',
            answer: '',
            suggestions: ['Try: read the title.'],
            plan: { steps: [] }
          };
        }
      };
    };
  });

  await page.addScriptTag({ path: 'src/background.js' });

  await page.evaluate(() => {
    // @ts-ignore
    window.chrome.storage.sync.get = (_defaults: unknown, cb: (res: unknown) => void) => {
      cb({
        navable_settings: {
          aiEnabled: true,
          aiMode: 'summary',
          language: 'en-US',
          autostart: true
        }
      });
    };
  });

  await page.addScriptTag({ path: 'src/common/announce.js' });
  await page.addScriptTag({ path: 'src/common/i18n.js' });
  await page.addScriptTag({ path: 'src/content.js' });

  await page.waitForFunction(() => (window as any).__speechStats?.start === 1);

  await page.evaluate(async () => {
    // @ts-ignore
    await (window as any).runPlanner('Summarize this page', 'en', false);
  });

  await expect(page.locator('#navable-output-text')).toHaveValue(/documentation/);

  const stats = await page.evaluate(() => {
    // @ts-ignore
    return window.__speechStats;
  });

  expect(stats.stop).toBe(0);
  expect(stats.langs).toEqual(['en-US']);
});

test('content pauses listening during a spoken turn and resumes automatically after handling', async ({ page }) => {
  await page.setContent(`
    <main>
      <h1>Voice</h1>
      <p>Testing turn pause.</p>
    </main>
  `);

  await page.evaluate(() => {
    const stats = { start: 0, stop: 0, langs: [] as string[] };
    let resolveAssistant: ((value: any) => void) | null = null;

    function createFakeRecognizer() {
      const listeners: Record<string, Array<(payload?: unknown) => void>> = {
        result: [],
        error: [],
        start: [],
        end: []
      };

      return {
        start() {
          stats.start += 1;
          listeners.start.forEach((fn) => fn({ provider: 'native' }));
        },
        stop() {
          stats.stop += 1;
          listeners.end.forEach((fn) => fn({ provider: 'native' }));
        },
        on(type: string, handler: (payload?: unknown) => void) {
          if (!listeners[type]) listeners[type] = [];
          listeners[type].push(handler);
          return this;
        }
      };
    }

    // @ts-ignore
    window.__speechStats = stats;
    // @ts-ignore
    window.__resolveAssistant = () => {
      if (resolveAssistant) {
        resolveAssistant({
          ok: true,
          speech: "The moon is Earth's natural satellite.",
          plan: { steps: [] }
        });
      }
    };
    // @ts-ignore
    window.NavableSpeech = {
      supportsRecognition: () => true,
      createRecognizer: ({ lang }: { lang: string }) => {
        stats.langs.push(String(lang || ''));
        return createFakeRecognizer();
      }
    };
    // @ts-ignore
    window.chrome = {
      runtime: {
        sendMessage: (payload: any) => {
          if (payload.type === 'planner:run') {
            return Promise.resolve({ ok: false, unhandled: true, plan: { steps: [] } });
          }
          if (payload.type === 'navable:assistant') {
            return new Promise((resolve) => {
              resolveAssistant = resolve;
            });
          }
          return Promise.resolve({ ok: false });
        },
        onMessage: {
          addListener() {}
        }
      },
      storage: {
        sync: {
          get(_defaults: any, cb: (res: any) => void) {
            cb({ navable_settings: { language: 'en-US', autostart: true, overlay: false } });
          }
        },
        onChanged: {
          addListener() {}
        }
      }
    };
  });

  await page.addScriptTag({ path: 'src/common/announce.js' });
  await page.addScriptTag({ path: 'src/common/i18n.js' });
  await page.addScriptTag({ path: 'src/content.js' });

  await page.waitForFunction(() => (window as any).__speechStats?.start === 1);

  await page.evaluate(() => {
    // @ts-ignore
    window.__turnPromise = (window as any).NavableTools.handleTranscript('What is the moon?', 'en', 'native');
  });

  await page.waitForFunction(() => {
    // @ts-ignore
    return (window.__speechStats?.stop || 0) >= 1;
  });

  await page.evaluate(() => {
    // @ts-ignore
    window.__resolveAssistant();
  });

  await page.evaluate(async () => {
    // @ts-ignore
    await window.__turnPromise;
  });

  await page.waitForFunction(() => {
    // @ts-ignore
    return (window.__speechStats?.start || 0) >= 2;
  });

  const stats = await page.evaluate(() => {
    // @ts-ignore
    return window.__speechStats;
  });

  expect(stats.stop).toBeGreaterThanOrEqual(1);
  expect(stats.start).toBeGreaterThanOrEqual(2);
});

test('content resumes listening after a spoken turn even when the page loses focus', async ({ page }) => {
  await page.setContent(`
    <main>
      <h1>Voice</h1>
      <p>Testing focus loss.</p>
    </main>
  `);

  await page.evaluate(() => {
    const stats = { start: 0, stop: 0, langs: [] as string[] };
    let resolveAssistant: ((value: any) => void) | null = null;
    const focusState = { hasFocus: true };

    function createFakeRecognizer() {
      const listeners: Record<string, Array<(payload?: unknown) => void>> = {
        result: [],
        error: [],
        start: [],
        end: []
      };

      return {
        start() {
          stats.start += 1;
          listeners.start.forEach((fn) => fn({ provider: 'native' }));
        },
        stop() {
          stats.stop += 1;
          listeners.end.forEach((fn) => fn({ provider: 'native' }));
        },
        on(type: string, handler: (payload?: unknown) => void) {
          if (!listeners[type]) listeners[type] = [];
          listeners[type].push(handler);
          return this;
        }
      };
    }

    Object.defineProperty(document, 'hasFocus', {
      configurable: true,
      value: () => focusState.hasFocus
    });
    // @ts-ignore
    window.__focusState = focusState;
    // @ts-ignore
    window.__speechStats = stats;
    // @ts-ignore
    window.__resolveAssistant = () => {
      if (resolveAssistant) {
        resolveAssistant({
          ok: true,
          speech: "The moon is Earth's natural satellite.",
          plan: { steps: [] }
        });
      }
    };
    // @ts-ignore
    window.NavableSpeech = {
      supportsRecognition: () => true,
      createRecognizer: ({ lang }: { lang: string }) => {
        stats.langs.push(String(lang || ''));
        return createFakeRecognizer();
      }
    };
    // @ts-ignore
    window.chrome = {
      runtime: {
        sendMessage: (payload: any) => {
          if (payload.type === 'planner:run') {
            return Promise.resolve({ ok: false, unhandled: true, plan: { steps: [] } });
          }
          if (payload.type === 'navable:assistant') {
            return new Promise((resolve) => {
              resolveAssistant = resolve;
            });
          }
          return Promise.resolve({ ok: false });
        },
        onMessage: {
          addListener() {}
        }
      },
      storage: {
        sync: {
          get(_defaults: any, cb: (res: any) => void) {
            cb({ navable_settings: { language: 'en-US', autostart: true, overlay: false } });
          }
        },
        onChanged: {
          addListener() {}
        }
      }
    };
  });

  await page.addScriptTag({ path: 'src/common/announce.js' });
  await page.addScriptTag({ path: 'src/common/i18n.js' });
  await page.addScriptTag({ path: 'src/content.js' });

  await page.waitForFunction(() => (window as any).__speechStats?.start === 1);

  await page.evaluate(() => {
    // @ts-ignore
    window.__turnPromise = (window as any).NavableTools.handleTranscript('What is the moon?', 'en', 'native');
  });

  await page.waitForFunction(() => {
    // @ts-ignore
    return (window.__speechStats?.stop || 0) >= 1;
  });

  await page.evaluate(() => {
    // @ts-ignore
    window.__focusState.hasFocus = false;
    window.dispatchEvent(new Event('blur'));
  });

  await page.evaluate(() => {
    // @ts-ignore
    window.__resolveAssistant();
  });

  await page.evaluate(async () => {
    // @ts-ignore
    await window.__turnPromise;
  });

  await page.waitForFunction(() => {
    // @ts-ignore
    return (window.__speechStats?.start || 0) >= 2;
  });

  const stats = await page.evaluate(() => {
    // @ts-ignore
    return window.__speechStats;
  });

  expect(stats.stop).toBeGreaterThanOrEqual(1);
  expect(stats.start).toBeGreaterThanOrEqual(2);
});

test('native recognizer rebuilds when speech switches languages', async ({ page }) => {
  await page.setContent(`
    <main>
      <h1>Voice</h1>
      <p>Testing language switching.</p>
    </main>
  `);

  await page.evaluate(() => {
    const stats = { start: 0, stop: 0, langs: [] as string[] };

    function createFakeRecognizer() {
      const listeners: Record<string, Array<(payload?: unknown) => void>> = {
        result: [],
        error: [],
        start: [],
        end: []
      };

      return {
        start() {
          stats.start += 1;
          listeners.start.forEach((fn) => fn({ provider: 'native' }));
        },
        stop() {
          stats.stop += 1;
          listeners.end.forEach((fn) => fn({ provider: 'native' }));
        },
        on(type: string, handler: (payload?: unknown) => void) {
          if (!listeners[type]) listeners[type] = [];
          listeners[type].push(handler);
          return this;
        }
      };
    }

    // @ts-ignore
    window.__speechStats = stats;
    // @ts-ignore
    window.NavableSpeech = {
      supportsRecognition: () => true,
      createRecognizer: ({ lang }: { lang: string }) => {
        stats.langs.push(String(lang || ''));
        return createFakeRecognizer();
      }
    };

    window.fetch = async (url, init) => {
      if (!String(url).includes('/api/assistant')) {
        throw new Error(`Unexpected fetch: ${String(url)}`);
      }

      const body = JSON.parse(String(init?.body || '{}'));
      if (body.input !== 'Bonjour') {
        throw new Error(`Unexpected input: ${String(body.input || '')}`);
      }

      return {
        ok: true,
        async json() {
          return {
            mode: 'answer',
            speech: 'Bonjour.',
            summary: '',
            answer: 'Bonjour.',
            suggestions: [],
            plan: { steps: [] }
          };
        }
      };
    };
  });

  await page.addScriptTag({ path: 'src/background.js' });

  await page.evaluate(() => {
    // @ts-ignore
    window.chrome.storage.sync.get = (_defaults: unknown, cb: (res: unknown) => void) => {
      cb({
        navable_settings: {
          aiEnabled: true,
          aiMode: 'summary',
          language: 'en-US',
          autostart: true
        }
      });
    };
  });

  await page.addScriptTag({ path: 'src/common/announce.js' });
  await page.addScriptTag({ path: 'src/common/i18n.js' });
  await page.addScriptTag({ path: 'src/content.js' });

  await page.waitForFunction(() => (window as any).__speechStats?.langs?.length === 1);

  await page.evaluate(async () => {
    // @ts-ignore
    await (window as any).NavableTools.handleTranscript('Bonjour', '', 'native');
  });

  await page.waitForFunction(() => {
    // @ts-ignore
    return (window.__speechStats?.langs || []).includes('fr-FR');
  });

  const stats = await page.evaluate(() => {
    // @ts-ignore
    return window.__speechStats;
  });

  expect(stats.langs[0]).toBe('en-US');
  expect(stats.langs[1]).toBe('fr-FR');
  expect(stats.stop).toBeGreaterThanOrEqual(1);
  expect(stats.start).toBeGreaterThanOrEqual(2);
});

test('native fallback rotates to Arabic after recent English recognition gets no speech', async ({ page }) => {
  await page.setContent(`
    <main>
      <h1>Voice</h1>
      <p>Testing native locale rotation.</p>
    </main>
  `);

  await page.evaluate(() => {
    const stats = { start: 0, stop: 0, langs: [] as string[] };
    const recognizers: Array<{
      start: () => void;
      stop: () => void;
      on: (type: string, handler: (payload?: unknown) => void) => unknown;
      emit: (type: string, payload?: unknown) => void;
    }> = [];

    function createFakeRecognizer() {
      const listeners: Record<string, Array<(payload?: unknown) => void>> = {
        result: [],
        error: [],
        start: [],
        end: []
      };

      return {
        start() {
          stats.start += 1;
          listeners.start.forEach((fn) => fn({ provider: 'native' }));
        },
        stop() {
          stats.stop += 1;
          listeners.end.forEach((fn) => fn({ provider: 'native' }));
        },
        on(type: string, handler: (payload?: unknown) => void) {
          if (!listeners[type]) listeners[type] = [];
          listeners[type].push(handler);
          return this;
        },
        emit(type: string, payload?: unknown) {
          (listeners[type] || []).forEach((fn) => fn(payload));
        }
      };
    }

    // @ts-ignore
    window.__speechStats = stats;
    // @ts-ignore
    window.__recognizers = recognizers;
    // @ts-ignore
    window.NavableSpeech = {
      supportsRecognition: () => true,
      createRecognizer: ({ lang }: { lang: string }) => {
        stats.langs.push(String(lang || ''));
        const recognizer = createFakeRecognizer();
        recognizers.push(recognizer);
        return recognizer;
      }
    };

    window.fetch = async (url, init) => {
      if (!String(url).includes('/api/assistant')) {
        throw new Error(`Unexpected fetch: ${String(url)}`);
      }

      const body = JSON.parse(String(init?.body || '{}'));
      return {
        ok: true,
        async json() {
          if (body.input === 'What is the moon?') {
            return {
              mode: 'answer',
              speech: "The moon is Earth's natural satellite.",
              summary: '',
              answer: "The moon is Earth's natural satellite.",
              suggestions: [],
              plan: { steps: [] }
            };
          }
          if (body.input === 'ما هو القمر؟') {
            return {
              mode: 'answer',
              speech: 'القمر هو القمر الطبيعي للأرض.',
              summary: '',
              answer: 'القمر هو القمر الطبيعي للأرض.',
              suggestions: [],
              plan: { steps: [] }
            };
          }
          throw new Error(`Unexpected input: ${String(body.input || '')}`);
        }
      };
    };
  });

  await page.addScriptTag({ path: 'src/background.js' });

  await page.evaluate(() => {
    // @ts-ignore
    window.chrome.storage.sync.get = (_defaults: unknown, cb: (res: unknown) => void) => {
      cb({
        navable_settings: {
          aiEnabled: true,
          aiMode: 'summary',
          language: 'en-US',
          autostart: true
        }
      });
    };
  });

  await page.addScriptTag({ path: 'src/common/announce.js' });
  await page.addScriptTag({ path: 'src/common/i18n.js' });
  await page.addScriptTag({ path: 'src/content.js' });

  await page.waitForFunction(() => (window as any).__recognizers?.length === 1);

  await page.evaluate(async () => {
    // @ts-ignore
    await (window as any).NavableTools.handleTranscript('What is the moon?', 'en', 'native');
  });

  await page.evaluate(() => {
    // @ts-ignore
    window.__recognizers[0].emit('error', { error: 'no-speech', provider: 'native' });
  });

  await page.waitForFunction(() => {
    // @ts-ignore
    return (window.__speechStats?.langs || []).includes('ar-SA');
  });

  await page.evaluate(async () => {
    // @ts-ignore
    await (window as any).NavableTools.handleTranscript('ما هو القمر؟', 'ar', 'native');
  });

  await expect(page.locator('#navable-live-region-assertive')).toContainText('القمر');

  const stats = await page.evaluate(() => {
    // @ts-ignore
    return window.__speechStats;
  });

  expect(stats.langs[0]).toBe('en-US');
  expect(stats.langs).toContain('ar-SA');
  expect(stats.stop).toBeGreaterThanOrEqual(1);
});

test('locked English mode keeps recognizer and output language in English', async ({ page }) => {
  await page.setContent(`
    <main>
      <h1>Voice</h1>
      <p>Testing locked English mode.</p>
    </main>
  `);

  await page.evaluate(() => {
    const stats = { start: 0, stop: 0, langs: [] as string[] };
    const recognizers: Array<{
      start: () => void;
      stop: () => void;
      on: (type: string, handler: (payload?: unknown) => void) => unknown;
      emit: (type: string, payload?: unknown) => void;
    }> = [];

    function createFakeRecognizer() {
      const listeners: Record<string, Array<(payload?: unknown) => void>> = {
        result: [],
        error: [],
        start: [],
        end: []
      };

      return {
        start() {
          stats.start += 1;
          listeners.start.forEach((fn) => fn({ provider: 'native' }));
        },
        stop() {
          stats.stop += 1;
          listeners.end.forEach((fn) => fn({ provider: 'native' }));
        },
        on(type: string, handler: (payload?: unknown) => void) {
          if (!listeners[type]) listeners[type] = [];
          listeners[type].push(handler);
          return this;
        },
        emit(type: string, payload?: unknown) {
          (listeners[type] || []).forEach((fn) => fn(payload));
        }
      };
    }

    // @ts-ignore
    window.__speechStats = stats;
    // @ts-ignore
    window.__recognizers = recognizers;
    // @ts-ignore
    window.NavableSpeech = {
      supportsRecognition: () => true,
      createRecognizer: ({ lang }: { lang: string }) => {
        stats.langs.push(String(lang || ''));
        const recognizer = createFakeRecognizer();
        recognizers.push(recognizer);
        return recognizer;
      }
    };

    window.fetch = async (url, init) => {
      if (!String(url).includes('/api/assistant')) {
        throw new Error(`Unexpected fetch: ${String(url)}`);
      }

      const body = JSON.parse(String(init?.body || '{}'));
      if (body.outputLanguage !== 'en') {
        throw new Error(`Expected English output lock, got: ${String(body.outputLanguage || '')}`);
      }
      if (body.input !== 'ما هو القمر؟') {
        throw new Error(`Unexpected input: ${String(body.input || '')}`);
      }

      return {
        ok: true,
        async json() {
          return {
            mode: 'answer',
            speech: "The moon is Earth's natural satellite.",
            summary: '',
            answer: "The moon is Earth's natural satellite.",
            suggestions: [],
            plan: { steps: [] }
          };
        }
      };
    };
  });

  await page.addScriptTag({ path: 'src/background.js' });

  await page.evaluate(() => {
    // @ts-ignore
    window.chrome.storage.sync.get = (_defaults: unknown, cb: (res: unknown) => void) => {
      cb({
        navable_settings: {
          aiEnabled: true,
          aiMode: 'summary',
          language: 'en-US',
          languageMode: 'en',
          autostart: true
        }
      });
    };
  });

  await page.addScriptTag({ path: 'src/common/announce.js' });
  await page.addScriptTag({ path: 'src/common/i18n.js' });
  await page.addScriptTag({ path: 'src/content.js' });

  await page.waitForFunction(() => (window as any).__recognizers?.length === 1);

  await page.evaluate(async () => {
    // @ts-ignore
    await (window as any).NavableTools.handleTranscript('ما هو القمر؟', 'ar', 'native');
  });

  const stats = await page.evaluate(() => {
    // @ts-ignore
    return window.__speechStats;
  });

  expect(stats.langs).toEqual(['en-US']);
  await expect(page.locator('#navable-live-region-assertive')).toContainText("Earth's natural satellite");
});

test('new tab listening pauses while hidden and resumes automatically when visible again', async ({ page }) => {
  await page.setContent(`
    <div id="clock"></div>
    <div id="greeting"></div>
    <button id="btnMicToggle" type="button">Start listening</button>
    <div id="micStatus"></div>
  `);

  await page.evaluate(() => {
    const stats = { start: 0, stop: 0, langs: [] as string[] };
    const visibilityState = { value: 'visible' };

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get() {
        return visibilityState.value;
      }
    });

    function createFakeRecognizer() {
      const listeners: Record<string, Array<(payload?: unknown) => void>> = {
        result: [],
        error: [],
        start: [],
        end: []
      };

      return {
        start() {
          stats.start += 1;
          listeners.start.forEach((fn) => fn({ provider: 'native' }));
        },
        stop() {
          stats.stop += 1;
          listeners.end.forEach((fn) => fn({ provider: 'native' }));
        },
        on(type: string, handler: (payload?: unknown) => void) {
          if (!listeners[type]) listeners[type] = [];
          listeners[type].push(handler);
          return this;
        }
      };
    }

    // @ts-ignore
    window.__speechStats = stats;
    // @ts-ignore
    window.__visibilityState = visibilityState;
    // @ts-ignore
    window.chrome = {
      storage: {
        sync: {
          get(_defaults: any, cb: (res: any) => void) {
            cb({ navable_settings: { language: 'en-US' } });
          }
        },
        onChanged: {
          addListener() {}
        }
      }
    };
    // @ts-ignore
    window.NavableSpeech = {
      supportsRecognition: () => true,
      createRecognizer: ({ lang }: { lang: string }) => {
        stats.langs.push(String(lang || ''));
        return createFakeRecognizer();
      }
    };
  });

  await page.addScriptTag({ path: 'src/common/i18n.js' });
  await page.addScriptTag({ path: 'src/common/announce.js' });
  await page.addScriptTag({ path: 'src/newtab/newtab.js' });

  await page.evaluate(() => {
    document.dispatchEvent(new Event('DOMContentLoaded', { bubbles: true }));
    (document.getElementById('btnMicToggle') as HTMLButtonElement).click();
  });

  await page.waitForFunction(() => (window as any).__speechStats?.start === 1);

  await page.evaluate(() => {
    // @ts-ignore
    window.__visibilityState.value = 'hidden';
    document.dispatchEvent(new Event('visibilitychange'));
  });

  await page.waitForFunction(() => {
    // @ts-ignore
    return (window.__speechStats?.stop || 0) >= 1;
  });

  await page.evaluate(() => {
    // @ts-ignore
    window.__visibilityState.value = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
  });

  await page.waitForFunction(() => {
    // @ts-ignore
    return (window.__speechStats?.start || 0) >= 2;
  });

  await expect(page.locator('#micStatus')).toContainText('Listening');
});

test('new tab recognizer keeps the detected language across auto-resume', async ({ page }) => {
  await page.setContent(`
    <div id="clock"></div>
    <div id="greeting"></div>
    <button id="btnMicToggle" type="button">Start listening</button>
    <div id="micStatus"></div>
  `);

  await page.evaluate(() => {
    const stats = { start: 0, stop: 0, langs: [] as string[] };

    function createFakeRecognizer() {
      const listeners: Record<string, Array<(payload?: unknown) => void>> = {
        result: [],
        error: [],
        start: [],
        end: []
      };

      return {
        start() {
          stats.start += 1;
          listeners.start.forEach((fn) => fn({ provider: 'native' }));
        },
        stop() {
          stats.stop += 1;
          listeners.end.forEach((fn) => fn({ provider: 'native' }));
        },
        on(type: string, handler: (payload?: unknown) => void) {
          if (!listeners[type]) listeners[type] = [];
          listeners[type].push(handler);
          return this;
        }
      };
    }

    // @ts-ignore
    window.__speechStats = stats;
    // @ts-ignore
    window.chrome = {
      storage: {
        sync: {
          get(_defaults: any, cb: (res: any) => void) {
            cb({ navable_settings: { language: 'en-US' } });
          }
        },
        onChanged: {
          addListener() {}
        }
      }
    };
    // @ts-ignore
    window.NavableSpeech = {
      supportsRecognition: () => true,
      createRecognizer: ({ lang }: { lang: string }) => {
        stats.langs.push(String(lang || ''));
        return createFakeRecognizer();
      }
    };

    window.fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body || '{}'));
      if (body.input !== 'مرحبا') {
        throw new Error(`Unexpected input: ${String(body.input || '')}`);
      }
      return {
        ok: true,
        async json() {
          return {
            mode: 'answer',
            speech: 'مرحبا بك.',
            summary: '',
            answer: 'مرحبا بك.',
            suggestions: [],
            plan: { steps: [] }
          };
        }
      };
    };
  });

  await page.addScriptTag({ path: 'src/common/i18n.js' });
  await page.addScriptTag({ path: 'src/common/announce.js' });
  await page.addScriptTag({ path: 'src/newtab/newtab.js' });

  await page.evaluate(() => {
    document.dispatchEvent(new Event('DOMContentLoaded', { bubbles: true }));
    (document.getElementById('btnMicToggle') as HTMLButtonElement).click();
  });

  await page.waitForFunction(() => (window as any).__speechStats?.langs?.length === 1);

  await page.evaluate(async () => {
    // @ts-ignore
    await (window as any).NavableNewtabTools.handleTranscript('مرحبا', 'ar', 'native');
  });

  await page.waitForFunction(() => {
    // @ts-ignore
    return (window.__speechStats?.langs || []).includes('ar-SA');
  });

  const stats = await page.evaluate(() => {
    // @ts-ignore
    return window.__speechStats;
  });

  expect(stats.langs[0]).toBe('en-US');
  expect(stats.langs).toContain('ar-SA');
});
