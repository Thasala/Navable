import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import OpenAI, { toFile } from 'openai';
import swaggerUi from 'swagger-ui-express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  isClarifyingAnswerText,
  isFollowUpIntentText,
  resolveAnswerQuestionWithSessionContext
} from './assistant-session.js';
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
    suggestion_open_link: 'Try: open first link.',
    ai_answers_off: 'AI answers are off. Enable AI in options to ask general questions.',
    answer_unavailable: 'I could not answer that right now.'
  },
  fr: {
    no_page_data: 'Aucune donnee de page disponible.',
    title_value: 'Titre {value}.',
    counts_value: 'Titres {headings}, liens {links}, boutons {buttons}.',
    top_heading: 'Titre principal : {value}.',
    suggestion_scroll: 'Essayez : fais defiler vers le bas.',
    suggestion_title: 'Essayez : lis le titre.',
    suggestion_heading: 'Essayez : va au titre suivant.',
    suggestion_open_link: 'Essayez : ouvre le premier lien.',
    ai_answers_off: 'Les reponses IA sont desactivees. Activez l IA dans les options pour poser des questions generales.',
    answer_unavailable: 'Je n ai pas pu repondre a cela pour le moment.'
  },
  ar: {
    no_page_data: 'لا توجد بيانات متاحة عن الصفحة.',
    title_value: 'العنوان {value}.',
    counts_value: 'العناوين {headings}، الروابط {links}، الأزرار {buttons}.',
    top_heading: 'أعلى عنوان: {value}.',
    suggestion_scroll: 'جرّب: مرر إلى الأسفل.',
    suggestion_title: 'جرّب: اقرأ العنوان.',
    suggestion_heading: 'جرّب: انتقل إلى العنوان التالي.',
    suggestion_open_link: 'جرّب: افتح أول رابط.',
    ai_answers_off: 'إجابات الذكاء الاصطناعي متوقفة. فعّل الذكاء الاصطناعي من الإعدادات لطرح أسئلة عامة.',
    answer_unavailable: 'تعذر عليّ الإجابة عن ذلك الآن.'
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
  let arabiziScore = 0;

  if (/[àâçéèêëîïôûùüÿœæ]/i.test(raw)) frenchScore += 3;
  frenchScore += (lower.match(/\b(bonjour|salut|merci|ouvre|ouvrir|recherche|cherche|resume|résume|résumé|decris|décris|titre|page|lien|bouton|suivant|precedent|précédent|aide|ecoute|écoute)\b/g) || []).length;
  englishScore += (lower.match(/\b(open|search|scroll|summary|summarize|describe|title|button|link|page|help|listen|stop|start|next|previous|focus|activate)\b/g) || []).length;
  arabiziScore += (lower.match(/\b(ifta[h7]|efta[h7]|roo[h7]|rou[h7]|wayn|wein|shu|sho|khallas|waq[aei]f|inzil|inzal|itla[3a]|tal[ae]3|dawwer|dowwer|mosa[ae]da)\b/g) || []).length;

  if (frenchScore > englishScore && frenchScore > 0) return 'fr';
  if (arabiziScore > 0) return 'ar';
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

function sanitizeAssistantAction(rawAction) {
  if (!rawAction || typeof rawAction !== 'object' || Array.isArray(rawAction)) return null;
  const type = typeof rawAction.type === 'string' ? rawAction.type.trim().toLowerCase() : '';
  if (type !== 'open_site') return null;

  const query = typeof rawAction.query === 'string' ? rawAction.query.trim() : '';
  if (!query) return null;

  return {
    type: 'open_site',
    query,
    newTab: rawAction.newTab !== false
  };
}

function getOpenAiClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  return new OpenAI({ apiKey });
}

