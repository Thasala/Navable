import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import OpenAI, { toFile } from 'openai';
import swaggerUi from 'swagger-ui-express';
import { getOpenApiSpec } from './openapi.js';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '5mb' }));

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
  model: 'gpt-4.1-mini',
  transcriptionModel: 'gpt-4o-mini-transcribe'
};

let runtimeSettings = { ...DEFAULT_SETTINGS };
const translatedCatalogCache = new Map();

const OUTPUT_MESSAGES = {
  en: {
    no_page_data: 'No page data available.',
    title_value: 'Title {value}.',
    counts_value: 'Headings {headings}, links {links}, buttons {buttons}.',
    top_heading: 'Top heading: {value}.',
    suggestion_scroll: 'Try: scroll down.',
    suggestion_title: 'Try: read the title.',
    suggestion_heading: 'Try: move to the next heading.',
    suggestion_open_link: 'Try: open first link.'
  },
  fr: {
    no_page_data: 'Aucune donnee de page disponible.',
    title_value: 'Titre {value}.',
    counts_value: 'Titres {headings}, liens {links}, boutons {buttons}.',
    top_heading: 'Titre principal : {value}.',
    suggestion_scroll: 'Essayez : fais defiler vers le bas.',
    suggestion_title: 'Essayez : lis le titre.',
    suggestion_heading: 'Essayez : va au titre suivant.',
    suggestion_open_link: 'Essayez : ouvre le premier lien.'
  },
  ar: {
    no_page_data: 'لا توجد بيانات متاحة عن الصفحة.',
    title_value: 'العنوان {value}.',
    counts_value: 'العناوين {headings}، الروابط {links}، الأزرار {buttons}.',
    top_heading: 'أعلى عنوان: {value}.',
    suggestion_scroll: 'جرّب: مرر إلى الأسفل.',
    suggestion_title: 'جرّب: اقرأ العنوان.',
    suggestion_heading: 'جرّب: انتقل إلى العنوان التالي.',
    suggestion_open_link: 'جرّب: افتح أول رابط.'
  }
};

function canonicalizeLocale(lang) {
  const raw = String(lang || '').trim().replace(/_/g, '-');
  if (!raw) return '';
  try {
    return new Intl.Locale(raw).baseName;
  } catch {
    const parts = raw.split('-').filter(Boolean);
    if (!parts.length) return '';
    parts[0] = parts[0].toLowerCase();
    for (let i = 1; i < parts.length; i += 1) {
      if (parts[i].length === 2) parts[i] = parts[i].toUpperCase();
      else if (parts[i].length === 4) parts[i] = parts[i][0].toUpperCase() + parts[i].slice(1).toLowerCase();
      else parts[i] = parts[i].toLowerCase();
    }
    return parts.join('-');
  }
}

function normalizeOutputLanguage(lang) {
  const canonical = canonicalizeLocale(lang);
  if (!canonical) return 'en';
  const primary = canonical.split('-')[0].toLowerCase();
  return primary || 'en';
}

function interpolate(template, params = {}) {
  return String(template || '').replace(/\{(\w+)\}/g, (_match, name) => (
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : ''
  ));
}

function sanitizeTranslatedCatalog(candidate, fallbackCatalog) {
  return Object.keys(fallbackCatalog || {}).reduce((acc, key) => {
    const value = candidate && Object.prototype.hasOwnProperty.call(candidate, key)
      ? candidate[key]
      : null;
    acc[key] = typeof value === 'string' && value.trim() ? value : fallbackCatalog[key];
    return acc;
  }, {});
}

function catalogCacheKey(language, messages) {
  const ordered = Object.keys(messages || {}).sort().reduce((acc, key) => {
    acc[key] = messages[key];
    return acc;
  }, {});
  return `${normalizeOutputLanguage(language)}|${JSON.stringify(ordered)}`;
}

function localCatalogForLanguage(messageCatalogs, lang) {
  const normalized = normalizeOutputLanguage(lang);
  return messageCatalogs[normalized] || null;
}

async function callOpenAiTranslateMessages(messages, outputLanguage, settings = DEFAULT_SETTINGS) {
  const client = getOpenAiClient();
  if (!client) return null;

  const model = settings.model || DEFAULT_SETTINGS.model;
  const targetLanguage = normalizeOutputLanguage(outputLanguage);
  const completion = await client.chat.completions.create({
    model,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: [
          'You translate short browser-extension UI messages.',
          `Translate every value into "${targetLanguage}".`,
          'Return exactly one JSON object with the same keys as the input.',
          'Do not add or remove keys.',
          'Preserve placeholders like {value}, {target}, {name} exactly as written.',
          'Keep the same concise tone and sentence intent.'
        ].join('\n')
      },
      {
        role: 'user',
        content: JSON.stringify({
          language: targetLanguage,
          messages
        })
      }
    ]
  });

  const raw = completion.choices?.[0]?.message?.content || '{}';
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = {};
  }
  return sanitizeTranslatedCatalog(parsed, messages);
}

