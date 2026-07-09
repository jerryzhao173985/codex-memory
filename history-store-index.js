"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  SESSION_DOC_SCHEMA_VERSION,
  buildSessionLineageMetadata,
  resolveSessionDir,
  listRolloutFiles,
  buildSessionDocumentFromFile,
  buildCatalogFacets,
  buildArtifactCatalog,
  buildProjectCatalog,
} = require("./catalog");
const { inferCommandHints, inferShellCommandStructure, summarizeText } = require("./parser");

const HISTORY_INDEX_VERSION = 4;
const DEFAULT_HISTORY_INDEX_ROOT = path.join(os.homedir(), ".codex", "memories", "clawd-codex-history");

function resolveHistoryIndexRoot(indexRoot = DEFAULT_HISTORY_INDEX_ROOT) {
  if (typeof indexRoot !== "string" || !indexRoot) return DEFAULT_HISTORY_INDEX_ROOT;
  if (indexRoot.startsWith("~")) return path.join(os.homedir(), indexRoot.slice(1));
  return indexRoot;
}

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

function writeJsonBestEffort(filePath, value, persistenceState) {
  try {
    writeJsonAtomic(filePath, value);
    return true;
  } catch (err) {
    if (err && err.code === "ENOSPC") {
      if (persistenceState) {
        persistenceState.degraded = true;
        if (!persistenceState.errors.some((item) => item && item.code === "ENOSPC" && item.path === filePath)) {
          persistenceState.errors.push({
            code: "ENOSPC",
            path: filePath,
            message: err.message,
          });
        }
      }
      return false;
    }
    throw err;
  }
}

function removeFileQuiet(filePath) {
  try {
    fs.unlinkSync(filePath);
    return true;
  } catch {
    return false;
  }
}

function statRolloutFile(filePath) {
  try {
    const stat = fs.statSync(filePath);
    return {
      mtimeMs: stat.mtimeMs,
      size: stat.size,
    };
  } catch {
    return null;
  }
}

function isCommandEntryCompatible(entry) {
  return Boolean(
    entry &&
    typeof entry === "object" &&
    typeof entry.command === "string" &&
    Array.isArray(entry.commandTypes) &&
    Array.isArray(entry.commandTypeHints) &&
    Array.isArray(entry.commandPaths) &&
    Array.isArray(entry.commandPathPatterns) &&
    Array.isArray(entry.commandQueries) &&
    Array.isArray(entry.shellCommands)
  );
}

function isQueryEntryCompatible(entry) {
  return Boolean(
    entry &&
    typeof entry === "object" &&
    typeof entry.query === "string"
  );
}

function isTruncatedCommandPreview(command) {
  return typeof command === "string" && command.endsWith("...");
}

function getCommandEntryReuseIssue(entry) {
  if (!isCommandEntryCompatible(entry)) return "command_incompatible";
  const canInferFromCommand = !isTruncatedCommandPreview(entry.command);
  const hints = canInferFromCommand
    ? inferCommandHints(entry.command)
    : { types: [], paths: [], patterns: [], queries: [] };
  const shellStructure = canInferFromCommand
    ? inferShellCommandStructure(entry.command)
    : { shellCommands: [], commandTypeHints: [] };
  const expectedTypeHints = canInferFromCommand
    ? shellStructure.commandTypeHints.filter(
      (value) => !entry.commandTypes.includes(value)
    )
    : [];
  if (hints.types.length && !entry.commandTypes.length) return "missing_commandTypes";
  if (hints.paths.length && !entry.commandPaths.length) return "missing_commandPaths";
  if (hints.patterns.length && !entry.commandPathPatterns.length) return "missing_commandPathPatterns";
  if (hints.queries.length && !entry.commandQueries.length) return "missing_commandQueries";
  for (const shellCommand of shellStructure.shellCommands) {
    if (!entry.shellCommands.includes(shellCommand)) return "shellCommands_drift";
  }
  for (const typeHint of expectedTypeHints) {
    if (!entry.commandTypeHints.includes(typeHint)) return "commandTypeHints_drift";
  }

  for (const pathValue of entry.commandPaths) {
    if (typeof pathValue !== "string" || !pathValue.trim()) return "invalid_commandPath";
  }

  for (const patternValue of entry.commandPathPatterns) {
    if (typeof patternValue !== "string" || !patternValue.trim()) return "invalid_commandPathPattern";
  }

  const summarizedQueries = hints.queries
    .map((query) => summarizeText(query, 240))
    .filter(Boolean);
  for (const queryValue of summarizedQueries) {
    if (!entry.commandQueries.includes(queryValue)) return "missing_commandQuery_summary";
  }

  for (const queryValue of entry.commandQueries) {
    if (typeof queryValue !== "string" || !queryValue.trim()) return "invalid_commandQuery";
  }

  return null;
}

