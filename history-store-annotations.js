"use strict";

const fs = require("fs");
const path = require("path");

const { getCatalogSession } = require("./catalog");
const { prefixedSessionId } = require("./history-session-id");

function toTimestampMs(value) {
  if (Number.isFinite(value)) return Number(value);
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function writeJsonAtomic(filePath, value) {
  const dir = path.dirname(filePath);
  const tmpPath = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(tmpPath, JSON.stringify(value, null, 2), "utf8");
  fs.renameSync(tmpPath, filePath);
}

function normalizeAnnotationTag(value) {
  return typeof value === "string"
    ? value.trim().toLowerCase()
    : "";
}

function normalizeAnnotationEntry(entry) {
  if (!entry || typeof entry !== "object") return null;
  const bookmarked = entry.bookmarked === true;
  const tags = Array.isArray(entry.tags)
    ? Array.from(new Set(entry.tags.map(normalizeAnnotationTag).filter(Boolean))).sort()
    : [];
  const note = typeof entry.note === "string" && entry.note.trim()
    ? entry.note.trim()
    : "";
  const updatedAt = typeof entry.updatedAt === "string" && entry.updatedAt
    ? entry.updatedAt
    : null;
  if (!bookmarked && !tags.length && !note) return null;
  return {
    bookmarked,
    tags,
    note,
    updatedAt,
  };
}

function normalizeAnnotationStore(data, annotationStoreVersion = 1) {
  const sessions = {};
  const turns = {};
  const rawSessions = data && data.sessions && typeof data.sessions === "object" ? data.sessions : {};
  const rawTurns = data && data.turns && typeof data.turns === "object" ? data.turns : {};

  for (const [sessionId, value] of Object.entries(rawSessions)) {
    const normalizedSessionId = prefixedSessionId(sessionId);
    const normalized = normalizeAnnotationEntry(value);
    if (!normalizedSessionId || !normalized) continue;
    sessions[normalizedSessionId] = normalized;
  }

  for (const [turnKey, value] of Object.entries(rawTurns)) {
    const normalized = normalizeAnnotationEntry(value);
    if (!normalized || typeof turnKey !== "string" || !turnKey.includes("::")) continue;
    turns[turnKey] = normalized;
  }

  return {
    version: annotationStoreVersion,
    updatedAt: data && typeof data.updatedAt === "string" && data.updatedAt
      ? data.updatedAt
      : null,
    sessions,
    turns,
  };
}

function makeTurnAnnotationKey(sessionId, turnId) {
  const normalizedSessionId = prefixedSessionId(sessionId);
  const normalizedTurnId = typeof turnId === "string" ? turnId.trim() : "";
  if (!normalizedSessionId || !normalizedTurnId) return "";
  return `${normalizedSessionId}::${normalizedTurnId}`;
}

function cloneAnnotation(annotation) {
  if (!annotation || typeof annotation !== "object") return null;
  const tags = Array.isArray(annotation.tags) ? annotation.tags.slice() : [];
  const note = typeof annotation.note === "string" ? annotation.note : "";
  return {
    bookmarked: annotation.bookmarked === true,
    tags,
    note,
    updatedAt: typeof annotation.updatedAt === "string" ? annotation.updatedAt : null,
  };
}

function applyAnnotationPatch(existing, patch = {}) {
  const current = normalizeAnnotationEntry(existing) || { bookmarked: false, tags: [], note: "", updatedAt: null };
  let bookmarked = current.bookmarked;
  if (patch.bookmarked === true || patch.bookmarked === false) {
    bookmarked = patch.bookmarked;
  }

  let note = current.note || "";
  if (patch.clearNote) {
    note = "";
  } else if (typeof patch.note === "string") {
    note = patch.note.trim();
  }

  let tags = Array.isArray(current.tags) ? current.tags.slice() : [];
  if (patch.clearTags) tags = [];
  const removeTags = new Set((Array.isArray(patch.removeTags) ? patch.removeTags : []).map(normalizeAnnotationTag).filter(Boolean));
  if (removeTags.size) {
    tags = tags.filter((tag) => !removeTags.has(normalizeAnnotationTag(tag)));
  }
  for (const tag of Array.isArray(patch.addTags) ? patch.addTags : []) {
    const normalized = normalizeAnnotationTag(tag);
    if (!normalized || tags.includes(normalized)) continue;
    tags.push(normalized);
  }
  tags.sort();

  return normalizeAnnotationEntry({
    bookmarked,
    tags,
    note,
    updatedAt: new Date().toISOString(),
  });
}

function applyAnnotationsToCatalog(catalog, annotationStore) {
  if (!catalog || !Array.isArray(catalog.sessions)) return catalog;
  const sessions = annotationStore && annotationStore.sessions && typeof annotationStore.sessions === "object"
    ? annotationStore.sessions
    : {};
  const turns = annotationStore && annotationStore.turns && typeof annotationStore.turns === "object"
    ? annotationStore.turns
    : {};

  for (const session of catalog.sessions) {
    if (!session || typeof session !== "object") continue;
    session.annotation = cloneAnnotation(sessions[session.sessionId]);
    for (const turn of Array.isArray(session.turns) ? session.turns : []) {
      const turnKey = makeTurnAnnotationKey(session.sessionId, turn && turn.turnId);
      turn.annotation = cloneAnnotation(turns[turnKey]);
    }
  }
  return catalog;
}

function buildAnnotationStats(catalog, annotationStore) {
  const sessions = [];
  const turns = [];
  const tagCounts = {};
  const resolvedSessionIds = new Set();
  const resolvedTurnKeys = new Set();

  for (const session of Array.isArray(catalog && catalog.sessions) ? catalog.sessions : []) {
    if (!session || typeof session !== "object") continue;
    if (session.sessionId) resolvedSessionIds.add(session.sessionId);
    if (session.annotation) sessions.push(session.annotation);
    for (const turn of Array.isArray(session.turns) ? session.turns : []) {
      const turnKey = makeTurnAnnotationKey(session.sessionId, turn && turn.turnId);
      if (turnKey) resolvedTurnKeys.add(turnKey);
      if (turn && turn.annotation) turns.push(turn.annotation);
    }
  }

  for (const entry of sessions.concat(turns)) {
    for (const tag of Array.isArray(entry && entry.tags) ? entry.tags : []) {
      tagCounts[tag] = (tagCounts[tag] || 0) + 1;
    }
  }

  const rawSessions = annotationStore && annotationStore.sessions && typeof annotationStore.sessions === "object"
    ? annotationStore.sessions
    : {};
  const rawTurns = annotationStore && annotationStore.turns && typeof annotationStore.turns === "object"
    ? annotationStore.turns
    : {};
  let orphanSessionAnnotations = 0;
  let orphanTurnAnnotations = 0;

  for (const sessionId of Object.keys(rawSessions)) {
    if (!resolvedSessionIds.has(sessionId)) orphanSessionAnnotations += 1;
  }
  for (const turnKey of Object.keys(rawTurns)) {
    if (!resolvedTurnKeys.has(turnKey)) orphanTurnAnnotations += 1;
  }

  return {
    annotatedSessions: sessions.length,
    bookmarkedSessions: sessions.filter((entry) => entry && entry.bookmarked === true).length,
    annotatedTurns: turns.length,
    bookmarkedTurns: turns.filter((entry) => entry && entry.bookmarked === true).length,
    orphanSessionAnnotations,
    orphanTurnAnnotations,
    topManualTags: Object.entries(tagCounts)
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
      .slice(0, 10),
  };
}

function buildManualProjectStats(catalog) {
  const projectMap = new Map();
  for (const session of Array.isArray(catalog && catalog.sessions) ? catalog.sessions : []) {
    const cwd = session && typeof session.cwd === "string" ? session.cwd.trim() : "";
    if (!cwd) continue;
    let entry = projectMap.get(cwd);
    if (!entry) {
      entry = {
        cwd,
        updatedAt: session && typeof session.updatedAt === "string" ? session.updatedAt : null,
        annotatedSessions: 0,
        bookmarkedSessions: 0,
        annotatedTurns: 0,
        bookmarkedTurns: 0,
        tagCounts: new Map(),
      };
      projectMap.set(cwd, entry);
    } else {
      const sessionUpdatedAtMs = toTimestampMs(session && session.updatedAt) || 0;
      const currentUpdatedAtMs = toTimestampMs(entry.updatedAt) || 0;
      if (sessionUpdatedAtMs > currentUpdatedAtMs) {
        entry.updatedAt = session.updatedAt;
      }
    }

    const sessionAnnotation = session && session.annotation && typeof session.annotation === "object"
      ? session.annotation
      : null;
    if (sessionAnnotation) {
      entry.annotatedSessions += 1;
      if (sessionAnnotation.bookmarked === true) entry.bookmarkedSessions += 1;
      for (const tag of Array.isArray(sessionAnnotation.tags) ? sessionAnnotation.tags : []) {
        entry.tagCounts.set(tag, (entry.tagCounts.get(tag) || 0) + 1);
      }
    }

    for (const turn of Array.isArray(session && session.turns) ? session.turns : []) {
      const turnAnnotation = turn && turn.annotation && typeof turn.annotation === "object"
        ? turn.annotation
        : null;
      if (!turnAnnotation) continue;
      entry.annotatedTurns += 1;
      if (turnAnnotation.bookmarked === true) entry.bookmarkedTurns += 1;
      for (const tag of Array.isArray(turnAnnotation.tags) ? turnAnnotation.tags : []) {
        entry.tagCounts.set(tag, (entry.tagCounts.get(tag) || 0) + 1);
      }
    }
  }

  const projects = Array.from(projectMap.values())
    .filter((entry) => (
      entry.annotatedSessions > 0 ||
      entry.bookmarkedSessions > 0 ||
      entry.annotatedTurns > 0 ||
      entry.bookmarkedTurns > 0
    ))
    .map((entry) => ({
      cwd: entry.cwd,
      updatedAt: entry.updatedAt,
      annotatedSessions: entry.annotatedSessions,
      bookmarkedSessions: entry.bookmarkedSessions,
      annotatedTurns: entry.annotatedTurns,
      bookmarkedTurns: entry.bookmarkedTurns,
      topTags: Array.from(entry.tagCounts.entries())
        .map(([tag, count]) => ({ tag, count }))
        .sort((left, right) => right.count - left.count || left.tag.localeCompare(right.tag))
        .slice(0, 5),
    }))
    .sort((left, right) => {
      const rightBookmarked = (right.bookmarkedSessions || 0) + (right.bookmarkedTurns || 0);
      const leftBookmarked = (left.bookmarkedSessions || 0) + (left.bookmarkedTurns || 0);
      if (rightBookmarked !== leftBookmarked) return rightBookmarked - leftBookmarked;
      const rightAnnotated = (right.annotatedSessions || 0) + (right.annotatedTurns || 0);
      const leftAnnotated = (left.annotatedSessions || 0) + (left.annotatedTurns || 0);
      if (rightAnnotated !== leftAnnotated) return rightAnnotated - leftAnnotated;
      const rightUpdatedAt = toTimestampMs(right.updatedAt) || 0;
      const leftUpdatedAt = toTimestampMs(left.updatedAt) || 0;
      if (rightUpdatedAt !== leftUpdatedAt) return rightUpdatedAt - leftUpdatedAt;
      return left.cwd.localeCompare(right.cwd);
    });

  return {
    manualProjectCount: projects.length,
    bookmarkedProjectCount: projects.filter((entry) => (
      (entry.bookmarkedSessions || 0) > 0 ||
      (entry.bookmarkedTurns || 0) > 0
    )).length,
    topManualProjects: projects.slice(0, 10),
  };
}

function createHistoryAnnotationStore(options = {}) {
  const annotationPath = typeof options.annotationPath === "string" ? options.annotationPath : "";
  const annotationStoreVersion = Number.isInteger(options.annotationStoreVersion)
    ? options.annotationStoreVersion
    : 1;
  const loadCatalog = typeof options.loadCatalog === "function"
    ? options.loadCatalog
    : (() => null);
  const getCachedCatalog = typeof options.getCachedCatalog === "function"
    ? options.getCachedCatalog
    : (() => null);
  let annotationCache = null;
  let annotationMtimeMs = -1;

  function getAnnotationStore(force = false) {
    let stat = null;
    try {
      stat = fs.statSync(annotationPath);
    } catch {}
    const mtimeMs = stat ? stat.mtimeMs : -1;
    if (!force && annotationCache && mtimeMs === annotationMtimeMs) {
      return annotationCache;
    }
    annotationCache = normalizeAnnotationStore(readJson(annotationPath), annotationStoreVersion);
    annotationMtimeMs = mtimeMs;
    return annotationCache;
  }

  function saveAnnotationStore(store) {
    const normalized = normalizeAnnotationStore(store, annotationStoreVersion);
    normalized.updatedAt = new Date().toISOString();
    writeJsonAtomic(annotationPath, normalized);
    annotationCache = normalized;
    try {
      const stat = fs.statSync(annotationPath);
      annotationMtimeMs = stat.mtimeMs;
    } catch {
      annotationMtimeMs = -1;
    }
    const cachedCatalog = getCachedCatalog();
    if (cachedCatalog) applyAnnotationsToCatalog(cachedCatalog, annotationCache);
    return normalized;
  }

  return {
    getAnnotationStore,
    applyCatalogAnnotations(catalog, force = false) {
      return applyAnnotationsToCatalog(catalog, getAnnotationStore(force));
    },
    getAnnotationStats(catalog) {
      return buildAnnotationStats(catalog, getAnnotationStore(false));
    },
    getManualProjectStats(catalog) {
      return buildManualProjectStats(catalog);
    },
    setSessionAnnotation(sessionId, patch = {}, filters = {}) {
      const catalog = loadCatalog(Boolean(filters.refresh));
      const session = getCatalogSession(catalog, sessionId, filters);
      if (!session) return null;
      const normalizedSessionId = prefixedSessionId(session.sessionId || sessionId);
      if (!normalizedSessionId) return null;

      const store = getAnnotationStore(true);
      const next = applyAnnotationPatch(store.sessions[normalizedSessionId], patch);
      if (next) store.sessions[normalizedSessionId] = next;
      else delete store.sessions[normalizedSessionId];
      const saved = saveAnnotationStore(store);
      return {
        sessionId: normalizedSessionId,
        sessionKey: typeof session.sessionKey === "string" ? session.sessionKey : "",
        annotation: cloneAnnotation(saved.sessions[normalizedSessionId]),
      };
    },
    setTurnAnnotation(sessionId, turnId, patch = {}, filters = {}) {
      const catalog = loadCatalog(Boolean(filters.refresh));
      const session = getCatalogSession(catalog, sessionId, filters);
      const normalizedTurnId = typeof turnId === "string" ? turnId.trim() : "";
      if (!session || !normalizedTurnId) return null;
      const turn = Array.isArray(session.turns)
        ? session.turns.find((item) => item && item.turnId === normalizedTurnId)
        : null;
      if (!turn) return null;
      const normalizedSessionId = prefixedSessionId(session.sessionId || sessionId);
      const turnKey = makeTurnAnnotationKey(normalizedSessionId, normalizedTurnId);
      if (!turnKey) return null;

      const store = getAnnotationStore(true);
      const next = applyAnnotationPatch(store.turns[turnKey], patch);
      if (next) store.turns[turnKey] = next;
      else delete store.turns[turnKey];
      const saved = saveAnnotationStore(store);
      return {
        sessionId: normalizedSessionId,
        sessionKey: typeof session.sessionKey === "string" ? session.sessionKey : "",
        turnId: normalizedTurnId,
        annotation: cloneAnnotation(saved.turns[turnKey]),
      };
    },
  };
}

module.exports = {
  createHistoryAnnotationStore,
  normalizeAnnotationStore,
  makeTurnAnnotationKey,
  cloneAnnotation,
  applyAnnotationPatch,
  applyAnnotationsToCatalog,
  buildAnnotationStats,
  buildManualProjectStats,
};