async function getTranslatedCatalog(messages, outputLanguage, settings = DEFAULT_SETTINGS) {
  const targetLanguage = normalizeOutputLanguage(outputLanguage);
  if (!messages || typeof messages !== 'object' || Array.isArray(messages)) return {};
  if (!targetLanguage || targetLanguage === 'en') return { ...messages };

  const cacheKey = catalogCacheKey(targetLanguage, messages);
  if (translatedCatalogCache.has(cacheKey)) {
    return translatedCatalogCache.get(cacheKey);
  }

  let translated = null;
  try {
    translated = await callOpenAiTranslateMessages(messages, targetLanguage, settings);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[Navable backend] OpenAI UI translation error:', err);
  }

  const safe = sanitizeTranslatedCatalog(translated, messages);
  translatedCatalogCache.set(cacheKey, safe);
  return safe;
}

async function getOutputCatalog(outputLanguage, settings = DEFAULT_SETTINGS) {
  const localCatalog = localCatalogForLanguage(OUTPUT_MESSAGES, outputLanguage);
  if (localCatalog) return localCatalog;
  return getTranslatedCatalog(OUTPUT_MESSAGES.en, outputLanguage, settings);
}

function outputMessageFromCatalog(key, catalog, params = {}) {
  const template = (catalog && catalog[key]) || OUTPUT_MESSAGES.en[key] || key;
  return interpolate(template, params);
}

function outputMessage(key, lang, params = {}, catalog) {
  const dictionary = catalog || localCatalogForLanguage(OUTPUT_MESSAGES, lang) || OUTPUT_MESSAGES.en;
  return outputMessageFromCatalog(key, dictionary, params);
}

function detectTranscriptLanguage(text) {
  const raw = String(text || '').trim();
  if (!raw) return '';
  if (/[\u0600-\u06FF]/.test(raw)) return 'ar';

  const lower = raw.toLowerCase();
  let frenchScore = 0;
  let englishScore = 0;

  if (/[àâçéèêëîïôûùüÿœæ]/i.test(raw)) frenchScore += 3;
  frenchScore += (lower.match(/\b(bonjour|salut|merci|ouvre|ouvrir|recherche|cherche|resume|résume|résumé|decris|décris|titre|page|lien|bouton|suivant|precedent|précédent|aide|ecoute|écoute)\b/g) || []).length;
  englishScore += (lower.match(/\b(open|search|scroll|summary|summarize|describe|title|button|link|page|help|listen|stop|start|next|previous|focus|activate)\b/g) || []).length;

  if (frenchScore > englishScore && frenchScore > 0) return 'fr';
  if (englishScore > frenchScore && englishScore > 0) return 'en';
  return '';
}

function buildFallbackSummary(structure, outputLanguage, catalog) {
  if (!structure) return outputMessage('no_page_data', outputLanguage, {}, catalog);
  const counts = structure.counts || {};
  const titlePart = structure.title ? `${outputMessage('title_value', outputLanguage, { value: structure.title }, catalog)} ` : '';
  const basics = outputMessage('counts_value', outputLanguage, {
    headings: counts.headings || 0,
    links: counts.links || 0,
    buttons: counts.buttons || 0
  }, catalog);
  const firstHeading =
    structure.headings && structure.headings.length
      ? outputMessage('top_heading', outputLanguage, { value: structure.headings[0].label }, catalog)
      : '';
  return [titlePart + basics, firstHeading].filter(Boolean).join(' ');
}

