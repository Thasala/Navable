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

test('buildPageStructure includes actionable controls inside same-origin iframes and open shadow roots', async ({ page }) => {
  await page.setContent(`
    <main>
      <div id="shadow-host"></div>
      <iframe id="auth-frame"></iframe>
    </main>
  `);
  await page.evaluate(() => {
    const host = document.getElementById('shadow-host') as HTMLDivElement;
    const shadow = host.attachShadow({ mode: 'open' });
    const shadowButton = document.createElement('button');
    shadowButton.textContent = 'Shadow continue';
    shadow.appendChild(shadowButton);

    const frame = document.getElementById('auth-frame') as HTMLIFrameElement;
    const doc = frame.contentDocument!;
    doc.open();
    doc.write('<main><button>Frame continue</button></main>');
    doc.close();
  });
  await page.addScriptTag({ path: 'src/common/announce.js' });
  await page.addScriptTag({ path: 'src/content.js' });

  await page.waitForFunction(() => (window as any).NavableTools?.buildPageStructure);

  const structure = await page.evaluate(() => {
    // @ts-ignore
    return (window as any).NavableTools.buildPageStructure();
  });

  expect(structure.buttons.map((b: any) => b.label)).toEqual(
    expect.arrayContaining(['Shadow continue', 'Frame continue'])
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

test('runPlan resolves nearby sibling labels for inputs without explicit label wiring', async ({ page }) => {
  await page.setContent(`
    <main>
      <form>
        <div class="row">
          <div class="label-col">Email</div>
          <div class="input-col">
            <input type="email" placeholder="name@example.com" />
          </div>
        </div>
      </form>
    </main>
  `);
  await page.addScriptTag({ path: 'src/common/announce.js' });
  await page.addScriptTag({ path: 'src/content.js' });

  await page.waitForFunction(() => (window as any).NavableTools?.runPlan);

  const res = await page.evaluate(async () => {
    // @ts-ignore
    return (window as any).NavableTools.runPlan({
      steps: [
        { action: 'fill_text', targetType: 'input', label: 'Email', value: 'hazem@example.com' }
      ]
    });
  });

  expect(res.ok).toBe(true);
  const val = await page.$eval('input[type="email"]', (el) => (el as HTMLInputElement).value);
  expect(val).toBe('hazem@example.com');
});

test('typed form mode can guide fill, select, check, and submit a form', async ({ page }) => {
  await page.setContent(`
    <main>
      <form id="signup">
        <label for="email">Email</label>
        <input id="email" name="email" type="email" required />

        <label for="password">Password</label>
        <input id="password" name="password" type="password" required />

        <label for="country">Country</label>
        <select id="country" name="country">
          <option value="">Choose country</option>
          <option value="jo">Jordan</option>
          <option value="lb">Lebanon</option>
        </select>

        <label><input id="terms" type="checkbox" /> Accept terms</label>
        <button type="submit">Create account</button>
      </form>
    </main>
  `);
  await page.evaluate(() => {
    const form = document.getElementById('signup') as HTMLFormElement;
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      // @ts-ignore
      window.submitted = true;
    });
  });
  await installTypedCommandHarness(page);
  await page.addScriptTag({ path: 'src/common/announce.js' });
  await page.addScriptTag({ path: 'src/common/i18n.js' });
  await page.addScriptTag({ path: 'src/common/speech.js' });
  await page.addScriptTag({ path: 'src/content.js' });

  await page.waitForFunction(() => (window as any).__contentListeners?.length > 0);

  async function typed(text: string) {
    return await page.evaluate(async (utterance) => {
      // @ts-ignore
      const listener = (window as any).__contentListeners[0];
      return await new Promise((resolve, reject) => {
        try {
          listener({ type: 'navable:runTypedCommand', text: utterance, detectedLanguage: 'en' }, {}, resolve);
        } catch (err) {
          reject(err);
        }
      });
    }, text);
  }

  const start = await typed('guide me through this form');
  expect(start).toMatchObject({ ok: true });
  expect(String((start as any).speech || '')).toContain('Field 1 of 4: Email');
  expect(await page.evaluate(() => (document.activeElement as HTMLElement)?.id || '')).toBe('email');

  const fillEmail = await typed('fill hazem@example.com');
  expect(fillEmail).toMatchObject({ ok: true });
  expect(await page.$eval('#email', (el) => (el as HTMLInputElement).value)).toBe('hazem');
  expect(String((fillEmail as any).speech || '')).toContain('part before the at sign');
  expect(await page.evaluate(() => (document.activeElement as HTMLElement)?.id || '')).toBe('email');

  const confirmEmailLocal = await typed('yes');
  expect(confirmEmailLocal).toMatchObject({ ok: true });
  expect(await page.$eval('#email', (el) => (el as HTMLInputElement).value)).toBe('hazem@example.com');
  expect(String((confirmEmailLocal as any).speech || '')).toContain('part after the at sign');
  expect(String((confirmEmailLocal as any).speech || '')).toContain('example.com');

  const confirmEmail = await typed('yes');
  expect(confirmEmail).toMatchObject({ ok: true });
  expect(String((confirmEmail as any).speech || '')).toContain('Field 2 of 4: Password');
  expect(await page.evaluate(() => (document.activeElement as HTMLElement)?.id || '')).toBe('password');

  const fillPassword = await typed('fill supersecret');
  expect(fillPassword).toMatchObject({ ok: true });
  expect(await page.$eval('#password', (el) => (el as HTMLInputElement).value)).toBe('supersecret');
  expect(String((fillPassword as any).speech || '')).toContain('Password');
  expect(String((fillPassword as any).speech || '')).toContain('s, u, p');

  const confirmPassword = await typed('yes');
  expect(confirmPassword).toMatchObject({ ok: true });
  expect(String((confirmPassword as any).speech || '')).toContain('Field 3 of 4: Country');

  const chooseCountry = await typed('select Jordan');
  expect(chooseCountry).toMatchObject({ ok: true });
  expect(await page.$eval('#country', (el) => (el as HTMLSelectElement).value)).toBe('jo');
  expect(String((chooseCountry as any).speech || '')).toContain('Say yes to keep it');

  const confirmCountry = await typed('yes');
  expect(confirmCountry).toMatchObject({ ok: true });
  expect(String((confirmCountry as any).speech || '')).toContain('Field 4 of 4: Accept terms');

  const checkTerms = await typed('check');
  expect(checkTerms).toMatchObject({ ok: true });
  expect(await page.$eval('#terms', (el) => (el as HTMLInputElement).checked)).toBe(true);
  expect(String((checkTerms as any).speech || '')).toContain('Say yes to keep it');

  const confirmTerms = await typed('yes');
  expect(confirmTerms).toMatchObject({ ok: true });
  expect(String((confirmTerms as any).speech || '')).toContain('That was the last field');

  const submit = await typed('submit form');
  expect(submit).toMatchObject({ ok: true });
  expect(await page.evaluate(() => Boolean((window as any).submitted))).toBe(true);
});

test('typed form mode can handle radio choice groups', async ({ page }) => {
  await page.setContent(`
    <main>
      <form>
        <fieldset>
          <legend>Account type</legend>
          <label><input type="radio" name="accountType" value="personal" /> Personal</label>
          <label><input type="radio" name="accountType" value="business" /> Business</label>
        </fieldset>
      </form>
    </main>
  `);
  await installTypedCommandHarness(page);
  await page.addScriptTag({ path: 'src/common/announce.js' });
  await page.addScriptTag({ path: 'src/common/i18n.js' });
  await page.addScriptTag({ path: 'src/common/speech.js' });
  await page.addScriptTag({ path: 'src/content.js' });

  await page.waitForFunction(() => (window as any).__contentListeners?.length > 0);

  async function typed(text: string) {
    return await page.evaluate(async (utterance) => {
      // @ts-ignore
      const listener = (window as any).__contentListeners[0];
      return await new Promise((resolve, reject) => {
        try {
          listener({ type: 'navable:runTypedCommand', text: utterance, detectedLanguage: 'en' }, {}, resolve);
        } catch (err) {
          reject(err);
        }
      });
    }, text);
  }

  const start = await typed('form mode');
  expect(start).toMatchObject({ ok: true });
  expect(String((start as any).speech || '')).toContain('Account type');
  expect(String((start as any).speech || '')).toContain('Personal');
  expect(String((start as any).speech || '')).toContain('Business');

  const choose = await typed('choose business');
  expect(choose).toMatchObject({ ok: true });
  expect(await page.$eval('input[value="business"]', (el) => (el as HTMLInputElement).checked)).toBe(true);
  expect(String((choose as any).speech || '')).toContain('Say yes to keep it');

  const confirm = await typed('yes');
  expect(confirm).toMatchObject({ ok: true });
  expect(String((confirm as any).speech || '')).toContain('That was the last field');
});

test('typed form mode review prefers semantic field labels over placeholders and option text', async ({ page }) => {
  await page.setContent(`
    <main>
      <form>
        <div class="row">
          <div class="label-col">Email</div>
          <div class="input-col">
            <input type="email" value="hazemsalameh3456@gmail.com" placeholder="name@example.com" />
          </div>
        </div>
        <div class="row">
          <div class="label-col">Gender</div>
          <div class="input-col">
            <label><input type="radio" name="gender" value="male" /> Male</label>
            <label><input type="radio" name="gender" value="female" /> Female</label>
            <label><input type="radio" name="gender" value="other" checked /> Other</label>
          </div>
        </div>
        <div class="row">
          <div class="label-col">Date of Birth</div>
          <div class="input-col">
            <input type="text" value="15 Apr 2026" />
          </div>
        </div>
      </form>
    </main>
  `);
  await installTypedCommandHarness(page);
  await page.addScriptTag({ path: 'src/common/announce.js' });
  await page.addScriptTag({ path: 'src/common/i18n.js' });
  await page.addScriptTag({ path: 'src/common/speech.js' });
  await page.addScriptTag({ path: 'src/content.js' });

  await page.waitForFunction(() => (window as any).__contentListeners?.length > 0);

  async function typed(text: string) {
    return await page.evaluate(async (utterance) => {
      // @ts-ignore
      const listener = (window as any).__contentListeners[0];
      return await new Promise((resolve, reject) => {
        try {
          listener({ type: 'navable:runTypedCommand', text: utterance, detectedLanguage: 'en' }, {}, resolve);
        } catch (err) {
          reject(err);
        }
      });
    }, text);
  }

  const start = await typed('form mode');
  expect(start).toMatchObject({ ok: true });
  expect(String((start as any).speech || '')).toContain('Field 1 of 3: Email');
  expect(String((start as any).speech || '')).not.toContain('name@example.com');

  const review = await typed('review form');
  expect(review).toMatchObject({ ok: true });
  const speech = String((review as any).speech || '');
  expect(speech).toContain('Email: hazemsalameh3456@gmail.com');
  expect(speech).toContain('Gender: Other');
  expect(speech).toContain('Date of Birth: 15 Apr 2026');
  expect(speech).not.toContain('name@example.com:');
  expect(speech).not.toContain('Male: Other');
  expect(speech).not.toContain('15 Apr 2026: 15 Apr 2026');
});

test('typed form mode prefers a real auth form over a small search form', async ({ page }) => {
  await page.setContent(`
    <main>
      <form id="search-form">
        <label for="q">Search</label>
        <input id="q" type="search" />
      </form>
      <form id="login-form">
        <label for="email">Email</label>
        <input id="email" type="email" required />
        <label for="password">Password</label>
        <input id="password" type="password" required />
      </form>
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
        listener({ type: 'navable:runTypedCommand', text: 'guide me through the form', detectedLanguage: 'en' }, {}, resolve);
      } catch (err) {
        reject(err);
      }
    });
  });

  expect(response).toMatchObject({ ok: true });
  expect(String((response as any).speech || '')).toContain('Email');
  expect(await page.evaluate(() => (document.activeElement as HTMLElement)?.id || '')).toBe('email');
});

test('typed form mode supports named field fill and labeled option commands', async ({ page }) => {
  await page.setContent(`
    <main>
      <form id="signup">
        <label for="email">Email</label>
        <input id="email" name="email" type="email" required />
        <label for="password">Password</label>
        <input id="password" name="password" type="password" required />
        <label for="country">Country</label>
        <select id="country" name="country">
          <option value="">Choose country</option>
          <option value="jo">Jordan</option>
          <option value="lb">Lebanon</option>
        </select>
        <label><input id="terms" type="checkbox" /> Accept terms</label>
      </form>
    </main>
  `);
  await installTypedCommandHarness(page);
  await page.addScriptTag({ path: 'src/common/announce.js' });
  await page.addScriptTag({ path: 'src/common/i18n.js' });
  await page.addScriptTag({ path: 'src/common/speech.js' });
  await page.addScriptTag({ path: 'src/content.js' });

  await page.waitForFunction(() => (window as any).__contentListeners?.length > 0);

  async function typed(text: string) {
    return await page.evaluate(async (utterance) => {
      // @ts-ignore
      const listener = (window as any).__contentListeners[0];
      return await new Promise((resolve, reject) => {
        try {
          listener({ type: 'navable:runTypedCommand', text: utterance, detectedLanguage: 'en' }, {}, resolve);
        } catch (err) {
          reject(err);
        }
      });
    }, text);
  }

  await typed('help me fill the form');

  const fillPassword = await typed('fill password with supersecret');
  expect(fillPassword).toMatchObject({ ok: true });
  expect(await page.$eval('#password', (el) => (el as HTMLInputElement).value)).toBe('supersecret');
  expect(String((fillPassword as any).speech || '')).toContain('s, u, p');
  expect(String((fillPassword as any).speech || '')).toContain('Say yes to keep it');
  await typed('yes');

  const fillEmail = await typed('type hazem@example.com into email');
  expect(fillEmail).toMatchObject({ ok: true });
  expect(await page.$eval('#email', (el) => (el as HTMLInputElement).value)).toBe('hazem');
  expect(String((fillEmail as any).speech || '')).toContain('part before the at sign');
  await typed('yes');
  expect(await page.$eval('#email', (el) => (el as HTMLInputElement).value)).toBe('hazem@example.com');
  await typed('yes');

  const selectCountry = await typed('select Jordan for country');
  expect(selectCountry).toMatchObject({ ok: true });
  expect(await page.$eval('#country', (el) => (el as HTMLSelectElement).value)).toBe('jo');
  expect(String((selectCountry as any).speech || '')).toContain('Say yes to keep it');
  await typed('yes');

  const checkTerms = await typed('check accept terms');
  expect(checkTerms).toMatchObject({ ok: true });
  expect(await page.$eval('#terms', (el) => (el as HTMLInputElement).checked)).toBe(true);
  expect(String((checkTerms as any).speech || '')).toContain('Say yes to keep it');
});

test('typed form mode normalizes spoken email structure', async ({ page }) => {
  await page.setContent(`
    <main>
      <form>
        <label for="email">Email</label>
        <input id="email" name="email" type="email" required />
        <label for="name">Name</label>
        <input id="name" name="name" type="text" required />
      </form>
    </main>
  `);
  await installTypedCommandHarness(page);
  await page.addScriptTag({ path: 'src/common/announce.js' });
  await page.addScriptTag({ path: 'src/common/i18n.js' });
  await page.addScriptTag({ path: 'src/common/speech.js' });
  await page.addScriptTag({ path: 'src/content.js' });

  await page.waitForFunction(() => (window as any).__contentListeners?.length > 0);

  async function typed(text: string) {
    return await page.evaluate(async (utterance) => {
      // @ts-ignore
      const listener = (window as any).__contentListeners[0];
      return await new Promise((resolve, reject) => {
        try {
          listener({ type: 'navable:runTypedCommand', text: utterance, detectedLanguage: 'en' }, {}, resolve);
        } catch (err) {
          reject(err);
        }
      });
    }, text);
  }

  await typed('form mode');
  const fillEmail = await typed('hazem salameh at gmail dot com');
  expect(fillEmail).toMatchObject({ ok: true });
  expect(await page.$eval('#email', (el) => (el as HTMLInputElement).value)).toBe('hazemsalameh');
  expect(String((fillEmail as any).speech || '')).toContain('part before the at sign');
  expect(String((fillEmail as any).speech || '')).toContain('hazemsalameh');

  const confirmLocal = await typed('yes');
  expect(confirmLocal).toMatchObject({ ok: true });
  expect(await page.$eval('#email', (el) => (el as HTMLInputElement).value)).toBe('hazemsalameh@gmail.com');
  expect(String((confirmLocal as any).speech || '')).toContain('part after the at sign');
  expect(String((confirmLocal as any).speech || '')).toContain('gmail.com');

  const confirmTail = await typed('yes');
  expect(confirmTail).toMatchObject({ ok: true });
  expect(String((confirmTail as any).speech || '')).toContain('Field 2 of 2: Name');
});

test('typed form mode accepts the full email tail after the at sign', async ({ page }) => {
  await page.setContent(`
    <main>
      <form>
        <label for="email">Email</label>
        <input id="email" name="email" type="email" required />
        <label for="name">Name</label>
        <input id="name" name="name" type="text" required />
      </form>
    </main>
  `);
  await installTypedCommandHarness(page);
  await page.addScriptTag({ path: 'src/common/announce.js' });
  await page.addScriptTag({ path: 'src/common/i18n.js' });
  await page.addScriptTag({ path: 'src/common/speech.js' });
  await page.addScriptTag({ path: 'src/content.js' });

  await page.waitForFunction(() => (window as any).__contentListeners?.length > 0);

  async function typed(text: string) {
    return await page.evaluate(async (utterance) => {
      // @ts-ignore
      const listener = (window as any).__contentListeners[0];
      return await new Promise((resolve, reject) => {
        try {
          listener({ type: 'navable:runTypedCommand', text: utterance, detectedLanguage: 'en' }, {}, resolve);
        } catch (err) {
          reject(err);
        }
      });
    }, text);
  }

  await typed('form mode');
  await typed('hazem');

  const confirmLocal = await typed('yes');
  expect(confirmLocal).toMatchObject({ ok: true });
  expect(String((confirmLocal as any).speech || '')).toContain('what you want after the at sign');
  expect(String((confirmLocal as any).speech || '')).toContain('gmail dot com');

  const chooseTail = await typed('gmail.com');
  expect(chooseTail).toMatchObject({ ok: true });
  expect(await page.$eval('#email', (el) => (el as HTMLInputElement).value)).toBe('hazem@gmail.com');
  expect(String((chooseTail as any).speech || '')).toContain('part after the at sign');
  expect(String((chooseTail as any).speech || '')).toContain('gmail.com');

  const confirmTail = await typed('yes');
  expect(confirmTail).toMatchObject({ ok: true });
  expect(String((confirmTail as any).speech || '')).toContain('Field 2 of 2: Name');
});

test('typed form mode spells email segments after repeated corrections', async ({ page }) => {
  await page.setContent(`
    <main>
      <form>
        <label for="email">Email</label>
        <input id="email" name="email" type="email" required />
        <label for="name">Name</label>
        <input id="name" name="name" type="text" required />
      </form>
    </main>
  `);
  await installTypedCommandHarness(page);
  await page.addScriptTag({ path: 'src/common/announce.js' });
  await page.addScriptTag({ path: 'src/common/i18n.js' });
  await page.addScriptTag({ path: 'src/common/speech.js' });
  await page.addScriptTag({ path: 'src/content.js' });

  await page.waitForFunction(() => (window as any).__contentListeners?.length > 0);

  async function typed(text: string) {
    return await page.evaluate(async (utterance) => {
      // @ts-ignore
      const listener = (window as any).__contentListeners[0];
      return await new Promise((resolve, reject) => {
        try {
          listener({ type: 'navable:runTypedCommand', text: utterance, detectedLanguage: 'en' }, {}, resolve);
        } catch (err) {
          reject(err);
        }
      });
    }, text);
  }

  await typed('form mode');
  await typed('hazem');

  const confirmLocal = await typed('yes');
  expect(confirmLocal).toMatchObject({ ok: true });
  expect(String((confirmLocal as any).speech || '')).toContain('what you want after the at sign');

  const firstTail = await typed('gmeal.com');
  expect(firstTail).toMatchObject({ ok: true });
  expect(await page.$eval('#email', (el) => (el as HTMLInputElement).value)).toBe('hazem@gmeal.com');

  const rejectFirst = await typed('no');
  expect(rejectFirst).toMatchObject({ ok: true });
  expect(String((rejectFirst as any).speech || '')).toContain('what you want after the at sign');
  expect(await page.$eval('#email', (el) => (el as HTMLInputElement).value)).toBe('hazem');

  const secondTail = await typed('gmale.com');
  expect(secondTail).toMatchObject({ ok: true });
  expect(await page.$eval('#email', (el) => (el as HTMLInputElement).value)).toBe('hazem@gmale.com');

  const rejectSecond = await typed('no');
  expect(rejectSecond).toMatchObject({ ok: true });
  expect(String((rejectSecond as any).speech || '')).toContain('Please spell it letter by letter');
  expect(await page.$eval('#email', (el) => (el as HTMLInputElement).value)).toBe('hazem');

  const spelledTail = await typed('g m a i l dot c o m');
  expect(spelledTail).toMatchObject({ ok: true });
  expect(await page.$eval('#email', (el) => (el as HTMLInputElement).value)).toBe('hazem@gmail.com');
  expect(String((spelledTail as any).speech || '')).toContain('gmail.com');
});

test('typed form mode keeps long-text fields in chunked dictation on the same field', async ({ page }) => {
  await page.setContent(`
    <main>
      <form>
        <label for="description">Description</label>
        <textarea id="description" name="description" rows="5"></textarea>
        <label for="email">Email</label>
        <input id="email" name="email" type="email" />
      </form>
    </main>
  `);
  await installTypedCommandHarness(page);
  await page.addScriptTag({ path: 'src/common/announce.js' });
  await page.addScriptTag({ path: 'src/common/i18n.js' });
  await page.addScriptTag({ path: 'src/common/speech.js' });
  await page.addScriptTag({ path: 'src/content.js' });

  await page.waitForFunction(() => (window as any).__contentListeners?.length > 0);

  async function typed(text: string) {
    return await page.evaluate(async (utterance) => {
      // @ts-ignore
      const listener = (window as any).__contentListeners[0];
      return await new Promise((resolve, reject) => {
        try {
          listener({ type: 'navable:runTypedCommand', text: utterance, detectedLanguage: 'en' }, {}, resolve);
        } catch (err) {
          reject(err);
        }
      });
    }, text);
  }

  const start = await typed('form mode');
  expect(start).toMatchObject({ ok: true });
  expect(String((start as any).speech || '')).toContain('Dictate one sentence or chunk at a time');

  const firstChunk = await typed('I built Navable for blind web browsing');
  expect(firstChunk).toMatchObject({ ok: true });
  expect(String((firstChunk as any).speech || '')).toContain('Say yes to keep it');

  const confirmFirst = await typed('yes');
  expect(confirmFirst).toMatchObject({ ok: true });
  expect(String((confirmFirst as any).speech || '')).toContain('You can keep dictating');
  expect(await page.evaluate(() => (document.activeElement as HTMLElement)?.id || '')).toBe('description');

  const secondChunk = await typed('new paragraph It reads page structure and forms');
  expect(secondChunk).toMatchObject({ ok: true });
  expect(String((secondChunk as any).speech || '')).toContain('Say yes to keep it');

  await typed('yes');
  const review = await typed('review field');
  expect(review).toMatchObject({ ok: true });
  expect(String((review as any).speech || '')).toContain('Description currently says');
  expect(String((review as any).speech || '')).toContain('I built Navable');
  expect(String((review as any).speech || '')).toContain('It reads page structure and forms');

  const undo = await typed('undo last');
  expect(undo).toMatchObject({ ok: true });
  expect(String((undo as any).speech || '')).toContain('Removed the last part');

  const textValue = await page.$eval('#description', (el) => (el as HTMLTextAreaElement).value);
  expect(textValue).toContain('I built Navable for blind web browsing');
  expect(textValue).not.toContain('It reads page structure and forms');

  const next = await typed('next');
  expect(next).toMatchObject({ ok: true });
  expect(String((next as any).speech || '')).toContain('Field 2 of 2: Email');
});

test('typed broad form help phrases start form mode locally', async ({ page }) => {
  await page.setContent(`
    <main>
      <form>
        <label for="email">Email</label>
        <input id="email" type="email" required />
      </form>
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
        listener({ type: 'navable:runTypedCommand', text: 'help me with this form', detectedLanguage: 'en' }, {}, resolve);
      } catch (err) {
        reject(err);
      }
    });
  });

  expect(response).toMatchObject({ ok: true });
  expect(String((response as any).speech || '')).toContain('Form mode started');

  const messages = await page.evaluate(() => (window as any).__contentMessages || []);
  expect(messages.find((msg: any) => msg && msg.type === 'navable:assistant')).toBeFalsy();
});

