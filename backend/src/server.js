import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import swaggerUi from 'swagger-ui-express';
import { getOpenApiSpec } from './openapi.js';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.get('/api-docs.json', (req, res) => {
  res.json(getOpenApiSpec(req));
});

app.use(
  '/api-docs',
  swaggerUi.serve,
  swaggerUi.setup(null, {
    customSiteTitle: 'Navable API Docs',
    swaggerOptions: { url: '/api-docs.json' }
  })
);

// Allow only a small, known set of tool actions that the content script supports.
const ALLOWED_ACTIONS = new Set([
  'scroll',
  'announce',
  'read_title',
  'read_selection',
  'read_focused',
  'read_heading',
  'focus_element',
  'click_element',
  'fill_text',
  'describe_page',
  'wait_for_user_input',
  'move_heading'
]);

const DEFAULT_SETTINGS = {
  aiEnabled: true,
  model: 'gpt-4.1-mini'
};

let runtimeSettings = { ...DEFAULT_SETTINGS };

function buildFallbackSummary(structure) {
  if (!structure) return 'No page data available.';
  const counts = structure.counts || {};
  const titlePart = structure.title ? `Title ${structure.title}. ` : '';
  const basics = `Headings ${counts.headings || 0}, links ${counts.links || 0}, buttons ${counts.buttons || 0}.`;
  const firstHeading =
    structure.headings && structure.headings.length
      ? `Top heading: ${structure.headings[0].label}.`
      : '';
  return [titlePart + basics, firstHeading].filter(Boolean).join(' ');
}

function buildFallbackSuggestions(structure) {
  const suggestions = ['Try: scroll down.', 'Try: read the title.', 'Try: move to the next heading.'];
  if (structure && structure.links && structure.links.length) {
    suggestions.push('Try: open first link.');
  }
  return suggestions;
}

function sanitizePlan(rawPlan) {
  if (!rawPlan || !Array.isArray(rawPlan.steps)) return { steps: [] };
  const steps = rawPlan.steps
    .filter((step) => step && typeof step === 'object')
    .map((step) => ({
      action: typeof step.action === 'string' ? step.action : '',
      label: step.label,
      n: step.n,
      direction: step.direction || step.dir,
      target: step.target || step.targetType
    }))
    .filter((step) => ALLOWED_ACTIONS.has(step.action));
  return { steps };
}

async function callOpenAiSummarize(command, pageStructure, settings = DEFAULT_SETTINGS) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || settings.aiEnabled === false) {
    return null;
  }

  const client = new OpenAI({ apiKey });
  // Use the cheapest suitable model for short page summaries.
  const model = settings.model || DEFAULT_SETTINGS.model;

  const systemPrompt = [
    'You are an accessibility-oriented navigator assistant for a browser extension called Navable.',
    'You receive a structured snapshot of a web page as JSON (pageStructure) and an optional user command string.',
    'pageStructure.excerpt may contain up to ~1200 characters of visible page text; prefer it for detail.',
    'pageStructure includes counts, headings, links, buttons, landmarks, activeLabel (focused element), lang, and URL.',
    'Your job for a blind user:',
    '- Give a concise orientation: 2–4 short sentences on what the page is, key sections/headings/controls, and any focused element worth noting.',
    '- Then provide 2–5 next actions as a numbered list of short, actionable items.',
    '- Optionally propose a deterministic plan for the extension to execute via existing tools.',
    '- Understand implicit or indirect requests (e.g., “what is this page?”, “help me here”, non-English phrases like Arabic for “what is this page”). Infer intent to orient/summarize even without the word “summary.”',
    '- The command may be in any language; interpret intent from context and pageStructure.',
    '',
    'Important rules:',
    '- Only use the information provided in pageStructure and command; do not hallucinate hidden content.',
    '- Assume the extension can only perform these actions: scroll, read_title, read_selection, read_focused, read_heading, focus_element, click_element, describe_page, wait_for_user_input, move_heading.',
    '- If you propose a plan, use ONLY those actions in plan.steps.',
    '- When referencing elements (links, headings, buttons, inputs), prefer their labels from the structure.',
    '- Keep output concise and friendly; avoid long lists and repeating raw counts unless helpful.',
    '',
    'You MUST respond with a single JSON object of the form:',
    '{',
    '  "friendlySummary": string,',
    '  "suggestions": string[],',
    '  "plan": { "steps": [',
    '    { "action": string, "direction"?: "up"|"down"|"top"|"bottom"|"next"|"prev", "target"?: "heading"|"link"|"button"|"input", "label"?: string, "n"?: number }',
    '  ] }',
    '}',
    '',
    'If you do not want to propose a plan, set "plan": { "steps": [] }.'
  ].join('\n');

  const userContent = JSON.stringify({
    command: command || 'Summarize this page for a blind user.',
    pageStructure
  });

  const completion = await client.chat.completions.create({
    model,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent }
    ]
  });

  const raw = completion.choices?.[0]?.message?.content || '{}';
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = {};
  }

  return {
    friendlySummary: parsed.friendlySummary,
    suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : [],
    plan: sanitizePlan(parsed.plan)
  };
}

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/api/settings', (_req, res) => {
  res.json(runtimeSettings);
});

app.put('/api/settings', (req, res) => {
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }

  const allowedKeys = new Set(['aiEnabled', 'model']);
  const unknownKeys = Object.keys(body).filter((key) => !allowedKeys.has(key));
  if (unknownKeys.length) {
    return res
      .status(400)
      .json({ error: `Unknown setting(s): ${unknownKeys.join(', ')}` });
  }

  const updates = {};

  if (Object.prototype.hasOwnProperty.call(body, 'aiEnabled')) {
    if (typeof body.aiEnabled !== 'boolean') {
      return res.status(400).json({ error: 'aiEnabled must be a boolean' });
    }
    updates.aiEnabled = body.aiEnabled;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'model')) {
    if (typeof body.model !== 'string' || !body.model.trim()) {
      return res.status(400).json({ error: 'model must be a non-empty string' });
    }
    updates.model = body.model.trim();
  }

  runtimeSettings = { ...runtimeSettings, ...updates };
  res.json(runtimeSettings);
});

app.delete('/api/settings', (_req, res) => {
  runtimeSettings = { ...DEFAULT_SETTINGS };
  res.json(runtimeSettings);
});

app.post('/api/summarize', async (req, res) => {
  try {
    const { command, pageStructure } = req.body || {};
    if (!pageStructure) {
      return res.status(400).json({ error: 'Missing pageStructure' });
    }

    const structure = pageStructure;

    let result = null;
    try {
      result = await callOpenAiSummarize(command, structure, runtimeSettings);
    } catch (err) {
      // Failed OpenAI call; fall back to local summary.
      // eslint-disable-next-line no-console
      console.error('[Navable backend] OpenAI error:', err);
    }

    const friendlySummary =
      (result && result.friendlySummary) || buildFallbackSummary(structure);
    const suggestions =
      (result && result.suggestions && result.suggestions.length
        ? result.suggestions
        : buildFallbackSuggestions(structure));
    const plan =
      (result && result.plan && Array.isArray(result.plan.steps)
        ? sanitizePlan(result.plan)
        : { steps: [] });

    res.json({
      friendlySummary,
      suggestions,
      plan
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[Navable backend] /api/summarize error:', err);
    res.status(500).json({ error: 'Summarization failed' });
  }
});

app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`[Navable backend] Listening on http://localhost:${port}`);
});
