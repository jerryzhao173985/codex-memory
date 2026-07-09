"use strict";

function createCatalogArtifactViews(deps = {}) {
  const {
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
  } = deps;

  function matchesArtifactEntryValue(kind, candidate, value, filters = {}) {
    if (kind === "path" || kind === "file" || kind === "path_pattern") {
      return matchesPathValue(candidate, value, filters.cwd || "");
    }
    return matchesArtifactValue(candidate, value);
  }

  function findCatalogArtifactEntry(catalog, kind, value, filters = {}) {
    const entries = catalog.artifacts && catalog.artifacts.byKind
      ? catalog.artifacts.byKind[kind] || []
      : [];
    const requestedCommandOpSignal = kind === "command_op" ? getRequestedCommandOpSignal(filters) : "";
    const matches = entries.filter((item) => (
      matchesArtifactEntryValue(kind, item.value, value, filters) &&
      (!requestedCommandOpSignal || classifyCommandOpSignal(item.value) === requestedCommandOpSignal)
    ));
    if (!matches.length) {
      if (kind === "error") {
        const needle = normalizeArtifactValue(value);
        const aliasMatches = entries.filter((item) => (
          Array.isArray(item.searchValues) &&
          item.searchValues.includes(needle)
        ));
        if (aliasMatches.length === 1) return aliasMatches[0];
      }
      return null;
    }
    if (matches.length === 1) return matches[0];

    const exactMatches = matches.filter((item) => matchesArtifactValue(item.value, value));
    if (exactMatches.length === 1) return exactMatches[0];

    return null;
  }

  function recordTouchesPath(record, targetPath, resolvedCwd = "", pathRole = "") {
    const refs = getRecordReferencedPaths(record, resolvedCwd);
    const candidates = normalizePathRole(pathRole)
      ? getPathRoleValues(refs.pathRoles, pathRole)
      : refs.allPaths;
    return candidates.some((value) => matchesPathValue(value, targetPath, resolvedCwd));
  }

  function isPathThreadAnchorEvent(record) {
    if (!record || typeof record !== "object") return false;
    if (record.kind === "turn_context") return true;
    if (record.kind === "error") return true;
    if (record.kind === "turn_lifecycle") {
      return (
        record.lifecycle === "started" ||
        record.lifecycle === "completed" ||
        record.lifecycle === "aborted"
      );
    }
    if (record.kind !== "message") return false;
    if (record.role === "user") return true;
    return record.role === "assistant" && (
      record.phase === "commentary" ||
      record.phase === "final_answer"
    );
  }

  function summarizePathThreadTurn(session, turn, targetPath, events, extra = {}) {
    const actions = [];
    const seenActions = new Set();
    const commands = [];

    const addAction = (value) => {
      const normalized = typeof value === "string" ? value.trim() : "";
      if (!normalized || seenActions.has(normalized)) return;
      seenActions.add(normalized);
      actions.push(normalized);
    };

    const addCommand = (value) => {
      const normalized = typeof value === "string" ? summarizeText(value, 240) : "";
      if (!normalized || commands.includes(normalized)) return;
      commands.push(normalized);
    };

    for (const event of events) {
      if (Array.isArray(event.commandTypes)) {
        for (const type of event.commandTypes) addAction(type);
      }
      for (const role of getEntityPathValueRoles(event, targetPath)) addAction(role);
      if (event.command) addCommand(event.command);
      if (Array.isArray(event.filesTouched) && event.filesTouched.some((value) => matchesPathValue(value, targetPath, turn.cwd || session.cwd))) {
        addAction("patch");
      }
      if (event.kind === "error") addAction("error");
      if (event.kind === "message" && event.role === "assistant") addAction("answer");
      if (event.kind === "turn_lifecycle" && event.lifecycle === "completed" && event.detail) {
        addAction("answer");
      }
    }

    return {
      sessionId: session.sessionId,
      sessionKey: getSessionKey(session),
      filePath: session.filePath,
      sessionUpdatedAt: session.updatedAt,
      cwd: turn.cwd || session.cwd,
      model: turn.model || session.model,
      turnId: turn.turnId,
      startedAt: turn.startedAt,
      endedAt: turn.endedAt,
      status: turn.status,
      path: targetPath,
      userPromptPreview: turn.userPromptPreview,
      commentaryPreview: turn.commentaryPreview,
      finalAnswerPreview: turn.finalAnswerPreview,
      filesTouched: turn.filesTouched,
      pathsReferenced: turn.pathsReferenced || [],
      matchRoles: getEntityPathValueRoles(turn, targetPath),
      commandTypes: turn.commandTypes || [],
      toolsUsed: turn.toolsUsed,
      summary: turn.summary,
      actions,
      commands,
      matchedEvents: extra.totalEvents ?? events.length,
      directEventCount: extra.directEventCount ?? 0,
      truncated: extra.truncated === true,
      events,
    };
  }

  function summarizeArtifactEntry(entry, filters = {}) {
    const requestedPathRole = entry.kind === "path" || entry.kind === "path_pattern" ? resolveRequestedPathRole(filters) : "";
    const requestedCommandOpSignal = entry.kind === "command_op" ? getRequestedCommandOpSignal(filters) : "";
    if (requestedCommandOpSignal && classifyCommandOpSignal(entry.value) !== requestedCommandOpSignal) {
      return null;
    }
    const refs = entry.sessions.filter((sessionRef) => {
      if (!matchesSessionFilters(sessionRef, filters)) return false;
      if (requestedPathRole) {
        return Array.isArray(sessionRef.pathRoles) && sessionRef.pathRoles.includes(requestedPathRole);
      }
      return true;
    });

    if ((hasSessionScopeFilters(filters) || requestedPathRole) && !refs.length) return null;

    return {
      kind: entry.kind,
      value: entry.value,
      patternKind: entry.kind === "path_pattern" ? (entry.patternKind || classifyPathPatternValue(entry.value)) : undefined,
      signalTier: entry.kind === "command_op"
        ? (entry.signalTier || classifyCommandOpSignal(entry.value))
        : (entry.kind === "query" ? (entry.signalTier || classifyQuerySignal(entry.value)) : undefined),
      sessionCount: refs.length || entry.sessionCount,
      lastSeenAt: (refs[0] && refs[0].updatedAt) || entry.lastSeenAt,
      pathRoles: entry.kind === "path" || entry.kind === "path_pattern" ? (entry.pathRoles || []) : undefined,
      sessions: (refs.length ? refs : entry.sessions).slice(0, MAX_ARTIFACT_SESSION_REFS),
    };
  }

  function summarizeArtifactEntryCompact(entry, filters = {}) {
    const requestedPathRole = entry.kind === "path" || entry.kind === "path_pattern" ? resolveRequestedPathRole(filters) : "";
    const requestedCommandOpSignal = entry.kind === "command_op" ? getRequestedCommandOpSignal(filters) : "";
    if (requestedCommandOpSignal && classifyCommandOpSignal(entry.value) !== requestedCommandOpSignal) {
      return null;
    }
    const refs = entry.sessions.filter((sessionRef) => {
      if (!matchesSessionFilters(sessionRef, filters)) return false;
      if (requestedPathRole) {
        return Array.isArray(sessionRef.pathRoles) && sessionRef.pathRoles.includes(requestedPathRole);
      }
      return true;
    });

    if ((hasSessionScopeFilters(filters) || requestedPathRole) && !refs.length) return null;

    return {
      kind: entry.kind,
      value: entry.value,
      patternKind: entry.kind === "path_pattern" ? (entry.patternKind || classifyPathPatternValue(entry.value)) : undefined,
      signalTier: entry.kind === "command_op"
        ? (entry.signalTier || classifyCommandOpSignal(entry.value))
        : (entry.kind === "query" ? (entry.signalTier || classifyQuerySignal(entry.value)) : undefined),
      sessionCount: refs.length || entry.sessionCount,
      lastSeenAt: (refs[0] && refs[0].updatedAt) || entry.lastSeenAt,
      pathRoles: entry.kind === "path" || entry.kind === "path_pattern" ? (entry.pathRoles || []) : undefined,
    };
  }

  function sessionContainsArtifact(session, kind, value, filters = {}) {
    if (kind === "file") return session.filesTouched.some((item) => matchesPathValue(item, value, filters.cwd || session.cwd || ""));
    if (kind === "path") {
      const candidates = getEntityPathCandidates(session, filters, getEntityPathArtifacts(session));
      return candidates.some((item) => matchesPathValue(item, value, filters.cwd || session.cwd || ""));
    }
    if (kind === "path_pattern") {
      const candidates = getEntityPathPatternCandidates(session, filters, getEntityPathPatternArtifacts(session));
      return candidates.some((item) => matchesPathValue(item, value, filters.cwd || session.cwd || ""));
    }
    if (kind === "tool") return session.toolsUsed.some((item) => matchesArtifactValue(item, value));
    if (kind === "command") return (session.commandArtifacts || []).some((item) => matchesArtifactValue(item, value));
    if (kind === "command_op") return getMatchingCommandOps(session.commandOpArtifacts || [], filters).some((item) => matchesArtifactValue(item, value));
    if (kind === "query") return (session.queryArtifacts || []).some((item) => matchesArtifactValue(item, value));
    if (kind === "error") return getEntityErrorArtifactCandidates(session).some((item) => matchesArtifactValue(item, value));
    return false;
  }

  function getTurnArtifactValues(turn, kind, filters = {}) {
    if (kind === "file") return Array.isArray(turn.filesTouched) ? turn.filesTouched : [];
    if (kind === "path") return getEntityPathCandidates(turn, filters, getEntityPathArtifacts(turn));
    if (kind === "path_pattern") return getEntityPathPatternCandidates(turn, filters, getEntityPathPatternArtifacts(turn));
    if (kind === "tool") return Array.isArray(turn.toolsUsed) ? turn.toolsUsed : [];
    if (kind === "command") return Array.isArray(turn.commandArtifacts) ? turn.commandArtifacts : [];
    if (kind === "command_op") return getMatchingCommandOps(turn.commandOpArtifacts || [], filters);
    if (kind === "query") return Array.isArray(turn.queryArtifacts) ? turn.queryArtifacts : [];
    if (kind === "error") return getEntityErrorArtifactCandidates(turn);
    return [];
  }

  function summarizeArtifactTurn(turn, kind, value, filters = {}) {
    const matchValues = getTurnArtifactValues(turn, kind, filters).filter((item) => (
      (kind === "path" || kind === "file" || kind === "path_pattern")
        ? matchesPathValue(item, value, filters.cwd || turn.cwd || "")
        : matchesArtifactValue(item, value)
    ));
    if (!matchValues.length) return null;
    return {
      turnId: turn.turnId,
      startedAt: turn.startedAt,
      endedAt: turn.endedAt,
      status: turn.status,
      cwd: turn.cwd,
      model: turn.model,
      userPromptPreview: turn.userPromptPreview,
      commentaryPreview: turn.commentaryPreview,
      finalAnswerPreview: turn.finalAnswerPreview,
      summary: turn.summary,
      annotation: getEntityAnnotation(turn),
      matchValues,
      matchRoles: kind === "path"
        ? getEntityPathValueRoles(turn, value)
        : (kind === "path_pattern" ? getEntityPathPatternValueRoles(turn, value) : []),
    };
  }

  function summarizeArtifactTurnCompact(session, turn, summary) {
    return {
      ...summarizeProjectTurnCompact(session, turn),
      matchValues: summary.matchValues,
      matchRoles: summary.matchRoles,
    };
  }

  function summarizeArtifactSessionCompact(session, matchedTurns, turnLimit) {
    return {
      ...summarizeSessionCompact(session),
      turnMatchCount: matchedTurns.length,
      turns: matchedTurns.slice(0, turnLimit),
    };
  }

  function getCatalogArtifactTurns(catalog, kindInput, value, filters = {}) {
    ({ catalog } = resolveCatalogForHistoryMode(catalog, filters));
    const kind = normalizeArtifactKind(kindInput);
    const normalizedValue = typeof value === "string" ? value.trim() : "";
    if (!kind || !normalizedValue) return null;
    if (getRequestedCommandOpSignal(filters) && kind !== "command_op") return null;

    const entry = findCatalogArtifactEntry(catalog, kind, normalizedValue, filters);
    if (!entry) return null;

    const limit = Number.isInteger(filters.limit) && filters.limit > 0 ? filters.limit : DEFAULT_RESULT_LIMIT;
    const offset = normalizeOffset(filters.offset);
    const resultShape = normalizeResultShape(filters);
    const statusNeedle = typeof filters.status === "string" ? filters.status.trim().toLowerCase() : "";
    const turns = [];
    const seenSessions = new Set();

    for (const session of catalog.sessions) {
      if (!matchesSessionFilters(session, filters)) continue;
      if (!sessionContainsArtifact(session, kind, normalizedValue, filters)) continue;
      // Session-level match: counted even when no turn-level rows survive, so
      // sessionCount stays consistent with the artifact list view.
      seenSessions.add(session.sessionId);

      for (const turn of session.turns) {
        const summary = summarizeArtifactTurn(turn, kind, normalizedValue, filters);
        if (!summary) continue;
        if (statusNeedle && !(summary.status || "").toLowerCase().includes(statusNeedle)) continue;
        turns.push(resultShape === "compact"
          ? summarizeArtifactTurnCompact(session, turn, summary)
          : {
            sessionId: session.sessionId,
            filePath: session.filePath,
            sessionUpdatedAt: session.updatedAt,
            cwd: session.cwd,
            model: session.model,
            turnId: summary.turnId,
            startedAt: summary.startedAt,
            endedAt: summary.endedAt,
            status: summary.status,
            userPromptPreview: summary.userPromptPreview,
            commentaryPreview: summary.commentaryPreview,
            finalAnswerPreview: summary.finalAnswerPreview,
            summary: summary.summary,
            matchValues: summary.matchValues,
            matchRoles: summary.matchRoles,
          });
        seenSessions.add(session.sessionId);
      }
    }

    turns.sort((a, b) => {
      const bTime = toTimestampMs(b.endedAt || b.startedAt || b.sessionUpdatedAt) || 0;
      const aTime = toTimestampMs(a.endedAt || a.startedAt || a.sessionUpdatedAt) || 0;
      if (bTime !== aTime) return bTime - aTime;
      return a.turnId.localeCompare(b.turnId);
    });

    return {
      generatedAt: catalog.generatedAt,
      historyMode: normalizeHistoryMode(catalog.historyMode),
      shape: resultShape,
      offset,
      kind,
      value: entry.value,
      patternKind: kind === "path_pattern" ? (entry.patternKind || classifyPathPatternValue(entry.value)) : undefined,
      signalTier: kind === "command_op"
        ? (entry.signalTier || classifyCommandOpSignal(entry.value))
        : (kind === "query" ? (entry.signalTier || classifyQuerySignal(entry.value)) : undefined),
      pathRoles: kind === "path" || kind === "path_pattern" ? (entry.pathRoles || []) : undefined,
      sessionCount: seenSessions.size,
      turnCount: turns.length,
      lastSeenAt: entry.lastSeenAt,
      truncated: offset > 0 || (offset + limit) < turns.length,
      turns: turns.slice(offset, offset + limit),
    };
  }

  function getCatalogArtifact(catalog, kindInput, value, filters = {}) {
    ({ catalog } = resolveCatalogForHistoryMode(catalog, filters));
    const kind = normalizeArtifactKind(kindInput);
    const normalizedValue = typeof value === "string" ? value.trim() : "";
    if (!kind || !normalizedValue) return null;
    if (getRequestedCommandOpSignal(filters) && kind !== "command_op") return null;

    const entry = findCatalogArtifactEntry(catalog, kind, normalizedValue, filters);
    if (!entry) return null;

    const sessionLimit = Number.isInteger(filters.limit) && filters.limit > 0 ? filters.limit : DEFAULT_RESULT_LIMIT;
    const offset = normalizeOffset(filters.offset);
    const turnLimit = Number.isInteger(filters.turnLimit) && filters.turnLimit > 0 ? filters.turnLimit : MAX_TURN_ITEMS;
    const resultShape = normalizeResultShape(filters);
    const sessions = [];
    let totalTurns = 0;

    for (const session of catalog.sessions) {
      if (!matchesSessionFilters(session, filters)) continue;
      if (!sessionContainsArtifact(session, kind, normalizedValue, filters)) continue;

      const matchedTurns = [];
      for (const turn of session.turns) {
        const summary = summarizeArtifactTurn(turn, kind, normalizedValue, filters);
        if (!summary) continue;
        matchedTurns.push(resultShape === "compact"
          ? summarizeArtifactTurnCompact(session, turn, summary)
          : summary);
      }

      // Keep sessions that match at the session level even when no turn-level
      // match exists (turnless or truncated sessions); the artifact index
      // counted them, so the drilldown must not silently drop them.
      totalTurns += matchedTurns.length;
      sessions.push(resultShape === "compact"
        ? summarizeArtifactSessionCompact(session, matchedTurns, turnLimit)
        : {
          sessionId: session.sessionId,
          filePath: session.filePath,
          startedAt: session.startedAt,
          updatedAt: session.updatedAt,
          endedAt: session.endedAt,
          cwd: session.cwd,
          model: session.model,
          lastUserPreview: session.lastUserPreview,
          finalAnswerPreview: session.finalAnswerPreview,
          commentaryPreview: session.commentaryPreview,
          annotation: getEntityAnnotation(session),
          turnMatchCount: matchedTurns.length,
          turns: matchedTurns.slice(0, turnLimit),
        });
    }

    sessions.sort((a, b) => (toTimestampMs(b.updatedAt) || 0) - (toTimestampMs(a.updatedAt) || 0));

    return {
      generatedAt: catalog.generatedAt,
      historyMode: normalizeHistoryMode(catalog.historyMode),
      shape: resultShape,
      offset,
      kind,
      value: entry.value,
      patternKind: kind === "path_pattern" ? (entry.patternKind || classifyPathPatternValue(entry.value)) : undefined,
      signalTier: kind === "command_op"
        ? (entry.signalTier || classifyCommandOpSignal(entry.value))
        : (kind === "query" ? (entry.signalTier || classifyQuerySignal(entry.value)) : undefined),
      pathRoles: kind === "path" || kind === "path_pattern" ? (entry.pathRoles || []) : undefined,
      sessionCount: sessions.length,
      turnCount: totalTurns,
      lastSeenAt: entry.lastSeenAt,
      truncated: offset > 0 || (offset + sessionLimit) < sessions.length,
      sessions: sessions.slice(offset, offset + sessionLimit),
    };
  }

  function getCatalogPathThread(catalog, value, filters = {}) {
    ({ catalog } = resolveCatalogForHistoryMode(catalog, filters));
    const filterCwd = normalizeCwdValue(filters.cwd || "");
    const targetBaseCwd = path.isAbsolute(filterCwd) ? filterCwd : "";
    const targetPath = normalizeReferencedPath(targetBaseCwd, value) || normalizeCwdValue(value);
    if (!targetPath) return null;

    const limit = Number.isInteger(filters.limit) && filters.limit > 0 ? filters.limit : DEFAULT_RESULT_LIMIT;
    const eventLimit = Number.isInteger(filters.eventLimit) && filters.eventLimit > 0
      ? filters.eventLimit
      : DEFAULT_THREAD_EVENT_LIMIT;
    const requestedPathRole = resolveRequestedPathRole(filters);
    const turnNeedle = typeof filters.turn === "string" ? filters.turn.trim() : "";
    const statusNeedle = typeof filters.status === "string" ? filters.status.trim().toLowerCase() : "";
    const threads = [];
    const seenSessions = new Set();

    for (const session of catalog.sessions) {
      if (!matchesSessionFilters(session, filters)) continue;
      if (!matchesEntityPathFilters(session, {
        ...filters,
        path: targetPath,
        pathRole: requestedPathRole,
      }, getEntityPathArtifacts(session))) continue;

      const normalized = readNormalizedSessionEvents(session.filePath, {
        defaultCwd: session.cwd,
      });
      const visibleEvents = selectNormalizedEvents(normalized, filters.historyMode || session.historyMode);
      const turnItems = new Map();

      for (let eventIndex = 0; eventIndex < visibleEvents.length; eventIndex += 1) {
        const item = visibleEvents[eventIndex];
        const resolvedTurnId = item.resolvedTurnId;
        if (!resolvedTurnId) continue;
        if (!turnItems.has(resolvedTurnId)) turnItems.set(resolvedTurnId, []);
        turnItems.get(resolvedTurnId).push({
          item,
          eventIndex: eventIndex + 1,
        });
      }

      for (const turn of session.turns) {
        if (turnNeedle && turn.turnId !== turnNeedle) continue;
        if (statusNeedle && !(turn.status || "").toLowerCase().includes(statusNeedle)) continue;
        if (!matchesEntityPathFilters(turn, {
          ...filters,
          path: targetPath,
          pathRole: requestedPathRole,
        }, getEntityPathArtifacts(turn))) continue;

        const items = turnItems.get(turn.turnId) || [];
        const directIndexes = new Set();
        const anchorIndexes = new Set();
        const relevantCallIds = new Set();

        for (let index = 0; index < items.length; index += 1) {
          const item = items[index].item;
          const record = item.record;
          if (recordTouchesPath(record, targetPath, item.resolvedCwd, requestedPathRole)) {
            directIndexes.add(index);
            if (record.callId) relevantCallIds.add(record.callId);
            continue;
          }
          if (isPathThreadAnchorEvent(record)) anchorIndexes.add(index);
        }

        if (!directIndexes.size) continue;

        const matched = [];
        for (let index = 0; index < items.length; index += 1) {
          const entry = items[index];
          const item = entry.item;
          const record = item.record;
          const include = directIndexes.has(index) ||
            (record.callId && relevantCallIds.has(record.callId)) ||
            anchorIndexes.has(index);
          if (!include) continue;
          matched.push(summarizeCatalogEvent(
            record,
            item.lineNumber,
            entry.eventIndex,
            item.resolvedTurnId,
            item.resolvedCwd,
            item.includedInFinalHistory
          ));
        }

        const compacted = compactCatalogEvents(matched);
        threads.push(summarizePathThreadTurn(
          session,
          turn,
          targetPath,
          compacted.slice(-eventLimit),
          {
            totalEvents: compacted.length,
            directEventCount: directIndexes.size,
            truncated: compacted.length > eventLimit,
          }
        ));
        seenSessions.add(session.sessionId);
      }
    }

    threads.sort((a, b) => {
      const bTime = toTimestampMs(b.endedAt || b.startedAt || b.sessionUpdatedAt) || 0;
      const aTime = toTimestampMs(a.endedAt || a.startedAt || a.sessionUpdatedAt) || 0;
      if (bTime !== aTime) return bTime - aTime;
      return a.turnId.localeCompare(b.turnId);
    });

    if (!threads.length) return null;

    return {
      generatedAt: catalog.generatedAt,
      historyMode: normalizeHistoryMode(catalog.historyMode),
      path: targetPath,
      pathRole: requestedPathRole || null,
      sessionCount: seenSessions.size,
      turnCount: threads.length,
      eventLimit,
      truncated: threads.length > limit,
      threads: threads.slice(0, limit),
    };
  }

  function listCatalogArtifacts(catalog, filters = {}) {
    ({ catalog } = resolveCatalogForHistoryMode(catalog, filters));
    const resultShape = normalizeResultShape(filters);
    const kind = normalizeArtifactKind(filters.kind);
    const requestedPathRole = resolveRequestedPathRole(filters);
    const requestedPathPattern = getRequestedPathPattern(filters);
    const requestedCommandOpSignal = getRequestedCommandOpSignal(filters);
    const offset = normalizeOffset(filters.offset);
    if (requestedCommandOpSignal && kind && kind !== "command_op") {
      return {
        generatedAt: catalog.generatedAt,
        historyMode: normalizeHistoryMode(catalog.historyMode),
        shape: resultShape,
        offset,
        kind,
        total: 0,
        counts: catalog.artifacts ? catalog.artifacts.counts : {},
        artifacts: [],
      };
    }
    const kinds = kind
      ? [kind]
      : (requestedPathPattern
          ? ["path_pattern"]
          : (requestedPathRole
          ? ["path", "path_pattern"]
          : (requestedCommandOpSignal
              ? ["command_op"]
              : ["file", "path", "path_pattern", "tool", "command", "command_op", "query", "error"])));
    const rawQ = typeof filters.q === "string" ? filters.q.trim() : "";
    const q = rawQ.toLowerCase();
    const limit = Number.isInteger(filters.limit) && filters.limit > 0 ? filters.limit : DEFAULT_RESULT_LIMIT;
    const matched = [];

    for (const artifactKind of kinds) {
      const entries = catalog.artifacts && catalog.artifacts.byKind
        ? catalog.artifacts.byKind[artifactKind] || []
        : [];
      for (const entry of entries) {
        if (requestedPathPattern && artifactKind !== "path_pattern") continue;
        if (requestedPathPattern && !matchesPathNeedle(entry.value, requestedPathPattern, filters.cwd || "")) continue;
        if (q) {
          const matchesQuery = artifactKind === "path" || artifactKind === "file" || artifactKind === "path_pattern"
            ? matchesPathNeedle(entry.value, q, filters.cwd || "")
            : (artifactKind === "error"
              ? (
                (Array.isArray(entry.searchValues) && entry.searchValues.some((value) => value.includes(q))) ||
                entry.value.toLowerCase().includes(q)
              )
              : entry.value.toLowerCase().includes(q));
          if (!matchesQuery) continue;
        }
        const summary = resultShape === "compact"
          ? summarizeArtifactEntryCompact(entry, filters)
          : summarizeArtifactEntry(entry, filters);
        if (!summary) continue;
        matched.push(summary);
      }
    }

    matched.sort((a, b) => {
      const bQueryScore = b.kind === "path_pattern" && rawQ
        ? getPathPatternQuerySortScore(b.value, rawQ, filters.cwd || "")
        : (b.kind === "query" && rawQ ? getQueryArtifactSortScore(b.value, rawQ) : 0);
      const aQueryScore = a.kind === "path_pattern" && rawQ
        ? getPathPatternQuerySortScore(a.value, rawQ, filters.cwd || "")
        : (a.kind === "query" && rawQ ? getQueryArtifactSortScore(a.value, rawQ) : 0);
      if (bQueryScore !== aQueryScore) return bQueryScore - aQueryScore;
      if (a.kind === "command_op" && b.kind === "command_op") {
        const signalRankDiff = getCommandOpSignalRank(a.value) - getCommandOpSignalRank(b.value);
        if (signalRankDiff !== 0) return signalRankDiff;
      }
      if (a.kind === "query" && b.kind === "query") {
        const signalRankDiff = getQuerySignalRank(a.value) - getQuerySignalRank(b.value);
        if (signalRankDiff !== 0) return signalRankDiff;
      }
      if (b.sessionCount !== a.sessionCount) return b.sessionCount - a.sessionCount;
      const bTime = toTimestampMs(b.lastSeenAt) || 0;
      const aTime = toTimestampMs(a.lastSeenAt) || 0;
      if (bTime !== aTime) return bTime - aTime;
      return a.value.localeCompare(b.value);
    });

    return {
      generatedAt: catalog.generatedAt,
      historyMode: normalizeHistoryMode(catalog.historyMode),
      shape: resultShape,
      offset,
      kind,
      total: matched.length,
      counts: catalog.artifacts ? catalog.artifacts.counts : {},
      artifacts: matched.slice(offset, offset + limit),
    };
  }

  return {
    getCatalogArtifactTurns,
    getCatalogArtifact,
    getCatalogPathThread,
    listCatalogArtifacts,
  };
}

module.exports = {
  createCatalogArtifactViews,
};