async function callOpenAiSummarize(command, pageStructure, sessionContext, settings = DEFAULT_SETTINGS, outputLanguage = 'en') {
  if (settings.aiEnabled === false) {
    return null;
  }

  const client = getOpenAiClient();
  if (!client) return null;
  // Use the cheapest suitable model for short page summaries.
  const model = settings.model || DEFAULT_SETTINGS.model;

  const systemPrompt = [
    'You are an accessibility-oriented navigator assistant for a browser extension called Navable.',
    'You receive a structured snapshot of a web page as JSON (pageStructure), an optional sessionContext object, and an optional user command string.',
    'pageStructure.excerpt may contain up to ~1200 characters of visible page text; prefer it for detail.',
    'pageStructure includes counts, headings, links, buttons, landmarks, activeLabel (focused element), lang, and URL.',
    'sessionContext may include the last purpose, last entity, last assistant reply, and a sanitized lastPage summary from the same tab.',
    `You must answer in outputLanguage "${normalizeOutputLanguage(outputLanguage)}" unless the user command explicitly requests another output language.`,
    'Your job for a blind user:',
    '- Give a concise orientation: 2–4 short sentences on what the page is, key sections/headings/controls, and any focused element worth noting.',
    '- Then provide 2–5 next actions as a numbered list of short, actionable items.',
    '- Optionally propose a deterministic plan for the extension to execute via existing tools.',
    '- Understand implicit or indirect requests (e.g., “what is this page?”, “help me here”, non-English phrases like Arabic for “what is this page”). Infer intent to orient/summarize even without the word “summary.”',
    '- The command may be in any language; interpret intent from context and pageStructure.',
    '- Arabic may be Modern Standard Arabic, dialectal Arabic, or Arabic-English code switching. Treat colloquial Arabic as valid input.',
    '',
    'Important rules:',
    '- Only use the information provided in pageStructure and command; do not hallucinate hidden content.',
    '- Use sessionContext only as a short continuity hint. If it conflicts with the current pageStructure, prefer pageStructure.',
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
    sessionContext: sessionContext || null,
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

async function callOpenAiAnswerQuestion(
  question,
  sessionContext,
  settings = DEFAULT_SETTINGS,
  outputLanguage = 'en',
  resolvedQuestion = ''
) {
  if (settings.aiEnabled === false) {
    return null;
  }

  const client = getOpenAiClient();
  if (!client) return null;

  const model = settings.model || DEFAULT_SETTINGS.model;
  const completion = await client.chat.completions.create({
    model,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: [
          'You are a concise voice-first assistant for a browser extension called Navable.',
          `Answer in outputLanguage "${normalizeOutputLanguage(outputLanguage)}" unless the user explicitly requests another language.`,
          'The user asked a general informational question.',
          'Navable can open websites and web apps in the browser for the user.',
          'You may receive a sessionContext object with the previous purpose, last entity, last assistant reply, and a sanitized lastPage summary from the same tab.',
          'You may also receive a resolvedQuestion string. If resolvedQuestion is non-empty, treat it as the fully disambiguated version of the current request.',
          'The spoken question may be colloquial Arabic, dialectal Arabic, informal English, or Arabic-English code switching.',
          'Use sessionContext only when it clearly helps resolve a short follow-up such as "tell me more" or "what about that".',
          'If resolvedQuestion or sessionContext already identifies the topic, answer directly and do not ask the user to specify the topic again.',
          'If sessionContext conflicts with the current question, prefer the current question.',
          'If the user is asking Navable to open, navigate to, visit, launch, bring up, or take them to a website, web app, or named online service, do not refuse or say that you cannot do it.',
          'For those browser-navigation requests, return an action object with type "open_site" and a short query such as "facebook", "gmail", or a URL. Keep answer empty or use a very short acknowledgment.',
          'If the user says "app" but the destination is also available in a browser, treat it as an "open_site" request for the browser version.',
          'If the user is asking for information about the service instead of asking to navigate there, answer normally and return action null.',
          'Only return an action when the navigation intent is clear.',
          'Reply with 1 to 3 short sentences that are useful when read aloud.',
          'Do not use markdown, lists, headings, or emojis.',
          'If the question is ambiguous, ask one short clarifying question instead of guessing.',
          'If you do not know, say so briefly.',
          'Return exactly one JSON object: { "answer": string, "action": null | { "type": "open_site", "query": string, "newTab": boolean } }.'
        ].join('\n')
      },
      {
        role: 'user',
        content: JSON.stringify({
          question: String(question || '').trim(),
          resolvedQuestion: String(resolvedQuestion || '').trim(),
          sessionContext: sessionContext || null,
          outputLanguage: normalizeOutputLanguage(outputLanguage)
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

  return {
    answer: typeof parsed.answer === 'string' ? parsed.answer.trim() : '',
    action: sanitizeAssistantAction(parsed.action)
  };
}

function isSummaryIntentText(text) {
  const t = String(text || '').toLowerCase();
  if (!t) return false;
  return (
    t.includes('summarize') ||
    t.includes('summary') ||
    t.includes('describe this page') ||
    t.includes('describe the page') ||
    t.includes('what is this page') ||
    t.includes("what's on this page") ||
    t.includes('what is on this page') ||
    t.includes("what's this page") ||
    /r[ée]sum[ée]?.*cette page/.test(t) ||
    /d[ée]cri(s|re).*cette page/.test(t) ||
    /c[' ]?est quoi cette page/.test(t) ||
    /qu[' ]?est[- ]ce que cette page/.test(t) ||
    /ما هذه الصفحه/.test(t) ||
    /ما هذه الصفحة/.test(t) ||
    /ما هو محتوى الصفحة/.test(t) ||
    /ملخص/.test(t) ||
    /وصف الصفحة|شو هاي الصفحة|ايش هاي الصفحة|شو موجود هون|احكيلي عن الصفحة|اعطيني ملخص/.test(t)
  );
}

function isPageContextIntentText(text) {
  const t = String(text || '').trim().toLowerCase();
  if (!t) return false;
  if (isSummaryIntentText(t)) return true;
  return (
    /\b(where am i|help me here|help on this page|help on this site|what can i do here|what can i do on this page|what can i do on this site|what is important here|what's important here|what is important on this page|what's important on this page|tell me about this page|tell me about the page|guide me here|what am i looking at|what is on this screen|what's on this screen|what is here|what's here)\b/.test(t) ||
    /\b(o[uù] suis[- ]?je|aide[- ]?moi ici|que puis[- ]je faire ici|que puis[- ]je faire sur cette page|qu[' ]?est[- ]ce qui est important ici|qu[' ]?est[- ]ce qui est important sur cette page|parle[- ]?moi de cette page|guide[- ]?moi ici|qu[' ]?y a[- ]t[- ]il ici)\b/.test(t) ||
    /(أين أنا|اين انا|ساعدني هنا|ساعدني هون|ماذا يمكنني أن أفعل هنا|ماذا يمكنني ان افعل هنا|شو المهم هون|ايش المهم هون|شو المهم هنا|ايش المهم هنا|احكيلي عن (?:هاي|هذه) الصفحة|احكيلي عن ه(?:اي|ذا) الموقع|دلني هون|دلني هنا|وجهني هون|وجهني هنا|شو في هون|ايش في هون|شو الموجود هون|ايش الموجود هون)/.test(t)
  );
}

function isGeneralKnowledgeQuestionText(text) {
  const t = String(text || '').trim().toLowerCase();
  if (!t) return false;
  if (isPageContextIntentText(t)) return false;
  return (
    /^(who|what|when|where|why|how)\b/.test(t) ||
    /^(explain|define|compare|tell me about)\b/.test(t) ||
    /\?$/.test(t) ||
    /^(qui|que|qu[' ]?est[- ]?ce que|qu[' ]?est-ce que|quand|où|ou|pourquoi|comment)\b/.test(t) ||
    /^(explique|definis|définis|compare|parle-moi de|dis-moi)\b/.test(t) ||
    /^(من|ما|متى|أين|اين|لماذا|كيف)\b/.test(t) ||
    /^(اشرح|عر[ّ]ف|عرف|قارن|قل لي عن|احكيلي عن|خبرني عن)\b/.test(t)
  );
}

function buildAssistantSpeech(primaryText, suggestions = []) {
  const parts = [];
  const main = String(primaryText || '').trim();
  if (main) parts.push(main);
  if (Array.isArray(suggestions) && suggestions.length) {
    parts.push(suggestions.map((item) => String(item || '').trim()).filter(Boolean).join(' '));
  }
  return parts.join(' ').trim();
}

async function runAssistant(input, pageStructure, settings = DEFAULT_SETTINGS, outputLanguage = 'en', purpose = 'auto', sessionContext = null) {
  const resolvedOutputLanguage = normalizeOutputLanguage(outputLanguage);
  const outputCatalog = await getOutputCatalog(resolvedOutputLanguage, settings);
  const text = String(input || '').trim();
  const resolvedPurpose = typeof purpose === 'string' ? String(purpose).trim().toLowerCase() : 'auto';
  const priorPurpose = sessionContext && sessionContext.lastPurpose ? String(sessionContext.lastPurpose).trim().toLowerCase() : '';
  const followUpToPage = resolvedPurpose === 'auto' && isFollowUpIntentText(text) && (priorPurpose === 'page' || priorPurpose === 'summary');
  const wantsSummary = resolvedPurpose === 'summary' || (resolvedPurpose !== 'answer' && isSummaryIntentText(text));
  const wantsPageIntent =
    resolvedPurpose === 'summary' ||
    resolvedPurpose === 'page' ||
    followUpToPage ||
    (resolvedPurpose === 'auto' && isPageContextIntentText(text));
  const wantsPageAssistant = !!pageStructure && wantsPageIntent;

  if (wantsPageIntent && !pageStructure) {
    const summary = outputMessage('no_page_data', resolvedOutputLanguage, {}, outputCatalog);
    return {
      mode: 'page',
      speech: summary,
      summary,
      answer: '',
      suggestions: [],
      plan: { steps: [] }
    };
  }

  if (wantsPageAssistant) {
    let result = null;
    try {
      result = await callOpenAiSummarize(text, pageStructure, sessionContext, settings, resolvedOutputLanguage);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[Navable backend] OpenAI page assistant error:', err);
    }

    const summary =
      (result && result.friendlySummary) || buildFallbackSummary(pageStructure, resolvedOutputLanguage, outputCatalog);
    const suggestions =
      (result && result.suggestions && result.suggestions.length
        ? result.suggestions
        : buildFallbackSuggestions(pageStructure, resolvedOutputLanguage, outputCatalog));
    const plan =
      (result && result.plan && Array.isArray(result.plan.steps)
        ? sanitizePlan(result.plan)
        : { steps: [] });

    return {
      mode: 'page',
      speech: buildAssistantSpeech(summary, suggestions),
      summary,
      answer: '',
      suggestions,
      plan
    };
  }

  if (settings.aiEnabled === false) {
    return {
      ok: false,
      status: 503,
      error: outputMessage('ai_answers_off', resolvedOutputLanguage, {}, outputCatalog)
    };
  }

  let answerResult = null;
  const resolvedAnswer = resolveAnswerQuestionWithSessionContext(text, sessionContext);
  try {
    answerResult = await callOpenAiAnswerQuestion(
      text,
      sessionContext,
      settings,
      resolvedOutputLanguage,
      resolvedAnswer.resolvedQuestion !== resolvedAnswer.question ? resolvedAnswer.resolvedQuestion : ''
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[Navable backend] OpenAI answer error:', err);
  }

  if (
    resolvedAnswer.resolvedFromSession &&
    answerResult &&
    answerResult.answer &&
    isClarifyingAnswerText(answerResult.answer)
  ) {
    try {
      answerResult = await callOpenAiAnswerQuestion(
        resolvedAnswer.resolvedQuestion,
        sessionContext,
        settings,
        resolvedOutputLanguage,
        resolvedAnswer.resolvedQuestion
      );
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[Navable backend] OpenAI follow-up retry error:', err);
    }
  }

  const action = sanitizeAssistantAction(answerResult && answerResult.action);
  if (action) {
    return {
      mode: 'action',
      speech: answerResult && answerResult.answer ? answerResult.answer : '',
      summary: '',
      answer: '',
      suggestions: [],
      plan: { steps: [] },
      action
    };
  }

  if (!answerResult || !answerResult.answer) {
    return {
      ok: false,
      status: 503,
      error: outputMessage('answer_unavailable', resolvedOutputLanguage, {}, outputCatalog)
    };
  }

  return {
    mode: 'answer',
    speech: answerResult.answer,
    summary: '',
    answer: answerResult.answer,
    suggestions: [],
    plan: { steps: [] }
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

app.post('/api/assistant', async (req, res) => {
  try {
    const { input, pageStructure, outputLanguage, purpose, sessionContext } = req.body || {};
    if (!input || typeof input !== 'string' || !input.trim()) {
      return res.status(400).json({ error: 'Missing input' });
    }

    const result = await runAssistant(input, pageStructure || null, runtimeSettings, outputLanguage, purpose || 'auto', sessionContext || null);
    if (result && result.ok === false) {
      return res.status(result.status || 503).json({ error: result.error || 'Assistant unavailable' });
    }

    res.json({
      mode: result.mode || 'answer',
      speech: result.speech || '',
      summary: result.summary || '',
      answer: result.answer || '',
      suggestions: Array.isArray(result.suggestions) ? result.suggestions : [],
      plan: result.plan && Array.isArray(result.plan.steps) ? result.plan : { steps: [] },
      action: sanitizeAssistantAction(result.action)
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[Navable backend] /api/assistant error:', err);
    res.status(500).json({ error: 'Assistant request failed' });
  }
});

const isDirectRun = process.argv[1] ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;

if (isDirectRun) {
  app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`[Navable backend] Listening on http://localhost:${port}`);
  });
}

export {
  app,
  isClarifyingAnswerText,
  resolveAnswerQuestionWithSessionContext,
  runAssistant
};
