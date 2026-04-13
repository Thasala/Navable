import { test, expect } from '@playwright/test';

async function installTypedCommandHarness(page: any) {
  await page.evaluate(() => {
    const listeners: Array<(msg: any, sender: any, sendResponse: (res: any) => void) => any> = [];
    const messages: any[] = [];

    // @ts-ignore
    window.chrome = {
      runtime: {
        _listeners: listeners,
        sendMessage: async (payload: any) => {
          messages.push(payload);
          if (payload.type === 'planner:run') {
            return { ok: false, unhandled: true, plan: { steps: [] } };
          }
          if (payload.type === 'navable:assistant') {
            return { ok: false, error: 'assistant unavailable', plan: { steps: [] } };
          }
          return { ok: true };
        },
        onMessage: {
          addListener(fn: any) {
            listeners.push(fn);
          }
        }
      },
      storage: {
        sync: {
          get(_defaults: any, cb: (res: any) => void) {
            cb({ navable_settings: { language: 'en-US', autostart: false, overlay: false } });
          }
        },
        onChanged: {
          addListener() {}
        }
      }
    };

    // @ts-ignore
    window.__contentListeners = listeners;
    // @ts-ignore
    window.__contentMessages = messages;
    // @ts-ignore
    window.NavableSpeech = {
      supportsRecognition: () => true,
      createRecognizer: () => ({
        start() {},
        stop() {},
        on() { return this; }
      })
    };
  });
}

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

test('buildPageStructure keeps password metadata but excludes payment-style fields', async ({ page }) => {
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

  expect(structure.counts.inputs).toBe(2);
  const names = structure.inputs.map((i: any) => i.name).sort();
  expect(names).toEqual(['', 'city']);
  const passwordInput = structure.inputs.find((i: any) => i.inputType === 'password');
  expect(passwordInput).toBeTruthy();
  expect(passwordInput.label).toBe('Password');
  expect(passwordInput.sensitive).toBe(true);
  expect(structure.privacy?.sensitiveInputCount).toBe(2);
  expect(structure.privacy?.sensitivePage).toBe(true);
});

test('buildPageStructure excerpt keeps visible quiz choices for page QA', async ({ page }) => {
  await page.setContent(`
    <main>
      <h1>Question 1</h1>
      <fieldset>
        <legend>During Industry 1.0, what marked a major shift in production?</legend>
        <label><input type="radio" name="q1" value="phone" /> Introduction of the telephone in 1850.</label>
        <label><input type="radio" name="q1" value="steam" /> Development of James Watt's steam engine in 1763.</label>
        <label><input type="radio" name="q1" value="car" /> Implementation of Karl Benz's automobile patent in 1886.</label>
      </fieldset>
    </main>
  `);
  await page.addScriptTag({ path: 'src/common/announce.js' });
  await page.addScriptTag({ path: 'src/content.js' });

  await page.waitForFunction(() => (window as any).NavableTools?.buildPageStructure);

  const structure = await page.evaluate(() => {
    // @ts-ignore
    return (window as any).NavableTools.buildPageStructure();
  });

  expect(structure.excerpt).toContain('During Industry 1.0');
  expect(structure.excerpt).toContain("Development of James Watt's steam engine in 1763.");
  expect(structure.excerpt).toContain("Implementation of Karl Benz's automobile patent in 1886.");
});

test('buildPageStructure ignores Navable injected output UI', async ({ page }) => {
  await page.setContent(`
    <main>
      <h1>Real Page Title</h1>
      <p>This is the real page content.</p>
      <button>Actual page action</button>
    </main>
  `);
  await page.addScriptTag({ path: 'src/common/announce.js' });
  await page.addScriptTag({ path: 'src/content.js' });

  await page.waitForFunction(() => (window as any).NavableTools?.buildPageStructure);

  await page.evaluate(() => {
    // @ts-ignore
    (window as any).NavableAnnounce.speak('Summarizing the page now.', { mode: 'assertive', priority: true });
  });

  const structure = await page.evaluate(() => {
    // @ts-ignore
    return (window as any).NavableTools.buildPageStructure();
  });

  expect(structure.title).not.toContain('Navable');
  expect(structure.activeLabel).toBe('');
  expect(structure.headings.map((h: any) => h.label)).toContain('Real Page Title');
  expect(structure.buttons.map((b: any) => b.label)).toContain('Actual page action');
  expect(structure.buttons.map((b: any) => b.label)).not.toContain('Close');
  expect(structure.excerpt).toContain('real page content');
  expect(structure.excerpt).not.toContain('Summarizing the page now.');
});