test('typed current-page summary phrases stay on the current page and recover common describe misspellings', async ({ page }) => {
  await page.setContent(`
    <html>
      <head><title>Pricing</title></head>
      <body>
        <main>
          <h1>Pricing</h1>
          <p>Choose a plan for your team.</p>
        </main>
      </body>
    </html>
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
        listener({ type: 'navable:runTypedCommand', text: 'discribe the page', detectedLanguage: 'en' }, {}, resolve);
      } catch (err) {
        reject(err);
      }
    });
  });

  expect(response).toMatchObject({ ok: true });
  const messages = await page.evaluate(() => (window as any).__contentMessages || []);
  expect(messages.find((msg: any) => msg && msg.type === 'planner:run')).toBeTruthy();
  expect(messages.find((msg: any) => msg && msg.type === 'navable:assistant')).toBeFalsy();
});

test('typed fill command can auto-start form mode and fill by field name', async ({ page }) => {
  await page.setContent(`
    <main>
      <form>
        <label for="first-name">First name</label>
        <input id="first-name" name="firstName" type="text" required />
        <label for="email">Email</label>
        <input id="email" name="email" type="email" required />
      </form>
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
        listener({ type: 'navable:runTypedCommand', text: 'fill first name with Hasim', detectedLanguage: 'en' }, {}, resolve);
      } catch (err) {
        reject(err);
      }
    });
  });

  expect(response).toMatchObject({ ok: true });
  expect(await page.$eval('#first-name', (el) => (el as HTMLInputElement).value)).toBe('Hasim');
  expect(String((response as any).speech || '')).toContain('Say yes to keep it');

  const confirm = await page.evaluate(async () => {
    // @ts-ignore
    const listener = (window as any).__contentListeners[0];
    return await new Promise((resolve, reject) => {
      try {
        listener({ type: 'navable:runTypedCommand', text: 'yes', detectedLanguage: 'en' }, {}, resolve);
      } catch (err) {
        reject(err);
      }
    });
  });

  expect(confirm).toMatchObject({ ok: true });
  expect(String((confirm as any).speech || '')).toContain('Field 2 of 2: Email');
});

