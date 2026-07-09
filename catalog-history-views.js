"use strict";

function createCatalogHistoryViews(deps = {}) {
  const {
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
  } = deps;

function buildTranscriptResultFromSessionData(session, built, generatedAt, filters = {}, source = null) {
  const matched = [];
  const queryMode = getRequestedQueryMode(filters);
  const sessionAnnotationMatch = matchesAnnotationFilters(session, filters);
  const turnById = new Map(
    Array.isArray(session && session.turns)
      ? session.turns.map((turn) => [turn.turnId, turn])
      : []
  );
  for (const item of built.transcript) {
    if (hasAnnotationScopedFilters(filters)) {
      const turn = item && item.turnId ? turnById.get(item.turnId) || null : null;
      if (!sessionAnnotationMatch && !matchesAnnotationFilters(turn, filters)) continue;
    }
    const match = transcriptItemMatches(item, filters);
    if (!match) continue;
    matched.push({
      ...item,
      matchedFiles: match.matchedFiles,
      matchedPaths: match.matchedPaths,
      matchedPathPatterns: match.matchedPathPatterns,
      matchedCommandOps: match.matchedCommandOps,
      matchedQueries: match.matchedQueries,
    });
  }
  const limit = Number.isInteger(filters.limit) && filters.limit > 0 ? filters.limit : DEFAULT_EVENT_LIMIT;

  return {
    generatedAt,
    historyMode: normalizeHistoryMode(filters.historyMode || session.historyMode),
    source,
    queryMode: filters.query ? queryMode : undefined,
    session: summarizeSession(session),
    quality: buildHistoryQuality(session, filters, source, "transcript"),
    totalItems: built.transcript.length,
    matchedItems: matched.length,
    limit,
    truncated: matched.length > limit,
    items: matched.slice(-limit),
  };
}

function buildResumeResultFromSessionData(session, built, generatedAt, filters = {}, source = null) {
  const options = normalizeResumeOptions(filters);
  const queryMode = getRequestedQueryMode(filters);
  const quality = buildHistoryQuality(session, filters, source, "resume");
  const annotationScoped = hasAnnotationScopedFilters(filters);
  const sessionAnnotationMatch = matchesAnnotationFilters(session, filters);
  const contentFilters = annotationScoped ? clearAnnotationScopedFilters(filters) : filters;
  const contentScoped = hasTurnScopedFilters(contentFilters);
  const itemsByTurnId = new Map();
  for (const item of built.transcript) {
    if (!item.turnId) continue;
    if (!itemsByTurnId.has(item.turnId)) itemsByTurnId.set(item.turnId, []);
    itemsByTurnId.get(item.turnId).push(item);
  }

  const activeTurnEntries = session.turns.flatMap((turn) => {
    if (annotationScoped && !sessionAnnotationMatch && !matchesAnnotationFilters(turn, filters)) {
      return [];
    }
    const turnMatch = contentScoped
      ? turnMatches(turn, contentFilters)
      : {
        score: toTimestampMs(turn.endedAt || turn.startedAt) || 0,
        reasons: [],
        matchedCommandOps: [],
        matchedFiles: [],
        matchedPaths: [],
        matchedPathPatterns: [],
        matchedQueries: [],
      };
    if (contentScoped && !turnMatch) return [];
    return [{ turn, turnMatch }];
  });
  const activeTurns = activeTurnEntries.map((entry) => entry.turn);

  const activeTurnIds = new Set(activeTurns.map((turn) => turn.turnId).filter(Boolean));
  const activeTranscript = (Array.isArray(built.transcript) ? built.transcript : []).filter((item) => {
    if (!item || typeof item !== "object") return false;
    if (!item.turnId) return !annotationScoped && !contentScoped;
    return activeTurnIds.has(item.turnId);
  });
  const activeCompactions = !annotationScoped && !contentScoped
    ? built.compactions
    : built.compactions.filter((entry) => entry && entry.turnId && activeTurnIds.has(entry.turnId));

  const selectedTurns = activeTurnEntries
    .filter(({ turn }) =>
      turn.userPromptPreview ||
      turn.finalAnswerPreview ||
      turn.commentaryPreview ||
      turn.filesTouched.length ||
      turn.pathsReferenced.length ||
      hasPathRoleSignal(turn.pathRoles) ||
      turn.queries.length ||
      turn.errors.length ||
      turn.commands.length
    )
    .slice(-options.turnLimit)
    .map(({ turn, turnMatch }) => buildResumeTurn(turn, itemsByTurnId.get(turn.turnId) || [], options, turnMatch));

  const latestUser = findLatestTranscriptItem(activeTranscript, (item) => item.type === "user");
  const latestAnswer = findLatestTranscriptItem(activeTranscript, (item) => item.type === "assistant");
  const latestCommentary = findLatestTranscriptItem(activeTranscript, (item) => item.type === "commentary");
  const latestTurn = activeTurns.length ? activeTurns[activeTurns.length - 1] : null;
  const lastCompaction = activeCompactions.length ? activeCompactions[activeCompactions.length - 1] : null;

  const result = {
    generatedAt,
    historyMode: normalizeHistoryMode(filters.historyMode || session.historyMode),
    source,
    queryMode: filters.query ? queryMode : undefined,
    session: summarizeSession(session),
    quality,
    reloadSafety: buildResumeReloadSafety(quality, source, filters),
    shaping: {
      totalChars: options.totalChars,
      itemChars: options.itemChars,
      toolChars: options.toolChars,
      lineLimit: options.lineLimit,
      turnLimit: options.turnLimit,
      itemLimit: options.itemLimit,
      highlightLimit: options.highlightLimit,
      trimStrategy: options.trimStrategy,
      toolTextMode: options.toolTextMode,
      operationsApplied: [
        `trim_text(strategy=${options.trimStrategy},item_chars=${options.itemChars},tool_chars=${options.toolChars},line_limit=${options.lineLimit})`,
        `tool_text=${options.toolTextMode}`,
        `recent_turns=${options.turnLimit}`,
        `total_budget=${options.totalChars}`,
        "path_focus=role_annotated_recent",
        options.toolTextMode === "salient" ? "omit_read_and_listing_output" : "",
      ].filter(Boolean),
    },
    overview: {
      latestTurnId: latestTurn ? latestTurn.turnId : null,
      latestStatus: latestTurn ? latestTurn.status : null,
      latestUserText: latestUser
        ? shapeText(latestUser.text, {
          maxChars: options.itemChars,
          maxLines: options.lineLimit,
          strategy: options.trimStrategy,
        })
        : "",
      latestAnswerText: latestAnswer
        ? shapeText(latestAnswer.text, {
          maxChars: options.itemChars,
          maxLines: options.lineLimit,
          strategy: options.trimStrategy,
        })
        : "",
      latestCommentaryText: latestCommentary
        ? shapeText(latestCommentary.text, {
          maxChars: options.itemChars,
          maxLines: options.lineLimit,
          strategy: options.trimStrategy,
        })
        : "",
    },
    compactions: {
      count: activeCompactions.length,
      lastTimestamp: lastCompaction ? lastCompaction.timestamp : null,
      lastPreview: lastCompaction && lastCompaction.preview
        ? shapeText(lastCompaction.preview, {
          maxChars: Math.min(240, options.itemChars),
          maxLines: 4,
          strategy: options.trimStrategy,
        })
        : "",
    },
    highlights: buildResumeHighlights(activeTurns, options),
    turnCount: activeTurns.length,
    totalTurnCount: session.turnCount,
    turnsTruncated: activeTurns.length > selectedTurns.length,
    turns: selectedTurns,
  };

  const textResult = buildResumeText(result, options);
  return {
    ...result,
    ...textResult,
  };
}

function normalizeTranscriptSearchText(item) {
  return [
    item.type,
    item.kind,
    item.role,
    item.phase,
    item.preview,
    item.text,
    item.detail,
    item.toolName,
    item.command,
    item.commandSource,
    Array.isArray(item.commandTypes) ? item.commandTypes.join("\n") : "",
    Array.isArray(item.commandTypeHints) ? item.commandTypeHints.join("\n") : "",
    Array.isArray(item.shellCommands) ? item.shellCommands.join("\n") : "",
    Array.isArray(item.commandPaths) ? item.commandPaths.join("\n") : "",
    Array.isArray(item.commandPathPatterns) ? item.commandPathPatterns.join("\n") : "",
    Array.isArray(item.commandQueries) ? item.commandQueries.join("\n") : "",
    item.query,
    Array.isArray(item.queries) ? item.queries.join("\n") : "",
    Array.isArray(item.filesTouched) ? item.filesTouched.join("\n") : "",
    getTranscriptItemMemoryCitationSearchValues(item).join("\n"),
    getTranscriptItemErrorSearchValues(item).join("\n"),
    item.turnId,
  ].filter(Boolean).join("\n").toLowerCase();
}

function transcriptItemMatches(item, filters = {}) {
  const requestedPathRole = resolveRequestedPathRole(filters);
  const requestedPathPattern = getRequestedPathPattern(filters);
  const requestedQuery = getRequestedQuery(filters);
  const matchedFiles = filters.file ? getMatchingTranscriptItemFileValues(item, filters) : [];
  const matchedPaths = filters.path || requestedPathRole
    ? getMatchingPathValues(item, filters, [
      ...(item.commandPaths || []),
      ...(item.filesTouched || []),
      ...getTranscriptItemMemoryCitationPaths(item),
    ])
    : [];
  const matchedPathPatterns = requestedPathPattern || requestedPathRole
    ? getMatchingPathPatternValues(item, filters, item.commandPathPatterns || [])
    : [];
  const matchedCommandOps = filters.commandOp || filters.command_op || filters.commandOpSignal || filters.command_op_signal
    ? sortCommandOpValues(getMatchingCommandOps(item.shellCommands, filters))
    : [];
  const matchedQueries = requestedQuery
    ? getMatchingQueryValues(getTranscriptItemQueryCandidates(item), filters)
    : [];
  if (filters.turn) {
    const needle = String(filters.turn).toLowerCase();
    if (!(item.turnId || "").toLowerCase().includes(needle)) return null;
  }

  if (filters.kind) {
    const needle = String(filters.kind).toLowerCase();
    if (!(item.type || "").toLowerCase().includes(needle) && !(item.kind || "").toLowerCase().includes(needle)) {
      return null;
    }
  }

  if (filters.tool) {
    const needle = String(filters.tool).toLowerCase();
    if (!(item.toolName || "").toLowerCase().includes(needle)) return null;
  }

  if (filters.file && !matchedFiles.length) return null;

  if (filters.path && !matchedPaths.length) return null;

  if (requestedPathRole && !filters.path && !requestedPathPattern && !matchedPaths.length && !matchedPathPatterns.length) {
    return null;
  }

  if (requestedPathPattern && !matchedPathPatterns.length) return null;

  if (filters.commandType) {
    const needle = String(filters.commandType).toLowerCase();
    if (!(item.commandTypes || []).some((value) => value.toLowerCase().includes(needle))) return null;
  }

  if (filters.commandOp || filters.command_op || filters.commandOpSignal || filters.command_op_signal) {
    if (!matchedCommandOps.length) return null;
  }

  if (filters.error) {
    const needle = String(filters.error).toLowerCase();
    const errorText = getTranscriptItemErrorSearchValues(item).join("\n").toLowerCase();
    if (!errorText || !errorText.includes(needle)) return null;
  }

  if (requestedQuery && !matchedQueries.length) return null;

  const q = typeof filters.q === "string" ? filters.q.trim().toLowerCase() : "";
  if (!q) {
    return {
      matchedFiles,
      matchedPaths,
      matchedPathPatterns,
      matchedCommandOps,
      matchedQueries,
    };
  }
  if (!normalizeTranscriptSearchText(item).includes(q)) return null;
  return {
    matchedFiles,
    matchedPaths,
    matchedPathPatterns,
    matchedCommandOps,
    matchedQueries,
  };
}

function buildSessionTranscript(session, filters = {}) {
  const historyMode = normalizeHistoryMode(filters.historyMode || session.historyMode);
  const normalized = readNormalizedSessionEvents(session.filePath, {
    defaultCwd: session.cwd,
  });
  const visibleEvents = selectNormalizedEvents(normalized, historyMode);
  const transcript = [];
  const pendingToolItems = new Map();
  const compactions = [];

  for (let index = 0; index < visibleEvents.length; index += 1) {
    const item = visibleEvents[index];
    if (item.record.kind === "compaction") {
      compactions.push({
        timestamp: item.record.timestamp || null,
        turnId: item.resolvedTurnId || null,
        replacementCount: item.record.compaction ? item.record.compaction.replacementCount || 0 : 0,
        preview: item.record.compaction && item.record.compaction.preview
          ? item.record.compaction.preview
          : item.record.preview,
      });
    }

    const transcriptItem = buildTranscriptItem(
      item.record,
      item.lineNumber,
      index + 1,
      item.resolvedTurnId,
      item.resolvedCwd,
      item.includedInFinalHistory
    );
    if (!transcriptItem) continue;

    if (
      transcriptItem.type === "status" &&
      transcript.length &&
      transcript[transcript.length - 1].turnId === transcriptItem.turnId &&
      transcript[transcript.length - 1].type === "assistant"
    ) {
      const previous = transcript[transcript.length - 1];
      const previousText = normalizeCwdValue(previous.text || previous.preview);
      const currentText = normalizeCwdValue(transcriptItem.text || transcriptItem.preview);
      if (previousText && previousText === currentText) continue;
    }

    if (transcript.length && canDeduplicateTranscriptMessagePair(transcript[transcript.length - 1], transcriptItem)) {
      transcript[transcript.length - 1] = mergeTranscriptMessageItem(transcript[transcript.length - 1], transcriptItem);
      continue;
    }

    if (transcriptItem.type === "tool" && transcriptItem.callId) {
      if (transcriptItem.stage === "call") {
        pendingToolItems.set(transcriptItem.callId, transcript.length);
        transcript.push(transcriptItem);
        continue;
      }
      if (pendingToolItems.has(transcriptItem.callId)) {
        const targetIndex = pendingToolItems.get(transcriptItem.callId);
        transcript[targetIndex] = mergeTranscriptToolItem(transcript[targetIndex], transcriptItem);
        pendingToolItems.delete(transcriptItem.callId);
        continue;
      }
    }

    transcript.push(transcriptItem);
  }

  return { transcript, compactions };
}

function getCatalogTranscript(catalog, sessionId, filters = {}) {
  ({ catalog } = resolveCatalogForHistoryMode(catalog, filters));
  const session = getCatalogSessionMatches(catalog, sessionId)[0];
  if (!session) return null;

  const built = buildSessionTranscript(session, filters);
  return buildTranscriptResultFromSessionData(
    session,
    built,
    catalog.generatedAt,
    filters,
    buildHistoryViewSource(filters.source || "rollout", "rollout", {
      historyMode: normalizeHistoryMode(filters.historyMode || session.historyMode),
      rolloutOnly: true,
    })
  );
}

function normalizeResumeToolTextMode(value) {
  const text = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (text === "full" || text === "none") return text;
  return DEFAULT_RESUME_TOOL_TEXT_MODE;
}

function normalizeResumeOptions(filters = {}) {
  const trimStrategy = normalizeTrimStrategy(filters.trimStrategy || filters.strategy || "middle");
  const toolTextMode = normalizeResumeToolTextMode(filters.toolText || filters.toolTextMode);
  return {
    totalChars: normalizePositiveInt(filters.totalChars || filters.budgetChars, DEFAULT_RESUME_TOTAL_CHARS),
    itemChars: normalizePositiveInt(filters.itemChars, DEFAULT_RESUME_ITEM_CHARS),
    toolChars: normalizePositiveInt(filters.toolChars, DEFAULT_RESUME_TOOL_CHARS),
    lineLimit: normalizePositiveInt(filters.lineLimit, DEFAULT_RESUME_LINE_LIMIT),
    turnLimit: normalizePositiveInt(filters.turnLimit, DEFAULT_RESUME_TURN_LIMIT),
    itemLimit: normalizePositiveInt(filters.itemLimit, DEFAULT_RESUME_ITEM_LIMIT),
    highlightLimit: normalizePositiveInt(filters.highlightLimit, DEFAULT_RESUME_HIGHLIGHT_LIMIT),
    trimStrategy,
    toolTextMode,
  };
}

function findLatestTranscriptItem(transcript, predicate) {
  for (let index = transcript.length - 1; index >= 0; index -= 1) {
    if (predicate(transcript[index])) return transcript[index];
  }
  return null;
}

function collectRecentUniqueValues(entries, selector, limit, shapeOptions = null) {
  const values = [];
  const seen = new Set();
  for (let index = (Array.isArray(entries) ? entries.length : 0) - 1; index >= 0; index -= 1) {
    if (values.length >= limit) break;
    const raw = selector(entries[index]);
    if (typeof raw !== "string") continue;
    const text = raw.trim();
    if (!text) continue;
    const normalized = text.toLowerCase();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    values.push(shapeOptions ? shapeText(text, shapeOptions) : text);
  }
  return values;
}

function collectRecentArrayValues(values, limit, excludeValues = []) {
  const results = [];
  const seen = new Set((Array.isArray(excludeValues) ? excludeValues : []).map((value) => normalizeArtifactValue(value)));
  const source = Array.isArray(values) ? values : [];

  for (let index = source.length - 1; index >= 0; index -= 1) {
    if (results.length >= limit) break;
    const raw = source[index];
    if (typeof raw !== "string") continue;
    const text = raw.trim();
    if (!text) continue;
    const normalized = normalizeArtifactValue(text);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    results.push(text);
  }

  return results;
}

function collectRecentTurnValues(turns, selector, limit, excludeValues = []) {
  const results = [];
  const seen = new Set((Array.isArray(excludeValues) ? excludeValues : []).map((value) => normalizeArtifactValue(value)));
  const source = Array.isArray(turns) ? turns : [];

  for (let turnIndex = source.length - 1; turnIndex >= 0; turnIndex -= 1) {
    if (results.length >= limit) break;
    const selectedValues = selector(source[turnIndex]);
    const values = Array.isArray(selectedValues) ? selectedValues : [];
    for (let valueIndex = values.length - 1; valueIndex >= 0; valueIndex -= 1) {
      if (results.length >= limit) break;
      const raw = values[valueIndex];
      if (typeof raw !== "string") continue;
      const text = raw.trim();
      if (!text) continue;
      const normalized = normalizeArtifactValue(text);
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      results.push(text);
    }
  }

  return results;
}

function hasPathRoleSignal(pathRoles) {
  return PATH_ROLE_ORDER.some((role) => getPathRoleValues(pathRoles, role).length);
}

function sortResumePathRoles(roles) {
  const list = Array.isArray(roles) ? roles.filter(Boolean) : [];
  return list
    .slice()
    .sort((left, right) => RESUME_PATH_ROLE_ORDER.indexOf(left) - RESUME_PATH_ROLE_ORDER.indexOf(right));
}

function buildResumePathEntries(pathRoles, limit, excludeValues = []) {
  const excluded = new Set((Array.isArray(excludeValues) ? excludeValues : []).map((value) => normalizeArtifactValue(value)));
  const entries = new Map();

  for (const role of RESUME_PATH_ROLE_ORDER) {
    for (const raw of getPathRoleValues(pathRoles, role)) {
      const text = typeof raw === "string" ? raw.trim() : "";
      if (!text) continue;
      const normalized = normalizeArtifactValue(text);
      if (!normalized || excluded.has(normalized)) continue;
      let entry = entries.get(normalized);
      if (!entry) {
        entry = { path: text, roles: [] };
        entries.set(normalized, entry);
      }
      if (!entry.roles.includes(role)) entry.roles.push(role);
    }
  }

  return Array.from(entries.values())
    .map((entry) => ({
      path: entry.path,
      roles: sortResumePathRoles(entry.roles),
    }))
    .sort((left, right) => {
      const leftScore = Math.max(...left.roles.map((role) => RESUME_PATH_ROLE_ORDER.length - RESUME_PATH_ROLE_ORDER.indexOf(role)));
      const rightScore = Math.max(...right.roles.map((role) => RESUME_PATH_ROLE_ORDER.length - RESUME_PATH_ROLE_ORDER.indexOf(role)));
      if (rightScore !== leftScore) return rightScore - leftScore;
      if (right.roles.length !== left.roles.length) return right.roles.length - left.roles.length;
      return left.path.localeCompare(right.path);
    })
    .slice(0, limit);
}

function collectRecentSessionPathHighlights(turns, limit, excludeValues = []) {
  const results = [];
  const seen = new Set((Array.isArray(excludeValues) ? excludeValues : []).map((value) => normalizeArtifactValue(value)));
  const source = Array.isArray(turns) ? turns : [];

  for (let turnIndex = source.length - 1; turnIndex >= 0; turnIndex -= 1) {
    if (results.length >= limit) break;
    const turnEntries = buildResumePathEntries(source[turnIndex] && source[turnIndex].pathRoles, limit, excludeValues);
    for (const entry of turnEntries) {
      if (results.length >= limit) break;
      const normalized = normalizeArtifactValue(entry.path);
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      results.push(entry);
    }
  }

  return results;
}

function getResumePathValues(pathHighlights, role) {
  const normalizedRole = normalizePathRole(role);
  if (!normalizedRole) return [];
  return (Array.isArray(pathHighlights) ? pathHighlights : [])
    .filter((entry) => Array.isArray(entry.roles) && entry.roles.includes(normalizedRole))
    .map((entry) => entry.path);
}

function getResumeToolTextPolicy(item, options) {
  if (options.toolTextMode === "none") {
    return { mode: "omitted", reason: "tool_text_disabled" };
  }
  if (options.toolTextMode === "full") {
    return { mode: "full", reason: null };
  }
  if (item.type !== "tool") {
    return { mode: "full", reason: null };
  }

  const commandTypes = Array.isArray(item.commandTypes) ? item.commandTypes : [];
  if (item.exitCode != null && item.exitCode !== 0) return { mode: "salient", reason: null };
  if (item.statusCode != null && item.statusCode >= 400) return { mode: "salient", reason: null };
  if (item.toolName === "web_search") return { mode: "salient", reason: null };
  if ((item.commandQueries && item.commandQueries.length) || item.query || (item.queries && item.queries.length)) {
    return { mode: "salient", reason: null };
  }
  if (item.toolName === "mcp" || (item.toolName || "").startsWith("mcp:")) {
    return { mode: "salient", reason: null };
  }
  if (commandTypes.includes("search")) return { mode: "salient", reason: null };
  if (commandTypes.includes("read")) return { mode: "omitted", reason: "read_output" };
  if (commandTypes.includes("list_files")) return { mode: "omitted", reason: "listing_output" };
  if (item.toolName === "apply_patch" || (item.filesTouched && item.filesTouched.length)) {
    return { mode: "omitted", reason: "patch_result" };
  }
  return { mode: "omitted", reason: "low_signal_tool_output" };
}

function shouldIncludeResumeItem(item) {
  if (!item || typeof item !== "object") return false;
  if (item.type === "user" || item.type === "assistant" || item.type === "commentary" || item.type === "reasoning") {
    return Boolean(item.text || item.detail || item.preview);
  }
  if (item.type === "error") return true;
  if (item.type === "status") return Boolean(item.text || item.preview);
  if (item.type !== "tool") return false;
  if (item.toolName === "web_search" || item.toolName === "apply_patch") return true;
  if (item.exitCode != null && item.exitCode !== 0) return true;
  if ((item.commandQueries && item.commandQueries.length) || item.query || (item.queries && item.queries.length)) {
    return true;
  }
  if ((item.filesTouched && item.filesTouched.length) || (item.commandPaths && item.commandPaths.length)) {
    return !isLowSignalRelatedCommand(item.command || "");
  }
  return Boolean(item.command && !isLowSignalRelatedCommand(item.command));
}

function shapeResumeItem(item, options) {
  const commandMaxChars = Math.max(120, Math.min(320, options.itemChars));
  const textSource = item.type === "error"
    ? (item.detail || item.text || item.preview)
    : (item.text || item.detail || item.preview);
  const shaped = {
    index: item.index,
    timestamp: item.timestamp,
    turnId: item.turnId,
    type: item.type,
    toolName: item.toolName || null,
    stage: item.stage || null,
    exitCode: item.exitCode != null ? item.exitCode : null,
    errorCode: item.errorCode || "",
    statusCode: item.statusCode != null ? item.statusCode : null,
    errorRequestId: item.errorRequestId || null,
    errorUrl: item.errorUrl || null,
    errorCfRay: item.errorCfRay || null,
    command: item.command
      ? shapeText(item.command, {
        maxChars: commandMaxChars,
        strategy: options.trimStrategy,
      })
      : "",
    commandTypes: Array.isArray(item.commandTypes) ? item.commandTypes.slice(0, options.highlightLimit) : [],
    commandTypeHints: Array.isArray(item.commandTypeHints) ? item.commandTypeHints.slice(0, options.highlightLimit) : [],
    pathRoles: clonePathRoleBuckets(item.pathRoles),
    commandPaths: Array.isArray(item.commandPaths) ? item.commandPaths.slice(0, options.highlightLimit) : [],
    commandPathPatterns: Array.isArray(item.commandPathPatterns) ? item.commandPathPatterns.slice(0, options.highlightLimit) : [],
    commandQueries: Array.isArray(item.commandQueries) ? item.commandQueries.slice(0, options.highlightLimit) : [],
    shellCommands: Array.isArray(item.shellCommands) ? item.shellCommands.slice(0, options.highlightLimit) : [],
    filesTouched: Array.isArray(item.filesTouched) ? item.filesTouched.slice(0, options.highlightLimit) : [],
    query: item.query ? shapeText(item.query, { maxChars: Math.min(240, options.itemChars), strategy: options.trimStrategy }) : "",
    queries: Array.isArray(item.queries)
      ? item.queries.slice(0, options.highlightLimit).map((value) => shapeText(value, {
        maxChars: Math.min(240, options.itemChars),
        strategy: options.trimStrategy,
      }))
      : [],
    text: "",
    textMode: "full",
    omissionReason: null,
  };

  if (item.type === "tool") {
    const policy = getResumeToolTextPolicy(item, options);
    shaped.textMode = policy.mode;
    shaped.omissionReason = policy.reason;
    if (policy.mode !== "omitted") {
      shaped.text = shapeText(item.text || item.detail || item.preview, {
        maxChars: options.toolChars,
        maxLines: options.lineLimit,
        strategy: options.trimStrategy,
      });
    }
    return shaped;
  }

  shaped.text = shapeText(textSource, {
    maxChars: options.itemChars,
    maxLines: options.lineLimit,
    strategy: options.trimStrategy,
  });
  return shaped;
}

function selectResumeTurnItems(items, options) {
  const candidates = (Array.isArray(items) ? items : [])
    .filter((item) => shouldIncludeResumeItem(item))
    .map((item) => shapeResumeItem(item, options));

  const selected = [];
  const seen = new Set();
  const pick = (item) => {
    if (!item || seen.has(item.index)) return;
    seen.add(item.index);
    selected.push(item);
  };

  pick(candidates.find((item) => item.type === "user"));
  pick([...candidates].reverse().find((item) => item.type === "assistant"));
  pick([...candidates].reverse().find((item) => item.type === "commentary"));
  for (const item of candidates.filter((entry) => entry.type === "error").slice(-2)) pick(item);
  for (const item of candidates.filter((entry) => entry.type === "tool").slice(-options.itemLimit)) pick(item);
  pick([...candidates].reverse().find((item) => item.type === "status"));
  pick(candidates[candidates.length - 1]);

  selected.sort((a, b) => a.index - b.index);
  return selected.slice(-options.itemLimit);
}

function buildResumeTurn(turn, transcriptItems, options, turnMatch = null) {
  const items = selectResumeTurnItems(transcriptItems, options);
  const userItem = items.find((item) => item.type === "user");
  const assistantItem = [...items].reverse().find((item) => item.type === "assistant");
  const commentaryItem = [...items].reverse().find((item) => item.type === "commentary");
  const commandTextOptions = {
    maxChars: Math.max(120, Math.min(240, options.itemChars)),
    strategy: options.trimStrategy,
  };
  const filesTouched = collectRecentArrayValues(turn.filesTouched || [], options.highlightLimit);
  const pathHighlights = buildResumePathEntries(turn.pathRoles, options.highlightLimit, filesTouched);

  return {
    turnId: turn.turnId,
    startedAt: turn.startedAt,
    endedAt: turn.endedAt,
    status: turn.status,
    summary: shapeText(turn.summary || summarizeTurn(turn), {
      maxChars: options.itemChars,
      maxLines: 4,
      strategy: options.trimStrategy,
    }),
    userText: userItem ? userItem.text : shapeText(turn.userPromptPreview, {
      maxChars: options.itemChars,
      maxLines: options.lineLimit,
      strategy: options.trimStrategy,
    }),
    finalAnswerText: assistantItem ? assistantItem.text : shapeText(turn.finalAnswerPreview, {
      maxChars: options.itemChars,
      maxLines: options.lineLimit,
      strategy: options.trimStrategy,
    }),
    commentaryText: commentaryItem && !assistantItem ? commentaryItem.text : shapeText(turn.commentaryPreview, {
      maxChars: options.itemChars,
      maxLines: options.lineLimit,
      strategy: options.trimStrategy,
    }),
    filesTouched,
    pathsReferenced: collectRecentArrayValues(turn.pathsReferenced || [], options.highlightLimit, filesTouched),
    pathHighlights,
    pathsWritten: getResumePathValues(pathHighlights, "write"),
    pathsRead: getResumePathValues(pathHighlights, "read"),
    searchScopes: getResumePathValues(pathHighlights, "search_scope"),
    listScopes: getResumePathValues(pathHighlights, "list_scope"),
    pathRoles: clonePathRoleBuckets(turn.pathRoles),
    queries: (turn.queries || [])
      .slice(0, options.highlightLimit)
      .map((entry) => shapeText(entry.query, {
        maxChars: Math.min(240, options.itemChars),
        strategy: options.trimStrategy,
      })),
    errors: (turn.errors || [])
      .slice(0, Math.min(options.highlightLimit, 4))
      .map((entry) => shapeText(entry.detail || entry.message, {
        maxChars: Math.min(240, options.itemChars),
        maxLines: 4,
        strategy: options.trimStrategy,
      })),
    commands: collectRecentUniqueValues(
      (turn.commands || []).filter((entry) =>
        entry && (
          (entry.exitCode != null && entry.exitCode !== 0) ||
          (entry.commandQueries && entry.commandQueries.length) ||
          !isLowSignalRelatedCommand(entry.command || "")
        )
      ),
      (entry) => entry.command,
      options.highlightLimit,
      commandTextOptions
    ),
    matchedFiles: Array.isArray(turnMatch && turnMatch.matchedFiles) ? turnMatch.matchedFiles.slice() : [],
    matchedPaths: Array.isArray(turnMatch && turnMatch.matchedPaths) ? turnMatch.matchedPaths.slice() : [],
    matchedPathPatterns: Array.isArray(turnMatch && turnMatch.matchedPathPatterns) ? turnMatch.matchedPathPatterns.slice() : [],
    matchedCommandOps: Array.isArray(turnMatch && turnMatch.matchedCommandOps) ? turnMatch.matchedCommandOps.slice() : [],
    matchedQueries: Array.isArray(turnMatch && turnMatch.matchedQueries) ? turnMatch.matchedQueries.slice() : [],
    matchReasons: Array.isArray(turnMatch && turnMatch.reasons) ? turnMatch.reasons.slice() : [],
    matchScore: turnMatch && Number.isFinite(turnMatch.score) ? turnMatch.score : null,
    items,
  };
}

function buildResumeHighlights(turns, options) {
  const turnList = Array.isArray(turns) ? turns : [];
  const filesTouched = collectRecentTurnValues(
    turnList,
    (turn) => turn && turn.filesTouched,
    options.highlightLimit
  );
  const pathHighlights = collectRecentSessionPathHighlights(turnList, options.highlightLimit, filesTouched);

  return {
    filesTouched,
    pathsReferenced: collectRecentTurnValues(
      turnList,
      (turn) => turn && turn.pathsReferenced,
      options.highlightLimit,
      filesTouched
    ),
    pathHighlights,
    pathsWritten: getResumePathValues(pathHighlights, "write"),
    pathsRead: getResumePathValues(pathHighlights, "read"),
    searchScopes: getResumePathValues(pathHighlights, "search_scope"),
    listScopes: getResumePathValues(pathHighlights, "list_scope"),
    queries: collectRecentUniqueValues(
      turnList.flatMap((turn) => Array.isArray(turn && turn.queries) ? turn.queries : []),
      (entry) => entry && entry.query,
      options.highlightLimit,
      {
        maxChars: Math.min(240, options.itemChars),
        strategy: options.trimStrategy,
      }
    ),
    errors: collectRecentUniqueValues(
      turnList.flatMap((turn) => Array.isArray(turn && turn.errors) ? turn.errors : []),
      (entry) => entry && (entry.detail || entry.message),
      Math.min(options.highlightLimit, 4),
      {
        maxChars: Math.min(240, options.itemChars),
        maxLines: 4,
        strategy: options.trimStrategy,
      }
    ),
    commands: collectRecentUniqueValues(
      turnList.flatMap((turn) => Array.isArray(turn && turn.commands) ? turn.commands : [])
        .filter((entry) =>
          entry && (
            (entry.exitCode != null && entry.exitCode !== 0) ||
            (entry.commandQueries && entry.commandQueries.length) ||
            !isLowSignalRelatedCommand(entry.command || "")
          )
        ),
      (entry) => entry.command,
      options.highlightLimit,
      {
        maxChars: Math.max(120, Math.min(240, options.itemChars)),
        strategy: options.trimStrategy,
      }
    ),
    tools: collectRecentTurnValues(
      turnList,
      (turn) => turn && turn.toolsUsed,
      options.highlightLimit
    ),
  };
}

function formatResumeToolItem(item) {
  const bits = [];
  if (item.toolName) bits.push(item.toolName);
  if (item.command) bits.push(item.command);
  if (item.commandTypeHints && item.commandTypeHints.length) bits.push(`type-hints=${item.commandTypeHints.join(", ")}`);
  if (item.commandPaths && item.commandPaths.length) bits.push(`paths=${item.commandPaths.join(", ")}`);
  if (item.commandPathPatterns && item.commandPathPatterns.length) bits.push(`patterns=${item.commandPathPatterns.join(", ")}`);
  if (item.commandQueries && item.commandQueries.length) bits.push(`q=${item.commandQueries.join(" | ")}`);
  if (item.shellCommands && item.shellCommands.length) bits.push(`ops=${item.shellCommands.join(", ")}`);
  if (item.query) bits.push(`query=${item.query}`);
  else if (item.queries && item.queries.length) bits.push(`queries=${item.queries.join(" | ")}`);
  if (item.exitCode != null) bits.push(`exit=${item.exitCode}`);

  let line = bits.join(" | ");
  if (item.text) {
    line = line ? `${line} -> ${item.text}` : item.text;
  } else if (item.textMode === "omitted") {
    line = line ? `${line} [output omitted: ${item.omissionReason}]` : `[output omitted: ${item.omissionReason}]`;
  }
  return line;
}

function appendResumeSection(sections, state, text, options) {
  const source = typeof text === "string" ? text.trim() : "";
  if (!source || state.remaining <= 0) return;
  if (source.length <= state.remaining) {
    sections.push(source);
    state.remaining -= source.length + 2;
    return;
  }

  const shaped = shapeText(source, {
    maxChars: state.remaining,
    strategy: options.trimStrategy,
  });
  if (shaped) {
    sections.push(shaped);
    state.remaining = 0;
  }
}

function formatResumeListLine(label, values, visibleCount) {
  const list = Array.isArray(values) ? values.filter(Boolean) : [];
  if (!list.length) return "";
  const shown = list.slice(0, visibleCount);
  const suffix = list.length > shown.length ? ` (+${list.length - shown.length} more)` : "";
  return `${label}: ${shown.join(", ")}${suffix}`;
}

function formatResumePathRole(role) {
  if (role === "search_scope") return "search";
  if (role === "list_scope") return "list";
  return role;
}

function formatResumePathHighlight(entry) {
  if (!entry || typeof entry !== "object") return "";
  const pathText = typeof entry.path === "string" ? entry.path.trim() : "";
  if (!pathText) return "";
  const roles = sortResumePathRoles(entry.roles).map((role) => formatResumePathRole(role)).filter(Boolean);
  return roles.length ? `${pathText} [${roles.join(", ")}]` : pathText;
}

function buildResumeText(result, options) {
  const sections = [];
  const state = { remaining: options.totalChars };
  const headerLines = [
    `Session: ${result.session.sessionId}`,
    result.session.cwd ? `Project: ${result.session.cwd}` : "",
    result.session.model ? `Model: ${result.session.model}` : "",
    result.totalTurnCount && result.totalTurnCount !== result.turnCount
      ? `Turns: ${result.turnCount} of ${result.totalTurnCount}`
      : `Turns: ${result.turnCount}`,
    result.overview.latestTurnId ? `Latest turn: ${result.overview.latestTurnId} (${result.overview.latestStatus || "unknown"})` : "",
  ].filter(Boolean);
  appendResumeSection(sections, state, headerLines.join("\n"), options);

  const overviewLines = [];
  if (result.overview.latestUserText) overviewLines.push(`Goal: ${result.overview.latestUserText}`);
  if (result.overview.latestAnswerText) overviewLines.push(`Latest answer: ${result.overview.latestAnswerText}`);
  else if (result.overview.latestCommentaryText) overviewLines.push(`Latest commentary: ${result.overview.latestCommentaryText}`);
  if (result.compactions.count > 0) {
    overviewLines.push(
      result.compactions.lastPreview
        ? `Compactions: ${result.compactions.count} (last: ${result.compactions.lastPreview})`
        : `Compactions: ${result.compactions.count}`
    );
  }
  appendResumeSection(sections, state, overviewLines.join("\n"), options);

  const highlightLines = [];
  const listVisibleCount = Math.max(2, Math.min(4, options.highlightLimit));
  if (result.highlights.filesTouched.length) highlightLines.push(formatResumeListLine("Files changed", result.highlights.filesTouched, listVisibleCount));
  if (result.highlights.pathHighlights && result.highlights.pathHighlights.length) {
    highlightLines.push(formatResumeListLine(
      "Path focus",
      result.highlights.pathHighlights.map((entry) => formatResumePathHighlight(entry)),
      Math.max(1, Math.min(3, listVisibleCount))
    ));
  } else if (result.highlights.pathsReferenced.length) {
    highlightLines.push(formatResumeListLine("Paths inspected", result.highlights.pathsReferenced, listVisibleCount));
  }
  if (result.highlights.queries.length) highlightLines.push(formatResumeListLine("Queries", result.highlights.queries, Math.max(2, Math.min(3, listVisibleCount))));
  if (result.highlights.errors.length) highlightLines.push(formatResumeListLine("Errors", result.highlights.errors, Math.max(1, Math.min(2, listVisibleCount))));
  if (result.highlights.commands.length) highlightLines.push(formatResumeListLine("Key commands", result.highlights.commands, Math.max(1, Math.min(2, listVisibleCount))));
  appendResumeSection(sections, state, highlightLines.join("\n"), options);

  for (const turn of result.turns) {
    const lines = [`Turn ${turn.turnId} [${turn.status}]`];
    if (turn.userText) lines.push(`- user: ${turn.userText}`);
    if (turn.finalAnswerText) lines.push(`- answer: ${turn.finalAnswerText}`);
    else if (turn.commentaryText) lines.push(`- commentary: ${turn.commentaryText}`);
    if (turn.matchReasons && turn.matchReasons.length) lines.push(`- match: ${turn.matchReasons.join(", ")}`);
    if (turn.matchedFiles && turn.matchedFiles.length) {
      lines.push(`- ${formatResumeListLine("Matched files", turn.matchedFiles, Math.max(1, Math.min(3, options.highlightLimit)))}`);
    }
    if (turn.matchedPaths && turn.matchedPaths.length) {
      lines.push(`- ${formatResumeListLine("Matched paths", turn.matchedPaths, Math.max(1, Math.min(3, options.highlightLimit)))}`);
    }
    if (turn.matchedPathPatterns && turn.matchedPathPatterns.length) {
      lines.push(`- ${formatResumeListLine("Matched path patterns", turn.matchedPathPatterns, Math.max(1, Math.min(3, options.highlightLimit)))}`);
    }
    if (turn.matchedCommandOps && turn.matchedCommandOps.length) {
      lines.push(`- ${formatResumeListLine("Matched command ops", turn.matchedCommandOps, Math.max(1, Math.min(4, options.highlightLimit)))}`);
    }
    if (turn.matchedQueries && turn.matchedQueries.length) {
      lines.push(`- ${formatResumeListLine("Matched queries", turn.matchedQueries, Math.max(1, Math.min(3, options.highlightLimit)))}`);
    }
    if (turn.filesTouched.length) lines.push(`- files: ${turn.filesTouched.join(", ")}`);
    if (turn.pathHighlights && turn.pathHighlights.length) {
      const visible = Math.max(1, Math.min(3, options.highlightLimit));
      const shown = turn.pathHighlights.slice(0, visible).map((entry) => formatResumePathHighlight(entry));
      const suffix = turn.pathHighlights.length > shown.length ? ` (+${turn.pathHighlights.length - shown.length} more)` : "";
      lines.push(`- paths: ${shown.join(", ")}${suffix}`);
    } else if (turn.pathsReferenced.length) {
      lines.push(`- paths: ${turn.pathsReferenced.join(", ")}`);
    }
    if (turn.queries.length) lines.push(`- queries: ${turn.queries.join(" | ")}`);
    if (turn.errors.length) lines.push(`- errors: ${turn.errors.join(" | ")}`);
    for (const item of turn.items) {
      if (item.type !== "tool" && item.type !== "status" && item.type !== "reasoning") continue;
      if (item.type === "tool") lines.push(`- tool: ${formatResumeToolItem(item)}`);
      else if (item.text) lines.push(`- ${item.type}: ${item.text}`);
    }
    appendResumeSection(sections, state, lines.join("\n"), options);
    if (state.remaining <= 0) break;
  }

  const text = sections.join("\n\n");
  return {
    text,
    truncated: state.remaining <= 0,
    remainingChars: Math.max(0, state.remaining),
  };
}

function getCatalogResume(catalog, sessionId, filters = {}) {
  ({ catalog } = resolveCatalogForHistoryMode(catalog, filters));
  const session = getCatalogSessionMatches(catalog, sessionId)[0];
  if (!session) return null;

  const built = buildSessionTranscript(session, filters);
  return buildResumeResultFromSessionData(
    session,
    built,
    catalog.generatedAt,
    filters,
    buildHistoryViewSource(filters.source || "rollout", "rollout", {
      historyMode: normalizeHistoryMode(filters.historyMode || session.historyMode),
      rolloutOnly: true,
    })
  );
}

  return {
    buildTranscriptResultFromSessionData,
    buildResumeResultFromSessionData,
    getCatalogTranscript,
    getCatalogResume,
  };
}

module.exports = { createCatalogHistoryViews };