function commandEntryNeedsRebuild(entry) {
  return Boolean(getCommandEntryReuseIssue(entry));
}

function getTurnDocReuseIssue(turn) {
  if (!turn || typeof turn !== "object") return "turn:invalid";
  const requiredArrays = [
    "commands",
    "filesTouched",
    "pathsReferenced",
    "queries",
    "toolsUsed",
    "commandTypes",
    "errors",
    "commandArtifacts",
    "commandOpArtifacts",
    "pathArtifacts",
    "pathPatternArtifacts",
    "queryArtifacts",
    "errorArtifacts",
  ];
  for (const key of requiredArrays) {
    if (!Array.isArray(turn[key])) return `turn:missing_${key}`;
  }
  if (!turn.commands.every((entry) => isCommandEntryCompatible(entry))) return "turn:command_incompatible";
  if (!turn.queries.every((entry) => isQueryEntryCompatible(entry))) return "turn:query_incompatible";
  for (const entry of turn.commands) {
    const issue = getCommandEntryReuseIssue(entry);
    if (issue) return `turn:${issue}`;
  }
  return null;
}

function getSessionDocReuseIssue(doc, filePath) {
  if (!doc || typeof doc !== "object") return "doc_invalid";
  if (doc.filePath !== filePath) return "filePath_mismatch";
  if (doc.schemaVersion !== SESSION_DOC_SCHEMA_VERSION) return "schema_mismatch";
  if (!doc.rolloutPersistence || typeof doc.rolloutPersistence !== "object") return "missing_rolloutPersistence";
  if (!Array.isArray(doc.rolloutPersistence.observedEventKeys)) return "missing_observedEventKeys";

  const requiredArrays = [
    "toolsUsed",
    "filesTouched",
    "pathsReferenced",
    "commandTypes",
    "recentCommands",
    "recentQueries",
    "recentErrors",
    "commandArtifacts",
    "commandOpArtifacts",
    "pathArtifacts",
    "pathPatternArtifacts",
    "queryArtifacts",
    "errorArtifacts",
    "turns",
  ];
  for (const key of requiredArrays) {
    if (!Array.isArray(doc[key])) return `missing_${key}`;
  }
  if (!doc.recentCommands.every((entry) => isCommandEntryCompatible(entry))) return "recent:command_incompatible";
  if (!doc.recentQueries.every((entry) => isQueryEntryCompatible(entry))) return "recent:query_incompatible";
  for (const entry of doc.recentCommands) {
    const issue = getCommandEntryReuseIssue(entry);
    if (issue) return `recent:${issue}`;
  }
  for (const turn of doc.turns) {
    const issue = getTurnDocReuseIssue(turn);
    if (issue) return issue;
  }
  return null;
}

function encodeSessionDocName(filePath, sessionId) {
  let fileBase = "";
  if (typeof filePath === "string") {
    fileBase = path.basename(filePath);
    if (fileBase.endsWith(".jsonl")) fileBase = fileBase.slice(0, -".jsonl".length);
    else if (fileBase.endsWith(".json")) fileBase = fileBase.slice(0, -".json".length);
  }
  if (fileBase) return `${encodeURIComponent(fileBase)}.json`;
  return `${encodeURIComponent(sessionId || "codex:unknown")}.json`;
}

