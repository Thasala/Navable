import { test, expect } from '@playwright/test';

test('DOM walker labels interactives and headings', async ({ page }) => {
  await page.setContent(`
    <main>
      <h1>Welcome</h1>
      <a id="a1" href="#go">Go Link</a>
      <button id="b1">Click Me</button>
      <label for="i1">Name</label>
      <input id="i1" placeholder="Your name" />
      <div role="button" id="rb">Role Button</div>
    </main>
  `);

  await page.addScriptTag({ path: 'src/content.js' });

  // Wait for initial scan to complete
  await page.waitForFunction(() => {
    // @ts-ignore
    return window.NavableIndex && window.NavableIndex.getIndex().items.length >= 5;
  });

  const count = await page.$$eval('[data-navable-id]', (els) => els.length);
  expect(count).toBeGreaterThanOrEqual(5);

  // Check a few labels
  const b1Label = await page.$eval('#b1', (el) => (el as HTMLElement).dataset['navableLabel']);
  expect(b1Label).toMatch(/Click Me/);

  const a1Label = await page.$eval('#a1', (el) => (el as HTMLElement).dataset['navableLabel']);
  expect(a1Label).toMatch(/Go Link/);

  const h1Label = await page.$eval('h1', (el) => (el as HTMLElement).dataset['navableLabel']);
  expect(h1Label).toMatch(/Welcome/);
});

