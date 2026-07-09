"use strict";

function createCatalogSessionSummary(deps = {}) {
  const {
    normalizeHistoryMode,
    getQueryMatchSignalTier,
    getSessionKey,
    getEntityPathArtifacts,
    sortCommandOpValues,
    shapeCompactPreview,
    toTimestampMs,
    MAX_MANUAL_HIGHLIGHTS,
  } = deps;

  function clonePathRoleBuckets(pathRoles) {
    const cloned = {
      read: [],
      search_scope: [],
      list_scope: [],
      write: [],
    };
    if (!pathRoles || typeof pathRoles !== "object") return cloned;
    for (const [role, values] of Object.entries(pathRoles)) {
      cloned[role] = Array.isArray(values) ? values.slice() : [];
    }
    return cloned;
  }

  function normalizeRolloutMemoryMode(value) {
    const text = typeof value === "string"
      ? value.trim().toLowerCase().replace(/[\s-]+/g, "_")
      : "";
    if (!text) return "";
    if (text === "enable") return "enabled";
    if (text === "disable") return "disabled";
    return text;
  }

  function normalizeRolloutEventMode(value) {
    const text = typeof value === "string"
      ? value.trim().toLowerCase().replace(/[\s-]+/g, "_")
      : "";
    if (!text) return "";
    if (text === "extended") return "extended_observed";
    if (text === "limited" || text === "unknown") return "limited_or_unknown";
    return text;
  }

  function getSessionRolloutMemoryMode(sessionLike) {
    if (!sessionLike || typeof sessionLike !== "object") return "";
    const rolloutPersistence = sessionLike.rolloutPersistence && typeof sessionLike.rolloutPersistence === "object"
      ? sessionLike.rolloutPersistence
      : null;
    return normalizeRolloutMemoryMode(
      rolloutPersistence && typeof rolloutPersistence.memoryMode === "string"
        ? rolloutPersistence.memoryMode
        : sessionLike.memoryMode
    );
  }

  function getSessionRolloutEventMode(sessionLike) {
    if (!sessionLike || typeof sessionLike !== "object") return "";
    const rolloutPersistence = sessionLike.rolloutPersistence && typeof sessionLike.rolloutPersistence === "object"
      ? sessionLike.rolloutPersistence
      : null;
    return normalizeRolloutEventMode(
      rolloutPersistence && typeof rolloutPersistence.eventMode === "string"
        ? rolloutPersistence.eventMode
        : sessionLike.eventMode
    );
  }

  function getSessionTags(sessionLike) {
    return Array.isArray(sessionLike && sessionLike.tags) ? sessionLike.tags : [];
  }

  function cloneAnnotation(annotation) {
    if (!annotation || typeof annotation !== "object") return null;
    const tags = Array.isArray(annotation.tags)
      ? annotation.tags.filter((item) => typeof item === "string" && item.trim())
      : [];
    const note = typeof annotation.note === "string" && annotation.note.trim()
      ? annotation.note.trim()
      : "";
    const bookmarked = annotation.bookmarked === true;
    const updatedAt = typeof annotation.updatedAt === "string" && annotation.updatedAt
      ? annotation.updatedAt
      : null;
    if (!bookmarked && !tags.length && !note) return null;
    return {
      bookmarked,
      tags,
      note,
      updatedAt,
    };
  }

  function getEntityAnnotation(entity) {
    return cloneAnnotation(entity && entity.annotation);
  }

  function normalizeAnnotationTagValue(value) {
    return typeof value === "string"
      ? value.trim().toLowerCase()
      : "";
  }

  function getEntityAnnotationPriority(entity) {
    const annotation = getEntityAnnotation(entity);
    if (!annotation) return 0;
    let priority = 0;
    if (annotation.bookmarked) priority += 100;
    if (Array.isArray(annotation.tags) && annotation.tags.length) {
      priority += Math.min(20, annotation.tags.length * 5);
    }
    if (annotation.note) priority += 3;
    return priority;
  }

  function collectAnnotationTagCounts(entities, limit = 10) {
    const counts = new Map();
    for (const entity of Array.isArray(entities) ? entities : []) {
      const annotation = getEntityAnnotation(entity);
      for (const tag of Array.isArray(annotation && annotation.tags) ? annotation.tags : []) {
        const normalized = normalizeAnnotationTagValue(tag);
        if (!normalized) continue;
        counts.set(normalized, (counts.get(normalized) || 0) + 1);
      }
    }
    return Array.from(counts.entries())
      .map(([tag, count]) => ({ tag, count }))
      .sort((left, right) => right.count - left.count || left.tag.localeCompare(right.tag))
      .slice(0, limit);
  }

  function compareManualSessionHighlights(left, right) {
    const rightPriority = getEntityAnnotationPriority(right);
    const leftPriority = getEntityAnnotationPriority(left);
    if (rightPriority !== leftPriority) return rightPriority - leftPriority;
    if ((left.workstreamRole || "") !== (right.workstreamRole || "")) {
      if ((left.workstreamRole || "") === "root") return -1;
      if ((right.workstreamRole || "") === "root") return 1;
    }
    const rightTime = toTimestampMs(right.updatedAt || right.endedAt || right.startedAt) || 0;
    const leftTime = toTimestampMs(left.updatedAt || left.endedAt || left.startedAt) || 0;
    if (rightTime !== leftTime) return rightTime - leftTime;
    return (left.sessionId || "").localeCompare(right.sessionId || "");
  }

  function compareManualTurnHighlights(left, right) {
    const rightPriority = getEntityAnnotationPriority(right);
    const leftPriority = getEntityAnnotationPriority(left);
    if (rightPriority !== leftPriority) return rightPriority - leftPriority;
    const rightTime = toTimestampMs(right && (right.endedAt || right.startedAt || right.sessionUpdatedAt)) || 0;
    const leftTime = toTimestampMs(left && (left.endedAt || left.startedAt || left.sessionUpdatedAt)) || 0;
    if (rightTime !== leftTime) return rightTime - leftTime;
    return (left.turnId || "").localeCompare(right.turnId || "");
  }

  function dedupeManualEntities(entities, getKey) {
    const seen = new Set();
    const deduped = [];
    for (const entity of Array.isArray(entities) ? entities : []) {
      if (!entity) continue;
      const key = typeof getKey === "function" ? getKey(entity) : "";
      if (key) {
        if (seen.has(key)) continue;
        seen.add(key);
      }
      deduped.push(entity);
    }
    return deduped;
  }

  function buildManualSummary(sessionEntities, turnEntities, options = {}) {
    const normalizedSessions = dedupeManualEntities(sessionEntities, (entity) =>
      getSessionKey(entity) || ""
    );
    const normalizedTurns = dedupeManualEntities(turnEntities, (entity) => {
      const sessionRef = getSessionKey(entity) || "";
      const turnRef = entity && typeof entity.turnId === "string" ? entity.turnId.trim() : "";
      return sessionRef && turnRef ? `${sessionRef}:${turnRef}` : "";
    });
    const sessionCandidates = normalizedSessions.filter((item) => getEntityAnnotationPriority(item) > 0);
    const turnCandidates = normalizedTurns.filter((item) => getEntityAnnotationPriority(item) > 0);
    const includeHighlights = options.includeHighlights !== false;
    const tagLimit = Number.isInteger(options.tagLimit) && options.tagLimit > 0
      ? options.tagLimit
      : 10;
    const summary = {
      annotatedSessions: sessionCandidates.length,
      bookmarkedSessions: sessionCandidates.filter((item) => {
        const annotation = getEntityAnnotation(item);
        return annotation && annotation.bookmarked === true;
      }).length,
      annotatedTurns: turnCandidates.length,
      bookmarkedTurns: turnCandidates.filter((item) => {
        const annotation = getEntityAnnotation(item);
        return annotation && annotation.bookmarked === true;
      }).length,
      topTags: collectAnnotationTagCounts(normalizedSessions.concat(normalizedTurns), tagLimit),
    };
    if (!includeHighlights) return summary;
    const sessionHighlights = sessionCandidates.slice().sort(compareManualSessionHighlights);
    const turnHighlights = turnCandidates.slice().sort(compareManualTurnHighlights);
    summary.sessionHighlightCount = sessionHighlights.length;
    summary.turnHighlightCount = turnHighlights.length;
    summary.sessionHighlights = sessionHighlights.slice(0, MAX_MANUAL_HIGHLIGHTS);
    summary.turnHighlights = turnHighlights.slice(0, MAX_MANUAL_HIGHLIGHTS);
    return summary;
  }

  function buildWorkstreamManualSummary(rootSummary, familySummaries, contextSummaries, turns) {
    return buildManualSummary([
      rootSummary,
      ...(Array.isArray(familySummaries) ? familySummaries : []),
      ...(Array.isArray(contextSummaries) ? contextSummaries : []),
    ], turns);
  }

  function buildProjectManualSummary(sessions, turns) {
    return buildManualSummary(sessions, turns);
  }

  function buildProjectManualBrowseSummary(sessions, turns = []) {
    const sessionEntities = Array.isArray(sessions) ? sessions.filter(Boolean) : [];
    const turnEntities = Array.isArray(turns) ? turns.filter(Boolean) : [];
    if (!turnEntities.length) {
      for (const session of sessionEntities) {
        if (!Array.isArray(session.turns)) continue;
        turnEntities.push(...session.turns);
      }
    }
    const summary = buildManualSummary(sessionEntities, turnEntities, {
      includeHighlights: false,
      tagLimit: 5,
    });
    return {
      manualCounts: {
        annotatedSessions: summary.annotatedSessions,
        bookmarkedSessions: summary.bookmarkedSessions,
        annotatedTurns: summary.annotatedTurns,
        bookmarkedTurns: summary.bookmarkedTurns,
      },
      topManualTags: summary.topTags,
    };
  }

  function resolveRequestedSessionTag(sessionLike, tag) {
    const normalized = String(tag || "").trim();
    if (!normalized) return "";
    const tags = getSessionTags(sessionLike);
    if (tags.includes(normalized)) return normalized;
    if (normalized.startsWith("has_")) return normalized;
    const prefixed = `has_${normalized}`;
    return tags.includes(prefixed) ? prefixed : normalized;
  }

  function normalizeSessionQualityClass(value) {
    const text = typeof value === "string"
      ? value.trim().toLowerCase().replace(/[\s-]+/g, "_")
      : "";
    if (!text) return "";
    if (text === "rich" || text === "extended") return "rich_extended";
    if (text === "useful" || text === "limited") return "useful_limited";
    if (text === "partial") return "partial_investigation";
    if (text === "error") return "error_only";
    if (text === "aborted") return "aborted_empty";
    if (text === "answer") return "answer_only";
    if (text === "low_signal" || text === "low") return "other_low_signal";
    return [
      "rich_extended",
      "useful_limited",
      "partial_investigation",
      "error_only",
      "aborted_empty",
      "answer_only",
      "other_low_signal",
    ].includes(text) ? text : "";
  }

  function classifySessionQuality(sessionLike) {
    const hasAnswer = Boolean(sessionLike && typeof sessionLike.finalAnswerPreview === "string"
      ? sessionLike.finalAnswerPreview.trim()
      : sessionLike && sessionLike.finalAnswerPreview);
    const tools = Array.isArray(sessionLike && sessionLike.toolsUsed) ? sessionLike.toolsUsed.length : 0;
    const turnList = Array.isArray(sessionLike && sessionLike.turns) ? sessionLike.turns.filter(Boolean) : [];
    const paths = getEntityPathArtifacts(sessionLike).length;
    const files = Array.isArray(sessionLike && sessionLike.filesTouched) ? sessionLike.filesTouched.length : 0;
    const queries = Array.isArray(sessionLike && sessionLike.queryArtifacts)
      ? sessionLike.queryArtifacts.length
      : (Array.isArray(sessionLike && sessionLike.recentQueries) ? sessionLike.recentQueries.length : 0);
    const errorCount = Number.isInteger(sessionLike && sessionLike.errorCount)
      ? sessionLike.errorCount
      : (sessionLike && sessionLike.counts && Number.isInteger(sessionLike.counts.errors) ? sessionLike.counts.errors : 0);
    const commandCount = Number.isInteger(sessionLike && sessionLike.commandCount)
      ? sessionLike.commandCount
      : (sessionLike && sessionLike.counts && Number.isInteger(sessionLike.counts.commands) ? sessionLike.counts.commands : 0);
    const patchCount = Number.isInteger(sessionLike && sessionLike.patchCount)
      ? sessionLike.patchCount
      : (sessionLike && sessionLike.counts && Number.isInteger(sessionLike.counts.patches) ? sessionLike.counts.patches : 0);
    const searchCount = Number.isInteger(sessionLike && sessionLike.searchCount)
      ? sessionLike.searchCount
      : (sessionLike && sessionLike.counts && Number.isInteger(sessionLike.counts.searches) ? sessionLike.counts.searches : 0);
    const eventMode = getSessionRolloutEventMode(sessionLike) || "";
    const lastUserPreview = sessionLike && typeof sessionLike.lastUserPreview === "string"
      ? sessionLike.lastUserPreview
      : "";
    const aborted = /<turn_aborted>/i.test(lastUserPreview) || turnList.some((turn) => turn && turn.status === "aborted");
    const hasWorkArtifacts = Boolean(tools || paths || files || queries || commandCount || patchCount || searchCount);

    if (aborted && !hasAnswer && !hasWorkArtifacts) return "aborted_empty";
    if (errorCount > 0 && !hasAnswer && !hasWorkArtifacts) return "error_only";
    if (!hasAnswer && hasWorkArtifacts) return "partial_investigation";
    if (eventMode === "extended_observed" && hasAnswer && hasWorkArtifacts) return "rich_extended";
    if (hasAnswer && hasWorkArtifacts) return "useful_limited";
    if (hasAnswer) return "answer_only";
    return "other_low_signal";
  }

  function summarizeSession(session, extra = {}) {
    const match = extra.match && typeof extra.match === "object"
      ? {
        kind: typeof extra.match.kind === "string" ? extra.match.kind : "",
        text: typeof extra.match.text === "string" ? extra.match.text : "",
      }
      : null;
    const matchSignalTier = getQueryMatchSignalTier(match);
    if (match && matchSignalTier) match.signalTier = matchSignalTier;
    return {
      historyMode: normalizeHistoryMode(session && session.historyMode),
      sessionId: session.sessionId,
      sessionKey: getSessionKey(session),
      filePath: session.filePath,
      forkedFromId: session.forkedFromId || null,
      parentThreadId: session.parentThreadId || null,
      lineageRootId: session.lineageRootId || session.sessionId || null,
      lineageDepth: Number.isInteger(session.lineageDepth) ? session.lineageDepth : 0,
      lineageFamilyCount: Number.isInteger(session.lineageFamilyCount) ? session.lineageFamilyCount : 1,
      subagentDepth: Number.isInteger(session.subagentDepth) ? session.subagentDepth : null,
      replayedSessionIds: Array.isArray(session.replayedSessionIds) ? session.replayedSessionIds : [],
      startedAt: session.startedAt,
      updatedAt: session.updatedAt,
      endedAt: session.endedAt,
      cwd: session.cwd,
      model: session.model,
      cliVersion: session.cliVersion,
      modelProvider: session.modelProvider,
      originator: session.originator,
      source: session.source || null,
      sourceKind: session.sourceKind || null,
      sourceDetail: session.sourceDetail || null,
      memoryMode: session.rolloutPersistence ? session.rolloutPersistence.memoryMode : (session.memoryMode || null),
      qualityClass: classifySessionQuality(session),
      rolloutPersistence: session.rolloutPersistence || null,
      agentNickname: session.agentNickname,
      agentRole: session.agentRole,
      agentPath: session.agentPath || null,
      git: session.gitBranch || session.gitSha || session.gitOriginUrl
        ? {
          branch: session.gitBranch || null,
          sha: session.gitSha || null,
          originUrl: session.gitOriginUrl || null,
        }
        : null,
      baseInstructionsPreview: session.baseInstructionsPreview || "",
      dynamicToolCount: Number.isInteger(session.dynamicToolCount)
        ? session.dynamicToolCount
        : ((session.dynamicToolNames || []).length || 0),
      dynamicToolNames: Array.isArray(session.dynamicToolNames) ? session.dynamicToolNames : [],
      approvalPolicy: session.approvalPolicy,
      sandboxMode: session.sandboxMode,
      reasoningEffort: session.reasoningEffort,
      summaryMode: session.summaryMode,
      turnCount: session.turnCount,
      eventCount: session.eventCount,
      counts: {
        userMessages: session.userMessageCount,
        assistantMessages: session.assistantMessageCount,
        reasoning: session.reasoningCount,
        commands: session.commandCount,
        patches: session.patchCount,
        searches: session.searchCount,
        mcp: session.mcpCount,
        errors: session.errorCount,
      },
      lastUserPreview: session.lastUserPreview,
      commentaryPreview: session.commentaryPreview,
      finalAnswerPreview: session.finalAnswerPreview,
      toolsUsed: session.toolsUsed,
      focusRoot: session.focusRoot || null,
      topFocusRoots: session.topFocusRoots || [],
      filesTouched: session.filesTouched,
      matchedFiles: Array.isArray(extra.matchedFiles) ? extra.matchedFiles : [],
      pathsReferenced: session.pathsReferenced || [],
      matchedPaths: Array.isArray(extra.matchedPaths) ? extra.matchedPaths : [],
      pathRoles: clonePathRoleBuckets(session.pathRoles),
      pathPatterns: session.pathPatternArtifacts || [],
      matchedPathPatterns: Array.isArray(extra.matchedPathPatterns) ? extra.matchedPathPatterns : [],
      pathPatternRoles: clonePathRoleBuckets(session.pathPatternRoles),
      commandTypes: session.commandTypes || [],
      commandOps: sortCommandOpValues(session.commandOpArtifacts || []),
      matchedCommandOps: Array.isArray(extra.matchedCommandOps) ? extra.matchedCommandOps : [],
      matchedQueries: Array.isArray(extra.matchedQueries) ? extra.matchedQueries : [],
      recentCommands: session.recentCommands,
      recentQueries: session.recentQueries,
      recentErrors: session.recentErrors,
      artifactSamples: {
        commands: session.commandArtifacts || [],
        paths: session.pathArtifacts || [],
        pathPatterns: session.pathPatternArtifacts || [],
        queries: session.queryArtifacts || [],
        errors: session.errorArtifacts || [],
      },
      annotation: getEntityAnnotation(session),
      tags: session.tags,
      match,
      matchScore: extra.matchScore ?? null,
      matchReasons: extra.matchReasons || [],
    };
  }

  function summarizeSessionCompact(session, extra = {}) {
    const match = extra.match && typeof extra.match === "object"
      ? {
        kind: typeof extra.match.kind === "string" ? extra.match.kind : "",
        text: typeof extra.match.text === "string" ? extra.match.text : "",
      }
      : null;
    const matchSignalTier = getQueryMatchSignalTier(match);
    if (match && matchSignalTier) match.signalTier = matchSignalTier;
    return {
      historyMode: normalizeHistoryMode(session && session.historyMode),
      sessionId: session.sessionId,
      sessionKey: getSessionKey(session),
      forkedFromId: session.forkedFromId || null,
      parentThreadId: session.parentThreadId || null,
      lineageRootId: session.lineageRootId || session.sessionId || null,
      lineageDepth: Number.isInteger(session.lineageDepth) ? session.lineageDepth : 0,
      lineageFamilyCount: Number.isInteger(session.lineageFamilyCount) ? session.lineageFamilyCount : 1,
      subagentDepth: Number.isInteger(session.subagentDepth) ? session.subagentDepth : null,
      startedAt: session.startedAt,
      updatedAt: session.updatedAt,
      endedAt: session.endedAt,
      cwd: session.cwd,
      model: session.model,
      cliVersion: session.cliVersion,
      modelProvider: session.modelProvider,
      source: session.source || null,
      sourceKind: session.sourceKind || null,
      memoryMode: session.rolloutPersistence ? session.rolloutPersistence.memoryMode : (session.memoryMode || null),
      eventMode: session.rolloutPersistence ? session.rolloutPersistence.eventMode : null,
      qualityClass: classifySessionQuality(session),
      tags: session.tags,
      gitBranch: session.gitBranch || null,
      dynamicToolCount: Number.isInteger(session.dynamicToolCount)
        ? session.dynamicToolCount
        : ((session.dynamicToolNames || []).length || 0),
      turnCount: session.turnCount,
      counts: {
        userMessages: session.userMessageCount,
        assistantMessages: session.assistantMessageCount,
        reasoning: session.reasoningCount,
        commands: session.commandCount,
        patches: session.patchCount,
        searches: session.searchCount,
        mcp: session.mcpCount,
        errors: session.errorCount,
      },
      lastUserPreview: shapeCompactPreview(session.lastUserPreview),
      commentaryPreview: shapeCompactPreview(session.commentaryPreview),
      finalAnswerPreview: shapeCompactPreview(session.finalAnswerPreview),
      toolsUsed: session.toolsUsed,
      focusRoot: session.focusRoot || null,
      commandTypes: session.commandTypes || [],
      commandOps: sortCommandOpValues(session.commandOpArtifacts || []),
      annotation: getEntityAnnotation(session),
      matchedFiles: Array.isArray(extra.matchedFiles) ? extra.matchedFiles : [],
      matchedPaths: Array.isArray(extra.matchedPaths) ? extra.matchedPaths : [],
      matchedPathPatterns: Array.isArray(extra.matchedPathPatterns) ? extra.matchedPathPatterns : [],
      matchedCommandOps: Array.isArray(extra.matchedCommandOps) ? extra.matchedCommandOps : [],
      matchedQueries: Array.isArray(extra.matchedQueries) ? extra.matchedQueries : [],
      match,
      matchScore: extra.matchScore ?? null,
      matchReasons: extra.matchReasons || [],
    };
  }

  return {
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
  };
}

module.exports = {
  createCatalogSessionSummary,
};
