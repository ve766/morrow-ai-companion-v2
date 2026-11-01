"use strict";

// src/memory/fact-slot.ts
var VALUE_NOISE = /^[\s，,。.；;：:！!？?、]+|[\s，。；;：:！!？?、]+$/gu;
var COPULA = /^\s*(?:是|为|就是|叫|在)/u;
function clean(value) {
  return value.normalize("NFKC").replace(VALUE_NOISE, "").replace(COPULA, "").replace(/^有/u, "").replace(/了$/u, "").replace(VALUE_NOISE, "").replace(/\s+/gu, "");
}
function negatedBefore(text, index) {
  return /(?:不再|没有|不)$/u.test(text.slice(Math.max(0, index - 2), index));
}
var EXTRACTORS = [
  {
    predicate: "name",
    read: (text) => {
      const match = /(?:我的?名字|我叫|姓名)(?:是|叫)?/u.exec(text);
      if (!match) return null;
      return { value: clean(text.slice(match.index + match[0].length)), negated: false, asks: false };
    }
  },
  {
    predicate: "age",
    read: (text) => {
      const explicit = /(?:年龄)(?:是|为)?\s*(\d{1,3})?/u.exec(text);
      const counter = /(\d{1,3})\s*岁/u.exec(text);
      const asked = /(?:多少|几)\s*岁/u.test(text);
      if (!explicit && !counter && !asked) return null;
      const digits = counter?.[1] ?? explicit?.[1] ?? "";
      return { value: digits, negated: false, asks: digits.length === 0 };
    }
  },
  {
    predicate: "residence",
    read: (text) => {
      const match = /(?:住在|居住在|现居|定居在?|搬到|搬家到|搬去|住址(?:是|为)?|住(?:在)?哪(?:里|儿)?)/u.exec(text);
      if (!match) return null;
      return { value: clean(text.slice(match.index + match[0].length)), negated: negatedBefore(text, match.index), asks: false };
    }
  },
  {
    predicate: "employer",
    read: (text) => {
      const match = /在([^，。；\n]{1,20}?)(?:公司|集团|单位|工作|上班|任职|就职|实习)/u.exec(text);
      if (match) return { value: clean(match[1] ?? ""), negated: negatedBefore(text, match.index), asks: false };
      const own = /我的?公司(?:是|为)?/u.exec(text);
      if (!own) return null;
      return { value: clean(text.slice(own.index + own[0].length)), negated: false, asks: false };
    }
  },
  {
    predicate: "job_role",
    read: (text) => {
      const match = /(?:职业|职位|岗位|职务)(?:是|为)?/u.exec(text);
      if (!match) return null;
      return { value: clean(text.slice(match.index + match[0].length)), negated: negatedBefore(text, match.index), asks: false };
    }
  },
  {
    predicate: "study",
    read: (text) => {
      const match = /(?:学习|学会|课程|专业|在学(?!习))(?:是|为)?/u.exec(text);
      if (!match) return null;
      return { value: clean(text.slice(match.index + match[0].length)), negated: negatedBefore(text, match.index), asks: false };
    }
  },
  {
    // final-closure: pet names and object locations are personal facts users
    // ask back about ("我的猫叫什么？", "护照放在哪里？").
    predicate: "pet_name",
    read: (text) => {
      const match = /(?:我的?猫|我的?狗|宠物)(?:叫|名字是?|名字叫)?/u.exec(text);
      if (!match) return null;
      const value = clean(text.slice(match.index + match[0].length));
      if (/猫|狗|宠物/.test(value)) return null;
      return { value, negated: negatedBefore(text, match.index), asks: /叫什么|什么名字/u.test(value) };
    }
  },
  {
    predicate: "object_location",
    read: (text) => {
      const match = /(?:护照|身份证|钥匙|证件)(?:放在|在|丢了)?/u.exec(text);
      if (!match) return null;
      return { value: clean(text.slice(match.index + match[0].length)), negated: negatedBefore(text, match.index), asks: false };
    }
  },
  {
    predicate: "health",
    read: (text) => {
      const allergy = /对([^，。；\n]{1,20}?)(?:严重|比较|有点)?(不)?过敏/u.exec(text);
      if (allergy) return { value: clean(allergy[1] ?? ""), negated: Boolean(allergy[2]), asks: false };
      const absent = /(?:没有|没|无)([^，。；\n]{1,20}?)过敏/u.exec(text);
      if (absent) return { value: clean(absent[1] ?? ""), negated: true, asks: false };
      const marker = /(?:忌口|不能吃|患有|确诊|病史)(?:是|为)?/u.exec(text);
      if (!marker) return null;
      return { value: clean(text.slice(marker.index + marker[0].length)), negated: negatedBefore(text, marker.index), asks: false };
    }
  },
  {
    predicate: "preference",
    read: (text) => {
      const match = /(?:喜欢|偏好|讨厌|习惯|兴趣|爱好)(?:是|为)?/u.exec(text);
      if (!match) return null;
      return { value: clean(text.slice(match.index + match[0].length)), negated: negatedBefore(text, match.index), asks: false };
    }
  },
  {
    predicate: "goal",
    read: (text) => {
      const match = /(?:计划|打算|目标|准备)(?:是|为)?/u.exec(text);
      if (!match) return null;
      return { value: clean(text.slice(match.index + match[0].length)), negated: negatedBefore(text, match.index), asks: false };
    }
  },
  {
    predicate: "schedule",
    read: (text) => {
      const marker = /(?:安排|日程|行程|会议|出差|预约|复查|截止日期|截止)(?:是|为|在|有)?/u.exec(text);
      if (!marker) return null;
      const after = clean(text.slice(marker.index + marker[0].length));
      const before = clean(text.slice(0, marker.index).replace(/^我|(?:今天|明天|后天|昨天|本周|这周|下周|上周|这个月|下个月|今年|明年)/gu, ""));
      return { value: after.length > 0 ? after : before, negated: negatedBefore(text, marker.index), asks: false };
    }
  },
  {
    predicate: "project_code",
    read: (text) => {
      const match = /(?:项目代号|代号)(?:是|为)?/u.exec(text);
      if (!match) return null;
      return { value: clean(text.slice(match.index + match[0].length)), negated: false, asks: false };
    }
  }
];
var REPORTED = /(?:听说|据说|有人说|据称|别人说|我听说|他妈说|朋友说|同事说)/u;
var HYPOTHETICAL = /(?:如果|假设|假如|要是|万一|「|」|“|”)/u;
var MODAL = /(?:可能|也许|或许|好像|似乎|大概|说不定|应该是|不确定|估计)/u;
var DOUBLE_NEGATION = /(?:不是不|并非不|未尝不|不无)/u;
var PAST = /(?:以前|曾经|过去|去年|前年|之前|小时候|当年|原来|上次|当年)/u;
var PRESENT = /(?:现在|如今|目前|当前|眼下|这会儿|此刻)/u;
var FUTURE = /(?:以后|将来|未来|明年|后年|下周|下个月|明天|后天|下次|下一年|月底|年底)/u;
var QUESTION_TAIL = /(?:吗|么|呢)$/u;
var INTERROGATIVE = /(?:是否|是不是|难道|多少|几岁|什么|谁|哪(?:里|儿|个|些|种|年)?|怎么|为什么|如何)/u;
var CLAUSE_SEPARATOR = /[，,。.；;！!？?\n]+/u;
var LEADING_CONNECTIVE = /^(?:但是|但|不过|可是|然而|却|而且|并且|然后)/u;
function classifyFactTime(text) {
  const past = PAST.test(text);
  const present = PRESENT.test(text);
  const future = FUTURE.test(text);
  const states = Number(past) + Number(present) + Number(future);
  if (states > 1) return "mixed";
  if (past) return "past";
  if (future) return "future";
  if (present) return "present";
  return "unspecified";
}
var PREDICATE_MARKERS = {
  residence: /住/u,
  employer: /工作|公司|单位/u,
  job_role: /职业|职位|岗位|职务/u,
  study: /学习|学会|课程|专业|在学/u,
  preference: /喜欢|偏好|讨厌|习惯|兴趣|爱好/u,
  goal: /计划|打算|目标|准备/u,
  name: /名字|叫|姓名/u,
  age: /岁|年龄/u,
  project_code: /代号/u,
  pet_name: /猫|狗|宠物/u,
  object_location: /护照|身份证|钥匙|证件|放在/u,
  health: /过敏|忌口|病史/u,
  schedule: /安排|日程|行程|会议|出差|预约|复查|截止/u
};
function splitClauses(text) {
  return text.split(CLAUSE_SEPARATOR).map((part) => part.trim().replace(LEADING_CONNECTIVE, "").trim()).filter((part) => part.length > 0);
}
function readClause(clause) {
  for (const extractor of EXTRACTORS) {
    const extracted = extractor.read(clause);
    if (!extracted) continue;
    return {
      clause,
      predicate: extractor.predicate,
      extracted,
      time: classifyFactTime(clause),
      reported: REPORTED.test(clause),
      hypothetical: HYPOTHETICAL.test(clause),
      modal: MODAL.test(clause),
      doubleNegated: DOUBLE_NEGATION.test(clause),
      // `asks` comes from the extractor itself; the particles are additional
      // evidence, never the only evidence.
      question: extracted.asks || QUESTION_TAIL.test(clause) || INTERROGATIVE.test(clause)
    };
  }
  return null;
}
function dominantPredicate(reads) {
  const counts = /* @__PURE__ */ new Map();
  for (const read of reads) counts.set(read.predicate, (counts.get(read.predicate) ?? 0) + 1);
  let best = reads[0].predicate;
  let bestCount = counts.get(best) ?? 0;
  for (const read of reads) {
    const count = counts.get(read.predicate) ?? 0;
    if (count > bestCount) {
      best = read.predicate;
      bestCount = count;
    }
  }
  return best;
}
function readElliptical(clause, predicate, value) {
  if (!PREDICATE_MARKERS[predicate].test(clause)) return null;
  return {
    clause,
    predicate,
    extracted: { value, negated: /(?:不|没|无|并非|不再)/u.test(clause), asks: false },
    time: classifyFactTime(clause),
    reported: REPORTED.test(clause),
    hypothetical: HYPOTHETICAL.test(clause),
    modal: MODAL.test(clause),
    doubleNegated: DOUBLE_NEGATION.test(clause),
    question: QUESTION_TAIL.test(clause) || INTERROGATIVE.test(clause),
    inherited: true
  };
}
function readFactSlot(text, context = {}) {
  const normalized = text.normalize("NFKC").trim();
  if (normalized.length === 0) return null;
  const clauses = splitClauses(normalized);
  const direct = clauses.map(readClause);
  const found = direct.filter((read) => read !== null);
  if (found.length === 0) return null;
  const predicate = dominantPredicate(found);
  const anchorValue = clean(found.find((read) => read.predicate === predicate).extracted.value);
  const reads = [];
  for (let index = 0; index < clauses.length; index += 1) {
    const read = direct[index];
    if (read) {
      reads.push(read);
      continue;
    }
    const elliptical = readElliptical(clauses[index], predicate, anchorValue);
    if (elliptical) reads.push(elliptical);
  }
  const selected = reads.filter((read) => read.predicate === predicate);
  const build = (kind2, time2, value2) => ({
    subject: "user",
    predicate,
    value: kind2 === "question" || kind2 === "uncertain" ? "" : value2.slice(0, 120).toLocaleLowerCase(),
    kind: kind2,
    time: time2,
    question: kind2 === "question",
    observedAt: context.observedAt ?? "",
    status: context.status ?? "active",
    sourceId: context.sourceId ?? ""
  });
  if (selected.some((read) => read.reported || read.hypothetical || read.modal || read.doubleNegated)) {
    const time2 = selected.map((read) => read.time).find((value2) => value2 !== "unspecified") ?? "unspecified";
    return build("uncertain", selected.some((read) => read.time === "mixed") ? "mixed" : time2, "");
  }
  const definiteTimes = [...new Set(selected.map((read) => read.time).filter((time2) => time2 !== "unspecified"))];
  if (definiteTimes.length > 1 || selected.some((read) => read.time === "mixed")) {
    return build("uncertain", "mixed", "");
  }
  const time = definiteTimes[0] ?? "unspecified";
  if (selected.some((read) => read.question)) return build("question", time, "");
  const kinds = new Set(selected.map((read) => read.extracted.negated ? "negated" : "assertion"));
  const values = new Set(selected.map((read) => clean(read.extracted.value)));
  if (kinds.size > 1 || values.size > 1) return build("uncertain", time, "");
  const kind = kinds.has("negated") ? "negated" : "assertion";
  const value = clean(selected[0].extracted.value);
  if (value.length === 0) return build("uncertain", time, "");
  return build(kind, time, value);
}

