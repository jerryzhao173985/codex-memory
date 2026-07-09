"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const codexConfig = require("./config");
const { prefixedSessionId } = require("./history-session-id");
const {
  buildQuerySearchCandidates,
  classifyQuerySignal,
  findSearchCandidateMatches,
  getQueryMatchSignalTier,
  getQuerySignalRank,
  getSessionFindSearchCandidates,
  getSessionQuerySearchCandidates,
  normalizeSearchMode,
  summarizeLowSignalQueryMatches,
} = require("./session-search");
const {
  normalizeRecordObject,
  summarizeRecord,
  summarizeText,
  looksLikeGlobPath,
  inferShellCommandStructure,
} = require("./parser");
const {
  normalizeArtifactKind,
  normalizeArtifactValue,
  matchesArtifactValue,
  normalizePathComparisonValue,
  classifyPathPatternValue,
  getPathPatternQuerySortScore,
  getQueryArtifactSortScore,
  classifyCommandOpSignal,
  getCommandOpSignalRank,
  sortCommandOpValues,
  matchesPathValue,
  matchesPathNeedle,
} = require("./catalog-artifact-helpers");
const { createCatalogArtifactViews } = require("./catalog-artifact-views");
const { createCatalogHistoryViews } = require("./catalog-history-views");
const { createCatalogHistoryPolicy } = require("./catalog-history-policy");
const { createCatalogAppServerThreadView } = require("./catalog-app-server-thread-view");
const { createCatalogRelatedViews } = require("./catalog-related-views");
const { createCatalogProjectViews } = require("./catalog-project-views");
const { createCatalogSessionViews } = require("./catalog-session-views");
const { createCatalogSessionSummary } = require("./catalog-session-summary");
const { createCatalogTimelineHelpers } = require("./catalog-timeline-helpers");
const { createCatalogMatchers } = require("./catalog-matchers");
const { createCatalogBuild } = require("./catalog-build");
const { createCatalogRolloutBuild } = require("./catalog-rollout-build");
const { createCatalogSessionState } = require("./catalog-session-state");
const { normalizeSessionSource } = require("./history-session-source");
const { shapeText, normalizeTrimStrategy } = require("./text-shaper");

const DEFAULT_CATALOG_REFRESH_MS = 10000;
const DEFAULT_RESULT_LIMIT = 50;
const DEFAULT_EVENT_LIMIT = 200;
const MAX_UNIQUE_VALUES = 50;
const MAX_TURN_ITEMS = 20;
const MAX_RECENT_COMMANDS = 12;
const MAX_RECENT_QUERIES = 12;
const MAX_RECENT_ERRORS = 12;
const MAX_COMMAND_ARTIFACTS = 120;
const MAX_PATH_ARTIFACTS = 160;
const MAX_QUERY_ARTIFACTS = 120;
const MAX_ERROR_ARTIFACTS = 120;
const MAX_SEARCH_TEXT_CHARS = 32768;
const MAX_PROJECT_SEARCH_TEXT_CHARS = 65536;
const MAX_ARTIFACT_SESSION_REFS = 12;
const MAX_PROJECT_SESSION_REFS = 12;
const MAX_PROJECT_TURN_REFS = 20;
const MAX_PROJECT_AREA_REFS = 10;
const MAX_PROJECT_AREA_SESSION_REFS = 4;
const MAX_PROJECT_AREA_VALUE_REFS = 5;
const MAX_UNSCOPED_AREA_SAMPLES = 5;
const DEFAULT_THREAD_EVENT_LIMIT = 40;
const MAX_RELATED_SHARED_VALUES = 8;
const MAX_RELATED_TURN_REFS = 8;
const MAX_MANUAL_HIGHLIGHTS = 5;
const COMPACT_PREVIEW_CHARS = 220;
const COMPACT_PREVIEW_LINES = 4;
const COMPACT_SUMMARY_CHARS = 260;
const COMPACT_SUMMARY_LINES = 5;
const DEFAULT_RESUME_TOTAL_CHARS = 12000;
const DEFAULT_RESUME_ITEM_CHARS = 600;
const DEFAULT_RESUME_TOOL_CHARS = 280;
const DEFAULT_RESUME_LINE_LIMIT = 10;
const DEFAULT_RESUME_TURN_LIMIT = 6;
const DEFAULT_RESUME_ITEM_LIMIT = 6;
const DEFAULT_RESUME_HIGHLIGHT_LIMIT = 8;
const DEFAULT_RESUME_TOOL_TEXT_MODE = "salient";
const SESSION_DOC_SCHEMA_VERSION = 24;
const PATH_ROLE_ORDER = ["read", "search_scope", "list_scope", "write"];
const RESUME_PATH_ROLE_ORDER = ["write", "read", "search_scope", "list_scope"];
const FOCUS_ROOT_SIGNAL_SCORES = {
  file: 12,
  write: 10,
  read: 7,
  search_scope: 3,
  list_scope: 2,
  path_pattern: 1,
  fallback: 2,
};
const PROJECT_AREA_REASON_NOTES = {
  aborted_no_activity: "Turn or session ended before any local work artifacts were persisted.",
  query_only_search: "Only search/query intent was captured, with no local project path or file anchor.",
  external_only: "Recorded activity only referenced paths outside the current project cwd.",
  pattern_only_scope: "Only non-literal local scope patterns were captured, not stable local paths.",
  no_local_anchor: "Activity was recorded, but no stable local project root could be derived.",
  session_without_turns: "The matched session has no reconstructable turns in the current history view.",
};
const COMMAND_TYPE_PATH_ROLE_MAP = {
  read: "read",
  search: "search_scope",
  list_files: "list_scope",
};
const EXTENDED_EVENT_PERSISTENCE_KEYS = new Set([
  "event_msg:error",
  "event_msg:guardian_assessment",
  "event_msg:web_search_end",
  "event_msg:exec_command_end",
  "event_msg:patch_apply_end",
  "event_msg:mcp_tool_call_end",
  "event_msg:view_image_tool_call",
  "event_msg:collab_agent_spawn_end",
  "event_msg:collab_agent_interaction_end",
  "event_msg:collab_waiting_end",
  "event_msg:collab_close_end",
  "event_msg:collab_resume_end",
  "event_msg:dynamic_tool_call_request",
  "event_msg:dynamic_tool_call_response",
]);