test('typed go-through form phrasing stays local to the current page form', async ({ page }) => {
  await page.setContent(`
    <main>
      <form id="signup">
        <label for="email">Email</label>
        <input id="email" type="email" required />
      </form>
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
        listener({ type: 'navable:runTypedCommand', text: "let's go through this form", detectedLanguage: 'en' }, {}, resolve);
      } catch (err) {
        reject(err);
      }
    });
  });

  expect(response).toMatchObject({ ok: true });
  expect(String((response as any).speech || '')).toContain('Form mode started');
  const messages = await page.evaluate(() => (window as any).__contentMessages || []);
  expect(messages.find((msg: any) => msg && msg.type === 'navable:assistant')).toBeFalsy();
});

test('typed form mode recovers near-miss fill verbs and stays locked in form context', async ({ page }) => {
  await page.setContent(`
    <main>
      <form id="signup">
        <label for="first-name">First name</label>
        <input id="first-name" name="firstName" type="text" required />
        <label for="last-name">Last name</label>
        <input id="last-name" name="lastName" type="text" required />
      </form>
    </main>
  `);
  await installTypedCommandHarness(page);
  await page.addScriptTag({ path: 'src/common/announce.js' });
  await page.addScriptTag({ path: 'src/common/i18n.js' });
  await page.addScriptTag({ path: 'src/common/speech.js' });
  await page.addScriptTag({ path: 'src/content.js' });

  await page.waitForFunction(() => (window as any).__contentListeners?.length > 0);

  async function typed(text: string) {
    return await page.evaluate(async (utterance) => {
      // @ts-ignore
      const listener = (window as any).__contentListeners[0];
      return await new Promise((resolve, reject) => {
        try {
          listener({ type: 'navable:runTypedCommand', text: utterance, detectedLanguage: 'en' }, {}, resolve);
        } catch (err) {
          reject(err);
        }
      });
    }, text);
  }

  await typed('guide me through the form');

  const nearMissFill = await typed('phil first name with Hasim');
  expect(nearMissFill).toMatchObject({ ok: true });
  expect(await page.$eval('#first-name', (el) => (el as HTMLInputElement).value)).toBe('Hasim');
  expect(String((nearMissFill as any).speech || '')).toContain('Say yes to keep it');

  const locked = await typed('what is machine learning');
  expect(locked).toMatchObject({ ok: true });
  expect(String((locked as any).speech || '')).toContain('Say yes to keep it');

  const messages = await page.evaluate(() => (window as any).__contentMessages || []);
  expect(messages.find((msg: any) => msg && msg.type === 'navable:assistant')).toBeFalsy();
});

test('typed form mode reviews entered values before submit', async ({ page }) => {
  await page.setContent(`
    <main>
      <form id="signup">
        <label for="first-name">First name</label>
        <input id="first-name" name="firstName" type="text" required />
        <label for="password">Password</label>
        <input id="password" name="password" type="password" required />
        <button type="submit">Create account</button>
      </form>
    </main>
  `);
  await page.evaluate(() => {
    const form = document.getElementById('signup') as HTMLFormElement;
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      // @ts-ignore
      window.submitted = true;
    });
  });
  await installTypedCommandHarness(page);
  await page.addScriptTag({ path: 'src/common/announce.js' });
  await page.addScriptTag({ path: 'src/common/i18n.js' });
  await page.addScriptTag({ path: 'src/common/speech.js' });
  await page.addScriptTag({ path: 'src/content.js' });

  await page.waitForFunction(() => (window as any).__contentListeners?.length > 0);

  async function typed(text: string) {
    return await page.evaluate(async (utterance) => {
      // @ts-ignore
      const listener = (window as any).__contentListeners[0];
      return await new Promise((resolve, reject) => {
        try {
          listener({ type: 'navable:runTypedCommand', text: utterance, detectedLanguage: 'en' }, {}, resolve);
        } catch (err) {
          reject(err);
        }
      });
    }, text);
  }

  await typed('form mode');
  await typed('Hasim');
  await typed('yes');
  await typed('fill password with supersecret');
  await typed('yes');

  const review = await typed('finish');
  expect(review).toMatchObject({ ok: true });
  expect(String((review as any).speech || '')).toContain('Form review');
  expect(String((review as any).speech || '')).toContain('First name: Hasim');
  expect(String((review as any).speech || '')).toContain('Password: s, u, p');
  expect(await page.evaluate(() => Boolean((window as any).submitted))).toBe(false);

  const submit = await typed('submit');
  expect(submit).toMatchObject({ ok: true });
  expect(await page.evaluate(() => Boolean((window as any).submitted))).toBe(true);
});

test('typed form mode blocks moving on until confirmation and asks for spelling after repeated corrections', async ({ page }) => {
  await page.setContent(`
    <main>
      <form>
        <label for="first-name">First name</label>
        <input id="first-name" name="firstName" type="text" required />
        <label for="email">Email</label>
        <input id="email" name="email" type="email" required />
      </form>
    </main>
  `);
  await installTypedCommandHarness(page);
  await page.addScriptTag({ path: 'src/common/announce.js' });
  await page.addScriptTag({ path: 'src/common/i18n.js' });
  await page.addScriptTag({ path: 'src/common/speech.js' });
  await page.addScriptTag({ path: 'src/content.js' });

  await page.waitForFunction(() => (window as any).__contentListeners?.length > 0);

  async function typed(text: string) {
    return await page.evaluate(async (utterance) => {
      // @ts-ignore
      const listener = (window as any).__contentListeners[0];
      return await new Promise((resolve, reject) => {
        try {
          listener({ type: 'navable:runTypedCommand', text: utterance, detectedLanguage: 'en' }, {}, resolve);
        } catch (err) {
          reject(err);
        }
      });
    }, text);
  }

  await typed('form mode');

  const initialFill = await typed('fill Hasem');
  expect(initialFill).toMatchObject({ ok: true });
  expect((initialFill as any).feedback).toMatchObject({ status: 'clarification_needed' });
  expect(String((initialFill as any).speech || '')).toContain('Say yes to keep it');
  expect(await page.evaluate(() => (document.activeElement as HTMLElement)?.id || '')).toBe('first-name');

  const strayValue = await typed('Hazim');
  expect(strayValue).toMatchObject({ ok: true });
  expect(String((strayValue as any).speech || '')).toContain('I have not changed First name');
  expect(await page.$eval('#first-name', (el) => (el as HTMLInputElement).value)).toBe('Hasem');

  const blockedNext = await typed('next');
  expect(blockedNext).toMatchObject({ ok: true });
  expect(String((blockedNext as any).speech || '')).toContain('Say yes to keep it');
  expect(await page.evaluate(() => (document.activeElement as HTMLElement)?.id || '')).toBe('first-name');

  await typed('no');
  const retryOne = await typed('Hazem');
  expect(retryOne).toMatchObject({ ok: true });
  expect(String((retryOne as any).speech || '')).toContain('Say yes to keep it');

  await typed('no');
  const retryTwo = await typed('Hasim');
  expect(retryTwo).toMatchObject({ ok: true });
  expect(String((retryTwo as any).speech || '')).toContain('Say yes to keep it');

  const spellingPrompt = await typed('no');
  expect(spellingPrompt).toMatchObject({ ok: true });
  expect(String((spellingPrompt as any).speech || '')).toContain('Please spell it letter by letter');

  const spelled = await typed('H A Z I M');
  expect(spelled).toMatchObject({ ok: true });
  expect(await page.$eval('#first-name', (el) => (el as HTMLInputElement).value)).toBe('h a z i m'.replace(/\s+/g, ''));
  expect(String((spelled as any).speech || '')).toContain('Say yes to keep it');

  const confirmed = await typed('yes');
  expect(confirmed).toMatchObject({ ok: true });
  expect(String((confirmed as any).speech || '')).toContain('Field 2 of 2: Email');
  expect(await page.evaluate(() => (document.activeElement as HTMLElement)?.id || '')).toBe('email');
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

test('runStep clicks labeled controls inside same-origin iframes', async ({ page }) => {
  await page.setContent(`
    <main>
      <iframe id="auth-frame"></iframe>
    </main>
  `);
  await page.evaluate(() => {
    const frame = document.getElementById('auth-frame') as HTMLIFrameElement;
    const doc = frame.contentDocument!;
    doc.open();
    doc.write('<main><button id="continue-btn">Continue</button></main>');
    doc.close();
    const button = doc.getElementById('continue-btn') as HTMLButtonElement;
    button.onclick = () => {
      // @ts-ignore
      top.frameClicked = 'continue';
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
  expect(await page.evaluate(() => (window as any).frameClicked || '')).toBe('continue');
});

test('runStep clicks labeled controls inside open shadow roots', async ({ page }) => {
  await page.setContent(`
    <main>
      <div id="shadow-host"></div>
    </main>
  `);
  await page.evaluate(() => {
    const host = document.getElementById('shadow-host') as HTMLDivElement;
    const shadow = host.attachShadow({ mode: 'open' });
    const button = document.createElement('button');
    button.textContent = 'Use another profile';
    button.onclick = () => {
      // @ts-ignore
      window.shadowClicked = 'profile';
    };
    shadow.appendChild(button);
  });
  await page.addScriptTag({ path: 'src/common/announce.js' });
  await page.addScriptTag({ path: 'src/content.js' });

  await page.waitForFunction(() => (window as any).NavableTools?.runStep);

  const result = await page.evaluate(async () => {
    // @ts-ignore
    return await (window as any).NavableTools.runStep({ action: 'click_element', targetType: 'button', label: 'Use another profile' });
  });

  expect(result.ok).toBe(true);
  expect(await page.evaluate(() => (window as any).shadowClicked || '')).toBe('profile');
});

test('runStep focuses inputs inside same-origin iframes', async ({ page }) => {
  await page.setContent(`
    <main>
      <iframe id="auth-frame"></iframe>
    </main>
  `);
  await page.evaluate(() => {
    const frame = document.getElementById('auth-frame') as HTMLIFrameElement;
    const doc = frame.contentDocument!;
    doc.open();
    doc.write('<main><label for="email">Email</label><input id="email" type="email" /></main>');
    doc.close();
  });
  await page.addScriptTag({ path: 'src/common/announce.js' });
  await page.addScriptTag({ path: 'src/content.js' });

  await page.waitForFunction(() => (window as any).NavableTools?.runStep);

  const result = await page.evaluate(async () => {
    // @ts-ignore
    return await (window as any).NavableTools.runStep({ action: 'focus_element', targetType: 'input', label: 'Email' });
  });

  expect(result.ok).toBe(true);
  expect(await page.evaluate(() => {
    const frame = document.getElementById('auth-frame') as HTMLIFrameElement;
    const doc = frame.contentDocument!;
    return (doc.activeElement && (doc.activeElement as HTMLElement).id) || '';
  })).toBe('email');
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

test('runStep clicks pointer-styled delegated clickables by label', async ({ page }) => {
  await page.setContent(`
    <main>
      <div id="continue-card" style="cursor: pointer"><span>Continue</span></div>
    </main>
  `);
  await page.evaluate(() => {
    const control = document.getElementById('continue-card') as HTMLDivElement;
    control.addEventListener('click', () => {
      // @ts-ignore
      window.clicked = 'delegated';
    });
  });
  await page.addScriptTag({ path: 'src/common/announce.js' });
  await page.addScriptTag({ path: 'src/content.js' });

  await page.waitForFunction(() => (window as any).NavableTools?.runStep);

  const result = await page.evaluate(async () => {
    // @ts-ignore
    return await (window as any).NavableTools.runStep({ action: 'click_element', targetType: 'button', label: 'Continue' });
  });

  expect(result.ok).toBe(true);
  expect(await page.evaluate(() => (window as any).clicked || '')).toBe('delegated');
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

test('runStep retries long enough for a late delegated clickable to appear', async ({ page }) => {
  await page.setContent(`
    <main id="root"></main>
    <script>
      setTimeout(() => {
        const control = document.createElement('div');
        control.id = 'late-continue';
        control.style.cursor = 'pointer';
        const label = document.createElement('span');
        label.textContent = 'Continue';
        control.appendChild(label);
        control.addEventListener('click', () => { window.clicked = 'late'; });
        document.getElementById('root').appendChild(control);
      }, 950);
    </script>
  `);
  await page.addScriptTag({ path: 'src/common/announce.js' });
  await page.addScriptTag({ path: 'src/content.js' });

  await page.waitForFunction(() => (window as any).NavableTools?.runStep);

  const result = await page.evaluate(async () => {
    // @ts-ignore
    return await (window as any).NavableTools.runStep({ action: 'click_element', targetType: 'button', label: 'Continue' });
  });

  expect(result.ok).toBe(true);
  expect(await page.evaluate(() => (window as any).clicked || '')).toBe('late');
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

test('typed click miss reports a control miss instead of a link miss for auto actions', async ({ page }) => {
  await page.setContent(`
    <main>
      <div id="continue-card" style="cursor: pointer"><span>Continue</span></div>
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
        listener({ type: 'navable:runTypedCommand', text: 'click missing option', detectedLanguage: 'en' }, {}, resolve);
      } catch (err) {
        reject(err);
      }
    });
  });

  expect(response).toMatchObject({ ok: true });
  expect(String((response as any).speech || '')).toContain('control');
  expect(String((response as any).speech || '')).not.toContain('link');
});

