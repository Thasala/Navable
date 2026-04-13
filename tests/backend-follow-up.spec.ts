import { expect, test } from '@playwright/test';
import {
  isClarifyingAnswerText,
  resolveAnswerQuestionWithSessionContext
} from '../backend/src/assistant-session.js';

test('answer follow-ups resolve to the prior entity', async () => {
  const resolved = resolveAnswerQuestionWithSessionContext('tell me more', {
    lastPurpose: 'answer',
    lastEntity: 'moon',
    lastUserUtterance: 'What is the moon?',
    lastAnswer: "The moon is Earth's natural satellite."
  });

  expect(resolved.resolvedFromSession).toBe(true);
  expect(resolved.topic).toBe('moon');
  expect(resolved.resolvedQuestion).toBe('Tell me more about moon.');
});

test('pronoun questions reuse the prior entity', async () => {
  const resolved = resolveAnswerQuestionWithSessionContext('what about its orbit?', {
    lastPurpose: 'answer',
    lastEntity: 'moon',
    lastUserUtterance: 'What is the moon?',
    lastAnswer: "The moon is Earth's natural satellite."
  });

  expect(resolved.resolvedFromSession).toBe(true);
  expect(resolved.resolvedQuestion).toBe("what about moon's orbit?");
});

test('clarifying follow-up answers are detected for retry', async () => {
  expect(isClarifyingAnswerText('Could you please specify the topic you want to know more about?')).toBe(true);
  expect(isClarifyingAnswerText('The moon affects tides on Earth.')).toBe(false);
});
