import { expect, test } from '@playwright/test';

test('background creates a USER_MEDIA offscreen document and relays speech events to the sender tab', async ({ page }) => {
  await page.addScriptTag({ path: 'src/background.js' });

  const result = await page.evaluate(async () => {
    const createdDocuments: any[] = [];
    const createdTabs: any[] = [];
    const offscreenMessages: any[] = [];
    const relayedMessages: any[] = [];

    // @ts-ignore
    window.chrome.runtime.id = 'test-extension';
    // @ts-ignore
    window.chrome.runtime.getURL = (path: string) => `chrome-extension://test-extension/${path}`;
    // @ts-ignore
    window.chrome.runtime.getContexts = async () => [];
    // @ts-ignore
    window.chrome.offscreen = {
      createDocument: async (params: any) => {
        createdDocuments.push(params);
      }
    };
    // @ts-ignore
    window.chrome.tabs.sendMessage = async (tabId: number, payload: any) => {
      relayedMessages.push({ tabId, payload });
      return { ok: true };
    };
    // @ts-ignore
    window.chrome.tabs.create = async (payload: any) => {
      createdTabs.push(payload);
      return { id: 99 };
    };
    // @ts-ignore
    window.chrome.runtime._listeners.push((msg: any, _sender: any, sendResponse: (res: any) => void) => {
      if (msg?.target !== 'navable:offscreenSpeech') return false;
      offscreenMessages.push(msg);
      sendResponse({ ok: true });
      return false;
    });

    // @ts-ignore
    const backgroundListener = window.chrome.runtime._listeners[0];
    const startResponse = await new Promise((resolve, reject) => {
      try {
        backgroundListener(
          { type: 'navable:voiceStart', sessionId: 'voice-1', lang: 'en-US' },
          { tab: { id: 42 } },
          resolve
        );
      } catch (err) {
        reject(err);
      }
    });

    const relayResponse = await new Promise((resolve, reject) => {
      try {
        backgroundListener(
          {
            type: 'navable:offscreenSpeechEvent',
            sessionId: 'voice-1',
            tabId: 42,
            event: 'result',
            payload: { transcript: 'read title', provider: 'backend' }
          },
          {},
          resolve
        );
      } catch (err) {
        reject(err);
      }
    });

    const micSetupResponse = await new Promise((resolve, reject) => {
      try {
        backgroundListener(
          { type: 'navable:openMicrophoneSetup', reason: 'not-allowed' },
          { tab: { id: 42 } },
          resolve
        );
      } catch (err) {
        reject(err);
      }
    });

    return { createdDocuments, createdTabs, offscreenMessages, relayedMessages, startResponse, relayResponse, micSetupResponse };
  });

  expect(result.startResponse).toMatchObject({ ok: true });
  expect(result.createdDocuments).toHaveLength(1);
  expect(result.createdDocuments[0].url).toBe('src/offscreen/offscreen.html');
  expect(result.createdDocuments[0].reasons).toContain('USER_MEDIA');
  expect(result.offscreenMessages[0]).toMatchObject({
    target: 'navable:offscreenSpeech',
    action: 'start',
    sessionId: 'voice-1',
    tabId: 42,
    lang: 'en-US'
  });
  expect(result.relayResponse).toMatchObject({ ok: true });
  expect(result.micSetupResponse).toMatchObject({ ok: true });
  expect(result.createdTabs[0].url).toContain('/src/permissions/microphone.html');
  expect(result.createdTabs[0].url).toContain('reason=not-allowed');
  expect(result.relayedMessages).toEqual([
    {
      tabId: 42,
      payload: {
        type: 'navable:voiceEvent',
        sessionId: 'voice-1',
        event: 'result',
        payload: { transcript: 'read title', provider: 'backend' }
      }
    }
  ]);
});

