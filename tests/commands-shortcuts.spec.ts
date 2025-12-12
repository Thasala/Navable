import { test, expect } from '@playwright/test';

test('chrome.commands path scrolls and moves headings', async ({ page }) => {
  // Stub a minimal chrome API before any scripts run
  await page.addInitScript(() => {
    // @ts-ignore
    (window as any).chrome = {
      commands: {
        _listeners: [] as any[],
        onCommand: {
          addListener(fn: any) {
            // @ts-ignore
            (window as any).chrome.commands._listeners.push(fn);
          }
        },
        _trigger(command: string) {
          // @ts-ignore
          const listeners = (window as any).chrome.commands._listeners || [];
          for (const fn of listeners) {
            try {
              fn(command);
            } catch {
              // ignore handler errors in tests
            }
          }
        }
      },
      tabs: {
        query(_info: any) {
          return Promise.resolve([{ id: 1 }]);
        },
        sendMessage(tabId: number, payload: any) {
          return new Promise((resolve) => {
            // @ts-ignore
            const listeners = (window as any).chrome.runtime._listeners || [];
            let responded = false;
            const sendResponse = (res: any) => {
              responded = true;
              resolve(res);
            };
            for (const fn of listeners) {
              try {
                const maybeAsync = fn(payload, { tab: { id: tabId } }, sendResponse);
                // If listener returns true it may respond async; we still resolve when called.
                if (maybeAsync === true) {
                  // allow async sendResponse
                }
              } catch {
                // ignore listener errors
              }
            }
            if (!responded) {
              setTimeout(() => resolve(undefined), 0);
            }
          });
        }
      },
      runtime: {
        _listeners: [] as any[],
        onMessage: {
          addListener(fn: any) {
            // @ts-ignore
            (window as any).chrome.runtime._listeners.push(fn);
          }
        }
      },
      storage: {
        sync: {
          get(defaults: any, cb: (res: any) => void) {
            cb(defaults);
          }
        },
        onChanged: {
          addListener(_fn: any) {
            // no-op for tests
          }
        }
      }
    };
  });

  await page.setContent(`
    <main style="height:2000px">
      <h1>Page Title</h1>
      <h2>Section One</h2>
      <h2>Section Two</h2>
    </main>
  `);

  await page.addScriptTag({ path: 'src/common/announce.js' });
  await page.addScriptTag({ path: 'src/content.js' });
  await page.addScriptTag({ path: 'src/background.js' });

  // Wait for tools to be ready
  await page.waitForFunction(() => (window as any).NavableTools?.buildPageStructure);

  const initialScroll = await page.evaluate(() => window.scrollY);

  // Trigger the scroll-down command through the chrome.commands handler
  await page.evaluate(() => {
    // @ts-ignore
    (window as any).chrome.commands._trigger('scroll-down');
  });

  await page.waitForFunction(() => window.scrollY > 0);
  const afterScroll = await page.evaluate(() => window.scrollY);
  expect(afterScroll).toBeGreaterThan(initialScroll);

  // Trigger the next-heading command and expect focus to move to a heading
  await page.evaluate(() => {
    document.body.focus();
    // @ts-ignore
    (window as any).chrome.commands._trigger('next-heading');
  });

  await page.waitForFunction(() => document.activeElement && document.activeElement.tagName === 'H2');
  const focusedText = await page.evaluate(() => document.activeElement?.textContent?.trim());
  expect(focusedText).toContain('Section One');
});