function normalizeSessions(sessions) {
  sessions.sort((a, b) => {
    const bTime = toTimestampMs(b.updatedAt) || 0;
    const aTime = toTimestampMs(a.updatedAt) || 0;
    if (bTime !== aTime) return bTime - aTime;
    return (b.filePath || "").localeCompare(a.filePath || "");
  });
  return sessions;
}

function buildCatalogFromSessions(sessions, sessionDir, generatedAt = new Date().toISOString()) {
  const normalized = normalizeSessions(sessions.slice());
  buildSessionLineageMetadata(normalized);
  return {
    generatedAt,
    historyMode: "effective",
    sessionDir,
    sessionCount: normalized.length,
    sessions: normalized,
    facets: buildCatalogFacets(normalized),
    artifacts: buildArtifactCatalog(normalized),
    projects: buildProjectCatalog(normalized),
  };
}

function buildRolloutPersistenceStats(sessions) {
  const memoryModeCounts = {};
  const eventModeCounts = {};
  let extendedEventSessions = 0;

  for (const session of Array.isArray(sessions) ? sessions : []) {
    const persistence = session && session.rolloutPersistence && typeof session.rolloutPersistence === "object"
      ? session.rolloutPersistence
      : null;
    if (!persistence) continue;

    const memoryMode = typeof persistence.memoryMode === "string" && persistence.memoryMode.trim()
      ? persistence.memoryMode.trim()
      : "enabled";
    memoryModeCounts[memoryMode] = (memoryModeCounts[memoryMode] || 0) + 1;
    const eventMode = typeof persistence.eventMode === "string" && persistence.eventMode.trim()
      ? persistence.eventMode.trim()
      : "limited_or_unknown";
    eventModeCounts[eventMode] = (eventModeCounts[eventMode] || 0) + 1;
    if (persistence.extendedObserved === true) extendedEventSessions += 1;
  }

  return {
    memoryModeCounts,
    eventModeCounts,
    extendedEventSessions,
  };
}

