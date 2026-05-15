import { expect, test } from '@playwright/test';
import {
  isPageQuestionIntentText,
  isSummaryIntentText,
  resolveRequestedAssistantPurpose
} from '../backend/src/page-assistant-intent.js';
import { runAssistant } from '../backend/src/server.js';

test('page-intent helper detects current-page answer requests and upgrades answer mode', async () => {
  const text = 'What is the answer to the question on the current page?';
  expect(isPageQuestionIntentText(text)).toBe(true);
  expect(resolveRequestedAssistantPurpose(text, 'answer')).toBe('page');
  expect(resolveRequestedAssistantPurpose('What is the moon?', 'answer')).toBe('answer');
});

test('page-intent helper treats describe-the-page variants as current-page requests', async () => {
  expect(isSummaryIntentText('Describe the page')).toBe(true);
  expect(isSummaryIntentText('discribe the page')).toBe(true);
  expect(resolveRequestedAssistantPurpose('Describe the page', 'answer')).toBe('page');
});

test('page summaries suggest only extension-executable next actions', async () => {
  const result = await runAssistant(
    'summarize this page',
    {
      title: 'Docs',
      url: 'https://example.com/docs',
      counts: { headings: 1, links: 1, buttons: 1 },
      headings: [{ label: 'Getting started' }],
      links: [{ label: 'Install guide', href: '/install' }],
      buttons: [{ label: 'Copy' }],
      inputs: [],
      excerpt: 'Documentation for installing Navable.'
    },
    { aiEnabled: false, model: 'gpt-4.1-mini', transcriptionModel: 'gpt-4o-mini-transcribe' },
    'en',
    'summary'
  );

  expect(result.mode).toBe('page');
  expect(result.suggestions).toEqual([
    'Try: read the title.',
    'Try: move to the next heading.',
    'Try: open first link.',
    'Try: scroll down.'
  ]);
});
