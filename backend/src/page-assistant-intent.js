const SUMMARY_VERB_ALIASES = {
  discribe: 'describe',
  dicribe: 'describe',
  descrbe: 'describe',
  descripe: 'describe',
  desribe: 'describe',
  summerize: 'summarize',
  sumarize: 'summarize',
  summrize: 'summarize',
  summarise: 'summarize'
};

function normalizeIntentText(text) {
  let raw = String(text || '');
  if (!raw) return '';
  raw = raw.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ');
  if (typeof raw.normalize === 'function') {
    try {
      raw = raw.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
    } catch {
      // ignore normalize failures
    }
  }
  return raw.toLowerCase().replace(/[^\w\u0600-\u06FF\s]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function hasCurrentPageReferenceText(text) {
  const normalized = normalizeIntentText(text);
  if (!normalized) return false;
  return (
    /\b(?:this|current|the)\s+(?:page|screen|site|website|app)\b/.test(normalized) ||
    /\b(?:on|in)\s+(?:this|the|the current)\s+(?:page|screen|site|website|app)\b/.test(normalized) ||
    /\b(?:sur|dans)\s+(?:cette|la)\s+(?:page|ecran|site)\b/.test(normalized) ||
    /(?:في|على|ب)\s+(?:هاي|هذه|هاد|هذي)\s+(?:الصفحة|الشاشة|الموقع)/.test(normalized) ||
    /(?:الصفحة|الشاشة|الموقع)\s+(?:الحالية|هاي|هذه)/.test(normalized)
  );
}

function normalizeCurrentPageIntentText(text) {
  const raw = String(text || '').trim();
  if (!raw || !hasCurrentPageReferenceText(raw)) return raw;
  const parts = raw.split(/\s+/).filter(Boolean);
  if (!parts.length) return raw;
  const first = normalizeIntentText(parts[0]);
  if (!first || !SUMMARY_VERB_ALIASES[first]) return raw;
  parts[0] = SUMMARY_VERB_ALIASES[first];
  return parts.join(' ').trim();
}

function isSummaryIntentText(text) {
  const raw = normalizeCurrentPageIntentText(text);
  const t = String(raw || '').toLowerCase();
  const normalized = normalizeIntentText(raw);
  if (!t) return false;
  return (
    t.includes('summarize') ||
    t.includes('summary') ||
    t.includes('describe this page') ||
    /\b(?:describe|summarize|explain)\s+(?:this|the|current)?\s*(?:page|screen|site|website|app)\b/.test(normalized) ||
    /\b(?:tell me about|show me)\s+(?:this|the|current)?\s*(?:page|screen|site|website|app)\b/.test(normalized) ||
    /\b(?:what s|whats|what is)\s+(?:on|in)\s+(?:this|the|current)?\s*(?:page|screen|site|website|app)\b/.test(normalized) ||
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

function isCurrentPageReferenceText(text) {
  return hasCurrentPageReferenceText(text);
}

function isPageQuestionIntentText(text) {
  const t = String(text || '').trim().toLowerCase();
  if (!t || !isCurrentPageReferenceText(t)) return false;
  return (
    /\b(answer|correct answer|question|quiz|exercise|problem|prompt|choice|choices|option|options|solve|read|explain)\b/.test(t) ||
    /\b(r[ée]ponse|question|quiz|exercice|probl[èe]me|choix|option|options|r[ée]soudre|lire|explique)\b/.test(t) ||
    /(سؤال|اسئلة|أسئلة|جواب|الجواب|إجابة|اجابة|حل|خيارات|خيار|اختيار|اقر[أا]|اشرح)/.test(t)
  );
}

function isPageContextIntentText(text) {
  const raw = normalizeCurrentPageIntentText(text);
  const t = String(raw || '').trim().toLowerCase();
  const normalized = normalizeIntentText(raw);
  if (!t) return false;
  if (isSummaryIntentText(t)) return true;
  if (isPageQuestionIntentText(t)) return true;
  return (
    /\b(where am i|help me here|help on this page|help on the page|help on this site|help on the site|what can i do here|what can i do on this page|what can i do on the page|what can i do on this site|what is important here|what's important here|what is important on this page|what's important on this page|tell me about this page|tell me about the page|tell me about the current page|guide me here|what am i looking at|what is on this screen|what's on this screen|what is here|what's here)\b/.test(t) ||
    /\b(?:help|guide)\s+me\s+(?:on|through)\s+(?:this|the|current)\s+(?:page|screen|site)\b/.test(normalized) ||
    /\b(o[uù] suis[- ]?je|aide[- ]?moi ici|que puis[- ]je faire ici|que puis[- ]je faire sur cette page|qu[' ]?est[- ]ce qui est important ici|qu[' ]?est[- ]ce qui est important sur cette page|parle[- ]?moi de cette page|guide[- ]?moi ici|qu[' ]?y a[- ]t[- ]il ici)\b/.test(t) ||
    /(أين أنا|اين انا|ساعدني هنا|ساعدني هون|ماذا يمكنني أن أفعل هنا|ماذا يمكنني ان افعل هنا|شو المهم هون|ايش المهم هون|شو المهم هنا|ايش المهم هنا|احكيلي عن (?:هاي|هذه) الصفحة|احكيلي عن ه(?:اي|ذا) الموقع|دلني هون|دلني هنا|وجهني هون|وجهني هنا|شو في هون|ايش في هون|شو الموجود هون|ايش الموجود هون)/.test(t)
  );
}

function isPageLocalActionIntentText(text) {
  const t = String(text || '').trim().toLowerCase();
  if (!t) return false;
  return (
    /\b(create|compose|write|start|make)\b.*\bpost\b|\bpost\b.*\b(create|compose|write|start|make)\b/.test(t) ||
    /\b(read|show|open|click|press|activate)\b.*\b(notifications?|alerts?|messages?|inbox)\b/.test(t)
  );
}

function resolveRequestedAssistantPurpose(text, requestedPurpose = 'auto') {
  const normalizedPurpose = typeof requestedPurpose === 'string' ? String(requestedPurpose).trim().toLowerCase() : 'auto';
  if (normalizedPurpose === 'answer' && (isPageContextIntentText(text) || isPageLocalActionIntentText(text))) {
    return 'page';
  }
  if (normalizedPurpose === 'auto' && isPageLocalActionIntentText(text)) return 'page';
  return normalizedPurpose;
}

export {
  isCurrentPageReferenceText,
  isPageContextIntentText,
  isPageQuestionIntentText,
  isSummaryIntentText,
  isPageLocalActionIntentText,
  resolveRequestedAssistantPurpose
};