test('content pages start extension-origin voice capture instead of page getUserMedia capture', async ({ page }) => {
  await page.evaluate(() => {
    const listeners: any[] = [];
    const messages: any[] = [];

    // @ts-ignore
    window.chrome = {
      runtime: {
        id: 'test-extension',
        getURL(path: string) {
          return `chrome-extension://test-extension/${path || ''}`;
        },
        sendMessage(payload: any, cb?: (res: any) => void) {
          messages.push(payload);
          const response = payload?.type === 'navable:voiceStart' || payload?.type === 'navable:voiceStop'
            ? { ok: true }
            : { ok: false };
          if (typeof cb === 'function') cb(response);
          return undefined;
        },
        onMessage: {
          addListener(fn: any) {
            listeners.push(fn);
          },
          removeListener(fn: any) {
            const index = listeners.indexOf(fn);
            if (index >= 0) listeners.splice(index, 1);
          }
        }
      },
      storage: {
        sync: {
          get(_defaults: any, cb: (res: any) => void) {
            cb({ navable_settings: { language: 'en-US', autostart: false, overlay: false } });
          }
        },
        onChanged: { addListener() {} }
      }
    };

    // @ts-ignore
    window.__voiceMessages = messages;
    // @ts-ignore
    window.__voiceListeners = listeners;
    // @ts-ignore
    window.NavableSpeech = {
      supportsRecognition: () => false,
      createRecognizer: () => {
        throw new Error('content page mic capture should not be used');
      }
    };
  });

  await page.addScriptTag({ path: 'src/common/config.js' });
  await page.addScriptTag({ path: 'src/common/i18n.js' });
  await page.addScriptTag({ path: 'src/common/announce.js' });
  await page.addScriptTag({ path: 'src/content.js' });
  await page.waitForFunction(() => (window as any).NavableTools?.getSpeechStatus);

  const status = await page.evaluate(() => {
    // @ts-ignore
    window.NavableTools.startListening({ announce: false });
    // @ts-ignore
    return window.NavableTools.getSpeechStatus();
  });

  const messages = await page.evaluate(() => (window as any).__voiceMessages);
  expect(status).toMatchObject({ ok: true, supports: true, listening: true });
  expect(messages.find((msg: any) => msg.type === 'navable:voiceStart')).toMatchObject({
    type: 'navable:voiceStart',
    lang: 'en-US'
  });
});

test('content opens microphone setup when extension mic permission is blocked', async ({ page }) => {
  await page.evaluate(() => {
    const listeners: any[] = [];
    const messages: any[] = [];

    // @ts-ignore
    window.chrome = {
      runtime: {
        id: 'test-extension',
        getURL(path: string) {
          return `chrome-extension://test-extension/${path || ''}`;
        },
        sendMessage(payload: any, cb?: (res: any) => void) {
          messages.push(payload);
          const response = payload?.type === 'navable:voiceStart' ||
            payload?.type === 'navable:voiceStop' ||
            payload?.type === 'navable:openMicrophoneSetup'
            ? { ok: true }
            : { ok: false };
          if (typeof cb === 'function') cb(response);
          return undefined;
        },
        onMessage: {
          addListener(fn: any) {
            listeners.push(fn);
          },
          removeListener(fn: any) {
            const index = listeners.indexOf(fn);
            if (index >= 0) listeners.splice(index, 1);
          }
        }
      },
      storage: {
        sync: {
          get(_defaults: any, cb: (res: any) => void) {
            cb({ navable_settings: { language: 'en-US', autostart: false, overlay: false } });
          }
        },
        onChanged: { addListener() {} }
      }
    };

    // @ts-ignore
    window.__voiceMessages = messages;
    // @ts-ignore
    window.__voiceListeners = listeners;
    // @ts-ignore
    window.NavableSpeech = {
      supportsRecognition: () => false,
      createRecognizer: () => {
        throw new Error('content page mic capture should not be used');
      }
    };
  });

  await page.addScriptTag({ path: 'src/common/config.js' });
  await page.addScriptTag({ path: 'src/common/i18n.js' });
  await page.addScriptTag({ path: 'src/common/announce.js' });
  await page.addScriptTag({ path: 'src/content.js' });
  await page.waitForFunction(() => (window as any).NavableTools?.getSpeechStatus);

  const messages = await page.evaluate(async () => {
    // @ts-ignore
    window.NavableTools.startListening({ announce: false });
    await new Promise((resolve) => setTimeout(resolve, 0));
    // @ts-ignore
    const startMessage = window.__voiceMessages.find((msg: any) => msg.type === 'navable:voiceStart');
    const eventMessage = {
      type: 'navable:voiceEvent',
      sessionId: startMessage.sessionId,
      event: 'error',
      payload: { error: 'not-allowed', provider: 'backend' }
    };
    // @ts-ignore
    window.__voiceListeners.forEach((listener: any) => listener(eventMessage));
    await new Promise((resolve) => setTimeout(resolve, 0));
    // @ts-ignore
    return window.__voiceMessages;
  });

  expect(messages.find((msg: any) => msg.type === 'navable:openMicrophoneSetup')).toMatchObject({
    type: 'navable:openMicrophoneSetup',
    reason: 'not-allowed'
  });
});

