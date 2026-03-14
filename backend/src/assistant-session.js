function trimSessionText(text, maxLen = 240) {
  const raw = String(text || '').replace(/\s+/g, ' ').trim();
  if (!raw) return '';
  return raw.length > maxLen ? `${raw.slice(0, Math.max(0, maxLen - 3)).trim()}...` : raw;
}

function isFollowUpIntentText(text) {
  const t = String(text || '').trim().toLowerCase();
  if (!t) return false;
  return (
    /^(tell me more|more detail|more details|go on|continue|keep going|expand that|what about that|what about it|and then)\b/.test(t) ||
    /^(dis[- ]?m[' ]?en plus|plus de d[ée]tails|continue|vas[- ]?y|et ensuite)\b/.test(t) ||
    /^(احكيلي اكثر|احكيلي المزيد|زيدني|كم[ّ]?ل|كمل|ماذا عن ذلك|شو كمان|ايش كمان)\b/.test(t)
  );
}

function rewriteTopicPronouns(text, topic) {
  const raw = trimSessionText(text, 240);
  const subject = trimSessionText(topic, 120);
  if (!raw || !subject) return raw;
  return raw
    .replace(/\bits\b/gi, `${subject}'s`)
    .replace(/\btheir\b/gi, `${subject}'s`)
    .replace(/\bit\b/gi, subject)
    .replace(/\bthis\b/gi, subject)
    .replace(/\bthat\b/gi, subject)
    .replace(/\bthey\b/gi, subject)
    .replace(/\bthem\b/gi, subject)
    .replace(/\bhe\b/gi, subject)
    .replace(/\bhim\b/gi, subject)
    .replace(/\bshe\b/gi, subject)
    .replace(/\bher\b/gi, subject);
}

function resolveAnswerQuestionWithSessionContext(question, sessionContext = null) {
  const rawQuestion = trimSessionText(question, 240);
  if (!rawQuestion) {
    return { question: '', resolvedQuestion: '', resolvedFromSession: false, topic: '' };
  }

  const lastEntity = trimSessionText(sessionContext && sessionContext.lastEntity, 120);
  const lastUserUtterance = trimSessionText(sessionContext && sessionContext.lastUserUtterance, 180);
  const lastAnswer = trimSessionText(sessionContext && sessionContext.lastAnswer, 220);
  const isFollowUp = isFollowUpIntentText(rawQuestion);

  if (isFollowUp) {
    if (lastEntity) {
      return {
        question: rawQuestion,
        resolvedQuestion: `Tell me more about ${lastEntity}.`,
        resolvedFromSession: true,
        topic: lastEntity
      };
    }
    if (lastUserUtterance && !isFollowUpIntentText(lastUserUtterance)) {
      return {
        question: rawQuestion,
        resolvedQuestion: `Tell me more about: ${lastUserUtterance}`,
        resolvedFromSession: true,
        topic: lastUserUtterance
      };
    }
    if (lastAnswer) {
      return {
        question: rawQuestion,
        resolvedQuestion: `Tell me more about this previous answer: ${lastAnswer}`,
        resolvedFromSession: true,
        topic: lastAnswer
      };
    }
  }

  if (lastEntity) {
    const rewritten = rewriteTopicPronouns(rawQuestion, lastEntity);
    if (rewritten && rewritten !== rawQuestion) {
      return {
        question: rawQuestion,
        resolvedQuestion: rewritten,
        resolvedFromSession: true,
        topic: lastEntity
      };
    }
  }

  return {
    question: rawQuestion,
    resolvedQuestion: rawQuestion,
    resolvedFromSession: false,
    topic: lastEntity
  };
}

function isClarifyingAnswerText(answer) {
  const t = String(answer || '').trim().toLowerCase();
  if (!t) return false;
  return (
    /\b(specify|clarify|which topic|what topic|which subject|what subject|more context|what would you like|which one)\b/.test(t) ||
    /(pr[ée]ciser|quel sujet|quel thème|de quel sujet|sur quel sujet)/.test(t) ||
    /(حدد|حدّد|أي موضوع|اي موضوع|عن ماذا|عن اي موضوع|أي شيء تقصد|اي شيء تقصد)/.test(t)
  );
}

export {
  isClarifyingAnswerText,
  isFollowUpIntentText,
  resolveAnswerQuestionWithSessionContext
};
