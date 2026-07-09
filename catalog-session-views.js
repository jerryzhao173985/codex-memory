"use strict";

function createCatalogSessionViews(deps = {}) {
  const {
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
  } = deps;

  function listCatalogSessions(catalog, filters = {}) {
    ({ catalog } = resolveCatalogForHistoryMode(catalog, filters));
    const limit = Number.isInteger(filters.limit) && filters.limit > 0 ? filters.limit : DEFAULT_RESULT_LIMIT;
    const offset = normalizeOffset(filters.offset);
    const resultShape = normalizeResultShape(filters);
    const qMode = getRequestedQMode(filters);
    const queryMode = getRequestedQueryMode(filters);
    const matched = [];

    for (const session of catalog.sessions) {
      const match = sessionMatches(session, filters);
      if (!match) continue;
      matched.push({
        session,
        score: match.score,
        reasons: match.reasons,
        match: match.match,
        matchedFiles: match.matchedFiles,
        matchedPaths: match.matchedPaths,
        matchedPathPatterns: match.matchedPathPatterns,
        matchedCommandOps: match.matchedCommandOps,
        matchedQueries: match.matchedQueries,
      });
    }

    matched.sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return (toTimestampMs(right.session.updatedAt) || 0) - (toTimestampMs(left.session.updatedAt) || 0);
    });

    const sessions = matched.slice(offset, offset + limit).map((item) => {
      const extra = {
        match: item.match,
        matchScore: item.score,
        matchReasons: item.reasons,
        matchedFiles: item.matchedFiles,
        matchedPaths: item.matchedPaths,
        matchedPathPatterns: item.matchedPathPatterns,
        matchedCommandOps: item.matchedCommandOps,
        matchedQueries: item.matchedQueries,
      };
      return resultShape === "compact"
        ? summarizeSessionCompact(item.session, extra)
        : summarizeSession(item.session, extra);
    });
    const querySignalSummary = filters.query && queryMode === "fuzzy"
      ? summarizeLowSignalQueryMatches(sessions)
      : undefined;

    return {
      generatedAt: catalog.generatedAt,
      historyMode: normalizeHistoryMode(catalog.historyMode),
      shape: resultShape,
      qMode: filters.q ? qMode : undefined,
      queryMode: filters.query ? queryMode : undefined,
      querySignalSummary,
      offset,
      total: matched.length,
      sessions,
      facets: resultShape === "compact" ? undefined : catalog.facets,
    };
  }

  function getCatalogSessionMatches(catalog, sessionRef) {
    const needle = normalizeSessionLookupValue(sessionRef);
    if (!needle) return [];

    const keyMatches = catalog.sessions.filter((item) => getSessionKey(item) === needle);
    if (keyMatches.length) return keyMatches;

    const pathNeedle = normalizePathComparisonValue(needle);
    if (pathNeedle) {
      const pathMatches = catalog.sessions.filter(
        (item) => normalizePathComparisonValue(item.filePath) === pathNeedle
      );
      if (pathMatches.length) return pathMatches;
    }

    const sessionIdNeedle = prefixedSessionId(needle);
    if (!sessionIdNeedle) return [];
    return catalog.sessions.filter((item) => item.sessionId === sessionIdNeedle);
  }

  function getCatalogSession(catalog, sessionId, filters = {}) {
    ({ catalog } = resolveCatalogForHistoryMode(catalog, filters));
    const session = getCatalogSessionMatches(catalog, sessionId)[0];
    if (!session) return null;
    return {
      ...summarizeSession(session),
      turns: session.turns.map((turn) => ({
        turnId: turn.turnId,
        startedAt: turn.startedAt,
        endedAt: turn.endedAt,
        status: turn.status,
        cwd: turn.cwd,
        model: turn.model,
        approvalPolicy: turn.approvalPolicy,
        sandboxMode: turn.sandboxMode,
        reasoningEffort: turn.reasoningEffort,
        summaryMode: turn.summaryMode,
        userPromptPreview: turn.userPromptPreview,
        commentaryPreview: turn.commentaryPreview,
        finalAnswerPreview: turn.finalAnswerPreview,
        commands: turn.commands,
        filesTouched: turn.filesTouched,
        pathsReferenced: turn.pathsReferenced || [],
        pathRoles: clonePathRoleBuckets(turn.pathRoles),
        pathPatterns: turn.pathPatternArtifacts || [],
        pathPatternRoles: clonePathRoleBuckets(turn.pathPatternRoles),
        queries: turn.queries,
        toolsUsed: turn.toolsUsed,
        commandTypes: turn.commandTypes || [],
        commandOps: sortCommandOpValues(turn.commandOpArtifacts || []),
        errors: turn.errors,
        annotation: getEntityAnnotation(turn),
        events: turn.events,
        summary: turn.summary,
      })),
    };
  }

  function getCatalogTurns(catalog, sessionId, filters = {}) {
    ({ catalog } = resolveCatalogForHistoryMode(catalog, filters));
    const session = getCatalogSession(catalog, sessionId, filters);
    if (!session) return null;
    return {
      historyMode: normalizeHistoryMode(catalog.historyMode),
      sessionId: session.sessionId,
      sessionKey: session.sessionKey || "",
      turnCount: session.turns.length,
      turns: session.turns,
    };
  }

  function getCatalogTurn(catalog, sessionId, turnId, filters = {}) {
    ({ catalog } = resolveCatalogForHistoryMode(catalog, filters));
    const session = getCatalogSession(catalog, sessionId, filters);
    const needle = typeof turnId === "string" ? turnId.trim() : "";
    if (!session || !needle) return null;
    const queryMode = getRequestedQueryMode(filters);

    const turn = session.turns.find((item) => item.turnId === needle);
    if (!turn) return null;
    const turnMatch = hasTurnScopedFilters(filters) || filters.status
      ? turnMatches(turn, {
        q: filters.q,
        tool: filters.tool,
        file: filters.file,
        path: filters.path,
        pathPattern: getRequestedPathPattern(filters),
        pathRole: filters.pathRole || filters.path_role,
        commandOp: filters.commandOp || filters.command_op,
        commandOpSignal: filters.commandOpSignal || filters.command_op_signal,
        commandType: filters.commandType,
        query: filters.query,
        queryMode,
        error: filters.error,
        status: filters.status,
        turn: needle,
      })
      : { matchedFiles: [], matchedPaths: [], matchedPathPatterns: [], matchedCommandOps: [], matchedQueries: [] };
    if (!turnMatch) return null;

    const normalized = readNormalizedSessionEvents(session.filePath, {
      defaultCwd: session.cwd,
    });
    const visibleEvents = selectNormalizedEvents(normalized, filters.historyMode || session.historyMode);
    const events = [];

    for (let index = 0; index < visibleEvents.length; index += 1) {
      const item = visibleEvents[index];
      if (item.resolvedTurnId !== needle) continue;
      const eventMatch = eventMatches(item, {
        q: filters.q,
        tool: filters.tool,
        file: filters.file,
        path: filters.path,
        pathPattern: getRequestedPathPattern(filters),
        pathRole: filters.pathRole || filters.path_role,
        commandOp: filters.commandOp || filters.command_op,
        commandOpSignal: filters.commandOpSignal || filters.command_op_signal,
        commandType: filters.commandType,
        query: filters.query,
        queryMode,
        error: filters.error,
        kind: filters.kind,
        turn: needle,
      });
      if (!eventMatch) continue;
      events.push(summarizeCatalogEvent(
        item.record,
        item.lineNumber,
        index + 1,
        item.resolvedTurnId,
        item.resolvedCwd,
        item.includedInFinalHistory,
        eventMatch
      ));
    }
    const compactedEvents = compactCatalogEvents(events);

    const limit = Number.isInteger(filters.limit) && filters.limit > 0 ? filters.limit : DEFAULT_EVENT_LIMIT;
    return {
      generatedAt: catalog.generatedAt,
      historyMode: normalizeHistoryMode(catalog.historyMode),
      queryMode: filters.query ? queryMode : undefined,
      sessionId: session.sessionId,
      sessionKey: session.sessionKey || getSessionKey(session),
      forkedFromId: session.forkedFromId || null,
      parentThreadId: session.parentThreadId || null,
      filePath: session.filePath,
      turn: {
        turnId: turn.turnId,
        startedAt: turn.startedAt,
        endedAt: turn.endedAt,
        status: turn.status,
        cwd: turn.cwd,
        model: turn.model,
        approvalPolicy: turn.approvalPolicy,
        sandboxMode: turn.sandboxMode,
        reasoningEffort: turn.reasoningEffort,
        summaryMode: turn.summaryMode,
        userPromptPreview: turn.userPromptPreview,
        commentaryPreview: turn.commentaryPreview,
        finalAnswerPreview: turn.finalAnswerPreview,
        commands: turn.commands,
        filesTouched: turn.filesTouched,
        matchedFiles: turnMatch.matchedFiles || [],
        pathsReferenced: turn.pathsReferenced || [],
        matchedPaths: turnMatch.matchedPaths || [],
        pathRoles: clonePathRoleBuckets(turn.pathRoles),
        pathPatterns: turn.pathPatternArtifacts || [],
        matchedPathPatterns: turnMatch.matchedPathPatterns || [],
        pathPatternRoles: clonePathRoleBuckets(turn.pathPatternRoles),
        matchedQueries: turnMatch.matchedQueries || [],
        queries: turn.queries,
        toolsUsed: turn.toolsUsed,
        commandTypes: turn.commandTypes || [],
        commandOps: sortCommandOpValues(turn.commandOpArtifacts || []),
        matchedCommandOps: turnMatch.matchedCommandOps || [],
        errors: turn.errors,
        events: turn.events,
        summary: turn.summary,
      },
      matchedEvents: compactedEvents.length,
      limit,
      truncated: compactedEvents.length > limit,
      events: compactedEvents.slice(-limit),
    };
  }

  function getCatalogEvents(catalog, sessionId, filters = {}) {
    ({ catalog } = resolveCatalogForHistoryMode(catalog, filters));
    const queryMode = getRequestedQueryMode(filters);

    const session = getCatalogSessionMatches(catalog, sessionId)[0];
    if (!session) return null;

    const normalized = readNormalizedSessionEvents(session.filePath, {
      defaultCwd: session.cwd,
    });
    const visibleEvents = selectNormalizedEvents(normalized, filters.historyMode || session.historyMode);
    const matched = [];
    const sessionAnnotationMatch = matchesAnnotationFilters(session, filters);
    const turnById = new Map(
      Array.isArray(session.turns)
        ? session.turns.map((turn) => [turn.turnId, turn])
        : []
    );

    for (let index = 0; index < visibleEvents.length; index += 1) {
      const item = visibleEvents[index];
      if (hasAnnotationScopedFilters(filters)) {
        const turn = item && item.resolvedTurnId ? turnById.get(item.resolvedTurnId) || null : null;
        if (!sessionAnnotationMatch && !matchesAnnotationFilters(turn, filters)) continue;
      }
      const match = eventMatches(item, filters);
      if (!match) continue;
      matched.push(summarizeCatalogEvent(
        item.record,
        item.lineNumber,
        index + 1,
        item.resolvedTurnId,
        item.resolvedCwd,
        item.includedInFinalHistory,
        match
      ));
    }
    const compactedMatched = compactCatalogEvents(matched);

    const limit = Number.isInteger(filters.limit) && filters.limit > 0 ? filters.limit : DEFAULT_EVENT_LIMIT;
    return {
      historyMode: normalizeHistoryMode(catalog.historyMode),
      queryMode: filters.query ? queryMode : undefined,
      sessionId: session.sessionId,
      sessionKey: session.sessionKey || getSessionKey(session),
      forkedFromId: session.forkedFromId || null,
      parentThreadId: session.parentThreadId || null,
      filePath: session.filePath,
      totalEvents: visibleEvents.length,
      matchedEvents: compactedMatched.length,
      limit,
      truncated: compactedMatched.length > limit,
      events: compactedMatched.slice(-limit),
    };
  }

  return {
    listCatalogSessions,
    getCatalogSessionMatches,
    getCatalogSession,
    getCatalogTurns,
    getCatalogTurn,
    getCatalogEvents,
  };
}

module.exports = { createCatalogSessionViews };
