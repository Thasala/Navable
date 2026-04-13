import { expect, test } from '@playwright/test';
import { runAssistant } from '../backend/src/server.js';

test('backend routes current-page answer requests through page mode', async () => {
  const result = await runAssistant(
    'What is the answer to the question on the current page?',
    {
      title: 'Quiz',
      url: 'https://example.com/quiz',
      lang: 'en',
      activeId: null,
      activeLabel: '',
      landmarks: [{ role: 'main', tag: 'main', label: '' }],
      privacy: { sensitiveInputCount: 0, sensitivePage: false },
      counts: { headings: 1, links: 0, buttons: 0, inputs: 0, landmarks: 1 },
      headings: [{ id: 'n1', label: 'Question 1', tag: 'h1', type: 'heading', level: 1 }],
      links: [],
      buttons: [],
      inputs: [],
      excerpt: "During Industry 1.0, what marked a major shift in production? Development of James Watt's steam engine in 1763."
    },
    {
      aiEnabled: false,
      model: 'gpt-4.1-mini',
      transcriptionModel: 'gpt-4o-mini-transcribe'
    },
    'en',
    'answer',
    null
  );

  expect(result.mode).toBe('page');
  expect(result.summary).toContain('Title Quiz.');
});