function normalizeHistoryMode(value) {
  const text = typeof value === "string" ? value.trim().toLowerCase() : "";
  return text === "raw" ? "raw" : "effective";
}

function resolveSessionDir(sessionDir = codexConfig.logConfig.sessionDir) {
  if (typeof sessionDir !== "string" || !sessionDir) return codexConfig.logConfig.sessionDir;
  if (sessionDir.startsWith("~")) return path.join(os.homedir(), sessionDir.slice(1));
  return sessionDir;
}

function isRolloutFileName(name) {
  return Boolean(
    typeof name === "string" &&
    name.startsWith("rollout-") &&
    (name.endsWith(".jsonl") || name.endsWith(".json"))
  );
}

function stripRolloutExtension(value) {
  if (typeof value !== "string") return "";
  if (value.endsWith(".jsonl")) return value.slice(0, -".jsonl".length);
  if (value.endsWith(".json")) return value.slice(0, -".json".length);
  return value;
}

function walkRolloutFiles(dir, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkRolloutFiles(fullPath, out);
      continue;
    }
    if (entry.isFile() && isRolloutFileName(entry.name)) {
      out.push(fullPath);
    }
  }
  return out;
}

function listRolloutFiles(sessionDir, options = {}) {
  const dir = resolveSessionDir(sessionDir);
  const entries = walkRolloutFiles(dir).map((filePath) => {
    let mtimeMs = 0;
    try { mtimeMs = fs.statSync(filePath).mtimeMs; } catch {}
    return { filePath, mtimeMs };
  });
  entries.sort((a, b) => {
    if (b.mtimeMs !== a.mtimeMs) return b.mtimeMs - a.mtimeMs;
    return b.filePath.localeCompare(a.filePath);
  });
  const files = entries.map((entry) => entry.filePath);
  if (Number.isInteger(options.limitFiles) && options.limitFiles > 0) {
    return files.slice(0, options.limitFiles);
  }
  return files;
}

function extractSessionIdFromFilePath(filePath) {
  const base = stripRolloutExtension(path.basename(filePath || ""));
  if (!base.startsWith("rollout-")) return null;
  const parts = base.split("-");
  if (parts.length >= 10) return parts.slice(-5).join("-");
  return base.slice("rollout-".length) || null;
}

function extractRolloutKeyFromFilePath(filePath) {
  const base = stripRolloutExtension(path.basename(filePath || ""));
  return base || "";
}