// src/cognition/cognition.ts
var COGNITIVE_SCHEMA_VERSION = 1;
var COGNITIVE_ANALYZER_VERSION = "rules-v2";
var COGNITIVE_INTENTS = [
  "information_query",
  "explanation",
  "venting",
  "feedback",
  "correction",
  "exploration",
  "planning",
  "sharing",
  "uncertain"
];
var intentSet = new Set(COGNITIVE_INTENTS);
var quotedTextPattern = /"[^"\r\n]*"|“[^”\r\n]*”|‘[^’\r\n]*’|「[^」\r\n]*」|『[^』\r\n]*』|«[^»\r\n]*»|`[^`\r\n]*`|(?<![\p{L}\p{N}])'[^'\r\n]+'(?![\p{L}\p{N}])/gu;
var reportedEnglishSpeechPattern = /\b(?:my\s+(?:friend|coworker|colleague|partner|mother|father|sister|brother)|someone|he|she|they|a\s+review|the\s+review|a\s+reviewer|the\s+reviewer)\s+(?:said|says|wrote|writes|texted|mentioned|reported|stated|claimed)\b[^.!?;。！？；\r\n]*(?:[.!?;。！？；]|$)/giu;
var reportedChineseSpeechPattern = /(?:我(?:的)?(?:朋友|同事|伴侣|家人|母亲|父亲)|朋友|同事|伴侣|家人|有人|他|她|对方|评论者|这条评论|那条评论)\s*(?:说|提到|表示|写道|称)[^。！？!?；;\r\n]*(?:[。！？!?；;]|$)/gu;
function stripQuotedAndReportedText(value) {
  return value.replace(quotedTextPattern, " ").replace(/^\s*>[^\r\n]*$/gmu, " ").replace(reportedEnglishSpeechPattern, " ").replace(reportedChineseSpeechPattern, " ").replace(/\s+/gu, " ").trim();
}
var uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
var envelopeKeys = [
  "schemaVersion",
  "recordKind",
  "recordId",
  "source",
  "status",
  "evidenceRefs",
  "confidenceScore",
  "confidenceBasis",
  "uncertainty",
  "requiresUserConfirmation",
  "revision",
  "changeReason"
].sort().join("|");
var turnKeys = [
  "schemaVersion",
  "analyzerVersion",
  "intent",
  "alternatives",
  "confidenceScore",
  "confidenceBasis",
  "uncertainty",
  "strategy",
  "topicSource",
  "topicReferenceMessageId",
  "signals",
  "evidence"
].sort().join("|");
function exactKeys(value, expected) {
  return Object.keys(value).sort().join("|") === expected;
}
function isValidUuid(value) {
  return typeof value === "string" && uuidPattern.test(value);
}
function isEvidenceReference(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const reference = value;
  if (typeof reference.kind !== "string" || typeof reference.id !== "string") return false;
  if (reference.kind === "conversation_message" || reference.kind === "memory_suggestion") {
    return Object.keys(reference).sort().join("|") === "id|kind|revision" && isValidUuid(reference.id) && reference.revision === null;
  }
  if (reference.kind === "memory_revision") {
    return Object.keys(reference).sort().join("|") === "id|kind|revision" && isValidUuid(reference.id) && Number.isSafeInteger(reference.revision) && Number(reference.revision) > 0;
  }
  if (reference.kind === "personality_revision") {
    return Object.keys(reference).sort().join("|") === "id|kind|revision" && reference.id === "primary" && Number.isSafeInteger(reference.revision) && Number(reference.revision) > 0;
  }
  return false;
}
function isCognitiveEvidenceEnvelope(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value;
  if (!exactKeys(record, envelopeKeys) || record.schemaVersion !== COGNITIVE_SCHEMA_VERSION) return false;
  if (!["intent", "memory", "personality", "memory_suggestion"].includes(String(record.recordKind))) return false;
  if (typeof record.recordId !== "string" || record.recordId.length < 1 || record.recordId.length > 80) return false;
  if (!["local_rules", "user_explicit", "user_edited", "provider_proposal"].includes(String(record.source))) return false;
  if (!["observation", "active", "candidate", "retracted", "historical"].includes(String(record.status))) return false;
  if (!Array.isArray(record.evidenceRefs) || record.evidenceRefs.length > 32 || !record.evidenceRefs.every(isEvidenceReference)) return false;
  if (record.confidenceScore !== null && (!Number.isSafeInteger(record.confidenceScore) || Number(record.confidenceScore) < 0 || Number(record.confidenceScore) > 100)) return false;
  if (!["unscored", "unvalidated_rule_strength"].includes(String(record.confidenceBasis))) return false;
  if (!["low", "medium", "high", "not_scored"].includes(String(record.uncertainty))) return false;
  if (typeof record.requiresUserConfirmation !== "boolean") return false;
  if (record.revision !== null && (!Number.isSafeInteger(record.revision) || Number(record.revision) < 1)) return false;
  if (!["rule_inference", "explicit_memory_entry", "explicit_memory_correction", "explicit_memory_retraction", "explicit_memory_restore", "explicit_memory_control", "user_controlled_personality_edit", "user_controlled_personality_restore", "model_proposal", "user_approved_proposal", "user_rejected_proposal"].includes(String(record.changeReason))) return false;
  if (record.confidenceBasis === "unscored" && (record.confidenceScore !== null || record.uncertainty !== "not_scored")) return false;
  if (record.confidenceBasis === "unvalidated_rule_strength" && (record.confidenceScore === null || record.uncertainty === "not_scored")) return false;
  if (record.recordKind === "intent") {
    if (record.source !== "local_rules" || record.status !== "observation" || record.changeReason !== "rule_inference" || record.revision !== null || record.requiresUserConfirmation !== true) return false;
    const messages = record.evidenceRefs.filter((item) => item.kind === "conversation_message");
    const memories = record.evidenceRefs.filter((item) => item.kind === "memory_revision");
    const personalities = record.evidenceRefs.filter((item) => item.kind === "personality_revision");
    if (messages.length < 1 || messages.length > 2 || messages[0]?.id !== record.recordId || memories.length > 25 || personalities.length > 1) return false;
    if (record.evidenceRefs.some((item) => item.kind === "memory_suggestion")) return false;
    if (new Set(record.evidenceRefs.map((item) => `${item.kind}:${item.id}:${item.revision}`)).size !== record.evidenceRefs.length) return false;
  }
  if (record.recordKind === "memory") {
    if (record.source !== "user_explicit" || !["active", "retracted"].includes(String(record.status)) || !record.evidenceRefs.some((item) => item.kind === "memory_revision" && item.id === record.recordId && item.revision === record.revision)) return false;
  }
  if (record.recordKind === "personality") {
    if (record.source !== "user_edited" || record.status !== "active" || record.recordId !== "primary" || !record.evidenceRefs.some((item) => item.kind === "personality_revision" && item.revision === record.revision)) return false;
  }
  if (record.recordKind === "memory_suggestion") {
    if (record.source !== "provider_proposal" || !["candidate", "historical", "retracted"].includes(String(record.status))) return false;
    if (record.requiresUserConfirmation !== (record.status === "candidate")) return false;
    if (!record.evidenceRefs.some((item) => item.kind === "memory_suggestion" && item.id === record.recordId)) return false;
  }
  return true;
}
function assertCognitiveEvidenceEnvelope(value) {
  if (!isCognitiveEvidenceEnvelope(value)) throw new TypeError("Invalid cognitive evidence envelope.");
}
function createIntentEvidence(sourceMessageId, topicReferenceMessageId, confidenceScore, uncertainty, memoryRefs = [], personalityVersion) {
  const evidenceRefs = [
    { kind: "conversation_message", id: sourceMessageId, revision: null },
    ...topicReferenceMessageId ? [{ kind: "conversation_message", id: topicReferenceMessageId, revision: null }] : [],
    ...personalityVersion === void 0 ? [] : [{ kind: "personality_revision", id: "primary", revision: personalityVersion }],
    ...memoryRefs
  ];
  const envelope = {
    schemaVersion: COGNITIVE_SCHEMA_VERSION,
    recordKind: "intent",
    recordId: sourceMessageId,
    source: "local_rules",
    status: "observation",
    evidenceRefs,
    confidenceScore,
    confidenceBasis: "unvalidated_rule_strength",
    uncertainty,
    requiresUserConfirmation: true,
    revision: null,
    changeReason: "rule_inference"
  };
  assertCognitiveEvidenceEnvelope(envelope);
  return envelope;
}
function isCognitiveUuid(value) {
  return isValidUuid(value);
}