test('offscreen speech document sanitizes recognizer events before relaying them', async ({ page }) => {
  await page.evaluate(() => {
    const listeners: any[] = [];
    const messages: any[] = [];
    const recognizers: any[] = [];

    // @ts-ignore
    window.chrome = {
      runtime: {
        sendMessage(payload: any) {
          messages.push(payload);
        },
        onMessage: {
          addListener(fn: any) {
            listeners.push(fn);
          }
        }
      }
    };

    // @ts-ignore
    window.NavableSpeech = {
      createRecognizer() {
        const eventHandlers: Record<string, any[]> = {};
        const recognizer = {
          start() {
            (eventHandlers.start || []).forEach((fn) => fn({ provider: 'backend', raw: { ignored: true } }));
          },
          stop() {},
          on(type: string, fn: any) {
            eventHandlers[type] = eventHandlers[type] || [];
            eventHandlers[type].push(fn);
            return recognizer;
          },
          emit(type: string, payload: any) {
            (eventHandlers[type] || []).forEach((fn) => fn(payload));
          }
        };
        recognizers.push(recognizer);
        return recognizer;
      }
    };

    // @ts-ignore
    window.__offscreenListeners = listeners;
    // @ts-ignore
    window.__offscreenMessages = messages;
    // @ts-ignore
    window.__offscreenRecognizers = recognizers;
  });

  await page.addScriptTag({ path: 'src/offscreen/offscreen.js' });

  const result = await page.evaluate(() => {
    // @ts-ignore
    const listener = window.__offscreenListeners[0];
    const response = new Promise((resolve) => {
      listener(
        {
          target: 'navable:offscreenSpeech',
          action: 'start',
          sessionId: 'voice-2',
          tabId: 9,
          lang: 'en-US'
        },
        {},
        resolve
      );
    });
    // @ts-ignore
    window.__offscreenRecognizers[0].emit('result', {
      transcript: 'open example',
      provider: 'backend',
      raw: { shouldNotCrossRuntime: true }
    });
    return response.then((startResponse) => ({
      startResponse,
      // @ts-ignore
      messages: window.__offscreenMessages
    }));
  });

  expect(result.startResponse).toMatchObject({ ok: true });
  expect(result.messages).toContainEqual({
    type: 'navable:offscreenSpeechEvent',
    sessionId: 'voice-2',
    tabId: 9,
    event: 'start',
    payload: { provider: 'backend' }
  });
  expect(result.messages).toContainEqual({
    type: 'navable:offscreenSpeechEvent',
    sessionId: 'voice-2',
    tabId: 9,
    event: 'result',
    payload: { transcript: 'open example', provider: 'backend' }
  });
});