function buildPersistentHistoryIndex(options = {}) {
  const sessionDir = resolveSessionDir(options.sessionDir);
  const indexRoot = resolveHistoryIndexRoot(options.indexRoot);
  // Recovery lever: ignore doc reuse and re-derive every session from its
  // rollout. Annotations live in a separate overlay file and are untouched.
  const forceRebuild = options.forceRebuild === true;
  const manifestPath = path.join(indexRoot, "manifest.json");
  const artifactsPath = path.join(indexRoot, "artifacts.json");
  const projectsPath = path.join(indexRoot, "projects.json");
  const sessionsDir = path.join(indexRoot, "sessions");
  const previousManifest = readJson(manifestPath);
  const canReusePrevious = previousManifest &&
    previousManifest.version === HISTORY_INDEX_VERSION &&
    previousManifest.files &&
    typeof previousManifest.files === "object";
  const previousFiles = canReusePrevious
    ? previousManifest.files
    : {};
  const rolloutFiles = listRolloutFiles(sessionDir, options);
  const sessions = [];
  const persistenceState = {
    degraded: false,
    errors: [],
  };
  const nextFiles = {};
  const reuseFailureCounts = {};
  const reuseFailureSamples = {};
  let reuseCandidates = 0;
  let reuseFailures = 0;
  let reusedFiles = 0;
  let rebuiltFiles = 0;
  let skippedFiles = 0;

  for (const filePath of rolloutFiles) {
    const stat = statRolloutFile(filePath);
    if (!stat) {
      skippedFiles += 1;
      continue;
    }

    const previousEntry = previousFiles[filePath];
    let sessionDoc = null;
    let docPath = previousEntry && typeof previousEntry.docPath === "string"
      ? previousEntry.docPath
      : null;
    let buildStatus = "rebuilt";
    let buildReason = previousEntry ? "rollout_changed" : "new_or_reset";
    let shouldWriteDoc = false;

    if (forceRebuild && previousEntry) {
      buildReason = "forced_rebuild";
    }

    if (
      !forceRebuild &&
      previousEntry &&
      previousEntry.mtimeMs === stat.mtimeMs &&
      previousEntry.size === stat.size &&
      docPath
    ) {
      reuseCandidates += 1;
      const reused = readJson(path.join(indexRoot, docPath));
      const reuseIssue = getSessionDocReuseIssue(reused, filePath);
      if (!reuseIssue) {
        sessionDoc = reused;
        reusedFiles += 1;
        buildStatus = "reused";
        buildReason = "";
      } else {
        reuseFailures += 1;
        reuseFailureCounts[reuseIssue] = (reuseFailureCounts[reuseIssue] || 0) + 1;
        if (!reuseFailureSamples[reuseIssue]) reuseFailureSamples[reuseIssue] = filePath;
        buildReason = reuseIssue;
      }
    }

    if (!sessionDoc) {
      sessionDoc = buildSessionDocumentFromFile(filePath);
      if (!sessionDoc) {
        skippedFiles += 1;
        continue;
      }
      rebuiltFiles += 1;
      docPath = path.join("sessions", encodeSessionDocName(filePath, sessionDoc.sessionId));
      shouldWriteDoc = true;
    }

    sessionDoc.filePath = filePath;
    if (shouldWriteDoc) writeJsonBestEffort(path.join(indexRoot, docPath), sessionDoc, persistenceState);
    nextFiles[filePath] = {
      mtimeMs: stat.mtimeMs,
      size: stat.size,
      sessionId: sessionDoc.sessionId,
      docPath,
      buildStatus,
      buildReason,
    };
    sessions.push(sessionDoc);
  }

  let removedFiles = 0;
  if (!persistenceState.degraded && fs.existsSync(sessionsDir)) {
    const knownDocPaths = new Set(Object.values(nextFiles).map((entry) => entry.docPath));
    for (const entry of fs.readdirSync(sessionsDir, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const relativePath = path.join("sessions", entry.name);
      if (knownDocPaths.has(relativePath)) continue;
      if (removeFileQuiet(path.join(indexRoot, relativePath))) removedFiles += 1;
    }
  }

  const generatedAt = new Date().toISOString();
  const catalog = buildCatalogFromSessions(sessions, sessionDir, generatedAt);
  const persistenceStats = buildRolloutPersistenceStats(catalog.sessions);
  writeJsonBestEffort(artifactsPath, catalog.artifacts, persistenceState);
  writeJsonBestEffort(projectsPath, catalog.projects, persistenceState);

  const manifest = {
    version: HISTORY_INDEX_VERSION,
    sessionDocSchemaVersion: SESSION_DOC_SCHEMA_VERSION,
    generatedAt,
    sessionDir,
    indexRoot,
    fileCount: rolloutFiles.length,
    sessionCount: catalog.sessionCount,
    files: nextFiles,
    facets: catalog.facets,
    stats: {
      reusedFiles,
      reuseCandidates,
      reuseFailures,
      reuseFailureCounts,
      reuseFailureSamples,
      persistenceDegraded: persistenceState.degraded,
      persistenceErrors: persistenceState.errors,
      rebuiltFiles,
      skippedFiles,
      removedFiles,
      projectCount: catalog.projects.length,
      artifactCounts: catalog.artifacts.counts,
      memoryModeCounts: persistenceStats.memoryModeCounts,
      eventModeCounts: persistenceStats.eventModeCounts,
      extendedEventSessions: persistenceStats.extendedEventSessions,
    },
  };
  writeJsonBestEffort(manifestPath, manifest, persistenceState);

  return { catalog, manifest };
}

module.exports = {
  HISTORY_INDEX_VERSION,
  DEFAULT_HISTORY_INDEX_ROOT,
  resolveHistoryIndexRoot,
  buildCatalogFromSessions,
  buildRolloutPersistenceStats,
  buildPersistentHistoryIndex,
};
