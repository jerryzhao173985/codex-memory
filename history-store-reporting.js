"use strict";

const path = require("path");

const { SESSION_DOC_SCHEMA_VERSION } = require("./catalog");
const { resolveHistoryIndexRoot, buildRolloutPersistenceStats } = require("./history-store-index");

const DEFAULT_DOCTOR_RESULT_LIMIT = 50;
const DEFAULT_DOCTOR_LIVE_WINDOW_MS = 120000;

function toTimestampMs(value) {
  if (Number.isFinite(value)) return Number(value);
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeDoctorStatus(value) {
  const text = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (["reused", "rebuilt", "live", "duplicate", "forked", "subagent"].includes(text)) return text;
  return "";
}

function buildDuplicateGroups(sessions) {
  const duplicateGroups = new Map();
  for (const session of Array.isArray(sessions) ? sessions : []) {
    const sessionId = typeof session.sessionId === "string" ? session.sessionId : "";
    if (!sessionId) continue;
    if (!duplicateGroups.has(sessionId)) duplicateGroups.set(sessionId, []);
    duplicateGroups.get(sessionId).push(session);
  }
  return duplicateGroups;
}

function buildForkFamilyEntries(sessions) {
  const sessionList = Array.isArray(sessions) ? sessions : [];
  const sessionById = new Map();
  for (const session of sessionList) {
    if (session && typeof session.sessionId === "string" && session.sessionId) {
      sessionById.set(session.sessionId, session);
    }
  }

  function resolveFamilyRootId(session) {
    const seen = new Set();
    let current = session;
    while (current && current.sessionId && !seen.has(current.sessionId)) {
      seen.add(current.sessionId);
      const nextId = current.parentThreadId || current.forkedFromId || "";
      if (!nextId) return current.sessionId;
      const next = sessionById.get(nextId);
      if (!next) return nextId;
      current = next;
    }
    return session && session.sessionId ? session.sessionId : "";
  }

  const familyMap = new Map();
  for (const session of sessionList) {
    const rootSessionId = resolveFamilyRootId(session);
    if (!rootSessionId) continue;
    if (!familyMap.has(rootSessionId)) familyMap.set(rootSessionId, []);
    familyMap.get(rootSessionId).push(session);
  }

  return Array.from(familyMap.entries())
    .map(([rootSessionId, items]) => ({
      rootSessionId,
      sessions: items,
    }))
    .filter((entry) => entry.sessions.length > 1)
    .sort((a, b) => b.sessions.length - a.sessions.length || a.rootSessionId.localeCompare(b.rootSessionId));
}

function buildHistoryStats(options = {}) {
  const built = options.built && typeof options.built === "object" ? options.built : {};
  const catalog = built.catalog && typeof built.catalog === "object"
    ? built.catalog
    : { sessions: [], facets: {}, artifacts: { counts: {} }, projects: [], sessionCount: 0, generatedAt: null, sessionDir: null };
  const currentManifest = built.manifest && typeof built.manifest === "object" ? built.manifest : null;
  const annotationStats = options.annotationStats && typeof options.annotationStats === "object" ? options.annotationStats : {};
  const manualProjectStats = options.manualProjectStats && typeof options.manualProjectStats === "object" ? options.manualProjectStats : {};
  const persistenceStats = buildRolloutPersistenceStats(catalog.sessions);
  const generatedMs = toTimestampMs(currentManifest ? currentManifest.generatedAt : catalog.generatedAt) || Date.now();
  const duplicateGroups = buildDuplicateGroups(catalog.sessions);
  const forkFamilies = buildForkFamilyEntries(catalog.sessions);
  let liveCandidates = 0;
  let forkedSessions = 0;
  let subagentSessions = 0;

  for (const session of Array.isArray(catalog.sessions) ? catalog.sessions : []) {
    if (session.forkedFromId) forkedSessions += 1;
    if (session.parentThreadId) subagentSessions += 1;
    const updatedMs = toTimestampMs(session.updatedAt) || 0;
    if (updatedMs > 0 && generatedMs >= updatedMs && (generatedMs - updatedMs) <= DEFAULT_DOCTOR_LIVE_WINDOW_MS) {
      liveCandidates += 1;
    }
  }

  const duplicateEntries = Array.from(duplicateGroups.values()).filter((items) => items.length > 1);

  return {
    generatedAt: currentManifest ? currentManifest.generatedAt : catalog.generatedAt,
    sessionDir: currentManifest ? currentManifest.sessionDir : catalog.sessionDir,
    indexRoot: currentManifest ? currentManifest.indexRoot : resolveHistoryIndexRoot(options.indexRoot),
    sessionDocSchemaVersion: currentManifest ? currentManifest.sessionDocSchemaVersion : SESSION_DOC_SCHEMA_VERSION,
    sessionCount: catalog.sessionCount,
    fileCount: currentManifest ? currentManifest.fileCount : catalog.sessions.length,
    reusedFiles: currentManifest && currentManifest.stats ? currentManifest.stats.reusedFiles : 0,
    reuseCandidates: currentManifest && currentManifest.stats ? currentManifest.stats.reuseCandidates || 0 : 0,
    reuseFailures: currentManifest && currentManifest.stats ? currentManifest.stats.reuseFailures || 0 : 0,
    reuseFailureCounts: currentManifest && currentManifest.stats
      ? currentManifest.stats.reuseFailureCounts || {}
      : {},
    reuseFailureSamples: currentManifest && currentManifest.stats
      ? currentManifest.stats.reuseFailureSamples || {}
      : {},
    persistenceDegraded: currentManifest && currentManifest.stats
      ? currentManifest.stats.persistenceDegraded === true
      : false,
    persistenceErrors: currentManifest && currentManifest.stats
      ? currentManifest.stats.persistenceErrors || []
      : [],
    rebuiltFiles: currentManifest && currentManifest.stats ? currentManifest.stats.rebuiltFiles : 0,
    skippedFiles: currentManifest && currentManifest.stats ? currentManifest.stats.skippedFiles : 0,
    removedFiles: currentManifest && currentManifest.stats ? currentManifest.stats.removedFiles : 0,
    artifactCounts: currentManifest && currentManifest.stats
      ? currentManifest.stats.artifactCounts
      : catalog.artifacts.counts,
    memoryModeCounts: currentManifest && currentManifest.stats
      ? currentManifest.stats.memoryModeCounts || {}
      : persistenceStats.memoryModeCounts,
    eventModeCounts: currentManifest && currentManifest.stats
      ? currentManifest.stats.eventModeCounts || {}
      : persistenceStats.eventModeCounts,
    extendedEventSessions: currentManifest && currentManifest.stats
      ? currentManifest.stats.extendedEventSessions || 0
      : persistenceStats.extendedEventSessions,
    forkedSessions,
    subagentSessions,
    forkFamilies: forkFamilies.length,
    duplicateSessionIds: duplicateEntries.length,
    duplicateRolloutFiles: duplicateEntries.reduce((sum, items) => sum + items.length, 0),
    liveCandidates,
    projectCount: currentManifest && currentManifest.stats ? currentManifest.stats.projectCount : catalog.projects.length,
    annotatedSessions: annotationStats.annotatedSessions || 0,
    bookmarkedSessions: annotationStats.bookmarkedSessions || 0,
    annotatedTurns: annotationStats.annotatedTurns || 0,
    bookmarkedTurns: annotationStats.bookmarkedTurns || 0,
    orphanSessionAnnotations: annotationStats.orphanSessionAnnotations || 0,
    orphanTurnAnnotations: annotationStats.orphanTurnAnnotations || 0,
    manualProjectCount: manualProjectStats.manualProjectCount || 0,
    bookmarkedProjectCount: manualProjectStats.bookmarkedProjectCount || 0,
    topFiles: Array.isArray(catalog.facets.topFiles) ? catalog.facets.topFiles.slice(0, 10) : [],
    topPaths: Array.isArray(catalog.facets.topPaths) ? catalog.facets.topPaths.slice(0, 10) : [],
    topActiveFiles: Array.isArray(catalog.facets.topActiveFiles) ? catalog.facets.topActiveFiles.slice(0, 10) : [],
    topActivePaths: Array.isArray(catalog.facets.topActivePaths) ? catalog.facets.topActivePaths.slice(0, 10) : [],
    topPathPatterns: Array.isArray(catalog.facets.topPathPatterns) ? catalog.facets.topPathPatterns.slice(0, 10) : [],
    topCommandOps: Array.isArray(catalog.facets.topCommandOps) ? catalog.facets.topCommandOps.slice(0, 10) : [],
    topHighSignalCommandOps: Array.isArray(catalog.facets.topHighSignalCommandOps) ? catalog.facets.topHighSignalCommandOps.slice(0, 10) : [],
    topQueries: Array.isArray(catalog.facets.topQueries) ? catalog.facets.topQueries.slice(0, 10) : [],
    topLowSignalQueries: Array.isArray(catalog.facets.topLowSignalQueries) ? catalog.facets.topLowSignalQueries.slice(0, 10) : [],
    topTools: Array.isArray(catalog.facets.topTools) ? catalog.facets.topTools.slice(0, 10) : [],
    topActiveTools: Array.isArray(catalog.facets.topActiveTools) ? catalog.facets.topActiveTools.slice(0, 10) : [],
    topProjects: Array.isArray(catalog.facets.topProjects) ? catalog.facets.topProjects.slice(0, 10) : [],
    topActiveProjects: Array.isArray(catalog.facets.topActiveProjects) ? catalog.facets.topActiveProjects.slice(0, 10) : [],
    topMemoryModes: Array.isArray(catalog.facets.topMemoryModes) ? catalog.facets.topMemoryModes.slice(0, 10) : [],
    topEventModes: Array.isArray(catalog.facets.topEventModes) ? catalog.facets.topEventModes.slice(0, 10) : [],
    qualityClassCounts: Object.fromEntries(
      (Array.isArray(catalog.facets.topQualityClasses) ? catalog.facets.topQualityClasses : [])
        .map((item) => [item.qualityClass, item.count])
    ),
    topQualityClasses: Array.isArray(catalog.facets.topQualityClasses) ? catalog.facets.topQualityClasses.slice(0, 10) : [],
    topManualTags: Array.isArray(annotationStats.topManualTags) ? annotationStats.topManualTags : [],
    topManualProjects: Array.isArray(manualProjectStats.topManualProjects) ? manualProjectStats.topManualProjects : [],
  };
}

function buildHistoryDoctor(options = {}) {
  const built = options.built && typeof options.built === "object" ? options.built : {};
  const catalog = built.catalog && typeof built.catalog === "object"
    ? built.catalog
    : { sessions: [], sessionCount: 0, generatedAt: null, sessionDir: null };
  const currentManifest = built.manifest && typeof built.manifest === "object" ? built.manifest : null;
  const filters = options.filters && typeof options.filters === "object" ? options.filters : {};
  const limit = Number.isInteger(filters.limit) && filters.limit > 0 ? filters.limit : DEFAULT_DOCTOR_RESULT_LIMIT;
  const offset = Number.isInteger(filters.offset) && filters.offset > 0 ? filters.offset : 0;
  const q = typeof filters.q === "string" ? filters.q.trim().toLowerCase() : "";
  const statusFilter = normalizeDoctorStatus(filters.status);
  const reasonNeedle = typeof filters.reason === "string" ? filters.reason.trim().toLowerCase() : "";
  const sessionKeyNeedle = typeof filters.sessionKey === "string" ? filters.sessionKey.trim() : "";
  const liveWindowMs = Number.isInteger(filters.liveWindowMs) && filters.liveWindowMs > 0
    ? filters.liveWindowMs
    : DEFAULT_DOCTOR_LIVE_WINDOW_MS;
  const generatedMs = toTimestampMs(currentManifest ? currentManifest.generatedAt : catalog.generatedAt) || Date.now();
  const duplicateGroups = buildDuplicateGroups(catalog.sessions);
  const forkFamilies = buildForkFamilyEntries(catalog.sessions);
  const duplicateEntries = Array.from(duplicateGroups.entries())
    .filter(([, items]) => items.length > 1)
    .map(([sessionId, items]) => ({
      sessionId,
      count: items.length,
      rollouts: items
        .map((session) => ({
          sessionKey: session.sessionKey || path.basename(session.filePath || "", ".jsonl"),
          filePath: session.filePath || "",
          updatedAt: session.updatedAt || session.startedAt || null,
          cwd: session.cwd || "",
        }))
        .sort((a, b) => (toTimestampMs(b.updatedAt) || 0) - (toTimestampMs(a.updatedAt) || 0)),
    }))
    .sort((a, b) => b.count - a.count || a.sessionId.localeCompare(b.sessionId));
  const forkEntries = forkFamilies.map((entry) => ({
    rootSessionId: entry.rootSessionId,
    count: entry.sessions.length,
    rollouts: entry.sessions
      .map((session) => ({
        sessionId: session.sessionId,
        sessionKey: session.sessionKey || path.basename(session.filePath || "", ".jsonl"),
        forkedFromId: session.forkedFromId || null,
        parentThreadId: session.parentThreadId || null,
        agentRole: session.agentRole || null,
        agentNickname: session.agentNickname || null,
        filePath: session.filePath || "",
        updatedAt: session.updatedAt || session.startedAt || null,
        cwd: session.cwd || "",
      }))
      .sort((a, b) => (toTimestampMs(b.updatedAt) || 0) - (toTimestampMs(a.updatedAt) || 0)),
  }));

  const fileEntries = [];
  for (const session of Array.isArray(catalog.sessions) ? catalog.sessions : []) {
    const manifestEntry = currentManifest && currentManifest.files ? currentManifest.files[session.filePath] : null;
    const updatedMs = toTimestampMs(session.updatedAt) || (manifestEntry && manifestEntry.mtimeMs) || 0;
    const liveCandidate = updatedMs > 0 && generatedMs >= updatedMs && (generatedMs - updatedMs) <= liveWindowMs;
    const duplicateGroup = duplicateGroups.get(session.sessionId) || [];
    const sessionKey = session.sessionKey || path.basename(session.filePath || "", ".jsonl");
    const buildStatus = manifestEntry && typeof manifestEntry.buildStatus === "string"
      ? manifestEntry.buildStatus
      : "unknown";
    const buildReason = manifestEntry && typeof manifestEntry.buildReason === "string"
      ? manifestEntry.buildReason
      : "";
    const fileEntry = {
      sessionId: session.sessionId,
      sessionKey,
      filePath: session.filePath,
      docPath: manifestEntry && typeof manifestEntry.docPath === "string" ? manifestEntry.docPath : null,
      buildStatus,
      buildReason,
      mtimeMs: manifestEntry && Number.isFinite(manifestEntry.mtimeMs) ? manifestEntry.mtimeMs : null,
      size: manifestEntry && Number.isFinite(manifestEntry.size) ? manifestEntry.size : null,
      cwd: session.cwd || "",
      startedAt: session.startedAt || null,
      updatedAt: session.updatedAt || null,
      turnCount: Number.isInteger(session.turnCount) ? session.turnCount : 0,
      eventCount: Number.isInteger(session.eventCount) ? session.eventCount : 0,
      forkedFromId: session.forkedFromId || null,
      parentThreadId: session.parentThreadId || null,
      subagentDepth: Number.isInteger(session.subagentDepth) ? session.subagentDepth : null,
      liveCandidate,
      duplicateSessionId: duplicateGroup.length > 1,
      duplicateCount: duplicateGroup.length,
    };

    if (sessionKeyNeedle && fileEntry.sessionKey !== sessionKeyNeedle) continue;
    if (reasonNeedle && !buildReason.toLowerCase().includes(reasonNeedle)) continue;
    if (statusFilter === "reused" && buildStatus !== "reused") continue;
    if (statusFilter === "rebuilt" && buildStatus !== "rebuilt") continue;
    if (statusFilter === "live" && !liveCandidate) continue;
    if (statusFilter === "duplicate" && !fileEntry.duplicateSessionId) continue;
    if (statusFilter === "forked" && !fileEntry.forkedFromId) continue;
    if (statusFilter === "subagent" && !fileEntry.parentThreadId) continue;
    if (q) {
      const haystack = [
        fileEntry.sessionId,
        fileEntry.sessionKey,
        fileEntry.forkedFromId,
        fileEntry.parentThreadId,
        fileEntry.filePath,
        fileEntry.docPath,
        fileEntry.cwd,
        fileEntry.buildStatus,
        fileEntry.buildReason,
      ].filter(Boolean).join("\n").toLowerCase();
      if (!haystack.includes(q)) continue;
    }
    fileEntries.push(fileEntry);
  }

  fileEntries.sort((a, b) => {
    if (Number(b.liveCandidate) !== Number(a.liveCandidate)) return Number(b.liveCandidate) - Number(a.liveCandidate);
    if (Number(b.duplicateSessionId) !== Number(a.duplicateSessionId)) return Number(b.duplicateSessionId) - Number(a.duplicateSessionId);
    if ((b.buildStatus || "") !== (a.buildStatus || "")) {
      if (a.buildStatus === "rebuilt") return -1;
      if (b.buildStatus === "rebuilt") return 1;
    }
    return (toTimestampMs(b.updatedAt) || 0) - (toTimestampMs(a.updatedAt) || 0);
  });

  return {
    generatedAt: currentManifest ? currentManifest.generatedAt : catalog.generatedAt,
    sessionDir: currentManifest ? currentManifest.sessionDir : catalog.sessionDir,
    indexRoot: currentManifest ? currentManifest.indexRoot : resolveHistoryIndexRoot(options.indexRoot),
    sessionDocSchemaVersion: currentManifest ? currentManifest.sessionDocSchemaVersion : SESSION_DOC_SCHEMA_VERSION,
    liveWindowMs,
    sessionCount: catalog.sessionCount,
    fileCount: currentManifest ? currentManifest.fileCount : catalog.sessions.length,
    persistenceDegraded: currentManifest && currentManifest.stats
      ? currentManifest.stats.persistenceDegraded === true
      : false,
    persistenceErrors: currentManifest && currentManifest.stats
      ? currentManifest.stats.persistenceErrors || []
      : [],
    total: fileEntries.length,
    offset,
    limit,
    truncated: offset > 0 || (offset + limit) < fileEntries.length,
    counts: {
      reused: fileEntries.filter((item) => item.buildStatus === "reused").length,
      rebuilt: fileEntries.filter((item) => item.buildStatus === "rebuilt").length,
      live: fileEntries.filter((item) => item.liveCandidate).length,
      duplicates: fileEntries.filter((item) => item.duplicateSessionId).length,
      forked: fileEntries.filter((item) => Boolean(item.forkedFromId)).length,
      subagent: fileEntries.filter((item) => Boolean(item.parentThreadId)).length,
    },
    duplicates: duplicateEntries.slice(0, 12),
    forkFamilies: forkEntries.slice(0, 12),
    files: fileEntries.slice(offset, offset + limit),
  };
}

module.exports = {
  buildHistoryStats,
  buildHistoryDoctor,
  buildDuplicateGroups,
  buildForkFamilyEntries,
  normalizeDoctorStatus,
  DEFAULT_DOCTOR_RESULT_LIMIT,
  DEFAULT_DOCTOR_LIVE_WINDOW_MS,
};
