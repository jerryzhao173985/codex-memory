"use strict";

function createCatalogRelatedViews(deps = {}) {
  const {
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
  } = deps;

  function stripWorkstreamAnchorFilters(filters = {}) {
    return {
      ...filters,
      sessionId: "",
      sessionKey: "",
      forkedFrom: "",
      forked_from: "",
      parentThread: "",
      parent_thread: "",
      lineageRoot: "",
      lineage_root: "",
      rootSession: "",
      root_session: "",
    };
  }

  function intersectArtifactValues(left, right, limit = MAX_RELATED_SHARED_VALUES) {
    const rightValues = Array.isArray(right) ? right : [];
    const rightMap = new Map();
    for (const candidate of rightValues) {
      const normalized = normalizeArtifactValue(candidate);
      if (!normalized || rightMap.has(normalized)) continue;
      rightMap.set(normalized, typeof candidate === "string" ? candidate.trim() : candidate);
    }

    const matches = [];
    const seen = new Set();
    for (const candidate of Array.isArray(left) ? left : []) {
      const normalized = normalizeArtifactValue(candidate);
      if (!normalized || seen.has(normalized) || !rightMap.has(normalized)) continue;
      seen.add(normalized);
      matches.push(typeof candidate === "string" ? candidate.trim() : rightMap.get(normalized));
      if (matches.length >= limit) break;
    }
    return matches;
  }

  function buildSharedArtifactSummary(source, candidate) {
    return {
      files: intersectArtifactValues(source.filesTouched, candidate.filesTouched),
      paths: intersectArtifactValues(
        getEntityPathArtifacts(source),
        getEntityPathArtifacts(candidate)
      ),
      queries: intersectArtifactValues(source.queryArtifacts || [], candidate.queryArtifacts || []),
      commands: intersectArtifactValues(source.commandArtifacts || [], candidate.commandArtifacts || [])
        .filter((command) => !isLowSignalRelatedCommand(command)),
      tools: intersectArtifactValues(source.toolsUsed || [], candidate.toolsUsed || []),
    };
  }

  function mergeSharedArtifactSummary(left, right) {
    return {
      files: mergeUniqueTextValues(left && left.files, right && right.files, MAX_RELATED_SHARED_VALUES),
      paths: mergeUniqueTextValues(left && left.paths, right && right.paths, MAX_RELATED_SHARED_VALUES),
      queries: mergeUniqueTextValues(left && left.queries, right && right.queries, MAX_RELATED_SHARED_VALUES),
      commands: mergeUniqueTextValues(left && left.commands, right && right.commands, MAX_RELATED_SHARED_VALUES),
      tools: mergeUniqueTextValues(left && left.tools, right && right.tools, MAX_RELATED_SHARED_VALUES),
    };
  }

  function hasRelatedArtifactSignal(shared) {
    if ((shared.files && shared.files.length) || (shared.paths && shared.paths.length) || (shared.queries && shared.queries.length)) {
      return true;
    }
    return Boolean(shared.commands && shared.commands.length >= 2);
  }

  function scoreRelatedSession(shared) {
    return (
      (shared.files ? shared.files.length : 0) * 8 +
      (shared.paths ? shared.paths.length : 0) * 6 +
      (shared.queries ? shared.queries.length : 0) * 5 +
      (shared.commands ? shared.commands.length : 0) * 4 +
      Math.min(shared.tools ? shared.tools.length : 0, 3)
    );
  }

  function collectRelatedTurnMatches(session, shared) {
    const turns = collectRelatedTurnLinks(session, shared)
      .map(({ turn, matchKinds }) => ({
        turnId: turn.turnId,
        startedAt: turn.startedAt,
        endedAt: turn.endedAt,
        status: turn.status,
        userPromptPreview: turn.userPromptPreview,
        commentaryPreview: turn.commentaryPreview,
        finalAnswerPreview: turn.finalAnswerPreview,
        summary: turn.summary,
        matchKinds,
      }));

    turns.sort((a, b) => (toTimestampMs(b.endedAt || b.startedAt) || 0) - (toTimestampMs(a.endedAt || a.startedAt) || 0));
    return turns;
  }

  function collectRelatedTurnLinks(session, shared) {
    const turns = [];
    for (const turn of session.turns) {
      const matchKinds = [];
      if (intersectArtifactValues(turn.filesTouched, shared.files, 1).length) matchKinds.push("file");
      if (intersectArtifactValues(getEntityPathArtifacts(turn), shared.paths, 1).length) matchKinds.push("path");
      if (intersectArtifactValues(turn.queryArtifacts || [], shared.queries, 1).length) matchKinds.push("query");
      if (intersectArtifactValues(turn.commandArtifacts || [], shared.commands, 1).length) matchKinds.push("command");
      if (!matchKinds.length) continue;
      turns.push({
        turn,
        matchKinds,
      });
    }

    turns.sort((a, b) => (toTimestampMs(b.turn && (b.turn.endedAt || b.turn.startedAt)) || 0) - (toTimestampMs(a.turn && (a.turn.endedAt || a.turn.startedAt)) || 0));
    return turns;
  }

  function summarizeRelatedSession(session, shared, turns, score) {
    return {
      sessionId: session.sessionId,
      filePath: session.filePath,
      startedAt: session.startedAt,
      updatedAt: session.updatedAt,
      endedAt: session.endedAt,
      cwd: session.cwd,
      model: session.model,
      lastUserPreview: session.lastUserPreview,
      commentaryPreview: session.commentaryPreview,
      finalAnswerPreview: session.finalAnswerPreview,
      turnCount: session.turnCount,
      relatedScore: score,
      relatedReasons: [
        shared.files.length ? "shared_files" : "",
        shared.paths.length ? "shared_paths" : "",
        shared.queries.length ? "shared_queries" : "",
        shared.commands.length ? "shared_commands" : "",
        shared.tools.length ? "shared_tools" : "",
      ].filter(Boolean),
      shared,
      matchedTurnCount: turns.length,
      turns: turns.slice(0, MAX_RELATED_TURN_REFS),
    };
  }

  function summarizeRelatedTurnCompact(turn) {
    return {
      turnId: turn.turnId,
      startedAt: turn.startedAt,
      endedAt: turn.endedAt,
      status: turn.status,
      userPromptPreview: turn.userPromptPreview,
      commentaryPreview: turn.commentaryPreview,
      finalAnswerPreview: turn.finalAnswerPreview,
      summary: turn.summary,
      matchKinds: Array.isArray(turn.matchKinds) ? turn.matchKinds : [],
    };
  }

  function summarizeRelatedSessionCompact(session, shared, turns, score) {
    const relatedReasons = [
      shared.files.length ? "shared_files" : "",
      shared.paths.length ? "shared_paths" : "",
      shared.queries.length ? "shared_queries" : "",
      shared.commands.length ? "shared_commands" : "",
      shared.tools.length ? "shared_tools" : "",
    ].filter(Boolean);
    return {
      ...summarizeSessionCompact(session, {
        matchScore: score,
        matchReasons: relatedReasons,
      }),
      relatedScore: score,
      relatedReasons,
      sharedCounts: {
        files: shared.files.length,
        paths: shared.paths.length,
        queries: shared.queries.length,
        commands: shared.commands.length,
        tools: shared.tools.length,
      },
      shared,
      matchedTurnCount: turns.length,
      turns: turns.slice(0, MAX_RELATED_TURN_REFS).map((turn) => summarizeRelatedTurnCompact(turn)),
    };
  }

  function getCatalogRelatedSessions(catalog, sessionId, filters = {}) {
    ({ catalog } = resolveCatalogForHistoryMode(catalog, filters));
    const source = getCatalogSessionMatches(catalog, sessionId)[0];
    if (!source) return null;

    const limit = Number.isInteger(filters.limit) && filters.limit > 0 ? filters.limit : DEFAULT_RESULT_LIMIT;
    const offset = normalizeOffset(filters.offset);
    const resultShape = normalizeResultShape(filters);
    const cwdFilter = normalizeCwdValue(filters.cwd || "");
    const scopeCwd = cwdFilter || normalizeCwdValue(source.cwd);
    const related = [];

    for (const session of catalog.sessions) {
      if (session.sessionId === source.sessionId) continue;
      if (!matchesSessionFilters(session, filters)) continue;
      if (scopeCwd) {
        const candidateCwd = normalizeCwdValue(session.cwd);
        if (cwdFilter) {
          if (!candidateCwd.toLowerCase().includes(cwdFilter.toLowerCase())) continue;
        } else if (candidateCwd !== scopeCwd) {
          continue;
        }
      }

      const shared = buildSharedArtifactSummary(source, session);
      if (!hasRelatedArtifactSignal(shared)) continue;

      const turns = collectRelatedTurnMatches(session, shared);
      const score = scoreRelatedSession(shared) + Math.min(turns.length, 4);
      related.push(resultShape === "compact"
        ? summarizeRelatedSessionCompact(session, shared, turns, score)
        : summarizeRelatedSession(session, shared, turns, score));
    }

    related.sort((a, b) => {
      if (b.relatedScore !== a.relatedScore) return b.relatedScore - a.relatedScore;
      return (toTimestampMs(b.updatedAt) || 0) - (toTimestampMs(a.updatedAt) || 0);
    });

    return {
      generatedAt: catalog.generatedAt,
      historyMode: normalizeHistoryMode(catalog.historyMode),
      shape: resultShape,
      offset,
      source: resultShape === "compact"
        ? summarizeSessionCompact(source)
        : summarizeSession(source),
      scopeCwd: scopeCwd || null,
      total: related.length,
      sessions: related.slice(offset, offset + limit),
    };
  }

  function getCatalogFamily(catalog, sessionRef, filters = {}) {
    ({ catalog } = resolveCatalogForHistoryMode(catalog, filters));
    const source = getCatalogSessionMatches(catalog, sessionRef)[0];
    if (!source) return null;
    const queryMode = getRequestedQueryMode(filters);

    const lineageRootId = prefixedSessionId(source.lineageRootId || source.sessionId) || source.sessionId;
    const familySessions = catalog.sessions.filter(
      (session) => prefixedSessionId(session.lineageRootId || session.sessionId) === lineageRootId
    );
    if (!familySessions.length) return null;

    const rootSession = familySessions.find((session) => session.sessionId === lineageRootId) || null;
    const sessionLimit = Number.isInteger(filters.limit) && filters.limit > 0 ? filters.limit : DEFAULT_RESULT_LIMIT;
    const turnLimit = Number.isInteger(filters.turnLimit) && filters.turnLimit > 0
      ? filters.turnLimit
      : MAX_PROJECT_TURN_REFS;
    const contentFilters = hasTurnScopedFilters(filters);
    const matchedSessions = [];
    const matchedTurns = [];

    for (const session of familySessions) {
      const sessionMatch = sessionMatches(session, filters);
      const turnSummaries = [];

      for (const turn of session.turns) {
        const turnMatch = contentFilters
          ? turnMatches(turn, filters)
          : { score: toTimestampMs(turn.endedAt || turn.startedAt) || 0, reasons: [] };
        if (!turnMatch) continue;
        turnSummaries.push(summarizeProjectTurn(session, turn, {
          matchScore: turnMatch.score,
          matchReasons: turnMatch.reasons,
          matchedFiles: turnMatch.matchedFiles,
          matchedPaths: turnMatch.matchedPaths,
          matchedPathPatterns: turnMatch.matchedPathPatterns,
          matchedCommandOps: turnMatch.matchedCommandOps,
          matchedQueries: turnMatch.matchedQueries,
        }));
      }

      if (!sessionMatch && !turnSummaries.length) continue;

      matchedSessions.push(summarizeSession(session, {
        matchScore: sessionMatch ? sessionMatch.score : null,
        matchReasons: sessionMatch ? sessionMatch.reasons : [],
        matchedFiles: sessionMatch ? sessionMatch.matchedFiles : [],
        matchedPaths: sessionMatch ? sessionMatch.matchedPaths : [],
        matchedPathPatterns: sessionMatch ? sessionMatch.matchedPathPatterns : [],
        matchedCommandOps: sessionMatch ? sessionMatch.matchedCommandOps : [],
        matchedQueries: sessionMatch ? sessionMatch.matchedQueries : [],
      }));
      matchedTurns.push(...turnSummaries);
    }

    matchedSessions.sort((left, right) => {
      if ((left.lineageDepth || 0) !== (right.lineageDepth || 0)) return (left.lineageDepth || 0) - (right.lineageDepth || 0);
      if ((left.sessionId || "") === lineageRootId && (right.sessionId || "") !== lineageRootId) return -1;
      if ((right.sessionId || "") === lineageRootId && (left.sessionId || "") !== lineageRootId) return 1;
      if ((right.matchScore || 0) !== (left.matchScore || 0)) return (right.matchScore || 0) - (left.matchScore || 0);
      return (toTimestampMs(right.updatedAt) || 0) - (toTimestampMs(left.updatedAt) || 0);
    });
    matchedTurns.sort((left, right) => {
      if ((right.matchScore || 0) !== (left.matchScore || 0)) return (right.matchScore || 0) - (left.matchScore || 0);
      return (toTimestampMs(right.endedAt || right.startedAt || right.sessionUpdatedAt) || 0) -
        (toTimestampMs(left.endedAt || left.startedAt || left.sessionUpdatedAt) || 0);
    });

    return {
      generatedAt: catalog.generatedAt,
      historyMode: normalizeHistoryMode(catalog.historyMode),
      queryMode: filters.query ? queryMode : undefined,
      lineageRootId,
      sourceSessionId: source.sessionId,
      rootSession: rootSession ? summarizeSession(rootSession) : null,
      familySessionCount: familySessions.length,
      matchedSessionCount: matchedSessions.length,
      matchedTurnCount: matchedTurns.length,
      counts: {
        forked: familySessions.filter((session) => Boolean(session.forkedFromId)).length,
        subagents: familySessions.filter((session) => Boolean(session.parentThreadId)).length,
        maxDepth: familySessions.reduce((maxDepth, session) => Math.max(maxDepth, session.lineageDepth || 0), 0),
      },
      truncatedSessions: matchedSessions.length > sessionLimit,
      truncatedTurns: matchedTurns.length > turnLimit,
      sessions: matchedSessions.slice(0, sessionLimit),
      turns: matchedTurns.slice(0, turnLimit),
    };
  }

  function getCatalogWorkstream(catalog, sessionRef, filters = {}) {
    ({ catalog } = resolveCatalogForHistoryMode(catalog, filters));
    const source = getCatalogSessionMatches(catalog, sessionRef)[0];
    if (!source) return null;

    const resultShape = normalizeResultShape(filters);
    const queryMode = getRequestedQueryMode(filters);
    const lineageRootId = prefixedSessionId(source.lineageRootId || source.sessionId) || source.sessionId;
    const familySessions = catalog.sessions.filter(
      (session) => prefixedSessionId(session.lineageRootId || session.sessionId) === lineageRootId
    );
    if (!familySessions.length) return null;

    const rootSession = familySessions.find((session) => session.sessionId === lineageRootId) || source;
    const offset = normalizeOffset(filters.offset);
    const limit = Number.isInteger(filters.limit) && filters.limit > 0 ? filters.limit : DEFAULT_RESULT_LIMIT;
    const familyOffset = normalizeOffset(filters.familyOffset);
    const familyLimit = Number.isInteger(filters.familyLimit) && filters.familyLimit > 0
      ? filters.familyLimit
      : limit;
    const turnLimit = Number.isInteger(filters.turnLimit) && filters.turnLimit > 0 ? filters.turnLimit : MAX_PROJECT_TURN_REFS;
    const requestedArea = getRequestedProjectArea(filters);
    const matchFilters = stripWorkstreamAnchorFilters(filters);
    const contentFilters = hasTurnScopedFilters(matchFilters);
    const familySessionIds = new Set(familySessions.map((session) => session.sessionId));
    const scopeCwd = normalizeCwdValue(filters.cwd || "") || normalizeCwdValue(source.cwd || rootSession.cwd || "");
    const matchesRequestedArea = (entity) => {
      if (!requestedArea) return true;
      return matchesProjectAreaValue(getEntityProjectAreaRoot(entity, scopeCwd), requestedArea);
    };
    let selectedAreaMatched = requestedArea ? false : null;
    const familyPeerSummaries = [];
    const familyTurns = [];
    const summarizeWorkstreamSession = (session, extra = {}) => (
      resultShape === "compact"
        ? summarizeSessionCompact(session, extra)
        : summarizeSession(session, extra)
    );
    const summarizeWorkstreamTurn = (session, turn, extra = {}) => (
      resultShape === "compact"
        ? summarizeProjectTurnCompact(session, turn, extra)
        : summarizeProjectTurn(session, turn, extra)
    );

    for (const session of familySessions) {
      const sessionMatch = sessionMatches(session, matchFilters);
      const sessionAreaMatched = matchesRequestedArea(session);
      if (requestedArea && sessionAreaMatched) selectedAreaMatched = true;
      let matchedFamilyTurnCount = 0;

      for (const turn of session.turns) {
        const turnAreaMatched = matchesRequestedArea(turn);
        if (requestedArea && !turnAreaMatched) continue;
        if (requestedArea && turnAreaMatched) selectedAreaMatched = true;
        const turnMatch = contentFilters
          ? turnMatches(turn, matchFilters)
          : { score: toTimestampMs(turn.endedAt || turn.startedAt) || 0, reasons: [] };
        if (!turnMatch) continue;
        const turnSummary = summarizeWorkstreamTurn(session, turn, {
          matchScore: turnMatch.score,
          matchReasons: turnMatch.reasons,
          matchedFiles: turnMatch.matchedFiles,
          matchedPaths: turnMatch.matchedPaths,
          matchedPathPatterns: turnMatch.matchedPathPatterns,
          matchedCommandOps: turnMatch.matchedCommandOps,
          matchedQueries: turnMatch.matchedQueries,
        });
        turnSummary.workstreamRole = session.sessionId === rootSession.sessionId ? "root" : "family";
        familyTurns.push(turnSummary);
        matchedFamilyTurnCount += 1;
      }

      if (session.sessionId !== rootSession.sessionId) {
        if (requestedArea) {
          const areaPass = sessionAreaMatched || matchedFamilyTurnCount > 0;
          const contentPass = !contentFilters || Boolean(sessionMatch) || matchedFamilyTurnCount > 0;
          if (!areaPass || !contentPass) continue;
        }
        const sessionSummary = summarizeWorkstreamSession(session, {
          matchScore: sessionMatch ? sessionMatch.score : null,
          matchReasons: sessionMatch ? sessionMatch.reasons : [],
          matchedFiles: sessionMatch ? sessionMatch.matchedFiles : [],
          matchedPaths: sessionMatch ? sessionMatch.matchedPaths : [],
          matchedPathPatterns: sessionMatch ? sessionMatch.matchedPathPatterns : [],
          matchedCommandOps: sessionMatch ? sessionMatch.matchedCommandOps : [],
          matchedQueries: sessionMatch ? sessionMatch.matchedQueries : [],
        });
        sessionSummary.workstreamRole = "family";
        familyPeerSummaries.push(sessionSummary);
      }
    }

    const sourceSummary = summarizeWorkstreamSession(source);
    sourceSummary.workstreamRole = source.sessionId === rootSession.sessionId ? "root" : "family";
    const rootSummary = summarizeWorkstreamSession(rootSession);
    rootSummary.workstreamRole = "root";
    if (requestedArea && (matchesRequestedArea(source) || matchesRequestedArea(rootSession))) {
      selectedAreaMatched = true;
    }

    familyPeerSummaries.sort((left, right) => {
      if ((left.sessionId || "") === source.sessionId && (right.sessionId || "") !== source.sessionId) return -1;
      if ((right.sessionId || "") === source.sessionId && (left.sessionId || "") !== source.sessionId) return 1;
      const rightManual = getEntityAnnotationPriority(right);
      const leftManual = getEntityAnnotationPriority(left);
      if (rightManual !== leftManual) return rightManual - leftManual;
      if ((left.lineageDepth || 0) !== (right.lineageDepth || 0)) return (left.lineageDepth || 0) - (right.lineageDepth || 0);
      return (toTimestampMs(right.updatedAt) || 0) - (toTimestampMs(left.updatedAt) || 0);
    });

    const contextMap = new Map();
    for (const anchorSession of familySessions) {
      for (const candidate of catalog.sessions) {
        if (familySessionIds.has(candidate.sessionId)) continue;
        if (scopeCwd) {
          const candidateCwd = normalizeCwdValue(candidate.cwd);
          if (!candidateCwd || candidateCwd !== scopeCwd) continue;
        }

        const shared = buildSharedArtifactSummary(anchorSession, candidate);
        if (!hasRelatedArtifactSignal(shared)) continue;

        let entry = contextMap.get(candidate.sessionId);
        if (!entry) {
          entry = {
            session: candidate,
            shared: { files: [], paths: [], queries: [], commands: [], tools: [] },
            linkedSessions: [],
            linkedRoots: [],
            relationScore: 0,
            turnMap: new Map(),
          };
          contextMap.set(candidate.sessionId, entry);
        }

        entry.shared = mergeSharedArtifactSummary(entry.shared, shared);
        addUnique(entry.linkedSessions, anchorSession.sessionId, MAX_RELATED_SHARED_VALUES);
        addUnique(entry.linkedRoots, prefixedSessionId(anchorSession.lineageRootId || anchorSession.sessionId) || anchorSession.sessionId, MAX_RELATED_SHARED_VALUES);
        entry.relationScore += scoreRelatedSession(shared);

        for (const relatedTurn of collectRelatedTurnLinks(candidate, shared)) {
          const existing = entry.turnMap.get(relatedTurn.turn.turnId);
          if (!existing) {
            entry.turnMap.set(relatedTurn.turn.turnId, {
              turn: relatedTurn.turn,
              matchKinds: Array.isArray(relatedTurn.matchKinds) ? relatedTurn.matchKinds.slice() : [],
            });
            continue;
          }
          existing.matchKinds = mergeUniqueTextValues(existing.matchKinds, relatedTurn.matchKinds, 8);
        }
      }
    }

    const contextSummaries = [];
    const contextTurns = [];

    for (const entry of contextMap.values()) {
      const session = entry.session;
      const sessionMatch = sessionMatches(session, matchFilters);
      const sessionAreaMatched = matchesRequestedArea(session);
      if (requestedArea && sessionAreaMatched) selectedAreaMatched = true;
      const matchedTurnSummaries = [];

      for (const turnLink of entry.turnMap.values()) {
        const turnAreaMatched = matchesRequestedArea(turnLink.turn);
        if (requestedArea && !turnAreaMatched) continue;
        if (requestedArea && turnAreaMatched) selectedAreaMatched = true;
        const turnMatch = contentFilters ? turnMatches(turnLink.turn, matchFilters) : null;
        if (contentFilters && !turnMatch && !sessionMatch) continue;

        const turnSummary = summarizeWorkstreamTurn(session, turnLink.turn, {
          matchScore: (turnMatch ? turnMatch.score : 0) + turnLink.matchKinds.length,
          matchReasons: mergeUniqueTextValues(turnMatch ? turnMatch.reasons : [], turnLink.matchKinds.map((kind) => `related_${kind}`), 12),
          matchedFiles: turnMatch ? turnMatch.matchedFiles : [],
          matchedPaths: turnMatch ? turnMatch.matchedPaths : [],
          matchedPathPatterns: turnMatch ? turnMatch.matchedPathPatterns : [],
          matchedCommandOps: turnMatch ? turnMatch.matchedCommandOps : [],
          matchedQueries: turnMatch ? turnMatch.matchedQueries : [],
        });
        turnSummary.workstreamRole = "context";
        turnSummary.relatedKinds = turnLink.matchKinds.slice();
        turnSummary.linkedSessions = entry.linkedSessions.slice();
        matchedTurnSummaries.push(turnSummary);
      }

      const areaPass = !requestedArea || sessionAreaMatched || matchedTurnSummaries.length > 0;
      if (!areaPass) continue;
      if (!sessionMatch && !matchedTurnSummaries.length) continue;

      const relatedScore = entry.relationScore + Math.min(matchedTurnSummaries.length, 4) + Math.min(entry.linkedSessions.length, 3) * 2;
      const sessionSummary = summarizeWorkstreamSession(session, {
        matchScore: (sessionMatch ? sessionMatch.score : 0) + relatedScore,
        matchReasons: mergeUniqueTextValues(sessionMatch ? sessionMatch.reasons : [], [
          entry.shared.files.length ? "related_files" : "",
          entry.shared.paths.length ? "related_paths" : "",
          entry.shared.queries.length ? "related_queries" : "",
          entry.shared.commands.length ? "related_commands" : "",
          entry.shared.tools.length ? "related_tools" : "",
        ].filter(Boolean), 10),
        matchedFiles: sessionMatch ? sessionMatch.matchedFiles : [],
        matchedPaths: sessionMatch ? sessionMatch.matchedPaths : [],
        matchedPathPatterns: sessionMatch ? sessionMatch.matchedPathPatterns : [],
        matchedCommandOps: sessionMatch ? sessionMatch.matchedCommandOps : [],
        matchedQueries: sessionMatch ? sessionMatch.matchedQueries : [],
      });
      sessionSummary.workstreamRole = "context";
      sessionSummary.relatedScore = relatedScore;
      sessionSummary.linkedSessions = entry.linkedSessions.slice();
      sessionSummary.linkedRoots = entry.linkedRoots.slice();
      if (resultShape === "compact") {
        sessionSummary.sharedCounts = {
          files: entry.shared.files.length,
          paths: entry.shared.paths.length,
          queries: entry.shared.queries.length,
          commands: entry.shared.commands.length,
          tools: entry.shared.tools.length,
        };
      } else {
        sessionSummary.shared = entry.shared;
      }
      contextSummaries.push(sessionSummary);
      contextTurns.push(...matchedTurnSummaries);
    }

    contextSummaries.sort((left, right) => {
      if ((right.relatedScore || 0) !== (left.relatedScore || 0)) return (right.relatedScore || 0) - (left.relatedScore || 0);
      const rightManual = getEntityAnnotationPriority(right);
      const leftManual = getEntityAnnotationPriority(left);
      if (rightManual !== leftManual) return rightManual - leftManual;
      if ((right.matchScore || 0) !== (left.matchScore || 0)) return (right.matchScore || 0) - (left.matchScore || 0);
      return (toTimestampMs(right.updatedAt) || 0) - (toTimestampMs(left.updatedAt) || 0);
    });

    const turns = familyTurns.concat(contextTurns);
    turns.sort((left, right) => {
      const rightTime = toTimestampMs(right.endedAt || right.startedAt || right.sessionUpdatedAt) || 0;
      const leftTime = toTimestampMs(left.endedAt || left.startedAt || left.sessionUpdatedAt) || 0;
      if (rightTime !== leftTime) return rightTime - leftTime;
      if ((right.matchScore || 0) !== (left.matchScore || 0)) return (right.matchScore || 0) - (left.matchScore || 0);
      return (left.workstreamRole || "").localeCompare(right.workstreamRole || "");
    });
    const manual = buildWorkstreamManualSummary(rootSummary, familyPeerSummaries, contextSummaries, turns);

    return {
      generatedAt: catalog.generatedAt,
      historyMode: normalizeHistoryMode(catalog.historyMode),
      shape: resultShape,
      queryMode: filters.query ? queryMode : undefined,
      sourceSessionId: source.sessionId,
      sourceSession: sourceSummary,
      lineageRootId,
      scopeCwd: scopeCwd || null,
      selectedArea: requestedArea || null,
      selectedAreaMatched,
      rootSession: rootSummary,
      familySessionCount: familySessions.length,
      familyPeerCount: familyPeerSummaries.length,
      contextSessionCount: contextSummaries.length,
      totalSessionCount: familySessions.length + contextSummaries.length,
      matchedTurnCount: turns.length,
      manual,
      counts: {
        forked: familySessions.filter((session) => Boolean(session.forkedFromId)).length,
        subagents: familySessions.filter((session) => Boolean(session.parentThreadId)).length,
        maxDepth: familySessions.reduce((maxDepth, session) => Math.max(maxDepth, session.lineageDepth || 0), 0),
        contextLineageRoots: new Set(contextSummaries.map((session) => prefixedSessionId(session.lineageRootId || session.sessionId) || session.sessionId)).size,
      },
      familyOffset,
      familyLimit,
      offset,
      limit,
      truncatedFamilySessions: familyOffset > 0 || (familyOffset + familyLimit) < familyPeerSummaries.length,
      truncatedContextSessions: offset > 0 || (offset + limit) < contextSummaries.length,
      truncatedTurns: turns.length > turnLimit,
      familySessions: familyPeerSummaries.slice(familyOffset, familyOffset + familyLimit),
      contextSessions: contextSummaries.slice(offset, offset + limit),
      turns: turns.slice(0, turnLimit),
    };
  }

  return {
    getCatalogFamily,
    getCatalogRelatedSessions,
    getCatalogWorkstream,
  };
}

module.exports = { createCatalogRelatedViews };
