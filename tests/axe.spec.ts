import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('axe has no critical issues on simple page', async ({ page }) => {
  await page.setContent(`
    <main>
      <h1>Accessible Sample</h1>
      <button aria-label="confirm">OK</button>
    </main>
  `);

  const results = await new AxeBuilder({ page }).analyze();
  const critical = results.violations.filter(v => v.impact === 'critical');
  expect(critical, JSON.stringify(critical, null, 2)).toEqual([]);
});