test('typed list link request is handled locally instead of assistant fallback', async ({ page }) => {
  await page.setContent(`
    <main>
      <a href="#pricing">Pricing</a>
      <a href="#docs">Docs</a>
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
        listener({ type: 'navable:runTypedCommand', text: 'list link of this page', detectedLanguage: 'en' }, {}, resolve);
      } catch (err) {
        reject(err);
      }
    });
  });

  expect(response).toMatchObject({ ok: true });
  expect(String((response as any).speech || '')).toContain('Links:');
  expect(String((response as any).speech || '')).toContain('Pricing');
  expect(String((response as any).speech || '')).toContain('Docs');

  const messages = await page.evaluate(() => (window as any).__contentMessages || []);
  expect(messages.find((msg: any) => msg && msg.type === 'navable:assistant')).toBeFalsy();
});

test('typed click can activate pointer-styled delegated controls', async ({ page }) => {
  await page.setContent(`
    <main>
      <div id="continue-card" style="cursor: pointer"><span>Continue</span></div>
    </main>
  `);
  await page.evaluate(() => {
    const control = document.getElementById('continue-card') as HTMLDivElement;
    control.addEventListener('click', () => {
      // @ts-ignore
      window.clicked = 'delegated-typed';
    });
  });
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
        listener({ type: 'navable:runTypedCommand', text: 'click continue', detectedLanguage: 'en' }, {}, resolve);
      } catch (err) {
        reject(err);
      }
    });
  });

  expect(response).toMatchObject({ ok: true });
  expect(await page.evaluate(() => (window as any).clicked || '')).toBe('delegated-typed');
});

test('typed ambiguity responses include semantic context and accept ordinal follow-up', async ({ page }) => {
  await page.setContent(`
    <main>
      <section aria-label="saved profile">
        <h2>Hazem Salameh</h2>
        <button onclick="window.clicked = 'saved-profile'">Continue</button>
      </section>
      <section aria-label="account chooser">
        <h2>Use another account</h2>
        <button onclick="window.clicked = 'account-chooser'">Continue</button>
      </section>
    </main>
  `);
  await installTypedCommandHarness(page);
  await page.addScriptTag({ path: 'src/common/announce.js' });
  await page.addScriptTag({ path: 'src/common/i18n.js' });
  await page.addScriptTag({ path: 'src/common/speech.js' });
  await page.addScriptTag({ path: 'src/content.js' });

  await page.waitForFunction(() => (window as any).__contentListeners?.length > 0);

  const firstResponse = await page.evaluate(async () => {
    // @ts-ignore
    const listener = (window as any).__contentListeners[0];
    return await new Promise((resolve, reject) => {
      try {
        listener({ type: 'navable:runTypedCommand', text: 'click continue', detectedLanguage: 'en' }, {}, resolve);
      } catch (err) {
        reject(err);
      }
    });
  });

  expect(firstResponse).toMatchObject({ ok: true });
  expect((firstResponse as any).feedback).toMatchObject({ status: 'clarification_needed' });
  expect(String((firstResponse as any).speech || '')).toContain('Hazem Salameh');
  expect(String((firstResponse as any).speech || '')).toContain('Use another account');
  expect(await page.evaluate(() => (window as any).clicked || '')).toBe('');

  const followUpResponse = await page.evaluate(async () => {
    // @ts-ignore
    const listener = (window as any).__contentListeners[0];
    return await new Promise((resolve, reject) => {
      try {
        listener({ type: 'navable:runTypedCommand', text: 'first', detectedLanguage: 'en' }, {}, resolve);
      } catch (err) {
        reject(err);
      }
    });
  });

  expect(followUpResponse).toMatchObject({ ok: true });
  expect((followUpResponse as any).feedback).toMatchObject({ status: 'success' });
  expect(await page.evaluate(() => (window as any).clicked || '')).toBe('saved-profile');
});

test('typed ambiguity follow-up can resolve by semantic context name', async ({ page }) => {
  await page.setContent(`
    <main>
      <section aria-label="saved profile">
        <h2>Hazem Salameh</h2>
        <button onclick="window.clicked = 'saved-profile'">Continue</button>
      </section>
      <section aria-label="account chooser">
        <h2>Use another account</h2>
        <button onclick="window.clicked = 'account-chooser'">Continue</button>
      </section>
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
        listener({ type: 'navable:runTypedCommand', text: 'click continue', detectedLanguage: 'en' }, {}, resolve);
      } catch (err) {
        reject(err);
      }
    });
  });

  const followUpResponse = await page.evaluate(async () => {
    // @ts-ignore
    const listener = (window as any).__contentListeners[0];
    return await new Promise((resolve, reject) => {
      try {
        listener({ type: 'navable:runTypedCommand', text: 'use another account', detectedLanguage: 'en' }, {}, resolve);
      } catch (err) {
        reject(err);
      }
    });
  });

  expect(followUpResponse).toMatchObject({ ok: true });
  expect((followUpResponse as any).feedback).toMatchObject({ status: 'success' });
  expect(await page.evaluate(() => (window as any).clicked || '')).toBe('account-chooser');
});
