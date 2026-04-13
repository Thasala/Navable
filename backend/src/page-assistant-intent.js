function isSummaryIntentText(text) {
  const t = String(text || '').toLowerCase();
  if (!t) return false;
  return (
    t.includes('summarize') ||
    t.includes('summary') ||
    t.includes('describe this page') ||
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
  const t = String(text || '').trim().toLowerCase();
  if (!t) return false;
  return (
    /\b(?:this|current)\s+(?:page|screen|site)\b/.test(t) ||
    /\b(?:on|in)\s+(?:this|the current)\s+(?:page|screen|site)\b/.test(t) ||
    /\b(?:sur|dans)\s+(?:cette|la)\s+(?:page|ecran|écran|site)\b/.test(t) ||
    /(?:في|على|ب)\s+(?:هاي|هذه|هاد|هذي)\s+(?:الصفحة|الشاشة|الموقع)/.test(t) ||
    /(?:الصفحة|الشاشة|الموقع)\s+(?:الحالية|هاي|هذه)/.test(t)
  );
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
  const t = String(text || '').trim().toLowerCase();
  if (!t) return false;
  if (isSummaryIntentText(t)) return true;
  if (isPageQuestionIntentText(t)) return true;
  return (
    /\b(where am i|help me here|help on this page|help on this site|what can i do here|what can i do on this page|what can i do on this site|what is important here|what's important here|what is important on this page|what's important on this page|tell me about this page|tell me about the page|guide me here|what am i looking at|what is on this screen|what's on this screen|what is here|what's here)\b/.test(t) ||
    /\b(o[uù] suis[- ]?je|aide[- ]?moi ici|que puis[- ]je faire ici|que puis[- ]je faire sur cette page|qu[' ]?est[- ]ce qui est important ici|qu[' ]?est[- ]ce qui est important sur cette page|parle[- ]?moi de cette page|guide[- ]?moi ici|qu[' ]?y a[- ]t[- ]il ici)\b/.test(t) ||
    /(أين أنا|اين انا|ساعدني هنا|ساعدني هون|ماذا يمكنني أن أفعل هنا|ماذا يمكنني ان افعل هنا|شو المهم هون|ايش المهم هون|شو المهم هنا|ايش المهم هنا|احكيلي عن (?:هاي|هذه) الصفحة|احكيلي عن ه(?:اي|ذا) الموقع|دلني هون|دلني هنا|وجهني هون|وجهني هنا|شو في هون|ايش في هون|شو الموجود هون|ايش الموجود هون)/.test(t)
  );
}

function resolveRequestedAssistantPurpose(text, requestedPurpose = 'auto') {
  const normalizedPurpose = typeof requestedPurpose === 'string' ? String(requestedPurpose).trim().toLowerCase() : 'auto';
  if (normalizedPurpose === 'answer' && isPageContextIntentText(text)) {
    return 'page';
  }
  return normalizedPurpose;
}

export {
  isCurrentPageReferenceText,
  isPageContextIntentText,
  isPageQuestionIntentText,
  isSummaryIntentText,
  resolveRequestedAssistantPurpose
};
