import { test, expect } from '@playwright/test';

test('buildPageStructure returns landmarks and input metadata', async ({ page }) => {
  await page.setContent(`
    <header role="banner"><h1>Site Title</h1></header>
    <nav>Menu</nav>
    <main>
      <h2>Welcome</h2>
      <a href="#one">First link</a>
      <button>Press</button>
      <form>
        <label for="email">Email</label>
        <input id="email" name="email" type="email" placeholder="name@example.com" required />
      </form>
    </main>
    <footer>Foot</footer>
  `);
  await page.addScriptTag({ path: 'src/common/announce.js' });
  await page.addScriptTag({ path: 'src/content.js' });

  await page.waitForFunction(() => (window as any).NavableTools?.buildPageStructure);

  const structure = await page.evaluate(() => {
    // @ts-ignore
    return (window as any).NavableTools.buildPageStructure();
  });

  expect(structure.counts.headings).toBeGreaterThanOrEqual(1);
  expect(structure.counts.links).toBe(1);
  expect(structure.counts.buttons).toBe(1);
  expect(structure.counts.inputs).toBe(1);
  expect(structure.landmarks.length).toBeGreaterThanOrEqual(3);
  const firstLink = structure.links[0];
  expect(firstLink.href).toBe('#one');
  const email = structure.inputs.find((i: any) => i.name === 'email');
  expect(email).toBeTruthy();
  expect(email.inputType).toBe('email');
  expect(email.required).toBe(true);
});

test('buildPageStructure excludes sensitive inputs from snapshot', async ({ page }) => {
  await page.setContent(`
    <main>
      <form>
        <label for="pw">Password</label>
        <input id="pw" name="password" type="password" />
        <label for="card">Card</label>
        <input id="card" name="cardNumber" />
        <label for="city">City</label>
        <input id="city" name="city" />
      </form>
    </main>
  `);
  await page.addScriptTag({ path: 'src/common/announce.js' });
  await page.addScriptTag({ path: 'src/content.js' });

  await page.waitForFunction(() => (window as any).NavableTools?.buildPageStructure);

  const structure = await page.evaluate(() => {
    // @ts-ignore
    return (window as any).NavableTools.buildPageStructure();
  });

  // Only the non-sensitive "city" field should appear
  expect(structure.counts.inputs).toBe(1);
  const names = structure.inputs.map((i: any) => i.name).sort();
  expect(names).toEqual(['city']);
});

test('runPlan executes focus/click/fill steps via tools', async ({ page }) => {
  await page.setContent(`
    <main>
      <button id="btn" onclick="window.clicked=(window.clicked||0)+1">Click me</button>
      <label for="name">Name</label>
      <input id="name" name="name" />
    </main>
  `);
  await page.addScriptTag({ path: 'src/common/announce.js' });
  await page.addScriptTag({ path: 'src/content.js' });

  await page.waitForFunction(() => (window as any).NavableTools?.runPlan);

  const res = await page.evaluate(async () => {
    // @ts-ignore
    return (window as any).NavableTools.runPlan({
      steps: [
        { action: 'focus_element', targetType: 'button', label: 'Click me' },
        { action: 'click_element', targetType: 'button', label: 'Click me' },
        { action: 'fill_text', targetType: 'input', label: 'Name', value: 'Navable' }
      ]
    });
  });

  expect(res.ok).toBe(true);
  await page.waitForFunction(() => (window as any).clicked === 1);
  const val = await page.$eval('#name', (el) => (el as HTMLInputElement).value);
  expect(val).toBe('Navable');
});