function buildFallbackSuggestions(structure, outputLanguage, catalog) {
  const suggestions = [
    outputMessage('suggestion_scroll', outputLanguage, {}, catalog),
    outputMessage('suggestion_title', outputLanguage, {}, catalog),
    outputMessage('suggestion_heading', outputLanguage, {}, catalog)
  ];
  if (structure && structure.links && structure.links.length) {
    suggestions.push(outputMessage('suggestion_open_link', outputLanguage, {}, catalog));
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

function getOpenAiClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  return new OpenAI({ apiKey });
}

async function callOpenAiSummarize(command, pageStructure, settings = DEFAULT_SETTINGS, outputLanguage = 'en') {
  if (settings.aiEnabled === false) {
    return null;
  }

  const client = getOpenAiClient();
  if (!client) return null;
  // Use the cheapest suitable model for short page summaries.
  const model = settings.model || DEFAULT_SETTINGS.model;

  const systemPrompt = [
    'You are an accessibility-oriented navigator assistant for a browser extension called Navable.',
    'You receive a structured snapshot of a web page as JSON (pageStructure) and an optional user command string.',
    'pageStructure.excerpt may contain up to ~1200 characters of visible page text; prefer it for detail.',
    'pageStructure includes counts, headings, links, buttons, landmarks, activeLabel (focused element), lang, and URL.',
    `You must answer in outputLanguage "${normalizeOutputLanguage(outputLanguage)}" unless the user command explicitly requests another output language.`,
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
    pageStructure,
    outputLanguage: normalizeOutputLanguage(outputLanguage)
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

async function callOpenAiTranscribe(audioBase64, mimeType, settings = DEFAULT_SETTINGS) {
  const client = getOpenAiClient();
  if (!client) return null;

  const buffer = Buffer.from(String(audioBase64 || ''), 'base64');
  if (!buffer.length) {
    throw new Error('Empty audio payload');
  }

  const extension = mimeType && String(mimeType).includes('ogg')
    ? 'ogg'
    : mimeType && String(mimeType).includes('mp4')
      ? 'mp4'
      : 'webm';
  const audioFile = await toFile(buffer, `navable-voice.${extension}`, {
    type: mimeType || 'audio/webm'
  });

  const transcription = await client.audio.transcriptions.create({
    file: audioFile,
    model: settings.transcriptionModel || DEFAULT_SETTINGS.transcriptionModel,
    response_format: 'json',
    chunking_strategy: 'auto'
  });

  return {
    text: transcription && transcription.text ? String(transcription.text) : '',
    language:
      transcription && transcription.language
        ? String(transcription.language)
        : detectTranscriptLanguage(transcription && transcription.text ? transcription.text : '')
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

  const allowedKeys = new Set(['aiEnabled', 'model', 'transcriptionModel']);
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

  if (Object.prototype.hasOwnProperty.call(body, 'transcriptionModel')) {
    if (typeof body.transcriptionModel !== 'string' || !body.transcriptionModel.trim()) {
      return res.status(400).json({ error: 'transcriptionModel must be a non-empty string' });
    }
    updates.transcriptionModel = body.transcriptionModel.trim();
  }

  runtimeSettings = { ...runtimeSettings, ...updates };
  res.json(runtimeSettings);
});

app.delete('/api/settings', (_req, res) => {
  runtimeSettings = { ...DEFAULT_SETTINGS };
  res.json(runtimeSettings);
});

app.post('/api/transcribe', async (req, res) => {
  try {
    const { audioBase64, mimeType } = req.body || {};
    if (!audioBase64 || typeof audioBase64 !== 'string') {
      return res.status(400).json({ error: 'Missing audioBase64' });
    }

    let result = null;
    try {
      result = await callOpenAiTranscribe(audioBase64, mimeType, runtimeSettings);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[Navable backend] OpenAI transcription error:', err);
    }

    if (!result) {
      return res.status(503).json({ error: 'Transcription unavailable' });
    }

    res.json({
      text: result.text || '',
      language: result.language || ''
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[Navable backend] /api/transcribe error:', err);
    res.status(500).json({ error: 'Transcription failed' });
  }
});

app.post('/api/translate-messages', async (req, res) => {
  try {
    const { language, messages } = req.body || {};
    if (!language || typeof language !== 'string') {
      return res.status(400).json({ error: 'Missing language' });
    }
    if (!messages || typeof messages !== 'object' || Array.isArray(messages)) {
      return res.status(400).json({ error: 'Missing messages object' });
    }

    const sourceMessages = Object.keys(messages).reduce((acc, key) => {
      if (typeof messages[key] === 'string') acc[key] = messages[key];
      return acc;
    }, {});

    if (!Object.keys(sourceMessages).length) {
      return res.status(400).json({ error: 'Messages object must contain string values' });
    }

    const translated = await getTranslatedCatalog(sourceMessages, language, runtimeSettings);
    res.json({
      language: normalizeOutputLanguage(language),
      messages: translated
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[Navable backend] /api/translate-messages error:', err);
    res.status(500).json({ error: 'Message translation failed' });
  }
});

app.post('/api/summarize', async (req, res) => {
  try {
    const { command, pageStructure, outputLanguage } = req.body || {};
    if (!pageStructure) {
      return res.status(400).json({ error: 'Missing pageStructure' });
    }

    const structure = pageStructure;
    const resolvedOutputLanguage = normalizeOutputLanguage(outputLanguage);

    let result = null;
    try {
      result = await callOpenAiSummarize(command, structure, runtimeSettings, resolvedOutputLanguage);
    } catch (err) {
      // Failed OpenAI call; fall back to local summary.
      // eslint-disable-next-line no-console
      console.error('[Navable backend] OpenAI error:', err);
    }

    const outputCatalog = await getOutputCatalog(resolvedOutputLanguage, runtimeSettings);
    const friendlySummary =
      (result && result.friendlySummary) || buildFallbackSummary(structure, resolvedOutputLanguage, outputCatalog);
    const suggestions =
      (result && result.suggestions && result.suggestions.length
        ? result.suggestions
        : buildFallbackSuggestions(structure, resolvedOutputLanguage, outputCatalog));
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
