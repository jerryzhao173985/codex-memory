"use strict";

function toTimestampMs(value) {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeLooseSearchText(value) {
  return typeof value === "string"
    ? value.toLowerCase().replace(/\s+/g, " ").trim()
    : "";
}

function normalizeSearchMode(value, fallback = "substring") {
  const text = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (text === "exact" || text === "fuzzy" || text === "substring") return text;
  return fallback;
}

function tokenizeLooseSearchText(value) {
  return normalizeLooseSearchText(value)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function makeSearchCandidate(kind, value, weight = 1) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return null;
  return {
    kind: typeof kind === "string" && kind.trim() ? kind.trim() : "text",
    value: text,
    weight: Number.isFinite(weight) ? weight : 1,
  };
}

function getQueryCandidateText(entry) {
  if (typeof entry === "string") return entry.trim();
  if (entry && typeof entry === "object" && typeof entry.query === "string") return entry.query.trim();
  return "";
}

function normalizeQuerySearchKey(value) {
  const text = typeof value === "string"
    ? value
      .replace(/\\([()[\]{}.*+?^$|\\/"])/g, "$1")
      .replace(/\s+/g, " ")
      .trim()
    : "";
  return normalizeLooseSearchText(text);
}

function looksNoisyQueryCandidate(value) {
  if (typeof value !== "string") return false;
  const text = value.trim();
  if (!text) return false;
  if (text.length > 140) return true;
  if (/\\[()[\]{}.*+?^$|"]/u.test(text)) return true;
  if (/\.\*/u.test(text)) return true;
  if (/[()[\]{}]/u.test(text)) return true;
  const pipeCount = (text.match(/\|/gu) || []).length;
  return pipeCount >= 2;
}

function looksRegexOrGlobQueryCandidate(value) {
  if (typeof value !== "string") return false;
  const text = value.trim();
  if (!text) return false;
  if (/\\[()[\]{}.*+?^$|"]/u.test(text)) return true;
  if (/\.\*/u.test(text)) return true;
  if (/\|/u.test(text)) return true;
  if (/^[!^]/u.test(text)) return true;
  if (/[?*[\]{}]/u.test(text)) return true;
  return false;
}

function looksFilenameLikeQueryCandidate(value) {
  if (typeof value !== "string") return false;
  const text = value.trim();
  if (!text || /\s/u.test(text)) return false;
  if (text.startsWith("/") || text.includes("/")) return false;
  if (/^[a-z0-9_-]+\.[a-z0-9._-]+$/iu.test(text)) return true;
  return /^cmakelists\.txt$/iu.test(text);
}

function looksSimpleLiteralQueryCandidate(value) {
  if (typeof value !== "string") return false;
  const text = value.trim();
  if (!text || text.length > 48) return false;
  if (/\s/u.test(text)) return false;
  if (/[\\()[\]{}*+?^$|]/u.test(text)) return false;
  const alnumCount = (text.match(/[a-z0-9]/giu) || []).length;
  if (alnumCount < 3) return false;
  return /^[a-z0-9._/@:-]+$/iu.test(text);
}

function classifyQuerySignal(value) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return "";
  if (looksRegexOrGlobQueryCandidate(text) || looksFilenameLikeQueryCandidate(text)) return "low";
  const tokens = tokenizeLooseSearchText(text);
  if (tokens.length >= 3 && text.length >= 18) return "high";
  return "medium";
}

function getQuerySignalRank(value) {
  const signalTier = classifyQuerySignal(value);
  if (signalTier === "high") return 0;
  if (signalTier === "medium") return 1;
  if (signalTier === "low") return 2;
  return 3;
}

function getQueryMatchSignalTier(match) {
  if (!match || typeof match !== "object") return "";
  const kind = typeof match.kind === "string" ? match.kind.trim() : "";
  if (kind !== "query") return "";
  return classifyQuerySignal(match.text);
}

function summarizeLowSignalQueryMatches(entries) {
  const list = Array.isArray(entries) ? entries : [];
  if (!list.length) return { onlyLowSignal: false, examples: [] };
  const examples = [];
  const seen = new Set();
  for (const entry of list) {
    const match = entry && entry.match && typeof entry.match === "object"
      ? entry.match
      : entry;
    if (!match || typeof match !== "object") return { onlyLowSignal: false, examples: [] };
    if (getQueryMatchSignalTier(match) !== "low") return { onlyLowSignal: false, examples: [] };
    const text = typeof match.text === "string" ? match.text.trim() : "";
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    examples.push(text);
    if (examples.length >= 3) break;
  }
  return {
    onlyLowSignal: examples.length > 0,
    examples,
  };
}

function getQueryCandidateWeight(entry, text, baseWeight = 1) {
  let weight = Number.isFinite(baseWeight) ? baseWeight : 1;
  const actionType = entry && typeof entry === "object" && typeof entry.actionType === "string"
    ? entry.actionType.trim().toLowerCase()
    : "";

  if (actionType === "search") weight *= 1.12;
  else if (actionType === "find_in_page") weight *= 1.05;
  else if (actionType === "open_page") weight *= 0.98;
  else if (actionType === "command") weight *= 0.92;

  if (looksNoisyQueryCandidate(text)) weight *= 0.72;
  else if (text.length <= 80) weight *= 1.03;
  if (actionType === "command" && looksSimpleLiteralQueryCandidate(text)) weight *= 1.19;

  return weight;
}

function compareQueryCandidatePreference(left, right) {
  if (!left) return 1;
  if (!right) return -1;
  if (right.weight !== left.weight) return right.weight - left.weight;
  const leftBackslashes = (left.value.match(/\\/gu) || []).length;
  const rightBackslashes = (right.value.match(/\\/gu) || []).length;
  if (leftBackslashes !== rightBackslashes) return leftBackslashes - rightBackslashes;
  if (left.value.length !== right.value.length) return left.value.length - right.value.length;
  return left.value.localeCompare(right.value);
}

function buildQuerySearchCandidates(values, options = {}) {
  const baseWeight = Number.isFinite(options.baseWeight) ? options.baseWeight : 1;
  const byKey = new Map();

  for (const entry of Array.isArray(values) ? values : []) {
    const text = getQueryCandidateText(entry);
    if (!text) continue;
    const candidate = makeSearchCandidate("query", text, getQueryCandidateWeight(entry, text, baseWeight));
    if (!candidate) continue;
    const key = normalizeQuerySearchKey(candidate.value);
    if (!key) continue;
    const existing = byKey.get(key);
    if (!existing || compareQueryCandidatePreference(candidate, existing) < 0) {
      byKey.set(key, candidate);
    }
  }

  const result = Array.from(byKey.values());
  result.sort(compareQueryCandidatePreference);
  return result;
}

function uniqueSearchCandidates(values) {
  const result = [];
  const seen = new Set();
  for (const entry of Array.isArray(values) ? values : []) {
    const candidate = entry && typeof entry === "object"
      ? makeSearchCandidate(entry.kind, entry.value, entry.weight)
      : makeSearchCandidate("text", entry, 1);
    if (!candidate) continue;
    const normalized = normalizeLooseSearchText(candidate.value);
    if (!normalized) continue;
    const key = `${candidate.kind}\u0000${normalized}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(candidate);
  }
  return result;
}

function boundedLevenshtein(left, right, maxDistance) {
  if (left === right) return 0;
  if (!left || !right) return Math.max(left.length, right.length);
  if (Math.abs(left.length - right.length) > maxDistance) return maxDistance + 1;

  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    const current = [i];
    let rowMin = current[0];
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      const value = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + cost
      );
      current.push(value);
      if (value < rowMin) rowMin = value;
    }
    if (rowMin > maxDistance) return maxDistance + 1;
    previous = current;
  }
  return previous[right.length];
}

function isAdjacentTransposition(left, right) {
  if (!left || !right || left.length !== right.length || left.length < 2) return false;
  let firstMismatch = -1;
  let secondMismatch = -1;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] === right[index]) continue;
    if (firstMismatch < 0) firstMismatch = index;
    else if (secondMismatch < 0) secondMismatch = index;
    else return false;
  }
  if (firstMismatch < 0 || secondMismatch < 0 || secondMismatch !== firstMismatch + 1) return false;
  return left[firstMismatch] === right[secondMismatch] && left[secondMismatch] === right[firstMismatch];
}

function scoreFuzzyToken(queryToken, candidateToken) {
  if (!queryToken || !candidateToken) return 0;
  if (candidateToken === queryToken) return 1200;
  if (candidateToken.startsWith(queryToken)) return 1050 - Math.min(candidateToken.length - queryToken.length, 80);
  if (candidateToken.includes(queryToken)) return 900 - Math.min(candidateToken.indexOf(queryToken), 120);
  if (isAdjacentTransposition(queryToken, candidateToken)) return 620;

  const maxDistance = queryToken.length >= 6 ? 2 : 1;
  const distance = boundedLevenshtein(queryToken, candidateToken, maxDistance);
  if (distance > maxDistance) return 0;
  return 700 - (distance * 120) - (Math.abs(candidateToken.length - queryToken.length) * 20);
}

function computeSearchMatchScore(needle, candidate, mode = "substring") {
  const normalizedMode = normalizeSearchMode(mode);
  const query = normalizeLooseSearchText(needle);
  const text = normalizeLooseSearchText(candidate);
  if (!query || !text) return 0;

  if (normalizedMode === "exact") {
    return text === query ? 2000 : 0;
  }

  if (normalizedMode === "substring") {
    const substringIndex = text.indexOf(query);
    return substringIndex >= 0 ? 1400 - Math.min(substringIndex, 400) : 0;
  }

  if (text === query) return 2000;

  const substringIndex = text.indexOf(query);
  if (substringIndex >= 0) {
    return 1400 - Math.min(substringIndex, 400);
  }

  const queryTokens = tokenizeLooseSearchText(query);
  const candidateTokens = tokenizeLooseSearchText(text);
  if (!queryTokens.length || !candidateTokens.length) return 0;

  let score = 0;
  for (const queryToken of queryTokens) {
    let best = 0;
    for (const candidateToken of candidateTokens) {
      const tokenScore = scoreFuzzyToken(queryToken, candidateToken);
      if (tokenScore > best) best = tokenScore;
    }
    if (best < 1) return 0;
    score += best;
  }

  if (candidateTokens[0] && scoreFuzzyToken(queryTokens[0], candidateTokens[0]) > 0) {
    score += 40;
  }
  return score;
}

function applyCandidateWeight(score, candidate) {
  if (!Number.isFinite(score) || score <= 0) return 0;
  const weight = candidate && Number.isFinite(candidate.weight) ? candidate.weight : 1;
  return Math.round(score * weight);
}

function normalizeSearchCandidate(entry) {
  return entry && typeof entry === "object"
    ? makeSearchCandidate(entry.kind, entry.value, entry.weight)
    : makeSearchCandidate("text", entry, 1);
}

function findSearchCandidateMatches(candidates, needle, mode = "substring", options = {}) {
  const normalizedMode = normalizeSearchMode(mode);
  const minScore = Number.isFinite(options.minScore)
    ? options.minScore
    : (normalizedMode === "fuzzy" ? 550 : 1);
  const limit = Number.isInteger(options.limit) && options.limit > 0
    ? options.limit
    : Infinity;
  const matches = [];

  for (const rawCandidate of Array.isArray(candidates) ? candidates : []) {
    const candidate = normalizeSearchCandidate(rawCandidate);
    if (!candidate) continue;
    const score = applyCandidateWeight(
      computeSearchMatchScore(needle, candidate.value, normalizedMode),
      candidate
    );
    if (score < minScore) continue;
    matches.push({
      kind: candidate.kind,
      text: candidate.value,
      weight: candidate.weight,
      score,
    });
  }

  matches.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    if (left.kind !== right.kind) return left.kind.localeCompare(right.kind);
    return left.text.localeCompare(right.text);
  });

  const limited = matches.slice(0, limit);
  return {
    mode: normalizedMode,
    bestScore: limited[0] ? limited[0].score : 0,
    bestMatch: limited[0] || null,
    matches: limited,
  };
}

function getSessionAnnotation(session) {
  const annotation = session && session.annotation && typeof session.annotation === "object"
    ? session.annotation
    : null;
  if (annotation) return annotation;
  return {
    bookmarked: Boolean(session && session.bookmarked === true),
    tags: Array.isArray(session && session.tags) ? session.tags : [],
    note: session && typeof session.note === "string" ? session.note : "",
  };
}

function getSessionQuerySearchCandidates(session) {
  return buildQuerySearchCandidates([
    ...(Array.isArray(session && session.recentQueries) ? session.recentQueries : []),
    ...(Array.isArray(session && session.queryArtifacts) ? session.queryArtifacts : []),
  ]);
}

function getSessionFindSearchCandidates(session) {
  const annotation = getSessionAnnotation(session);
  return uniqueSearchCandidates([
    makeSearchCandidate("session", session && session.sessionId, 0.35),
    makeSearchCandidate("cwd", session && session.cwd, 0.45),
    makeSearchCandidate("focus", session && session.focusRoot, 0.55),
    makeSearchCandidate("user", session && session.lastUserPreview, 1),
    makeSearchCandidate("answer", session && (session.finalAnswerPreview || session.answerPreview), 0.9),
    makeSearchCandidate("commentary", session && session.commentaryPreview, 0.8),
    ...(Array.isArray(annotation.tags)
      ? annotation.tags.map((tag) => ({ kind: "tag", value: tag, weight: 0.95 }))
      : []),
    makeSearchCandidate("note", annotation.note, 1),
    ...buildQuerySearchCandidates([
      ...(Array.isArray(session && session.recentQueries) ? session.recentQueries : []),
      ...(Array.isArray(session && session.queryArtifacts) ? session.queryArtifacts : []),
    ], { baseWeight: 0.95 }),
    ...(Array.isArray(session && session.recentCommands)
      ? session.recentCommands.map((entry) => ({
        kind: "command",
        value: entry && typeof entry.command === "string" ? entry.command : "",
        weight: 0.35,
      }))
      : []),
    ...(Array.isArray(session && session.toolsUsed)
      ? session.toolsUsed.map((tool) => ({ kind: "tool", value: tool, weight: 0.3 }))
      : []),
  ]);
}

function rankSessionsBySearchMode(sessions, needle, candidateSelector, options = {}) {
  const mode = normalizeSearchMode(options.mode);
  const minScore = Number.isFinite(options.minScore)
    ? options.minScore
    : (mode === "fuzzy" ? 550 : 1);
  const matchLimit = Number.isInteger(options.matchLimit) && options.matchLimit > 0
    ? options.matchLimit
    : 5;
  const ranked = [];

  for (const session of Array.isArray(sessions) ? sessions : []) {
    const candidateResult = findSearchCandidateMatches(
      candidateSelector(session),
      needle,
      mode,
      { minScore, limit: matchLimit }
    );
    if (!candidateResult.bestMatch) continue;
    ranked.push({
      session: {
        ...session,
        match: {
          kind: candidateResult.bestMatch.kind,
          text: candidateResult.bestMatch.text,
        },
      },
      score: candidateResult.bestScore,
      matches: candidateResult.matches,
    });
  }

  ranked.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    return toTimestampMs(right.session && (right.session.updatedAt || right.session.startedAt || right.session.endedAt))
      - toTimestampMs(left.session && (left.session.updatedAt || left.session.startedAt || left.session.endedAt));
  });

  return ranked;
}

module.exports = {
  buildQuerySearchCandidates,
  classifyQuerySignal,
  findSearchCandidateMatches,
  getQueryMatchSignalTier,
  getQuerySignalRank,
  getSessionFindSearchCandidates,
  getSessionQuerySearchCandidates,
  normalizeSearchMode,
  rankSessionsBySearchMode,
  summarizeLowSignalQueryMatches,
};