function toTimestampMs(value) {
  if (Number.isFinite(value)) return Number(value);
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizePositiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeOffset(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

function shapeCompactPreview(value, options = {}) {
  return shapeText(value, {
    maxChars: Number.isInteger(options.maxChars) ? options.maxChars : COMPACT_PREVIEW_CHARS,
    maxLines: Number.isInteger(options.maxLines) ? options.maxLines : COMPACT_PREVIEW_LINES,
    strategy: "head",
  });
}

function addUnique(list, value, limit = MAX_UNIQUE_VALUES) {
  if (typeof value !== "string") return;
  const text = value.trim();
  if (!text) return;
  if (list.includes(text)) return;
  if (list.length >= limit) return;
  list.push(text);
}

function pushBounded(list, item, limit) {
  list.push(item);
  if (list.length > limit) list.splice(0, list.length - limit);
}

function normalizeCwdValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeSessionLookupValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

function getSessionKey(sessionLike) {
  const explicit = sessionLike && typeof sessionLike.sessionKey === "string"
    ? sessionLike.sessionKey.trim()
    : "";
  if (explicit) return explicit;
  return extractRolloutKeyFromFilePath(sessionLike && sessionLike.filePath);
}
function resolveCatalogForHistoryMode(catalog, filters = {}) {
  const historyMode = normalizeHistoryMode(
    filters.historyMode || filters.history_mode || filters.mode
  );
  if (!catalog || catalog.historyMode === historyMode || historyMode === "effective" || !catalog.sessionDir) {
    return { catalog, historyMode };
  }
  // Derived-mode rebuilds are cached on the source catalog object so their
  // lifetime matches the effective catalog's freshness window. The overlay
  // decorator runs on every resolve so raw views keep bookmarks/tags/notes
  // in sync with later annotation edits.
  if (!catalog._derivedModeCatalogs) {
    Object.defineProperty(catalog, "_derivedModeCatalogs", {
      value: new Map(),
      enumerable: false,
      writable: true,
    });
  }
  const cache = catalog._derivedModeCatalogs;
  let derived = cache.get(historyMode);
  if (!derived) {
    derived = buildHistoricalCatalog({
      sessionDir: catalog.sessionDir,
      historyMode,
    });
    cache.set(historyMode, derived);
  }
  if (typeof catalog._decorateDerivedCatalog === "function") {
    catalog._decorateDerivedCatalog(derived);
  }
  return {
    catalog: derived,
    historyMode,
  };
}

function normalizeResultShape(filters = {}) {
  const raw = typeof filters.shape === "string" && filters.shape.trim()
    ? filters.shape
    : (filters.compact ? "compact" : "");
  const text = String(raw || "").trim().toLowerCase();
  if (text === "compact" || text === "summary" || text === "card" || text === "cards") {
    return "compact";
  }
  return "full";
}

function getEntityPathArtifacts(entity) {
  if (entity && Array.isArray(entity.pathArtifacts)) return entity.pathArtifacts;
  if (entity && Array.isArray(entity.pathsReferenced)) return entity.pathsReferenced;
  return [];
}

function getEntityPathPatternArtifacts(entity) {
  if (entity && Array.isArray(entity.pathPatternArtifacts)) return entity.pathPatternArtifacts;
  return [];
}

function getEntityCommandOpArtifacts(entity) {
  if (entity && Array.isArray(entity.commandOpArtifacts)) return entity.commandOpArtifacts;
  return [];
}

const {
  normalizeRolloutMemoryMode,
  normalizeRolloutEventMode,
  getSessionRolloutMemoryMode,
  getSessionRolloutEventMode,
  getSessionTags,
  getEntityAnnotation,
  getEntityAnnotationPriority,
  resolveRequestedSessionTag,
  normalizeSessionQualityClass,
  classifySessionQuality,
  buildWorkstreamManualSummary,
  buildProjectManualSummary,
  buildProjectManualBrowseSummary,
  summarizeSession,
  summarizeSessionCompact,
} = createCatalogSessionSummary({
  normalizeHistoryMode,
  getQueryMatchSignalTier,
  getSessionKey,
  getEntityPathArtifacts,
  sortCommandOpValues,
  shapeCompactPreview,
  toTimestampMs,
  MAX_MANUAL_HIGHLIGHTS,
});

const {
  buildHistoryViewSource,
  buildHistoryQuality,
  buildResumeReloadSafety,
} = createCatalogHistoryPolicy({
  normalizeHistoryMode,
  getSessionRolloutMemoryMode,
  getSessionRolloutEventMode,
});

const {
  createSessionDocument,
  ensureTurn,
  noteSearchBucket,
  noteRolloutPersistence,
  noteTurnTool,
  normalizeTouchedFilePath,
  noteTurnFile,
  noteSessionFile,
  createPathRoleBuckets,
  clonePathRoleBuckets,
  normalizePathRole,
  addPathRoleValue,
  addPathRoleValues,
  getCommandPathRoles,
  getPathRoleValues,
  getEntityPathValueRoles,
  getEntityPathPatternValueRoles,
  noteTurnQuery,
  normalizeReferencedPath,
  normalizeReferencedPathPattern,
  deriveRelativeDisplayPath,
  isPathWithinProject,
  deriveProjectDisplayPath,
  deriveProjectFocusRoot,
  deriveProjectPatternFocusRoot,
  mergeFocusRootStats,
  sortFocusRootStats,
  collectEntityFocusRoots,
  collectEntityFileFocusRoots,
  collectEntityFocusRootStats,
  collectEntityFileFocusRootStats,
  summarizeEntityFocusRoots,
  derivePrimaryEntityFocusRoot,
  normalizeProjectAreaValue,
  getRequestedProjectArea,
  matchesProjectAreaValue,
  getEntityProjectAreaRoot,
  noteTurnPath,
  noteSessionPath,
  noteTurnPathPattern,
  noteSessionPathPattern,
  noteTurnCommandType,
  summarizeTurn,
  finalizeSession,
} = createCatalogSessionState({
  path,
  os,
  prefixedSessionId,
  extractSessionIdFromFilePath,
  extractRolloutKeyFromFilePath,
  normalizeHistoryMode,
  normalizeRolloutMemoryMode,
  summarizeText,
  addUnique,
  looksLikeGlobPath,
  matchesPathValue,
  getEntityPathArtifacts,
  getEntityPathPatternArtifacts,
  toTimestampMs,
  SESSION_DOC_SCHEMA_VERSION,
  PATH_ROLE_ORDER,
  COMMAND_TYPE_PATH_ROLE_MAP,
  EXTENDED_EVENT_PERSISTENCE_KEYS,
  FOCUS_ROOT_SIGNAL_SCORES,
  MAX_UNIQUE_VALUES,
  MAX_TURN_ITEMS,
  MAX_PATH_ARTIFACTS,
  MAX_SEARCH_TEXT_CHARS,
});

const {
  buildNormalizedErrorSearchValues,
  buildNormalizedErrorDetail,
  errorEntryMatchesNeedle,
  getRecordErrorSearchValues,
  getTranscriptItemErrorSearchValues,
  summarizeCatalogEvent,
  compactCatalogEvents,
  buildTranscriptItem,
  mergeTranscriptToolItem,
  canDeduplicateTranscriptMessagePair,
  mergeTranscriptMessageItem,
  appServerSecondsToIso,
  normalizeAppServerEnumValue,
  summarizeAppServerUserContent,
  summarizeStructuredValue,
  summarizeAppServerReasoning,
  summarizeAppServerContentBlocks,
  summarizeAppServerDynamicContent,
  normalizeAppServerMemoryCitation,
  normalizeAppServerTurnError,
  getTranscriptItemMemoryCitationPaths,
  getTranscriptItemMemoryCitationSearchValues,
} = createCatalogTimelineHelpers({
  summarizeRecord,
  getRecordReferencedPaths,
  getRecordReferencedPathPatterns,
  summarizeText,
  clonePathRoleBuckets,
  sortCommandOpValues,
  mergeUniqueTextValues,
  createPathRoleBuckets,
  PATH_ROLE_ORDER,
  MAX_PATH_ARTIFACTS,
  toTimestampMs,
  normalizeCwdValue,
  normalizeReferencedPath,
  addUnique,
});

const {
  loadRolloutObjects,
  readNormalizedSessionEvents,
  selectNormalizedEvents,
  buildSessionDocumentFromFile,
} = createCatalogRolloutBuild({
  fs,
  prefixedSessionId,
  extractSessionIdFromFilePath,
  normalizeHistoryMode,
  normalizeRecordObject,
  logEventMap: codexConfig.logEventMap,
  createSessionDocument,
  finalizeSession,
  toTimestampMs,
  noteSearchBucket,
  noteRolloutPersistence,
  ensureTurn,
  summarizeText,
  addUnique,
  noteTurnTool,
  getCommandPathRoles,
  normalizeReferencedPath,
  normalizeReferencedPathPattern,
  pushBounded,
  MAX_RECENT_COMMANDS,
  MAX_TURN_ITEMS,
  MAX_COMMAND_ARTIFACTS,
  noteTurnCommandType,
  noteSessionPath,
  noteTurnPath,
  MAX_PATH_ARTIFACTS,
  noteSessionPathPattern,
  noteTurnPathPattern,
  noteTurnFile,
  normalizeTouchedFilePath,
  noteSessionFile,
  noteTurnQuery,
  MAX_RECENT_QUERIES,
  MAX_QUERY_ARTIFACTS,
  buildNormalizedErrorDetail,
  buildNormalizedErrorSearchValues,
  MAX_RECENT_ERRORS,
  MAX_ERROR_ARTIFACTS,
});

const {
  matchesAnnotationFilters,
  hasAnnotationScopedFilters,
  clearAnnotationScopedFilters,
  resolveRequestedPathRole,
  getRequestedPathPattern,
  hasSessionScopeFilters,
  matchesSessionFilters,
  getRequestedCommandOpSignal,
  getRequestedQuery,
  getRequestedQMode,
  getRequestedQueryMode,
  getMatchingQueryValues,
  getTranscriptItemQueryCandidates,
  getMatchingFileValues,
  getMatchingCommandOps,
  matchesCommandOpFilters,
  getEntityPathCandidates,
  getEntityPathPatternCandidates,
  getMatchingPathValues,
  getMatchingPathPatternValues,
  getMatchingTranscriptItemFileValues,
  matchesEntityPathFilters,
  matchesEntityPathPatternFilters,
  sessionMatches,
  eventMatches,
  hasTurnScopedFilters,
  turnMatches,
} = createCatalogMatchers({
  prefixedSessionId,
  normalizeRolloutMemoryMode,
  normalizeRolloutEventMode,
  getSessionRolloutMemoryMode,
  getSessionRolloutEventMode,
  normalizeSessionQualityClass,
  classifySessionQuality,
  getSessionTags,
  resolveRequestedSessionTag,
  getEntityAnnotation,
  matchesPathNeedle,
  normalizeSearchMode,
  buildQuerySearchCandidates,
  findSearchCandidateMatches,
  getSessionQuerySearchCandidates,
  getSessionFindSearchCandidates,
  getSessionKey,
  normalizeCwdValue,
  normalizePathRole,
  getPathRoleValues,
  getEntityPathArtifacts,
  getEntityPathPatternArtifacts,
  getEntityCommandOpArtifacts,
  getTranscriptItemMemoryCitationPaths,
  sortCommandOpValues,
  classifyCommandOpSignal,
  getRecordReferencedPaths,
  getRecordReferencedPathPatterns,
  getRecordErrorSearchValues,
  errorEntryMatchesNeedle,
  normalizeReferencedPath,
  normalizeReferencedPathPattern,
  toTimestampMs,
});

const {
  buildSessionLineageMetadata,
  mapToTopList,
  buildCatalogFacets,
  getEntityErrorArtifactCandidates,
  buildArtifactCatalog,
  buildProjectCatalog,
  buildHistoricalCatalog,
} = createCatalogBuild({
  prefixedSessionId,
  toTimestampMs,
  getEntityPathArtifacts,
  getEntityPathPatternArtifacts,
  getEntityPathValueRoles,
  getEntityPathPatternValueRoles,
  getSessionRolloutMemoryMode,
  getSessionRolloutEventMode,
  getSessionTags,
  classifySessionQuality,
  classifyPathPatternValue,
  classifyCommandOpSignal,
  classifyQuerySignal,
  getQuerySignalRank,
  buildNormalizedErrorSearchValues,
  normalizeArtifactValue,
  isPathWithinProject,
  deriveProjectDisplayPath,
  deriveRelativeDisplayPath,
  collectEntityFocusRootStats,
  mergeFocusRootStats,
  sortFocusRootStats,
  normalizeHistoryMode,
  resolveSessionDir,
  listRolloutFiles,
  buildSessionDocumentFromFile,
  PATH_ROLE_ORDER,
  MAX_ARTIFACT_SESSION_REFS,
  MAX_PROJECT_SESSION_REFS,
  MAX_PROJECT_SEARCH_TEXT_CHARS,
  MAX_ERROR_ARTIFACTS,
});

const {
  summarizeProjectTurn,
  summarizeProjectTurnCompact,
  listCatalogProjects,
  listCatalogProjectAreas,
  getCatalogProject,
  getCatalogArea,
  searchCatalogTurns,
} = createCatalogProjectViews({
  resolveCatalogForHistoryMode,
  normalizeHistoryMode,
  normalizeOffset,
  normalizeResultShape,
  getRequestedQueryMode,
  normalizeCwdValue,
  resolveRequestedPathRole,
  getRequestedPathPattern,
  getRequestedQuery,
  getRequestedProjectArea,
  normalizeProjectAreaValue,
  matchesProjectAreaValue,
  getEntityProjectAreaRoot,
  matchesSessionFilters,
  getMatchingFileValues,
  getMatchingPathValues,
  getMatchingPathPatternValues,
  getMatchingQueryValues,
  matchesCommandOpFilters,
  getEntityCommandOpArtifacts,
  errorEntryMatchesNeedle,
  toTimestampMs,
  matchesPathNeedle,
  getSessionKey,
  getEntityPathArtifacts,
  getEntityPathPatternArtifacts,
  sortCommandOpValues,
  summarizeSession,
  summarizeSessionCompact,
  clonePathRoleBuckets,
  getEntityAnnotation,
  hasTurnScopedFilters,
  sessionMatches,
  turnMatches,
  buildProjectManualSummary,
  buildProjectManualBrowseSummary,
  shapeCompactPreview,
  COMPACT_SUMMARY_CHARS,
  COMPACT_SUMMARY_LINES,
  MAX_PROJECT_SESSION_REFS,
  MAX_PROJECT_TURN_REFS,
  MAX_PROJECT_AREA_REFS,
  MAX_PROJECT_AREA_SESSION_REFS,
  MAX_PROJECT_AREA_VALUE_REFS,
  MAX_UNSCOPED_AREA_SAMPLES,
  DEFAULT_RESULT_LIMIT,
  mapToTopList,
  deriveRelativeDisplayPath,
  isPathWithinProject,
  deriveProjectDisplayPath,
  deriveProjectFocusRoot,
  deriveProjectPatternFocusRoot,
  normalizeReferencedPathPattern,
  PROJECT_AREA_REASON_NOTES,
});

const {
  listCatalogSessions,
  getCatalogSessionMatches,
  getCatalogSession,
  getCatalogTurns,
  getCatalogTurn,
  getCatalogEvents,
} = createCatalogSessionViews({
  resolveCatalogForHistoryMode,
  normalizeHistoryMode,
  normalizeOffset,
  normalizeResultShape,
  getRequestedQMode,
  getRequestedQueryMode,
  sessionMatches,
  summarizeSession,
  summarizeSessionCompact,
  summarizeLowSignalQueryMatches,
  normalizeSessionLookupValue,
  normalizePathComparisonValue,
  prefixedSessionId,
  getSessionKey,
  clonePathRoleBuckets,
  sortCommandOpValues,
  getEntityAnnotation,
  hasTurnScopedFilters,
  turnMatches,
  getRequestedPathPattern,
  readNormalizedSessionEvents,
  selectNormalizedEvents,
  eventMatches,
  summarizeCatalogEvent,
  compactCatalogEvents,
  matchesAnnotationFilters,
  hasAnnotationScopedFilters,
  DEFAULT_RESULT_LIMIT,
  DEFAULT_EVENT_LIMIT,
  toTimestampMs,
});


function mergeUniqueTextValues(left, right, limit = MAX_UNIQUE_VALUES) {
  const values = [];
  for (const list of [left, right]) {
    for (const value of Array.isArray(list) ? list : []) {
      addUnique(values, value, limit);
    }
  }
  return values;
}

const {
  buildAppServerThreadView,
} = createCatalogAppServerThreadView({
  looksLikeGlobPath,
  summarizeText,
  inferShellCommandStructure,
  prefixedSessionId,
  normalizeSessionSource,
  normalizeAppServerTurnError,
  getTranscriptItemMemoryCitationSearchValues,
  createSessionDocument,
  extractRolloutKeyFromFilePath,
  appServerSecondsToIso,
  normalizeCwdValue,
  getEntityAnnotation,
  noteSearchBucket,
  ensureTurn,
  normalizeAppServerEnumValue,
  summarizeAppServerUserContent,
  normalizeAppServerMemoryCitation,
  summarizeAppServerReasoning,
  getCommandPathRoles,
  addUnique,
  noteTurnTool,
  pushBounded,
  MAX_RECENT_COMMANDS,
  MAX_TURN_ITEMS,
  MAX_COMMAND_ARTIFACTS,
  noteTurnCommandType,
  noteSessionPath,
  noteTurnPath,
  MAX_PATH_ARTIFACTS,
  noteSessionPathPattern,
  noteTurnPathPattern,
  MAX_RECENT_QUERIES,
  noteTurnQuery,
  MAX_QUERY_ARTIFACTS,
  clonePathRoleBuckets,
  createPathRoleBuckets,
  noteTurnFile,
  noteSessionFile,
  summarizeAppServerContentBlocks,
  summarizeStructuredValue,
  summarizeAppServerDynamicContent,
  normalizeReferencedPath,
  normalizeReferencedPathPattern,
  canDeduplicateTranscriptMessagePair,
  mergeTranscriptMessageItem,
  toTimestampMs,
  finalizeSession,
  buildNormalizedErrorSearchValues,
  MAX_RECENT_ERRORS,
  MAX_ERROR_ARTIFACTS,
});

const {
  buildTranscriptResultFromSessionData,
  buildResumeResultFromSessionData,
  getCatalogTranscript,
  getCatalogResume,
} = createCatalogHistoryViews({
  prefixedSessionId,
  getCatalogSessionMatches,
  resolveCatalogForHistoryMode,
  getRequestedQueryMode,
  matchesAnnotationFilters,
  hasAnnotationScopedFilters,
  clearAnnotationScopedFilters,
  hasTurnScopedFilters,
  turnMatches,
  summarizeSession,
  buildHistoryQuality,
  normalizeHistoryMode,
  buildHistoryViewSource,
  resolveRequestedPathRole,
  getRequestedPathPattern,
  getRequestedQuery,
  getMatchingTranscriptItemFileValues,
  getMatchingPathValues,
  getTranscriptItemMemoryCitationPaths,
  getMatchingPathPatternValues,
  getMatchingCommandOps,
  sortCommandOpValues,
  getMatchingQueryValues,
  getTranscriptItemQueryCandidates,
  getTranscriptItemErrorSearchValues,
  getTranscriptItemMemoryCitationSearchValues,
  readNormalizedSessionEvents,
  selectNormalizedEvents,
  buildTranscriptItem,
  canDeduplicateTranscriptMessagePair,
  mergeTranscriptMessageItem,
  mergeTranscriptToolItem,
  normalizeTrimStrategy,
  shapeText,
  normalizePositiveInt,
  normalizeArtifactValue,
  clonePathRoleBuckets,
  normalizeCwdValue,
  normalizePathRole,
  getPathRoleValues,
  summarizeTurn,
  buildResumeReloadSafety,
  toTimestampMs,
  isLowSignalRelatedCommand,
  DEFAULT_EVENT_LIMIT,
  DEFAULT_RESUME_TOTAL_CHARS,
  DEFAULT_RESUME_ITEM_CHARS,
  DEFAULT_RESUME_TOOL_CHARS,
  DEFAULT_RESUME_LINE_LIMIT,
  DEFAULT_RESUME_TURN_LIMIT,
  DEFAULT_RESUME_ITEM_LIMIT,
  DEFAULT_RESUME_HIGHLIGHT_LIMIT,
  DEFAULT_RESUME_TOOL_TEXT_MODE,
  PATH_ROLE_ORDER,
  RESUME_PATH_ROLE_ORDER,
});

function getRecordReferencedPaths(record, resolvedCwd = "") {
  const baseCwd = resolvedCwd || record.cwd || "";
  const commandPaths = Array.isArray(record.commandPaths)
    ? record.commandPaths
      .map((value) => normalizeReferencedPath(baseCwd, value))
      .filter(Boolean)
    : [];
  const patchPaths = record.patch && Array.isArray(record.patch.files)
    ? record.patch.files
      .map((file) => normalizeReferencedPath(baseCwd, file && file.path))
      .filter(Boolean)
    : [];
  const pathRoles = createPathRoleBuckets();
  const commandPathRoles = getCommandPathRoles(record.commandTypes);
  if (!commandPathRoles.length && commandPaths.length) {
    const toolName = typeof record.toolName === "string" ? record.toolName.trim().toLowerCase() : "";
    if (toolName === "image_view" || toolName === "view_image") {
      commandPathRoles.push("read");
    }
  }
  for (const candidate of commandPaths) addPathRoleValues(pathRoles, commandPathRoles, candidate, 20);
  for (const candidate of patchPaths) addPathRoleValue(pathRoles, "write", candidate, 20);
  const allPaths = [];
  for (const candidate of [...commandPaths, ...patchPaths]) {
    if (!allPaths.some((value) => matchesArtifactValue(value, candidate))) {
      allPaths.push(candidate);
    }
  }
  return {
    commandPaths,
    patchPaths,
    allPaths,
    pathRoles,
  };
}

function getRecordReferencedPathPatterns(record, resolvedCwd = "") {
  const baseCwd = resolvedCwd || record.cwd || "";
  const commandPathPatterns = Array.isArray(record.commandPathPatterns)
    ? record.commandPathPatterns
      .map((value) => normalizeReferencedPathPattern(baseCwd, value) || value)
      .filter(Boolean)
    : [];
  const pathPatternRoles = createPathRoleBuckets();
  const commandPathRoles = getCommandPathRoles(record.commandTypes);
  for (const candidate of commandPathPatterns) addPathRoleValues(pathPatternRoles, commandPathRoles, candidate, 20);
  return {
    commandPathPatterns,
    pathPatternRoles,
  };
}
const {
  getCatalogArtifactTurns,
  getCatalogArtifact,
  getCatalogPathThread,
  listCatalogArtifacts,
} = createCatalogArtifactViews({
  path,
  summarizeText,
  prefixedSessionId,
  normalizeHistoryMode,
  resolveCatalogForHistoryMode,
  normalizeArtifactKind,
  normalizeArtifactValue,
  matchesArtifactValue,
  normalizeOffset,
  normalizeResultShape,
  normalizeCwdValue,
  normalizeReferencedPath,
  matchesPathValue,
  matchesPathNeedle,
  normalizePathRole,
  getPathRoleValues,
  resolveRequestedPathRole,
  getRequestedPathPattern,
  getRequestedCommandOpSignal,
  getCommandOpSignalRank,
  getQuerySignalRank,
  getPathPatternQuerySortScore,
  getQueryArtifactSortScore,
  classifyCommandOpSignal,
  classifyPathPatternValue,
  classifyQuerySignal,
  matchesSessionFilters,
  matchesEntityPathFilters,
  hasSessionScopeFilters,
  getEntityPathArtifacts,
  getEntityPathPatternArtifacts,
  getEntityPathCandidates,
  getEntityPathPatternCandidates,
  getEntityPathValueRoles,
  getEntityPathPatternValueRoles,
  getEntityErrorArtifactCandidates,
  getMatchingCommandOps,
  getEntityAnnotation,
  summarizeProjectTurnCompact,
  summarizeSessionCompact,
  getSessionKey,
  readNormalizedSessionEvents,
  selectNormalizedEvents,
  summarizeCatalogEvent,
  compactCatalogEvents,
  getRecordReferencedPaths,
  toTimestampMs,
  DEFAULT_RESULT_LIMIT,
  DEFAULT_THREAD_EVENT_LIMIT,
  MAX_ARTIFACT_SESSION_REFS,
  MAX_TURN_ITEMS,
});

function normalizeRelatedCommand(command) {
  return typeof command === "string" ? command.replace(/\s+/g, " ").trim() : "";
}

function isLowSignalRelatedCommand(command) {
  const text = normalizeRelatedCommand(command);
  if (!text) return true;
  return (
    /^git status(?: --short)?$/i.test(text) ||
    /^git diff(?: --stat| --name-only)?$/i.test(text) ||
    /^pwd$/i.test(text) ||
    /^ls(?: -[A-Za-z-]+)?$/i.test(text)
  );
}

const {
  getCatalogFamily,
  getCatalogRelatedSessions,
  getCatalogWorkstream,
} = createCatalogRelatedViews({
  normalizeArtifactValue,
  isLowSignalRelatedCommand,
  getEntityPathArtifacts,
  mergeUniqueTextValues,
  MAX_RELATED_SHARED_VALUES,
  toTimestampMs,
  MAX_RELATED_TURN_REFS,
  resolveCatalogForHistoryMode,
  prefixedSessionId,
  normalizeOffset,
  normalizeResultShape,
  normalizeCwdValue,
  matchesSessionFilters,
  summarizeSessionCompact,
  summarizeSession,
  normalizeHistoryMode,
  DEFAULT_RESULT_LIMIT,
  getCatalogSessionMatches,
  getRequestedQueryMode,
  getRequestedProjectArea,
  hasTurnScopedFilters,
  matchesProjectAreaValue,
  getEntityProjectAreaRoot,
  sessionMatches,
  turnMatches,
  summarizeProjectTurnCompact,
  summarizeProjectTurn,
  MAX_PROJECT_TURN_REFS,
  getEntityAnnotationPriority,
  addUnique,
  buildWorkstreamManualSummary,
});

module.exports = {
  normalizeHistoryMode,
  SESSION_DOC_SCHEMA_VERSION,
  buildSessionLineageMetadata,
  resolveSessionDir,
  listRolloutFiles,
  loadRolloutObjects,
  extractSessionIdFromFilePath,
  buildSessionDocumentFromFile,
  buildCatalogFacets,
  buildArtifactCatalog,
  buildProjectCatalog,
  buildHistoricalCatalog,
  summarizeEntityFocusRoots,
  derivePrimaryEntityFocusRoot,
  listCatalogProjects,
  listCatalogProjectAreas,
  searchCatalogTurns,
  listCatalogSessions,
  listCatalogArtifacts,
  getCatalogArtifact,
  getCatalogArtifactTurns,
  getCatalogPathThread,
  getCatalogRelatedSessions,
  getCatalogTurn,
  getCatalogProject,
  getCatalogArea,
  getCatalogFamily,
  getCatalogWorkstream,
  getCatalogSession,
  getCatalogTurns,
  getCatalogEvents,
  getCatalogTranscript,
  getCatalogResume,
  hasAnnotationScopedFilters,
  buildAppServerThreadView,
  buildTranscriptResultFromSessionData,
  buildResumeResultFromSessionData,
  buildHistoryViewSource,
  buildHistoryQuality,
};
