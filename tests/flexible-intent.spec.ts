import { expect, test } from '@playwright/test';

test('planner fallback handles looser navigation phrasing', async ({ page }) => {
  await page.setContent(`
    <main style="height: 2400px">
      <h1>Home</h1>
      <p>Intro copy.</p>
      <a id="pricing-link" href="#pricing">Pricing</a>
      <div style="height: 1400px"></div>
      <h2 id="pricing" tabindex="-1">Pricing</h2>
      <p>Plans and billing.</p>
    </main>
  `);

  await page.addScriptTag({ path: 'src/background.js' });
  await page.addScriptTag({ path: 'src/common/announce.js' });
  await page.addScriptTag({ path: 'src/common/i18n.js' });
  await page.addScriptTag({ path: 'src/common/speech.js' });
  await page.addScriptTag({ path: 'src/content.js' });

  await page.waitForFunction(() => (window as any).NavableTools?.buildPageStructure);

  const scrollResult = await page.evaluate(async () => {
    // @ts-ignore
    return await (window as any).runPlanner('take me a bit lower', 'en', true);
  });
  expect(scrollResult.ok).toBe(true);
  await page.waitForFunction(() => window.scrollY > 0);

  const pricingResult = await page.evaluate(async () => {
    // @ts-ignore
    return await (window as any).runPlanner('take me to pricing', 'en', true);
  });
  expect(pricingResult.ok).toBe(true);
  await page.waitForFunction(() => window.location.hash === '#pricing');
});

test('planner fallback understands French and Arabic intent phrases', async ({ page }) => {
  await page.setContent(`
    <main style="height: 2400px">
      <h1>Accueil</h1>
      <p>Bienvenue.</p>
      <div style="height: 1200px"></div>
      <h2 id="features">Features</h2>
      <h2 id="pricing">Pricing</h2>
    </main>
  `);

  await page.addScriptTag({ path: 'src/background.js' });
  await page.addScriptTag({ path: 'src/common/announce.js' });
  await page.addScriptTag({ path: 'src/common/i18n.js' });
  await page.addScriptTag({ path: 'src/common/speech.js' });
  await page.addScriptTag({ path: 'src/content.js' });

  await page.waitForFunction(() => (window as any).NavableTools?.buildPageStructure);

  const frenchScroll = await page.evaluate(async () => {
    // @ts-ignore
    return await (window as any).runPlanner('descends un peu', 'fr', true);
  });
  expect(frenchScroll.ok).toBe(true);
  await page.waitForFunction(() => window.scrollY > 0);

  const arabicHeading = await page.evaluate(async () => {
    document.body.focus();
    // @ts-ignore
    return await (window as any).runPlanner('العنوان التالي', 'ar', true);
  });
  expect(arabicHeading.ok).toBe(true);
  await page.waitForFunction(() => document.activeElement && document.activeElement.tagName === 'H2');
});

test('planner fallback leaves informational questions unhandled', async ({ page }) => {
  await page.setContent(`
    <main>
      <h1>Pricing</h1>
      <p>Plans and billing.</p>
      <a href="#pricing">Pricing details</a>
    </main>
  `);

  await page.addScriptTag({ path: 'src/background.js' });
  await page.addScriptTag({ path: 'src/common/announce.js' });
  await page.addScriptTag({ path: 'src/common/i18n.js' });
  await page.addScriptTag({ path: 'src/common/speech.js' });
  await page.addScriptTag({ path: 'src/content.js' });

  await page.waitForFunction(() => (window as any).NavableTools?.buildPageStructure);

  const result = await page.evaluate(async () => {
    // @ts-ignore
    return await (window as any).runPlanner('what is pricing', 'en', true);
  });

  expect(result.ok).toBe(false);
  expect(result.unhandled).toBe(true);
});

test('planner fallback prefers password inputs over related links', async ({ page }) => {
  await page.setContent(`
    <main>
      <label for="email">Email</label>
      <input id="email" name="email" type="email" />
      <label for="pw">Password</label>
      <input id="pw" name="password" type="password" />
      <a href="#forgot">Forgot password?</a>
    </main>
  `);

  await page.addScriptTag({ path: 'src/background.js' });
  await page.addScriptTag({ path: 'src/common/announce.js' });
  await page.addScriptTag({ path: 'src/common/i18n.js' });
  await page.addScriptTag({ path: 'src/common/speech.js' });
  await page.addScriptTag({ path: 'src/content.js' });

  await page.waitForFunction(() => (window as any).NavableTools?.buildPageStructure);

  const result = await page.evaluate(async () => {
    // @ts-ignore
    return await (window as any).runPlanner('focus password', 'en', true);
  });

  expect(result.ok).toBe(true);
  await page.waitForFunction(() => document.activeElement && (document.activeElement as HTMLElement).id === 'pw');
});

test('planner fallback can choose generic actionable controls surfaced as buttons', async ({ page }) => {
  await page.setContent(`
    <main>
      <div role="button" onclick="window.clicked='profile'">Use another profile</div>
      <div tabindex="0" style="cursor: pointer" onclick="window.clicked='create'">Create new account</div>
    </main>
  `);

  await page.addScriptTag({ path: 'src/background.js' });
  await page.addScriptTag({ path: 'src/common/announce.js' });
  await page.addScriptTag({ path: 'src/common/i18n.js' });
  await page.addScriptTag({ path: 'src/common/speech.js' });
  await page.addScriptTag({ path: 'src/content.js' });

  await page.waitForFunction(() => (window as any).NavableTools?.buildPageStructure);

  const result = await page.evaluate(async () => {
    // @ts-ignore
    return await (window as any).runPlanner('click create new account', 'en', true);
  });

  expect(result.ok).toBe(true);
  expect(await page.evaluate(() => (window as any).clicked || '')).toBe('create');
});
