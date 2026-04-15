import { expect, test } from '@playwright/test';
import {
  isPageQuestionIntentText,
  isSummaryIntentText,
  resolveRequestedAssistantPurpose
} from '../backend/src/page-assistant-intent.js';

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