// src/cognition/intent-decision.ts
var INTENT_DECISION_VERSION = "intent-rules-v2";
var INTENT_LABELS = [
  "information_query",
  "continuation",
  "correction",
  "preference_expression",
  "emotion_expression",
  "goal_or_plan",
  "new_topic",
  "ambiguous",
  // A plain self-disclosure ("我住在杭州") is neither a preference nor a query;
  // it keeps its own class so it is never read as either.
  "self_fact",
  // A request for an action ("帮我把这段代码删掉") is not a question. Without its
  // own label it was either `ambiguous` or `information_query`, and both are
  // wrong in a way that reaches the retrieval policy.
  "request",
  // Preserved from the earlier taxonomy so stored turns keep a meaningful label.
  "explanation",
  "exploration",
  "feedback"
];
var LEGACY_MAP = {
  information_query: "information_query",
  continuation: "information_query",
  correction: "correction",
  preference_expression: "sharing",
  emotion_expression: "venting",
  goal_or_plan: "planning",
  // A topic switch is a routing hint, not a request to brainstorm: mapping it
  // to `exploration` made the affect engine emit an exploration event.
  new_topic: "information_query",
  ambiguous: "uncertain",
  self_fact: "sharing",
  // The legacy taxonomy has no request class; a request is answered like a
  // query, and the speech act carries the difference that matters.
  request: "information_query",
  explanation: "explanation",
  exploration: "exploration",
  feedback: "feedback"
};
function legacyIntentOf(label) {
  return LEGACY_MAP[label];
}
var RETRIEVAL = {
  information_query: true,
  continuation: true,
  correction: true,
  // "按需" retrieval: a stated preference is answered first; the policy still
  // restricts what may be attached to related preference history.
  preference_expression: false,
  emotion_expression: false,
  goal_or_plan: true,
  new_topic: false,
  ambiguous: false,
  self_fact: false,
  request: true,
  explanation: false,
  exploration: false,
  feedback: false
};
var CANDIDATE = {
  information_query: false,
  continuation: false,
  correction: true,
  preference_expression: true,
  emotion_expression: false,
  goal_or_plan: true,
  new_topic: false,
  ambiguous: false,
  self_fact: true,
  request: false,
  explanation: false,
  exploration: false,
  feedback: false
};
var CORRECTION = /(?:更正|纠正|我(?:刚才)?(?:说错了?|讲错了?)|你理解错了|我的意思是|我说的是|我不是说|其实(?:我|是)|不对|不是我说的|记错了|改正|不应该是)|\b(?:correction|i meant|i mean|i was wrong|that's not right|that is not right|not what i meant|not what i asked|you misunderstood|your answer(?: is| was)? (?:wrong|incorrect)|(?:this|that|the) answer (?:is|was) (?:wrong|incorrect)|you(?:'re| are) wrong|you got (?:it|that) wrong|i gave you the wrong|actually i (?:meant|said))\b/iu;
var CHANGED_MIND = /(?:我改主意|改变主意|改了主意|不再(?:喜欢|想要|想)|我不喜欢了|换一个|改成|不想要了|还是.{0,12}(?:吧|好了))|\b(?:let's do.{0,40}instead|i changed my mind|i'd rather|i would rather|instead of|i no longer (?:like|prefer)|i (?:don't|do not) like.{0,40}anymore)\b/iu;
var FEEDBACK = /(?:谢谢|感谢|很好用|有帮助|没帮助|很差|不满意|做得好|回答不错|反馈|你回答得)|\b(?:thank you|thanks|not useful|helpful|not helpful|great answer|poor answer|i appreciate|feedback)\b/iu;
var EMOTION = /(?:想倾诉|想吐槽|只是想说|心情(?:很|有点)?(?:差|糟|不好)|(?:很|有点|非常|特别)?(?:难过|焦虑|烦|累|孤独|害怕|沮丧|生气|愤怒|恼火|难受)|压力很大|受不了了|感觉(?:很|有点)?(?:难过|焦虑|烦|累|孤独|害怕|沮丧|生气|愤怒|恼火|难受))|\b(?:i need to vent|i (?:feel|am feeling) (?:really )?(?:sad|anxious|angry|overwhelmed|lonely|afraid|tired|upset|frustrated|scared|nervous|down)|i['’]m (?:feeling (?:really )?)?(?:sad|anxious|angry|overwhelmed|lonely|afraid|tired|upset|frustrated|scared|nervous|down))\b/iu;
var GOAL_REQUEST = /(?:计划|规划|安排|下一步|帮我制定|帮我计划|怎么开始|如何开始)|\b(?:plan|planning|schedule|roadmap|next steps|help me plan|how should i start)\b/iu;
var EXPLICIT_GOAL = /(?:我(?:打算|计划|准备|想要?)|我的目标|目标是|我想(?:先|要|在|于|把|完成|实现|开始))|\b(?:i want to|i want to achieve|my goal is|i intend to|i plan to)\b/iu;
var REQUEST_SHAPE = /(?:帮我|帮忙|请(?:你)?(?:帮|给|把)|麻烦(?:你)?|给我(?:把|写|改|看|查)|替我|把[^，。！？,!?]{1,20}(?:删|改|加|换|做|写|清空|移))|(?:please|can you|could you|would you|help me)/iu;
var EXPLANATION = /(?:解释(?:一下)?|说明一下|为什么会|为什么(?:是|要|会|不|.{1,12})|原理|原因是什么|是什么意思|怎么回事)|\b(?:explain|why does|why is|how does|what causes|what does .* mean)\b/iu;
var EXPLORATION = /(?:聊聊|讨论一下|探讨|探索|头脑风暴|一起想想|有什么想法|可以聊)|\b(?:brainstorm|explore|let's discuss|let us discuss|talk through|what are some ideas)\b/iu;
var INFORMATION = /(?:什么|怎么|如何|为什么|哪(?:一?个|家|些|种|里|儿|年)?|什么时候|多少|谁|是否|吗[？?。!！]?$|怎么样)|\b(?:what|who|where|when|which|why|how|can you tell me|could you tell me|do you know|is there|are there)\b/iu;
var PREFERENCE = /(?:我喜欢|我不喜欢|我偏好|我讨厌|我更(?:喜欢|愿意))|\b(?:i (?:like|love|prefer|dislike|hate)|i (?:do not|don't) (?:like|prefer))\b/iu;
var TOPIC_SWITCH = /(?:换个话题|换个问题|另一个问题|另外(?:问)?|先不说|说点别的|顺便问)|\b(?:new topic|different question|by the way|separate question|unrelated question|switch topics|never mind|ignore that|forget that|drop that)\b/iu;
var AMBIGUOUS_REFERENCE = /(?:你指的是什么|不确定你指|不太明白你的意思|我不懂你说的)|\b(?:i'm not sure what you mean|i am not sure what you mean|unclear what you mean|ambiguous)\b/iu;
var FOLLOW_UP = /^(?:那.{0,24}(?:呢|怎么办|如何|怎么|为什么|可以吗|行吗)|然后|所以|那么|(?:这个|那个|它|这件事|那件事)(?:呢|怎么办|如何|怎么|为什么|怎么样)|上面|刚才|之前)|\b(?:and then|then what|what about|how so|why so|what next|about that|and it|and this)\b/iu;
var DEICTIC = /(?:这个|那个|它|他们|她们|这件事|那件事|上面(?:说的)?|刚才(?:说的)?|之前(?:说的|提的|提到的)|那么|那里|这点)|\b(?:it|this|those|these)\b|\b(?:the above|what about that|that mean|this mean|how so|why so|then what|what next)\b/iu;
var SELF_FACT = /(?:我(?:不喜欢|喜欢|偏好|住在|工作在|从事|通常|习惯|的目标|的生日|会))|\bi (?:(?:do not|don't) )?(?:like|prefer|dislike|live|work|usually|tend to|use|avoid)\b/iu;
var SELF_DISCLOSURE = /(?:我(?:住在|在.{1,12}(?:工作|上班|学习)|通常|平时|一般|每天|叫|的生日是|今年\d{1,3}岁))|\bi\s+(?:live|work|study|usually|normally|drink|eat|use|am from|am a|am an)\b|\bmy\s+(?:name|job|birthday|routine)\b/iu;
var RECALL_REQUEST = /(?:你还记得|你记得我.{0,24}(?:吗|么)|我(?:之前|上次)告诉过你|我(?:之前|上次)(?:说过|说的|提过|提到的|聊过)|我们之前聊过|能回忆起|我的(?:偏好|目标|习惯)(?:是什么|是什么来着|吗|呢))|\b(?:do you remember|can you recall|what do i|what did i tell you|what have i told you|recall my|what is my|what's my)\b/iu;
var SAVE_REQUEST = /(?:请(?:你)?记住|记住(?:我|这个|这件事|一下)|以后(?:都)?记得|把这(?:条|件事|个)记下来|保存为记忆)|\b(?:please remember|remember that|remember this|save this as a memory|save that as a memory)\b/iu;
function isShortReference(value) {
  const han = (value.match(/\p{Script=Han}/gu) ?? []).length;
  const latinWords = (value.match(/[A-Za-z0-9]+/gu) ?? []).length;
  if (han > 0) return han <= 5 && latinWords <= 2;
  return latinWords <= 4;
}
function normalize(value) {
  return value.normalize("NFKC").toLowerCase().trim();
}
function collectSignals(content, hasPriorTurn, fact) {
  const signals = [];
  const seen = /* @__PURE__ */ new Map();
  const add = (label, weight, reason, source = reason) => {
    const key = `${label}|${source}`;
    const existing = seen.get(key);
    if (existing) {
      existing.weight = Math.max(existing.weight, weight);
      if (!existing.reasons.includes(reason)) existing.reasons.push(reason);
      return;
    }
    const signal = { label, weight, reasons: [reason], source };
    seen.set(key, signal);
    signals.push(signal);
  };
  if (CORRECTION.test(content)) add("correction", 94, "explicit_correction_marker");
  if (CHANGED_MIND.test(content)) add("correction", 88, "changed_mind_marker");
  if (FEEDBACK.test(content)) add("feedback", 88, "feedback_marker");
  if (EMOTION.test(content)) add("emotion_expression", 86, "affect_lexicon");
  const goalRequest = GOAL_REQUEST.test(content);
  const explicitGoal = EXPLICIT_GOAL.test(content);
  if ((goalRequest || explicitGoal) && fact?.kind !== "question") {
    add("goal_or_plan", 88, "goal_or_plan_marker", "goal_marker");
  }
  if (explicitGoal) add("goal_or_plan", 88, "explicit_goal_statement", "goal_marker");
  if (REQUEST_SHAPE.test(content) && !SAVE_REQUEST.test(content)) add("request", 86, "imperative_request");
  if (EXPLANATION.test(content)) add("explanation", 88, "explanation_marker");
  const explorationRequest = EXPLORATION.test(content);
  if (explorationRequest) add("exploration", 84, "exploration_marker");
  if (TOPIC_SWITCH.test(content)) add("new_topic", 90, "explicit_topic_switch");
  if (AMBIGUOUS_REFERENCE.test(content)) add("ambiguous", 86, "self_reported_ambiguity");
  if (INFORMATION.test(content) && !explorationRequest) {
    add("information_query", 80, "question_marker", "question_surface");
  }
  if (/[?？]/u.test(content)) add("information_query", 64, "question_punctuation", "question_surface");
  const hypothetical = /(?:如果|假设|假如|要是|万一|听说|据说|有人说)/u.test(content);
  if (PREFERENCE.test(content) && !hypothetical) add("preference_expression", 80, "preference_marker");
  if (hypothetical) add("information_query", 82, "hypothetical_or_reported");
  if (SELF_DISCLOSURE.test(content)) add("self_fact", 78, "self_disclosure_marker");
  if (RECALL_REQUEST.test(content)) add("information_query", 90, "explicit_recall_request");
  if (SAVE_REQUEST.test(content)) add(PREFERENCE.test(content) || SELF_FACT.test(content) ? "preference_expression" : "information_query", 86, "save_request_with_self_fact");
  if (fact) {
    if (fact.predicate === "preference" && fact.kind !== "question") add("preference_expression", 70, "fact_predicate_preference");
    if (fact.predicate === "goal") add("goal_or_plan", 70, "fact_predicate_goal");
    if (fact.predicate === "schedule" && fact.kind !== "question") add("goal_or_plan", 62, "fact_predicate_schedule");
    if (fact.kind === "question") add("information_query", 66, "fact_predicate_question");
    if (fact.predicate === "health" && fact.kind !== "question") add("information_query", 20, "fact_predicate_health");
  }
  const reference = FOLLOW_UP.test(content) || DEICTIC.test(content) || isShortReference(content) && /[?？]/u.test(content) && !INFORMATION.test(content);
  if (reference) {
    if (hasPriorTurn) add("continuation", isShortReference(content) ? 86 : 72, "reference_to_prior_turn");
    else add("ambiguous", 84, "reference_without_context");
  }
  if (SELF_FACT.test(content) && hasPriorTurn && reference) add("continuation", 60, "self_fact_inside_reference");
  return signals;
}
function levelOf(confidence) {
  if (confidence >= 80) return "high";
  if (confidence >= 55) return "medium";
  return "low";
}
function referenceDependenceOf(label, reasons) {
  if (label === "continuation") return true;
  return reasons.includes("reference_to_prior_turn") || reasons.includes("reference_without_context");
}
function retrievalNeedOf(label, input) {
  if (label === "emotion_expression") return input.reasons.includes("reference_to_prior_turn");
  if (label === "information_query") {
    if (input.reasons.includes("explicit_recall_request")) return true;
    const personalReference = /(?:我的|我(?:住在|叫|今年|的)|我自己)|\b(?:my|mine|about me|do i (?:like|prefer|have|own|remember)|did i (?:say|tell|mention)|have i (?:told|said|mentioned)|am i (?:allergic|living|working))\b/iu.test(input.content);
    const referenceOnly = input.reasons.includes("reference_to_prior_turn") && !personalReference;
    if (referenceOnly) return false;
    return personalReference || input.fact?.kind === "question";
  }
  if (label === "continuation") return input.hasPriorTurn;
  if (label === "request") {
    const personalReference = /(?:我的|我之前|我上次|我(?:住在|叫|今年)|我自己)|\b(?:my|mine|about me)\b/iu.test(input.content);
    return personalReference || GOAL_REQUEST.test(input.content);
  }
  return RETRIEVAL[label];
}
function scoreIntentCandidates(input) {
  const content = normalize(input.content);
  const fact = readFactSlot(input.content);
  const signals = collectSignals(content, input.hasPriorTurn, fact);
  const scores = /* @__PURE__ */ new Map();
  for (const signal of signals) {
    const entry = scores.get(signal.label) ?? { score: 0, maxWeight: 0, reasons: [], sources: 0 };
    entry.maxWeight = Math.max(entry.maxWeight, signal.weight);
    entry.sources += 1;
    for (const reason of signal.reasons) if (!entry.reasons.includes(reason)) entry.reasons.push(reason);
    scores.set(signal.label, entry);
  }
  for (const entry of scores.values()) {
    entry.score = Math.min(100, entry.maxWeight + Math.min(8, 4 * Math.max(0, entry.sources - 1)));
  }
  return [...scores.entries()].map(([label, entry]) => ({ label, score: entry.score, maxWeight: entry.maxWeight, reasons: entry.reasons })).sort((left, right) => right.score - left.score || right.maxWeight - left.maxWeight || left.label.localeCompare(right.label));
}
function decideIntent(input) {
  const content = normalize(input.content);
  const fact = readFactSlot(input.content);
  const signals = collectSignals(content, input.hasPriorTurn, fact);
  const candidates = scoreIntentCandidates(input);
  const scores = new Map(
    candidates.map((candidate) => [candidate.label, { score: candidate.score, maxWeight: candidate.maxWeight, reasons: candidate.reasons, sources: candidate.reasons.length }])
  );
  const ranked = [...scores.entries()].sort((left, right) => right[1].score - left[1].score || right[1].maxWeight - left[1].maxWeight || left[0].localeCompare(right[0]));
  const label = ranked[0]?.[0] ?? "ambiguous";
  let confidence = ranked[0]?.[1].score ?? 30;
  const reasons = [...ranked[0]?.[1].reasons ?? []];
  if (signals.length === 0) {
    reasons.push("no_rule_matched");
    confidence = 30;
  }
  const strong = signals.filter((signal) => signal.weight >= 80).length;
  if (strong === 0 && reasons.length <= 1) {
    confidence = Math.min(confidence, 62);
    reasons.push("single_weak_signal");
  }
  if (label === "ambiguous") confidence = Math.min(confidence, 74);
  const alternatives = ranked.slice(1).filter(([, entry]) => (ranked[0]?.[1].score ?? 0) - entry.score <= 18).slice(0, 2).map(([candidate]) => candidate);
  const dependsOnPriorTurn = signals.some((signal) => signal.reasons.includes("reference_to_prior_turn")) && input.hasPriorTurn || label === "ambiguous" && reasons.includes("reference_without_context");
  const personalReference = /(?:我的|我(?:住在|叫|今年|的)|我自己)|\b(?:my|mine|about me|do i|did i|have i|am i)\b/iu.test(content);
  const needsMemoryRetrieval = retrievalNeedOf(label, { content, fact, reasons, hasPriorTurn: input.hasPriorTurn });
  return {
    version: INTENT_DECISION_VERSION,
    intent: label,
    legacyIntent: LEGACY_MAP[label],
    confidence,
    confidenceLevel: levelOf(confidence),
    needsMemoryRetrieval,
    dependsOnPriorTurn,
    mayProduceMemoryCandidate: CANDIDATE[label],
    alternatives,
    reasons
  };
}
var labelSet = new Set(INTENT_LABELS);

// src/cognition/intent-confidence.ts
var INTENT_CONFIDENCE_WEIGHTS = {
  semantic: 0.1,
  explicitness: 0.6,
  completeness: 0.1,
  context: 0.1,
  ambiguity: 0.1
};
var INTENT_CONFIDENCE_BANDS = {
  high: 0.62,
  medium: 0.45,
  /** Below this, a direction-changing reading cannot drive the answer alone. */
  clarify: 0.42
};
var INTENT_MARGIN_FLOOR = 0.08;
var INTENT_SHARE_TEMPERATURE = 0.12;
var CONTENT_MARKERS = /[\p{Script=Han}A-Za-z0-9]/gu;
var NEGATION = /(?:不|没|别|未|非|无)|\b(?:not|no|never|without|don't|doesn't|isn't|aren't|won't)\b/iu;
var IRONY = /(?:反讽|阴阳怪气|说反话|呵呵|真是好极了)|\b(?:sarcas\w*|sure,? that went well|great,? just great)\b/iu;
var SELF_REPORTED_AMBIGUITY = /(?:你指的是什么|不确定你指|不太明白你的意思|我不懂你说的)|\b(?:i'?m not sure what you mean|unclear what you mean|ambiguous)\b/iu;
var DEICTIC2 = /(?:这个|那个|它|他们|她们|这件事|那件事|上面(?:说的)?|刚才(?:说的)?|之前(?:说的|提的|提到的)|那么|那里|这点)|\b(?:it|this|those|these)\b/iu;
var QUESTION_WORDS = /(?:什么|怎么|如何|为什么|哪(?:一?个|家|些|种|里|儿|年)?|什么时候|多少|谁|是否|吗)|\b(?:what|who|where|when|which|why|how)\b/iu;
var ACTION_VERB = /(?:制定|计划|规划|安排|开始|准备|学习|练习|做|完成|实现|整理|写|读)|\b(?:plan|schedule|start|prepare|build|write|learn|practice|organize)\b/iu;
var SCOPE_WORD = /(?:下周|下个月|本月|本周|今年|明天|每天|每周|预算|小时|天|周|月|年|目标|步骤|范围)|\b(?:next week|next month|this week|tomorrow|daily|weekly|budget|hours?|days?|weeks?|months?|goal|steps?|scope)\b/iu;
function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
function normalize2(value) {
  return value.normalize("NFKC").toLowerCase().trim();
}
function contentLength(value) {
  return (value.match(CONTENT_MARKERS) ?? []).length;
}
function sharesContentTerm(current, prior) {
  const bigrams = (value) => {
    const set = /* @__PURE__ */ new Set();
    for (const run of value.match(/[\p{Script=Han}]{2,}/gu) ?? []) {
      for (let index = 0; index + 1 < run.length; index += 1) set.add(run.slice(index, index + 2));
    }
    for (const word of value.match(/[a-z]{4,}/gu) ?? []) set.add(word);
    return set;
  };
  const priorTerms = bigrams(prior);
  if (priorTerms.size === 0) return false;
  for (const term of bigrams(current)) if (priorTerms.has(term)) return true;
  return false;
}
function explicitnessOf(candidate) {
  const predicateOnly = candidate.reasons.every((reason) => reason.startsWith("fact_predicate"));
  if (candidate.maxWeight >= 80 && !predicateOnly) return 1;
  if (candidate.reasons.some((reason) => reason.startsWith("fact_predicate"))) return 0.55;
  if (candidate.maxWeight >= 62) return 0.6;
  return 0.35;
}
function completenessOf(candidate, content) {
  const length = contentLength(content);
  const hasQuestionWord = QUESTION_WORDS.test(content);
  const hasQuestionMark = /[?？]/u.test(content);
  switch (candidate.label) {
    case "information_query": {
      if (hasQuestionWord && length >= 5) return 1;
      if (hasQuestionMark && length >= 4) return 0.8;
      return length >= 6 ? 0.6 : 0.35;
    }
    case "continuation":
      return hasQuestionWord || hasQuestionMark ? 0.9 : 0.5;
    case "goal_or_plan": {
      const action = ACTION_VERB.test(content);
      const scope = SCOPE_WORD.test(content);
      if (action && scope) return 1;
      if (action) return 0.65;
      return 0.4;
    }
    case "correction":
      return length >= 6 ? 1 : 0.45;
    case "preference_expression":
    case "self_fact":
      return length >= 5 ? 0.9 : 0.5;
    case "emotion_expression":
    case "feedback":
    case "explanation":
    case "exploration":
    case "new_topic":
      return 0.85;
    case "ambiguous":
      return 0.3;
    default:
      return 0.7;
  }
}
function contextFitOf(candidate, input) {
  if (!referenceDependenceOf(candidate.label, candidate.reasons)) return 1;
  if (!input.priorUserBody) return 0;
  return sharesContentTerm(normalize2(input.content), normalize2(input.priorUserBody)) ? 1 : 0.2;
}
function ambiguityOf(candidate, input, contested) {
  const content = normalize2(input.content);
  const reasons = [];
  let value = 0;
  const reference = referenceDependenceOf(candidate.label, candidate.reasons) || DEICTIC2.test(content);
  if (reference && !input.priorUserBody) {
    value += 0.6;
    reasons.push("reference_without_context");
  }
  if (SELF_REPORTED_AMBIGUITY.test(content)) {
    value += 0.8;
    reasons.push("self_reported_ambiguity");
  }
  if (DEICTIC2.test(content)) {
    value += 0.3;
    reasons.push("deixis");
  }
  if (NEGATION.test(content)) {
    value += 0.15;
    reasons.push("negation_present");
  }
  if (IRONY.test(content)) {
    value += 0.3;
    reasons.push("irony_marker");
  }
  if (contested) {
    value += 0.2;
    reasons.push("competing_readings");
  }
  return { value: clamp01(value), reasons };
}
function assessIntentConfidence(input, overrides = {}) {
  if (input.candidates.length === 0) {
    return {
      band: "low",
      top: "ambiguous",
      topScore: 0,
      margin: 0,
      directionChanging: false,
      needsClarification: false,
      reasons: ["no_candidate"],
      candidates: [],
      calibration: "uncalibrated_heuristic"
    };
  }
  const sorted = [...input.candidates].sort((left, right) => right.score - left.score || left.label.localeCompare(right.label));
  const contested = sorted.length > 1 && sorted[0].score - sorted[1].score <= 10;
  const w = overrides.weights ?? INTENT_CONFIDENCE_WEIGHTS;
  const scored = sorted.map((candidate) => {
    const semantic = clamp01(candidate.score / 100);
    const explicitness = explicitnessOf(candidate);
    const completeness = completenessOf(candidate, normalize2(input.content));
    const context = contextFitOf(candidate, input);
    const ambiguity = ambiguityOf(candidate, input, contested);
    const z = Number((w.semantic * semantic + w.explicitness * explicitness + w.completeness * completeness + w.context * context - w.ambiguity * ambiguity.value).toFixed(4));
    return {
      label: candidate.label,
      z,
      features: { semantic, explicitness, completeness, context, ambiguity: ambiguity.value },
      share: 0
    };
  });
  scored.sort((left, right) => right.z - left.z || right.features.semantic - left.features.semantic || left.label.localeCompare(right.label));
  const top = scored[0];
  const second = scored[1];
  const marginFloor = overrides.marginFloor ?? INTENT_MARGIN_FLOOR;
  const margin = Number((top.z - (second?.z ?? 0)).toFixed(4));
  const fact = readFactSlot(input.content);
  const reasonsOf = new Map(input.candidates.map((candidate) => [candidate.label, candidate.reasons]));
  const needsRetrieval = (label) => retrievalNeedOf(label, {
    content: input.content,
    fact,
    reasons: reasonsOf.get(label) ?? [],
    hasPriorTurn: Boolean(input.priorUserBody)
  });
  const directionChanging = second !== void 0 && needsRetrieval(top.label) !== needsRetrieval(second.label);
  const exp = scored.map((candidate) => Math.exp(candidate.z / INTENT_SHARE_TEMPERATURE));
  const total = exp.reduce((sum, value) => sum + value, 0);
  scored.forEach((candidate, index) => {
    candidate.share = Number((exp[index] / total).toFixed(4));
  });
  const band = top.z >= INTENT_CONFIDENCE_BANDS.high && margin >= marginFloor ? "high" : top.z >= INTENT_CONFIDENCE_BANDS.medium ? "medium" : "low";
  const topAmbiguity = top.features.ambiguity;
  const clarifyThreshold = overrides.clarifyThreshold ?? INTENT_CONFIDENCE_BANDS.clarify;
  const unresolvedReference = !input.priorUserBody && (input.candidates.some((candidate) => referenceDependenceOf(candidate.label, candidate.reasons)) || DEICTIC2.test(normalize2(input.content)));
  const needsClarification = unresolvedReference || directionChanging && margin < marginFloor || top.z < clarifyThreshold && directionChanging && topAmbiguity >= 0.5;
  const reasons = [];
  if (contested) reasons.push("competing_readings");
  if (directionChanging) reasons.push("direction_changing_pair");
  if (margin < marginFloor) reasons.push("margin_below_floor");
  if (topAmbiguity >= 0.5) reasons.push("high_ambiguity");
  if (unresolvedReference) reasons.push("unresolved_reference");
  if (reasons.length === 0) reasons.push("decisive");
  if (needsClarification) reasons.push("clarify");
  return {
    band,
    top: top.label,
    topScore: top.z,
    margin,
    directionChanging,
    needsClarification,
    reasons,
    candidates: scored,
    calibration: "uncalibrated_heuristic"
  };
}

// src/cognition/speech-act.ts
var SPEECH_ACT_VERSION = "speech-act-v1";
var ACTIONS = [
  { action: "delete", pattern: /(?:删除|删掉|删了|删掉它|清空|清除|抹掉|移除)|\b(?:delete|remove|erase|wipe|clear)\b/iu },
  { action: "save", pattern: /(?:保存|记住|记下来|存起来|记录一下)|\b(?:save|remember|store)\b/iu },
  { action: "execute", pattern: /(?:执行|运行|跑一下|动手|开始做|做一遍)|\b(?:execute|run it|do it|go ahead)\b/iu },
  { action: "modify", pattern: /(?:修改|改一下|改成|重写|调整)|\b(?:modify|change|rewrite|edit)\b/iu },
  { action: "continue", pattern: /(?:继续|接着说|往下说|接着讲|接着做)|\b(?:continue|go on|carry on|keep going)\b/iu },
  { action: "look", pattern: /(?:看看|看一下|帮我看|检查|审查|review)|\b(?:look at|check|review|take a look)\b/iu }
];
var NEGATED_ACTION = /(?:不要|别|不用|不需要|无需|停止|取消|先别|暂时别)\s*(?:再\s*)?/iu;
var RETRACTION_MARKERS = /(?:算了|当我没说|撤回|收回|取消(?:刚才|这个|上面)|不做了|不弄了|先不(?:做|弄|管)了|forget it|never mind|scratch that|call it off|withdraw that)/iu;
var CORRECTION_MARKERS = /(?:更正|纠正|我(?:刚才)?(?:说错了?|讲错了?)|你理解错了|我的意思是|我说的是|我不是说|不是我说的|记错了|改正|不应该是|不对)|\b(?:correction|i meant|i mean|i was wrong|that'?s not right|not what i meant|you misunderstood|you got (?:it|that) wrong)\b/iu;
var MISREAD_CORRECTION = /(?:我不是说|我没说|不是让你|我没让你|我的意思不是|不是这个意思)|\b(?:i didn'?t (?:say|mean)|that'?s not what i (?:said|meant)|i wasn'?t asking you to)\b/iu;
var CLARIFICATION_REQUEST = /(?:你指的是什么|你指的是哪个|什么意思|不太明白你(?:的)?意思|我没(?:有)?懂|没听懂|再说一遍|能说清楚)|\b(?:what do you mean|i don'?t understand|i don'?t follow|can you clarify|which one do you mean)\b/iu;
var HYPOTHETICAL2 = /(?:如果|假如|假设|要是|万一|倘若)|\b(?:if |suppose|supposing|what if|hypothetically|in case)\b/iu;
var HYPOTHETICAL_BEHAVIOUR = /(?:会(?:怎么做|怎么办|怎么处理|如何处理|做什么)|该(?:怎么|如何)|你(?:会|能)(?:做|处理|办))|\b(?:what would you do|how would you handle|what would happen)\b/iu;
var REFUSAL = /^(?:不用了?|不必了?|不需要|算了|不用麻烦了|暂时不用|先不用|no thanks|no thank you|not necessary)(?=[\s，。！？、,.!?;：:]|$)/iu;
var JOKE = /(?:开玩笑|逗你的|逗你玩|说说而已|开个玩笑|哈哈|呵呵|😂|🤣)|\b(?:just kidding|kidding|joking|jk|haha|lol)\b/iu;
var IRONY2 = /(?:说反话|阴阳怪气|真是好极了|太好了呢)|\b(?:yeah right|as if|sure,? that went well|great,? just great)\b/iu;
var EMOTION2 = /(?:想倾诉|想吐槽|只是想说|心情(?:很|有点)?(?:差|糟|不好)|(?:很|有点|非常|特别)?(?:难过|焦虑|烦|累|孤独|害怕|沮丧|生气|愤怒|恼火|难受)|压力很大|受不了了|感觉(?:很|有点)?(?:难过|焦虑|烦|累|孤独|害怕|沮丧|生气|愤怒|恼火|难受))|\b(?:i need to vent|i (?:feel|am feeling) (?:really )?(?:sad|anxious|angry|overwhelmed|lonely|afraid|tired|upset|frustrated|scared|nervous|down)|i['’]m (?:feeling (?:really )?)?(?:sad|anxious|angry|overwhelmed|lonely|afraid|tired|upset|frustrated|scared|nervous|down))\b/iu;
var PREFERENCE2 = /(?:我喜欢|我不喜欢|我偏好|我讨厌|我更(?:喜欢|愿意)|我更喜欢)|\b(?:i (?:like|love|prefer|dislike|hate)|i (?:do not|don'?t) (?:like|prefer))\b/iu;
var CONTINUATION_IMPERATIVE = /^(?:(?:那|就)?(?:继续|接着|往下|然后继续|接着说|接着讲)|(?:可以|好|行|嗯|对)[，,。.\s]*(?:继续|接着|往下|go on)|(?:go on|continue|carry on|keep going))\s*[。.!！,，]?$/iu;
var REQUEST = /(?:帮我|帮忙|请(?:你)?|麻烦(?:你)?|给我|替我|替我看看|能不能(?:帮我|给我)|可以(?:帮我|给我)|把.{1,20}(?:删|改|加|换|做|写))|\b(?:please|can you|could you|would you|help me|i need you to|do me a favor)\b/iu;
var CAPABILITY_QUESTION = /(?:你能不能|你可以|你会不会|你能|能否|可不可以)|\b(?:can you|could you|are you able to|is it possible for you to)\b/iu;
var QUESTION_SURFACE = /[?？]/u;
var QUESTION_WORD = /(?:什么|怎么|如何|为什么|哪(?:一?个|家|些|种|里|儿|年)?|什么时候|多少|谁|是否|吗)|\b(?:what|who|where|when|which|why|how)\b/iu;
var AFFIRMATION = /^(?:可以|好|行|嗯|对|是的|没问题|ok|okay|sure|yes|yep|fine)\b/iu;
function normalize3(value) {
  return value.normalize("NFKC").toLowerCase().trim();
}
function findAction(text) {
  for (const entry of ACTIONS) if (entry.pattern.test(text)) return entry.action;
  return null;
}
function negationOf(text, action) {
  const imperative = NEGATED_ACTION.test(text) && action !== null;
  if (imperative) return { scope: "verb_phrase", verb: action };
  if (/(?:不|没|别|未|非|无)|\b(?:not|no|never|don'?t)\b/iu.test(text)) return { scope: "clause", verb: null };
  return { scope: "none", verb: null };
}
function assistantOfferedAction(priorAssistantBody) {
  if (typeof priorAssistantBody !== "string" || priorAssistantBody.trim().length === 0) return false;
  return /(?:要我|需要我|我可以|我来|帮你|给你|要不要我|需要的话)|\b(?:shall i|should i|do you want me to|i can|may i)\b/iu.test(priorAssistantBody);
}
function analyzeSpeechAct(input) {
  if (typeof input.content !== "string") throw new TypeError("Speech act input requires text.");
  const raw = input.content;
  const unquoted = stripQuotedAndReportedText(raw);
  const text = normalize3(unquoted);
  const evidence = [];
  const secondary = [];
  const action = findAction(text);
  const negation = negationOf(text, action);
  const quotedOnly = text.replace(/[\s，。！？、；：,.!?;:]/gu, "");
  const hasQuotation = /["“”‘’「」『』`]/u.test(raw) || /(?:说|提到|表示|写道|称)/u.test(raw);
  const quotedCharacters = (raw.match(/"[^"\r\n]*"|“[^”\r\n]*”|‘[^’\r\n]*’|「[^」\r\n]*」|『[^』\r\n]*』|`[^`\r\n]*`/gu) ?? []).join("").length;
  const dominantQuotation = hasQuotation && quotedCharacters >= Math.max(8, Math.round(raw.length * 0.4));
  if (hasQuotation && (quotedOnly.length === 0 || dominantQuotation)) {
    evidence.push(quotedOnly.length === 0 ? "quotation_only" : "quotation_dominant");
    return {
      act: "quotation",
      surfaceAct: QUESTION_SURFACE.test(raw) ? "question" : /(?:删|改|做|给我|帮我)/u.test(raw) ? "request" : "statement",
      secondary,
      attributedTo: "quoted_other",
      // The whole point: someone else's command is not the user's request.
      binds: false,
      action,
      negation,
      evidence,
      version: SPEECH_ACT_VERSION
    };
  }
  if (HYPOTHETICAL2.test(text)) {
    evidence.push("conditional_mood");
    if (HYPOTHETICAL_BEHAVIOUR.test(text)) evidence.push("hypothetical_behaviour_question");
    if (QUESTION_SURFACE.test(raw) || QUESTION_WORD.test(text)) secondary.push("question");
    return {
      act: "hypothesis",
      surfaceAct: secondary.includes("question") ? "question" : "statement",
      secondary,
      attributedTo: "hypothetical",
      // "如果我让你删除，你会怎么做" authorises nothing.
      binds: false,
      action,
      negation,
      evidence,
      version: SPEECH_ACT_VERSION
    };
  }
  if (RETRACTION_MARKERS.test(text) || negation.scope === "verb_phrase") {
    evidence.push(negation.scope === "verb_phrase" ? "negated_imperative" : "retraction_marker");
    return {
      act: "retraction",
      surfaceAct: "request",
      secondary,
      attributedTo: "user",
      binds: false,
      action: negation.verb ?? action,
      negation,
      evidence,
      version: SPEECH_ACT_VERSION
    };
  }
  if (MISREAD_CORRECTION.test(text) || CORRECTION_MARKERS.test(text)) {
    evidence.push(MISREAD_CORRECTION.test(text) ? "misread_correction" : "correction_marker");
    if (action) secondary.push("request");
    return {
      act: "correction",
      surfaceAct: QUESTION_SURFACE.test(raw) ? "question" : "statement",
      secondary,
      attributedTo: "user",
      binds: false,
      action,
      negation,
      evidence,
      version: SPEECH_ACT_VERSION
    };
  }
  if (CLARIFICATION_REQUEST.test(text)) {
    evidence.push("clarification_marker");
    return {
      act: "clarification",
      surfaceAct: "question",
      secondary,
      attributedTo: "user",
      binds: false,
      action,
      negation,
      evidence,
      version: SPEECH_ACT_VERSION
    };
  }
  if (REFUSAL.test(text)) {
    evidence.push("refusal_marker");
    return {
      act: "refusal",
      surfaceAct: "statement",
      secondary,
      attributedTo: "user",
      binds: false,
      action,
      negation,
      evidence,
      version: SPEECH_ACT_VERSION
    };
  }
  if (JOKE.test(text) || IRONY2.test(text)) {
    evidence.push(JOKE.test(text) ? "joke_marker" : "irony_marker");
    return {
      act: "joke",
      surfaceAct: REQUEST.test(text) ? "request" : QUESTION_SURFACE.test(raw) ? "question" : "statement",
      secondary,
      attributedTo: "user",
      binds: false,
      action,
      negation,
      evidence,
      version: SPEECH_ACT_VERSION
    };
  }
  if (CAPABILITY_QUESTION.test(text) && !QUESTION_WORD.test(text.replace(/(?:能不能|可以|能否|可不可以|你能)/gu, ""))) {
    const offered = assistantOfferedAction(input.priorAssistantBody);
    evidence.push(offered ? "capability_after_offer" : "capability_without_offer");
    if (offered) {
      secondary.push("question");
      return {
        act: "request",
        surfaceAct: "question",
        secondary,
        attributedTo: "user",
        binds: true,
        action,
        negation,
        evidence,
        version: SPEECH_ACT_VERSION
      };
    }
    secondary.push("request");
    return {
      act: "question",
      surfaceAct: "question",
      secondary,
      attributedTo: "user",
      binds: false,
      action,
      negation,
      evidence,
      version: SPEECH_ACT_VERSION
    };
  }
  if (EMOTION2.test(text)) {
    evidence.push("affect_lexicon");
    return {
      act: "emotional_expression",
      surfaceAct: "statement",
      secondary,
      attributedTo: "user",
      binds: false,
      action,
      negation,
      evidence,
      version: SPEECH_ACT_VERSION
    };
  }
  if (PREFERENCE2.test(text) && !REQUEST.test(text)) {
    evidence.push("preference_marker");
    return {
      act: "preference_expression",
      surfaceAct: "statement",
      secondary,
      attributedTo: "user",
      // "我更喜欢你直接一点" asks for a style without asking for a task, so it
      // does not authorise execution; the growth layer reads it separately.
      binds: false,
      action,
      negation,
      evidence,
      version: SPEECH_ACT_VERSION
    };
  }
  const bareImperative = action !== null && !QUESTION_SURFACE.test(raw) && !/(?:^|[^\p{L}])(?:我|我们)(?=[^\p{L}]|$)|\b(?:i|we)\b/iu.test(text);
  const imperative = REQUEST.test(text) || bareImperative;
  if (CONTINUATION_IMPERATIVE.test(text)) {
    evidence.push("continuation_imperative");
    if (QUESTION_SURFACE.test(raw)) secondary.push("question");
    return {
      act: "request",
      surfaceAct: "statement",
      secondary,
      attributedTo: "user",
      binds: true,
      action: action ?? "continue",
      negation,
      evidence,
      version: SPEECH_ACT_VERSION
    };
  }
  const asking = QUESTION_SURFACE.test(raw) || QUESTION_WORD.test(text);
  if (imperative) {
    evidence.push("imperative_marker");
    if (asking) secondary.push("question");
    return {
      act: "request",
      surfaceAct: asking ? "question" : "request",
      secondary,
      attributedTo: "user",
      binds: true,
      action,
      negation,
      evidence,
      version: SPEECH_ACT_VERSION
    };
  }
  if (asking) {
    evidence.push(QUESTION_SURFACE.test(raw) ? "question_punctuation" : "question_word");
    return {
      act: "question",
      surfaceAct: "question",
      secondary,
      attributedTo: "user",
      binds: false,
      action,
      negation,
      evidence,
      version: SPEECH_ACT_VERSION
    };
  }
  if (AFFIRMATION.test(text)) evidence.push("affirmation_marker");
  return {
    act: "statement",
    surfaceAct: "statement",
    secondary,
    attributedTo: "user",
    binds: false,
    action,
    negation,
    evidence: evidence.length > 0 ? evidence : ["no_act_marker"],
    version: SPEECH_ACT_VERSION
  };
}

// src/cognition/context-window.ts
var LOCAL_CONTEXT_VERSION = "local-context-v1";
var AFFIRM_TOKENS = /* @__PURE__ */ new Set([
  "\u597D",
  "\u597D\u7684",
  "\u597D\u5440",
  "\u597D\u554A",
  "\u597D\u6EF4",
  "\u53EF\u4EE5",
  "\u53EF\u4EE5\u7684",
  "\u884C",
  "\u884C\u7684",
  "\u55EF",
  "\u6069",
  "\u5BF9",
  "\u662F\u7684",
  "\u662F",
  "\u6CA1\u95EE\u9898",
  "ok",
  "okay",
  "sure",
  "yes",
  "yep",
  "fine",
  "go ahead"
]);
var DENY_TOKENS = /* @__PURE__ */ new Set([
  "\u4E0D\u7528",
  "\u4E0D\u7528\u4E86",
  "\u4E0D\u8981",
  "\u4E0D\u5FC5",
  "\u4E0D\u5FC5\u4E86",
  "\u4E0D\u884C",
  "\u7B97\u4E86",
  "\u4E0D\u7528\u9EBB\u70E6",
  "\u6682\u65F6\u4E0D\u7528",
  "\u5148\u4E0D\u7528",
  "no",
  "nope",
  "not now",
  "no thanks",
  "not necessary"
]);
var CONTINUE_TOKENS = /* @__PURE__ */ new Set([
  "\u7EE7\u7EED",
  "\u63A5\u7740",
  "\u5F80\u4E0B",
  "\u5F00\u59CB",
  "\u6765\u5427",
  "go on",
  "continue",
  "carry on",
  "keep going"
]);
var POLITE_TOKENS = /* @__PURE__ */ new Set([
  "\u8C22\u8C22",
  "\u8C22\u4E86",
  "\u591A\u8C22",
  "\u611F\u8C22",
  "\u8F9B\u82E6\u4E86",
  "thanks",
  "thank you",
  "thx",
  "cheers"
]);
var CONTINUE = /(?:继续|接着|往下|然后呢|go on|continue|carry on|keep going)/iu;
var ASK_QUESTION = /[?？]\s*$/u;
function tokensOf(text) {
  return text.normalize("NFKC").toLowerCase().replace(/[。.!！?？~～]+$/gu, "").split(/[\s，,、。.!！?？;；:：]+/gu).filter((token) => token.length > 0);
}
function bareAnswerOf(text) {
  const tokens = tokensOf(text);
  if (tokens.length === 0) return "none";
  const [first, second, third] = tokens;
  if (first !== void 0 && DENY_TOKENS.has(first)) {
    if (tokens.length === 1) return "deny";
    if (tokens.length === 2 && second !== void 0 && POLITE_TOKENS.has(second)) return "deny";
    return "none";
  }
  if (first === void 0 || !AFFIRM_TOKENS.has(first)) return "none";
  if (tokens.length === 1) return "affirm";
  if (tokens.length === 2 && second !== void 0 && CONTINUE_TOKENS.has(second)) return "affirm";
  if (tokens.length === 2 && second !== void 0 && POLITE_TOKENS.has(second)) return "affirm";
  if (third !== void 0) return "none";
  return "none";
}
function askedQuestion(body) {
  if (!body) return false;
  const tail = body.trim().slice(-160);
  return ASK_QUESTION.test(tail) || /(?:吗|呢)[？?]?$/u.test(tail);
}
function offerOf(body) {
  if (!body) return "none";
  const tail = body.trim().slice(-240);
  const offering = /(?:要我|需要我|我可以|我来|要不要我|需要的话|帮你|给你)|\b(?:shall i|should i|do you want me to|i can|may i|would you like me to)\b/iu.test(tail);
  if (offering) {
    if (/(?:写|改|做|生成|创建|执行|运行|整理|删除|保存|build|write|rewrite|create|run|generate|delete|save)/iu.test(tail)) return "execute";
    if (/(?:讲|解释|说明|展开|详细|介绍|explain|walk you through|go deeper|elaborate)/iu.test(tail)) return "explain";
    return "discuss";
  }
  if (/(?:继续(?:讲|说|写)|下一部分|接下来(?:讲|说))/iu.test(tail)) return "explain";
  if (/(?:还想聊|聊点别的|想聊什么|你怎么看|你觉得呢)/iu.test(tail)) return "discuss";
  return "none";
}
function continuationOf(content, offer, assistantAsked, priorAssistantBody) {
  const returned = /(?:那你|你呢|你觉得呢|你怎么看|your take)/iu.test(content) && /[?？]/u.test(content);
  if (returned && assistantAsked && priorAssistantBody) return "discussion";
  const continuing = CONTINUE.test(content);
  const affirming = bareAnswerOf(content) === "affirm";
  if (!continuing && !(affirming && assistantAsked)) return "none";
  if (offer === "execute") return "execution";
  if (offer === "explain") return "explanation";
  if (offer === "discuss") return "discussion";
  return "none";
}
var TOPIC_SWITCH_MARKER = /(?:换个话题|换个问题|另一个问题|另外|先不说|说点别的|顺便问|new topic|different question|switch topics|unrelated question)/iu;
var DEICTIC_HEAD = /[这那](?:个|张|段|份|篇|条|行|句|些|种|位|块|只)?\s*([^\s，。！？,!?]{0,12})/u;
var HEAD_STOP = /(?:删|改|看|查|写|做|加|换|保存|执行|清空|移动|移|修|检查|整理|分析|优化|重写|生成|创建|打开|关闭|读取|读|说|讲|给|发|弄|跑|试|帮|请|为|怎|如|是|有|太|很|不|没|的|了|吧|呢|吗|啊|呗|么)/u;
function deicticHeadNoun(text) {
  const match = DEICTIC_HEAD.exec(text.trim());
  if (!match) return null;
  const captured = (match[1] ?? "").trim();
  const stop = HEAD_STOP.exec(captured);
  const head = (stop ? captured.slice(0, stop.index) : captured).replace(/[的了呢吗吧啊]$/u, "").trim();
  return head.length >= 2 ? head.slice(0, 12) : null;
}
function isMostlyQuotation(body) {
  const quoted = (body.match(/"[^"\r\n]*"|“[^”\r\n]*”|‘[^’\r\n]*’|「[^」\r\n]*」|『[^』\r\n]*』|`[^`\r\n]*`/gu) ?? []).join("").length;
  return body.length > 0 && quoted >= Math.max(8, Math.round(body.length * 0.5));
}
function resolveAntecedent(content, history) {
  const recent = history.slice(-6).filter((message) => message.body.trim().length > 0);
  if (recent.length === 0) return { status: "none", messageId: null, candidates: [], basis: "no_candidate" };
  let boundary = 0;
  for (let index = recent.length - 1; index >= 0; index -= 1) {
    if (TOPIC_SWITCH_MARKER.test(recent[index].body)) {
      boundary = index + 1;
      break;
    }
  }
  const window = recent.slice(boundary);
  if (window.length === 0) return { status: "none", messageId: null, candidates: [], basis: "blocked_by_topic_switch" };
  const head = deicticHeadNoun(content);
  const quotedOnly = window.filter((message) => isMostlyQuotation(message.body));
  const usable = window.filter((message) => !isMostlyQuotation(message.body));
  const userCandidates = usable.filter((message) => message.role === "user");
  const assistantCandidates = usable.filter((message) => message.role === "assistant");
  const scope = userCandidates.length > 0 ? userCandidates : usable;
  const bound = (message, basis) => ({
    status: "bound",
    messageId: message.id,
    candidates: [message.id],
    basis
  });
  const ambiguous = (messages, basis) => ({
    status: "ambiguous",
    messageId: null,
    candidates: messages.map((message) => message.id),
    basis
  });
  if (head !== null) {
    const inUser = scope.filter((message) => message.body.includes(head));
    if (inUser.length === 1) return bound(inUser[0], "head_noun_unique");
    if (inUser.length > 1) return ambiguous(inUser, "head_noun_multiple");
    const inAssistant = assistantCandidates.filter((message) => message.body.includes(head));
    if (inAssistant.length === 1) return bound(inAssistant[0], "head_noun_assistant_unique");
    if (inAssistant.length > 1) return ambiguous(inAssistant, "head_noun_multiple");
    if (scope.length === 1) return bound(scope[0], "head_noun_absent_single_available");
    if (scope.length === 0) {
      return {
        status: "none",
        messageId: null,
        candidates: quotedOnly.map((message) => message.id),
        basis: "quoted_antecedent"
      };
    }
    return ambiguous(scope, "head_noun_absent_multiple");
  }
  if (scope.length === 1) return bound(scope[0], "pronoun_single");
  if (scope.length === 0) {
    return {
      status: "none",
      messageId: null,
      candidates: quotedOnly.map((message) => message.id),
      basis: "quoted_antecedent"
    };
  }
  return ambiguous(scope, "pronoun_multiple");
}
function readLocalContext(input) {
  const history = Array.isArray(input.history) ? input.history : [];
  const priorUser = [...history].reverse().find((message) => message.role === "user") ?? null;
  const priorAssistant = [...history].reverse().find((message) => message.role === "assistant") ?? null;
  const content = typeof input.content === "string" ? input.content.normalize("NFKC") : "";
  const evidence = [];
  if (priorUser) evidence.push("prior_user_message");
  if (priorAssistant) evidence.push("prior_assistant_message");
  const assistantAsked = askedQuestion(priorAssistant?.body ?? null);
  if (assistantAsked) evidence.push("assistant_asked_question");
  const assistantOffer = offerOf(priorAssistant?.body ?? null);
  if (assistantOffer !== "none") evidence.push(`assistant_offered_${assistantOffer}`);
  const affirmation = bareAnswerOf(content);
  if (affirmation !== "none") evidence.push(affirmation === "affirm" ? "user_affirmed_prior" : "user_denied_prior");
  const continuationTarget = continuationOf(content, assistantOffer, assistantAsked, priorAssistant?.body ?? null);
  if (continuationTarget !== "none") evidence.push(`continues_${continuationTarget}`);
  const sequencing = priorUser !== null && /^(?:先|首先|然后|接着|下一步|再者|另外)/u.test(content.trim());
  if (sequencing) evidence.push("sequences_prior_turn");
  const antecedent = resolveAntecedent(content, history);
  if (antecedent.status !== "none") evidence.push(`antecedent_${antecedent.status}`);
  return {
    version: LOCAL_CONTEXT_VERSION,
    hasPriorTurn: history.length > 0,
    priorUserBody: priorUser?.body ?? null,
    priorAssistantBody: priorAssistant?.body ?? null,
    assistantAskedQuestion: assistantAsked,
    assistantOffer,
    affirmation,
    continuationTarget,
    sequencing,
    antecedent,
    evidence
  };
}

// src/cognition/intent-reading.ts
var INTENT_READING_VERSION = "c1-reading-v1";
var INTENT_PARAMETER_VERSION = "c1-params-v1";
var HORIZON = /(?:今天|明天|后天|这周|本周|下周|这个月|本月|下个月|\d{4}\s*年|\d{1,2}\s*月(\d{1,2}\s*[日号])?|\d+\s*(?:天|周|个月|年)(?:之后|以后|后|内)|月底|年底|今年|明年)|\b(?:today|tomorrow|this week|next week|this month|next month|by (?:the end of )?(?:next )?(?:week|month|year))\b/iu;
var QUANTITY = /(\d+(?:\.\d+)?)\s*(?:个|次|条|份|页|行|字|元|块|小时|分钟|天|周|%)/u;
var COMPOUND_JOIN = /(?:然后|接着|顺便|同时|另外|并且|，然后|;\s*(?:and\s+)?)|\b(?:and then|also|plus|after that)\b/iu;
var REQUEST_TARGET = /(?:帮我|帮忙|请(?:你)?|麻烦(?:你)?|给我|替我)\s*(?:把|将)?\s*([^\s，。！？,!?]{1,24})/u;
var BA_TARGET = /把\s*([^\s，。！？,!?]{1,20}?)\s*(?:删|改|加|换|做|写|保存|执行|清空|移)/u;
var LEADING_VERB = /^(?:看看|看一下|看|改一下|改|检查一下|检查|审查|整理|分析|写|做|删掉|删|修一下|修|查一下|查|review|check|look at|fix|rewrite)\s*/u;
var LEADING_FILLER = /^(?:一下|一张|张|下|[这那][个张段份篇条行句些种位块只]?|个)\s*/u;
var DEICTIC_PREFIX = /^[这那](?:个|张|段|份|篇|条|行|句|些|种|位|块|只)?/u;
function normalize4(value) {
  return value.normalize("NFKC").toLowerCase().trim();
}
function extractSlots(input) {
  const slots = [];
  const content = input.content;
  if (input.speechAct.action !== null) {
    const match = BA_TARGET.exec(content) ?? REQUEST_TARGET.exec(content);
    const captured = (match?.[1] ?? "").trim();
    const afterVerb = captured.replace(LEADING_VERB, "").trim();
    const stripped = afterVerb.replace(LEADING_FILLER, "").trim();
    const deicticOnly = (DEICTIC_PREFIX.test(afterVerb) || /^(?:它|他们|她们)/u.test(afterVerb)) && input.context.priorUserBody === null;
    const deicticTarget = DEICTIC_PREFIX.test(afterVerb) || /^(?:它|他们|她们)/u.test(afterVerb);
    const resolved = deicticTarget ? input.context.antecedent.status === "bound" : true;
    if (stripped.length >= 1 && !deicticOnly && resolved) {
      slots.push({ name: "target", value: stripped.slice(0, 40), status: "stated", evidenceMessageId: input.messageId });
    } else {
      slots.push({ name: "target", value: "", status: "unknown", evidenceMessageId: null });
    }
  }
  const horizon = HORIZON.exec(content);
  if (horizon) {
    slots.push({ name: "time_horizon", value: horizon[0].trim().slice(0, 24), status: "stated", evidenceMessageId: input.messageId });
  }
  const quantity = QUANTITY.exec(content);
  if (quantity) {
    slots.push({ name: "quantity", value: quantity[0].trim().slice(0, 24), status: "stated", evidenceMessageId: input.messageId });
  }
  const resolvedTopic = input.context.antecedent.status === "bound" ? input.antecedentBody : null;
  const inheritedTopic = resolvedTopic ?? (input.context.continuationTarget !== "none" ? input.context.priorUserBody ?? input.context.priorAssistantBody : null);
  if (inheritedTopic) {
    slots.push({
      name: "topic",
      value: inheritedTopic.slice(0, 40),
      status: "inferred",
      evidenceMessageId: resolvedTopic === null ? null : input.context.antecedent.messageId
    });
  }
  return slots;
}
function criticalMissingSlot(slots) {
  return slots.find((slot) => slot.name === "target" && slot.status === "unknown") ?? null;
}
function contraSignalsOf(input) {
  const contra = [];
  if (input.speechAct.act === "quotation") contra.push("quoted_act_not_user_request");
  if (input.speechAct.act === "hypothesis") contra.push("conditional_not_authorisation");
  if (input.speechAct.act === "joke") contra.push("ironic_surface_form");
  if (input.speechAct.negation.scope === "verb_phrase") contra.push("negated_action");
  if (input.ambiguous) contra.push("no_matching_evidence");
  if (input.assessment.reasons.includes("competing_readings")) contra.push("competing_reading");
  if (input.assessment.reasons.includes("margin_below_floor")) contra.push("margin_below_floor");
  if (input.assessment.reasons.includes("unresolved_reference")) contra.push("unresolved_reference");
  return [...new Set(contra)];
}
function compatibleWithRequest(a, b) {
  if (a === "request" || b === "request") return true;
  if (a === "continuation" || b === "continuation") return true;
  const pair = /* @__PURE__ */ new Set([a, b]);
  if (pair.has("information_query") && pair.has("explanation")) return true;
  if (pair.has("preference_expression") && pair.has("self_fact")) return true;
  return false;
}
function statusOf(input) {
  if (input.speechAct.act === "retraction") return "changed";
  if (input.speechAct.act === "correction") return "changed";
  if (input.context.continuationTarget !== "none") return "continuing";
  if (input.context.sequencing) return "continuing";
  if (input.ambiguous) return "unknown";
  if (input.speechAct.act === "quotation") return "unknown";
  const explicit = input.decisionReasons.some((reason) => [
    "explicit_correction_marker",
    "changed_mind_marker",
    "explicit_recall_request",
    "save_request_with_self_fact",
    "explicit_goal_statement",
    "goal_or_plan_marker",
    "self_reported_ambiguity"
  ].includes(reason));
  if (explicit && !input.assessment.directionChanging) return "explicit";
  if (input.assessment.directionChanging && input.assessment.margin < 0.08 && !(input.secondary.length > 0 && compatibleWithRequest(input.primary, input.secondary[0]))) return "conflicting";
  if (input.secondary.length > 0) return "inferred";
  return "inferred";
}
function responseModeOf(input) {
  if (input.speechAct.act === "retraction") return "stop_previous";
  if (input.speechAct.act === "refusal") return "stop_previous";
  if (input.speechAct.act === "correction") return "answer";
  if (input.speechAct.act === "quotation") return "acknowledge";
  if (input.context.continuationTarget === "execution") return "execute_pending";
  if (input.context.continuationTarget === "discussion") return "answer";
  if (input.clarificationRequired) return "clarify";
  if (input.compound) return "split";
  if (input.intentStatus === "conflicting") return "clarify";
  if (input.primary === "emotion_expression" || input.primary === "feedback") return "answer";
  const unresolved = input.assessment.reasons.includes("unresolved_reference");
  if (unresolved) return "clarify";
  return "answer";
}
function readTurn(input) {
  if (typeof input.content !== "string" || input.content.trim().length === 0) {
    throw new TypeError("Intent reading requires text.");
  }
  if (typeof input.messageId !== "string" || input.messageId.length === 0) {
    throw new TypeError("Intent reading requires a source message id.");
  }
  const history = Array.isArray(input.history) ? input.history : [];
  const context = readLocalContext({ content: input.content, history });
  const speechAct = analyzeSpeechAct({
    content: input.content,
    priorUserBody: context.priorUserBody,
    priorAssistantBody: context.priorAssistantBody
  });
  const content = normalize4(stripQuotedAndReportedText(input.content));
  const decision = decideIntent({
    content,
    hasPriorTurn: context.hasPriorTurn,
    priorUserBody: context.priorUserBody
  });
  const candidates = scoreIntentCandidates({
    content,
    hasPriorTurn: context.hasPriorTurn,
    priorUserBody: context.priorUserBody
  });
  const assessment = assessIntentConfidence({
    content,
    priorUserBody: context.priorUserBody,
    candidates
  });
  const compoundEarly = COMPOUND_JOIN.test(content) && speechAct.binds && speechAct.action !== null;
  const primary = speechAct.act === "quotation" ? "ambiguous" : context.continuationTarget !== "none" ? "continuation" : compoundEarly && candidates.some((candidate) => candidate.label === "request") ? "request" : decision.intent;
  const ambiguous = primary === "ambiguous" || candidates.length === 0 && context.continuationTarget === "none";
  const secondary = decision.alternatives.filter((label) => label !== primary).slice(0, 2);
  const antecedentBody = context.antecedent.messageId === null ? null : history.find((message) => message.id === context.antecedent.messageId)?.body ?? null;
  const slots = extractSlots({ content: input.content, messageId: input.messageId, speechAct, context, antecedentBody });
  const missing = criticalMissingSlot(slots);
  const needsTargetBeforeActing = speechAct.binds && speechAct.action !== null && ["delete", "modify", "execute", "look", "continue"].includes(speechAct.action);
  const targetMissing = needsTargetBeforeActing && missing !== null && context.continuationTarget === "none";
  const intentStatus = statusOf({
    speechAct,
    context,
    ambiguous,
    assessment,
    decisionReasons: decision.reasons,
    secondary,
    primary
  });
  const compound = compoundEarly;
  const responseMode = responseModeOf({
    speechAct,
    context,
    intentStatus,
    assessment,
    clarificationRequired: targetMissing,
    compound,
    primary
  });
  const clarificationRequired = responseMode === "clarify";
  const clarificationReason = clarificationRequired ? missing !== null ? `missing_${missing.name}` : context.antecedent.status === "ambiguous" ? "ambiguous_reference" : assessment.reasons.includes("unresolved_reference") ? "unresolved_reference" : "competing_execution_paths" : null;
  const supportingSignals = [...new Set(candidates.flatMap((candidate) => candidate.reasons))].slice(0, 12);
  const contradictingSignals = contraSignalsOf({ speechAct, assessment, context, ambiguous });
  const uncertainties = [];
  if (ambiguous) uncertainties.push("no_matching_rule");
  if (speechAct.act === "quotation") uncertainties.push("quoted_act_attribution");
  if (speechAct.act === "hypothesis") uncertainties.push("hypothetical_not_instruction");
  if (speechAct.negation.scope !== "none") uncertainties.push("negation_scope");
  if (assessment.reasons.includes("competing_readings")) uncertainties.push("competing_readings");
  if (assessment.reasons.includes("unresolved_reference")) uncertainties.push("unresolved_reference");
  if (context.continuationTarget === "none" && /(?:继续|接着|往下|go on|continue)/iu.test(content)) {
    uncertainties.push("continuation_without_offer");
  }
  if (missing !== null) uncertainties.push(`missing_${missing.name}`);
  if (context.antecedent.status === "ambiguous") uncertainties.push("ambiguous_antecedent");
  if (context.antecedent.basis === "quoted_antecedent") uncertainties.push("antecedent_only_in_quotation");
  if (speechAct.evidence.includes("capability_without_offer")) uncertainties.push("capability_vs_request");
  const priorUserMessageId = context.priorUserBody === null ? null : [...history].reverse().find((message) => message.role === "user")?.id ?? null;
  const supersedes = speechAct.act === "correction" || intentStatus === "changed" || decision.reasons.includes("changed_mind_marker") ? priorUserMessageId : null;
  const reading = {
    version: INTENT_READING_VERSION,
    algorithmVersion: INTENT_DECISION_VERSION,
    parameterVersion: INTENT_PARAMETER_VERSION,
    messageId: input.messageId,
    primaryIntent: primary,
    decisionReasons: [...decision.reasons].slice(0, 8),
    secondaryIntents: secondary,
    intentStatus,
    speechAct,
    entitiesAndSlots: slots,
    evidenceRefs: [
      input.messageId,
      ...context.priorUserBody && context.continuationTarget !== "none" ? [history.filter((m) => m.role === "user").at(-1).id] : [],
      ...context.priorAssistantBody && context.assistantOffer !== "none" ? [history.filter((m) => m.role === "assistant").at(-1).id] : []
    ].filter((id, index, all) => all.indexOf(id) === index),
    supportingSignals,
    contradictingSignals,
    context: {
      used: context.hasPriorTurn,
      priorUser: context.priorUserBody !== null,
      priorAssistant: context.priorAssistantBody !== null,
      assistantOffer: context.assistantOffer,
      continuationTarget: context.continuationTarget,
      evidence: context.evidence
    },
    uncertainties,
    scoreKind: "heuristic_score",
    confidence: decision.confidence,
    confidenceBand: assessment.band,
    clarificationRequired,
    clarificationReason,
    responseMode,
    mayExecute: speechAct.binds && responseMode !== "stop_previous" && responseMode !== "clarify",
    supersedesMessageId: supersedes
  };
  return { reading, decision, assessment, candidates };
}

// src/cognition/cognitive-turn-analyzer.ts
var COGNITIVE_HISTORY_LIMIT_MESSAGES = 12;
var COGNITIVE_HISTORY_LIMIT_CHARACTERS = 6e3;
var stopWords = /* @__PURE__ */ new Set(["a", "an", "and", "for", "from", "have", "how", "is", "it", "me", "of", "on", "or", "the", "to", "was", "what", "when", "where", "which", "who", "why", "with", "you", "your", "\u6211", "\u4F60", "\u4ED6", "\u5979", "\u5B83", "\u7684", "\u4E86", "\u662F", "\u5728", "\u548C", "\u6709", "\u5C31", "\u90FD", "\u800C", "\u53CA", "\u4E0E", "\u7740", "\u6216", "\u4E00\u4E2A"]);
var featurePatterns = {
  negation: /(?:不是|并非|没有|不再|不要|不能|没|不|\b(?:no|not|never|don't|do not|doesn't|didn't|won't|can't|cannot|wouldn't)\b)/iu,
  explicitConstraint: /(?:必须|一定要|不要|不能|仅限|只要|只在|不超过|预算|截止时间|时间限制|避免|\b(?:must|only|don't|do not|cannot|can't|no more than|budget|deadline|avoid|constraint)\b)/iu,
  explicitMemoryRequest: /(?:你还记得|你记得我.{0,24}(?:吗|么)|我(?:之前|上次)告诉过你|我之前说过|我上次提到过|我们之前聊过|能回忆起|我的(?:偏好|目标|习惯)(?:是什么|是什么来着|吗|呢)|\b(?:do you remember|can you recall|what do i|what did i tell you|what have i told you|recall my|what is my|what's my)\b)/iu,
  explicitMemorySaveRequest: /(?:请(?:你)?记住|记住(?:我|这个|这件事|一下)|以后(?:都)?记得|把这(?:条|件事|个)记下来|保存为记忆|\b(?:please remember|remember that|remember this|save this as a memory|save that as a memory)\b)/iu,
  explicitSelfFact: /(?:我(?:不喜欢|喜欢|偏好|住在|工作在|从事|通常|习惯|的目标|的生日|会)|\bi (?:(?:do not|don't) )?(?:like|prefer|dislike|live|work|usually|tend to|use|avoid)\b)/iu
};
function normalize5(value) {
  return value.normalize("NFKC").toLowerCase().trim();
}
function wordCount(value) {
  const normalized = normalize5(value);
  const words = normalized.match(/[\p{L}\p{N}]+/gu) ?? [];
  const nonHanWords = words.filter((item) => !/\p{Script=Han}/u.test(item) && !stopWords.has(item)).length;
  const hanCharacters = (normalized.match(/\p{Script=Han}/gu) ?? []).length;
  return nonHanWords + Math.ceil(hanCharacters / 2);
}
function boundCognitiveHistory(history) {
  if (!Array.isArray(history)) throw new TypeError("Invalid cognitive history.");
  const selected = [];
  const seen = /* @__PURE__ */ new Set();
  let budget = COGNITIVE_HISTORY_LIMIT_CHARACTERS;
  const recent = history.slice(-COGNITIVE_HISTORY_LIMIT_MESSAGES);
  for (let index = recent.length - 1; index >= 0; index -= 1) {
    const message = recent[index];
    if (!message || !isCognitiveUuid(message.id) || typeof message.body !== "string" || message.body.length > 2e4 || message.role !== "user" && message.role !== "assistant") {
      throw new TypeError("Invalid cognitive history.");
    }
    if (seen.has(message.id) || message.body.length > budget) break;
    seen.add(message.id);
    selected.push({ id: message.id, role: message.role, body: message.body });
    budget -= message.body.length;
  }
  return selected.reverse();
}
function uncertaintyFor(intent, confidence, alternatives, content) {
  if (intent === "uncertain" || confidence < 50 || /(?:\b(?:said no one ever|said nobody ever|yeah right|as if)\b|🙃|😏|🙄)/iu.test(content)) return "high";
  if (confidence < 72 || alternatives.length > 0) return "medium";
  return "low";
}
function analyzeCognitiveTurnDetailed(content, history, sourceMessageId, confidenceOverrides = {}) {
  if (typeof content !== "string" || content.trim().length === 0 || content.length > 8e3 || !isCognitiveUuid(sourceMessageId)) {
    throw new TypeError("Invalid cognitive turn input.");
  }
  const current = normalize5(stripQuotedAndReportedText(content));
  const boundedHistory = boundCognitiveHistory(history);
  const priorUser = [...boundedHistory].reverse().find((message) => message.role === "user");
  const parsed = readTurn({ content, history: boundedHistory, messageId: sourceMessageId });
  const reading = parsed.reading;
  const decision = parsed.decision;
  const reasons = new Set(decision.reasons);
  const signals = {
    correction: reasons.has("explicit_correction_marker"),
    negation: featurePatterns.negation.test(current),
    changedMind: reasons.has("changed_mind_marker"),
    explicitGoal: reasons.has("explicit_goal_statement"),
    explicitConstraint: featurePatterns.explicitConstraint.test(current),
    explicitMemoryRequest: featurePatterns.explicitMemoryRequest.test(current),
    explicitMemorySaveRequest: featurePatterns.explicitMemorySaveRequest.test(current),
    explicitSelfFact: featurePatterns.explicitSelfFact.test(current),
    topicSwitch: reasons.has("explicit_topic_switch")
  };
  const intent = legacyIntentOf(reading.primaryIntent);
  const alternatives = decision.alternatives.map((label) => legacyIntentOf(label)).filter((candidate) => candidate !== intent).filter((candidate, index, all) => all.indexOf(candidate) === index).slice(0, 2);
  const uncertainty = uncertaintyFor(intent, decision.confidence, alternatives, current);
  const topicSource = decision.dependsOnPriorTurn && priorUser ? "previous_user_message" : reading.primaryIntent === "ambiguous" ? "none" : "current";
  const topicReferenceMessageId = topicSource === "previous_user_message" ? priorUser.id : null;
  const correctionNeedsDetail = signals.correction && !signals.explicitSelfFact && !signals.changedMind && wordCount(current) <= 2;
  const assessment = Object.keys(confidenceOverrides).length === 0 ? parsed.assessment : assessIntentConfidence({
    content: current,
    priorUserBody: priorUser?.body ?? null,
    candidates: scoreIntentCandidates({
      content: current,
      hasPriorTurn: Boolean(priorUser),
      priorUserBody: priorUser?.body ?? null
    })
  }, confidenceOverrides);
  const strategy = reading.responseMode === "clarify" || correctionNeedsDetail ? "clarify" : reading.responseMode === "acknowledge" || reading.responseMode === "stop_previous" ? "answer" : decision.needsMemoryRetrieval ? "retrieve_memory" : "answer";
  const evidence = createIntentEvidence(sourceMessageId, topicReferenceMessageId, decision.confidence, uncertainty);
  return {
    decision,
    assessment,
    reading,
    analysis: {
      schemaVersion: COGNITIVE_SCHEMA_VERSION,
      analyzerVersion: COGNITIVE_ANALYZER_VERSION,
      intent,
      alternatives,
      confidenceScore: decision.confidence,
      confidenceBasis: "unvalidated_rule_strength",
      uncertainty,
      strategy,
      topicSource,
      topicReferenceMessageId,
      signals,
      evidence
    }
  };
}

// .tmp-run/dbg-f15.ts
async function main() {
  const q = "\u4EE3\u53F7\u662F\u4EC0\u4E48\u6765\u7740\uFF1F";
  const turn = analyzeCognitiveTurnDetailed(q, [], "00000000-0000-4000-8000-000000000001");
  console.log("intent:", turn.decision?.intent, "| slot:", JSON.stringify(readFactSlot(q)));
  const q2 = "\u5B83\u53EB\u4EC0\u4E48\u6765\u7740\uFF1F";
  console.log("F09 widen regex:", /(?:^|[，。；\s])(?:它|她|他)(?:叫|是|有|在|多大|几)/u.test(q2));
}
void main();
