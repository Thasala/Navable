import { expect, test } from '@playwright/test';

test('language helper resolves transcript language and explicit overrides', async ({ page }) => {
  await page.addScriptTag({ path: 'src/common/i18n.js' });

  const result = await page.evaluate(() => {
    // @ts-ignore
    const i18n = (window as any).NavableI18n;
    return {
      frenchTranscript: i18n.resolveOutputLanguage({ transcript: 'Ouvre YouTube', fallbackLanguage: 'en-US' }),
      explicitFrench: i18n.resolveOutputLanguage({ transcript: 'Summarize this page in French', fallbackLanguage: 'en-US' }),
      arabicTranscript: i18n.resolveOutputLanguage({ transcript: 'افتح يوتيوب', fallbackLanguage: 'en-US' }),
      frenchMessage: i18n.t('scrolled_down', 'fr'),
      frenchLocale: i18n.localeForLanguage('fr')
    };
  });

  expect(result.frenchTranscript).toBe('fr');
  expect(result.explicitFrench).toBe('fr');
  expect(result.arabicTranscript).toBe('ar');
  expect(result.frenchMessage).toContain('Defilement');
  expect(result.frenchLocale).toBe('fr-FR');
});

test('language helper loads an on-demand pack for unknown languages', async ({ page }) => {
  await page.evaluate(() => {
    window.fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body || '{}'));
      return {
        ok: true,
        async json() {
          return {
            language: body.language,
            messages: {
              ...body.messages,
              scrolled_down: 'Desplazado hacia abajo.'
            }
          };
        }
      };
    };
  });

  await page.addScriptTag({ path: 'src/common/i18n.js' });

  const result = await page.evaluate(async () => {
    // @ts-ignore
    const i18n = (window as any).NavableI18n;
    await i18n.ensureLanguage('es');
    return {
      message: i18n.t('scrolled_down', 'es'),
      locale: i18n.localeForLanguage('es')
    };
  });

  expect(result.message).toBe('Desplazado hacia abajo.');
  expect(result.locale).toBe('es');
});

test('announce helper applies lang attribute to live regions', async ({ page }) => {
  await page.setContent('<main><h1>Test</h1></main>');
  await page.addScriptTag({ path: 'src/common/announce.js' });

  await page.evaluate(() => {
    // @ts-ignore
    (window as any).NavableAnnounce.speak('Bonjour', { mode: 'polite', lang: 'fr-FR' });
  });

  const region = page.locator('#navable-live-region-polite');
  await expect(region).toHaveAttribute('lang', 'fr-FR');
  await expect(region).toHaveText(/Bonjour/, { timeout: 5000 });
});

test('background fallback orientation follows output language', async ({ page }) => {
  await page.addScriptTag({ path: 'src/background.js' });

  const description = await page.evaluate(() => {
    // @ts-ignore
    return (window as any).buildFriendlyOrientation(
      {
        title: 'Example',
        counts: { headings: 2, links: 4, buttons: 1 },
        headings: [{ label: 'Accueil' }],
        excerpt: 'Bonjour et bienvenue sur cette page.'
      },
      'fr'
    );
  });

  expect(description).toContain('Titre');
  expect(description).toContain('liens');
  expect(description).toContain('Titre principal');
});