test('buildPageStructure keeps fallback labels for icon-only controls', async ({ page }) => {
  await page.setContent(`
    <main>
      <a href="#pricing" id="pricing-link"><svg aria-hidden="true"></svg></a>
      <button id="continueButton"><svg aria-hidden="true"></svg></button>
    </main>
  `);
  await page.addScriptTag({ path: 'src/common/announce.js' });
  await page.addScriptTag({ path: 'src/content.js' });

  await page.waitForFunction(() => (window as any).NavableTools?.buildPageStructure);

  const structure = await page.evaluate(() => {
    // @ts-ignore
    return (window as any).NavableTools.buildPageStructure();
  });

  expect(structure.counts.links).toBe(1);
  expect(structure.counts.buttons).toBe(1);
  expect(structure.links[0].label).toContain('pricing');
  expect(structure.buttons[0].label).toContain('continue');
});

test('buildPageStructure includes labeled semantically discoverable actionable controls as buttons', async ({ page }) => {
  await page.setContent(`
    <main>
      <div role="button" id="use-profile">Use another profile</div>
      <div tabindex="0" style="cursor: pointer">Create new account</div>
      <summary>Show details</summary>
    </main>
  `);
  await page.addScriptTag({ path: 'src/common/announce.js' });
  await page.addScriptTag({ path: 'src/content.js' });

  await page.waitForFunction(() => (window as any).NavableTools?.buildPageStructure);

  const structure = await page.evaluate(() => {
    // @ts-ignore
    return (window as any).NavableTools.buildPageStructure();
  });

  expect(structure.buttons.map((b: any) => b.label)).toEqual(
    expect.arrayContaining(['Use another profile', 'Create new account', 'Show details'])
  );
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

test('runStep retries until a dynamic link appears', async ({ page }) => {
  await page.setContent(`
    <main id="root"></main>
    <script>
      setTimeout(() => {
        const link = document.createElement('a');
        link.href = '#pricing';
        link.textContent = 'Pricing';
        document.getElementById('root').appendChild(link);
      }, 140);
    </script>
  `);
  await page.addScriptTag({ path: 'src/common/announce.js' });
  await page.addScriptTag({ path: 'src/content.js' });

  await page.waitForFunction(() => (window as any).NavableTools?.runStep);

  const result = await page.evaluate(async () => {
    // @ts-ignore
    return await (window as any).NavableTools.runStep({ action: 'click_element', targetType: 'link', label: 'Pricing' });
  });

  expect(result.ok).toBe(true);
  await page.waitForFunction(() => window.location.hash === '#pricing');
});

test('runStep clicks labeled role button controls by label', async ({ page }) => {
  await page.setContent(`
    <main>
      <div role="button" onclick="window.clicked='profile'">Use another profile</div>
    </main>
  `);
  await page.addScriptTag({ path: 'src/common/announce.js' });
  await page.addScriptTag({ path: 'src/content.js' });

  await page.waitForFunction(() => (window as any).NavableTools?.runStep);

  const result = await page.evaluate(async () => {
    // @ts-ignore
    return await (window as any).NavableTools.runStep({ action: 'click_element', targetType: 'button', label: 'Use another profile' });
  });

  expect(result.ok).toBe(true);
  expect(await page.evaluate(() => (window as any).clicked || '')).toBe('profile');
});

test('runStep clicks labeled tabindex clickables by label', async ({ page }) => {
  await page.setContent(`
    <main>
      <div id="create-account" tabindex="0" onclick="window.clicked='create'" style="cursor: pointer">Create new account</div>
    </main>
  `);
  await page.addScriptTag({ path: 'src/common/announce.js' });
  await page.addScriptTag({ path: 'src/content.js' });

  await page.waitForFunction(() => (window as any).NavableTools?.runStep);

  const result = await page.evaluate(async () => {
    // @ts-ignore
    return await (window as any).NavableTools.runStep({ action: 'click_element', targetType: 'button', label: 'Create new account' });
  });

  expect(result.ok).toBe(true);
  expect(await page.evaluate(() => (window as any).clicked || '')).toBe('create');
});

test('runStep can focus labeled semantically discoverable custom controls', async ({ page }) => {
  await page.setContent(`
    <main>
      <div id="create-account" onclick="window.clicked='create'">Create new account</div>
    </main>
  `);
  await page.addScriptTag({ path: 'src/common/announce.js' });
  await page.addScriptTag({ path: 'src/content.js' });

  await page.waitForFunction(() => (window as any).NavableTools?.runStep);

  const result = await page.evaluate(async () => {
    // @ts-ignore
    return await (window as any).NavableTools.runStep({ action: 'focus_element', targetType: 'button', label: 'Create new account' });
  });

  expect(result.ok).toBe(true);
  expect(await page.evaluate(() => (document.activeElement && (document.activeElement as HTMLElement).id) || '')).toBe('create-account');
  expect(await page.getAttribute('#create-account', 'tabindex')).toBe('-1');
});

test('runStep re-resolves after a stale element is replaced', async ({ page }) => {
  await page.setContent(`
    <main>
      <button id="continueBtn" data-version="1">Continue</button>
    </main>
  `);
  await page.evaluate(() => {
    const first = document.getElementById('continueBtn') as HTMLButtonElement;
    first.click = function () {
      const replacement = document.createElement('button');
      replacement.textContent = 'Continue';
      replacement.dataset.version = '2';
      replacement.click = function () {
        // @ts-ignore
        window.clicked = 'second';
      };
      this.replaceWith(replacement);
      throw new Error('stale element');
    };
  });
  await page.addScriptTag({ path: 'src/common/announce.js' });
  await page.addScriptTag({ path: 'src/content.js' });

  await page.waitForFunction(() => (window as any).NavableTools?.runStep);

  const result = await page.evaluate(async () => {
    // @ts-ignore
    return await (window as any).NavableTools.runStep({ action: 'click_element', targetType: 'button', label: 'Continue' });
  });

  expect(result.ok).toBe(true);
  expect(await page.evaluate(() => (window as any).clicked || '')).toBe('second');
});

test('runStep retries until a dynamic role button appears', async ({ page }) => {
  await page.setContent(`
    <main id="root"></main>
    <script>
      setTimeout(() => {
        const control = document.createElement('div');
        control.setAttribute('role', 'button');
        control.textContent = 'Use another profile';
        control.onclick = () => { window.clicked = 'profile'; };
        document.getElementById('root').appendChild(control);
      }, 140);
    </script>
  `);
  await page.addScriptTag({ path: 'src/common/announce.js' });
  await page.addScriptTag({ path: 'src/content.js' });

  await page.waitForFunction(() => (window as any).NavableTools?.runStep);

  const result = await page.evaluate(async () => {
    // @ts-ignore
    return await (window as any).NavableTools.runStep({ action: 'click_element', targetType: 'button', label: 'Use another profile' });
  });

  expect(result.ok).toBe(true);
  expect(await page.evaluate(() => (window as any).clicked || '')).toBe('profile');
});

test('runStep reports ambiguity instead of clicking the wrong duplicate control', async ({ page }) => {
  await page.setContent(`
    <main>
      <button onclick="window.clicked='first'">Continue</button>
      <button onclick="window.clicked='second'">Continue</button>
    </main>
  `);
  await page.addScriptTag({ path: 'src/common/announce.js' });
  await page.addScriptTag({ path: 'src/common/i18n.js' });
  await page.addScriptTag({ path: 'src/content.js' });

  await page.waitForFunction(() => (window as any).NavableTools?.runStep);

  const result = await page.evaluate(() => {
    // @ts-ignore
    return (window as any).NavableTools.runStep({ action: 'click_element', targetType: 'button', label: 'Continue' });
  });

  expect(result.ok).toBe(false);
  expect(result.message).toContain('matching buttons');
  expect(await page.evaluate(() => (window as any).clicked || '')).toBe('');
});

test('runStep reports ambiguity for duplicate generic clickable controls', async ({ page }) => {
  await page.setContent(`
    <main>
      <div role="button" onclick="window.clicked='first'">Continue</div>
      <div role="button" onclick="window.clicked='second'">Continue</div>
    </main>
  `);
  await page.addScriptTag({ path: 'src/common/announce.js' });
  await page.addScriptTag({ path: 'src/common/i18n.js' });
  await page.addScriptTag({ path: 'src/content.js' });

  await page.waitForFunction(() => (window as any).NavableTools?.runStep);

  const result = await page.evaluate(() => {
    // @ts-ignore
    return (window as any).NavableTools.runStep({ action: 'click_element', targetType: 'button', label: 'Continue' });
  });

  expect(result.ok).toBe(false);
  expect(result.message).toContain('matching buttons');
  expect(await page.evaluate(() => (window as any).clicked || '')).toBe('');
});

test('runStep can target the nth duplicate control when provided', async ({ page }) => {
  await page.setContent(`
    <main>
      <button onclick="window.clicked='first'">Continue</button>
      <button onclick="window.clicked='second'">Continue</button>
    </main>
  `);
  await page.addScriptTag({ path: 'src/common/announce.js' });
  await page.addScriptTag({ path: 'src/common/i18n.js' });
  await page.addScriptTag({ path: 'src/content.js' });

  await page.waitForFunction(() => (window as any).NavableTools?.runStep);

  const result = await page.evaluate(() => {
    // @ts-ignore
    return (window as any).NavableTools.runStep({ action: 'click_element', targetType: 'button', label: 'Continue', n: 2 });
  });

  expect(result.ok).toBe(true);
  expect(await page.evaluate(() => (window as any).clicked || '')).toBe('second');
});

test('runStep can target the nth duplicate generic clickable control when provided', async ({ page }) => {
  await page.setContent(`
    <main>
      <div role="button" onclick="window.clicked='first'">Continue</div>
      <div role="button" onclick="window.clicked='second'">Continue</div>
    </main>
  `);
  await page.addScriptTag({ path: 'src/common/announce.js' });
  await page.addScriptTag({ path: 'src/common/i18n.js' });
  await page.addScriptTag({ path: 'src/content.js' });

  await page.waitForFunction(() => (window as any).NavableTools?.runStep);

  const result = await page.evaluate(() => {
    // @ts-ignore
    return (window as any).NavableTools.runStep({ action: 'click_element', targetType: 'button', label: 'Continue', n: 2 });
  });

  expect(result.ok).toBe(true);
  expect(await page.evaluate(() => (window as any).clicked || '')).toBe('second');
});

test('typed focus password prefers the password input over related links', async ({ page }) => {
  await page.setContent(`
    <main>
      <label for="email">Email</label>
      <input id="email" name="email" type="email" />
      <label for="pw">Password</label>
      <input id="pw" name="password" type="password" />
      <a href="#forgot">Forgot password?</a>
    </main>
  `);
  await installTypedCommandHarness(page);
  await page.addScriptTag({ path: 'src/common/announce.js' });
  await page.addScriptTag({ path: 'src/common/i18n.js' });
  await page.addScriptTag({ path: 'src/common/speech.js' });
  await page.addScriptTag({ path: 'src/content.js' });

  await page.waitForFunction(() => (window as any).__contentListeners?.length > 0);

  const response = await page.evaluate(async () => {
    // @ts-ignore
    const listener = (window as any).__contentListeners[0];
    return await new Promise((resolve, reject) => {
      try {
        listener({ type: 'navable:runTypedCommand', text: 'focus password', detectedLanguage: 'en' }, {}, resolve);
      } catch (err) {
        reject(err);
      }
    });
  });

  expect(response).toMatchObject({ ok: true });
  expect(await page.evaluate(() => (document.activeElement && (document.activeElement as HTMLElement).id) || '')).toBe('pw');
});

test('typed command recovers obvious verb misses like lick pricing', async ({ page }) => {
  await page.setContent(`
    <main>
      <a href="#pricing">Pricing</a>
    </main>
  `);
  await installTypedCommandHarness(page);
  await page.addScriptTag({ path: 'src/common/announce.js' });
  await page.addScriptTag({ path: 'src/common/i18n.js' });
  await page.addScriptTag({ path: 'src/common/speech.js' });
  await page.addScriptTag({ path: 'src/content.js' });

  await page.waitForFunction(() => (window as any).__contentListeners?.length > 0);

  const response = await page.evaluate(async () => {
    // @ts-ignore
    const listener = (window as any).__contentListeners[0];
    return await new Promise((resolve, reject) => {
      try {
        listener({ type: 'navable:runTypedCommand', text: 'lick pricing', detectedLanguage: 'en' }, {}, resolve);
      } catch (err) {
        reject(err);
      }
    });
  });

  expect(response).toMatchObject({ ok: true });
  await page.waitForFunction(() => window.location.hash === '#pricing');
});

test('typed click on phrasing strips filler prepositions for links and generic controls', async ({ page }) => {
  await page.setContent(`
    <main>
      <a href="#pricing">Pricing</a>
      <div role="button" onclick="window.clicked = 'account'">Create new account</div>
    </main>
  `);
  await installTypedCommandHarness(page);
  await page.addScriptTag({ path: 'src/common/announce.js' });
  await page.addScriptTag({ path: 'src/common/i18n.js' });
  await page.addScriptTag({ path: 'src/common/speech.js' });
  await page.addScriptTag({ path: 'src/content.js' });

  await page.waitForFunction(() => (window as any).__contentListeners?.length > 0);

  await page.evaluate(async () => {
    // @ts-ignore
    const listener = (window as any).__contentListeners[0];
    await new Promise((resolve, reject) => {
      try {
        listener({ type: 'navable:runTypedCommand', text: 'click on pricing', detectedLanguage: 'en' }, {}, resolve);
      } catch (err) {
        reject(err);
      }
    });
  });

  expect(await page.evaluate(() => window.location.hash)).toBe('#pricing');

  await page.evaluate(async () => {
    // @ts-ignore
    const listener = (window as any).__contentListeners[0];
    await new Promise((resolve, reject) => {
      try {
        listener({ type: 'navable:runTypedCommand', text: 'click on create new account', detectedLanguage: 'en' }, {}, resolve);
      } catch (err) {
        reject(err);
      }
    });
  });

  expect(await page.evaluate(() => (window as any).clicked || '')).toBe('account');
});

test('typed malformed commands do not trigger accidental clicks', async ({ page }) => {
  await page.setContent(`
    <main>
      <a href="#pricing">Pricing</a>
      <button onclick="window.clicked = true">Continue</button>
    </main>
  `);
  await installTypedCommandHarness(page);
  await page.addScriptTag({ path: 'src/common/announce.js' });
  await page.addScriptTag({ path: 'src/common/i18n.js' });
  await page.addScriptTag({ path: 'src/common/speech.js' });
  await page.addScriptTag({ path: 'src/content.js' });

  await page.waitForFunction(() => (window as any).__contentListeners?.length > 0);

  await page.evaluate(async () => {
    // @ts-ignore
    const listener = (window as any).__contentListeners[0];
    await new Promise((resolve, reject) => {
      try {
        listener({ type: 'navable:runTypedCommand', text: 'blick wobble', detectedLanguage: 'en' }, {}, resolve);
      } catch (err) {
        reject(err);
      }
    });
  });

  expect(await page.evaluate(() => window.location.hash)).toBe('');
  expect(await page.evaluate(() => Boolean((window as any).clicked))).toBe(false);
});
