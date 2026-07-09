"use strict";

function createCatalogMatchers(deps = {}) {
  const {
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
  } = deps;

  function normalizeAnnotationTagValue(value) {
    return typeof value === "string"
      ? value.trim().toLowerCase()
      : "";
  }

  function getRequestedManualTags(filters = {}) {
    const values = [];
    const seen = new Set();
    const note = (value) => {
      const normalized = normalizeAnnotationTagValue(value);
      if (!normalized || seen.has(normalized)) return;
      seen.add(normalized);
      values.push(normalized);
    };

    const manualTag = filters.manualTag ?? filters.manual_tag;
    if (Array.isArray(filters.manualTags)) {
      for (const value of filters.manualTags) note(value);
    }
    if (Array.isArray(manualTag)) {
      for (const value of manualTag) note(value);
    } else {
      note(manualTag);
    }
    return values;
  }

  function normalizeBookmarkedFilter(value) {
    if (value === true || value === false) return value;
    if (typeof value !== "string") return null;
    const text = value.trim().toLowerCase();
    if (!text) return null;
    if (text === "1" || text === "true" || text === "yes") return true;
    if (text === "0" || text === "false" || text === "no") return false;
    return null;
  }

  function matchesAnnotationFilters(entity, filters = {}) {
    const annotation = getEntityAnnotation(entity);
    const bookmarked = normalizeBookmarkedFilter(filters.bookmarked ?? filters.bookmark);
    if (bookmarked !== null) {
      if (!annotation || annotation.bookmarked !== bookmarked) return false;
    }

    const manualTags = getRequestedManualTags(filters);
    if (manualTags.length) {
      const tagSet = new Set(annotation && Array.isArray(annotation.tags) ? annotation.tags.map(normalizeAnnotationTagValue) : []);
      for (const tag of manualTags) {
        if (!tagSet.has(tag)) return false;
      }
    }

    return true;
  }

  function hasAnnotationScopedFilters(filters = {}) {
    return normalizeBookmarkedFilter(filters.bookmarked ?? filters.bookmark) !== null ||
      getRequestedManualTags(filters).length > 0;
  }

  function clearAnnotationScopedFilters(filters = {}) {
    if (!filters || typeof filters !== "object") return {};
    const next = { ...filters };
    delete next.bookmarked;
    delete next.bookmark;
    delete next.manualTag;
    delete next.manual_tag;
    delete next.manualTags;
    return next;
  }

  function matchesSessionAnnotationScope(sessionLike, filters = {}) {
    if (!hasAnnotationScopedFilters(filters)) return true;
    if (matchesAnnotationFilters(sessionLike, filters)) return true;
    for (const turn of Array.isArray(sessionLike && sessionLike.turns) ? sessionLike.turns : []) {
      if (matchesAnnotationFilters(turn, filters)) return true;
    }
    return false;
  }

  function resolveRequestedPathRole(filters = {}) {
    return normalizePathRole(filters.pathRole || filters.path_role);
  }

  function getRequestedPathPattern(filters = {}) {
    return typeof (filters.pathPattern || filters.path_pattern) === "string"
      ? (filters.pathPattern || filters.path_pattern).trim()
      : "";
  }

  function hasSessionScopeFilters(filters = {}) {
    return Boolean(
      filters.cwd ||
      filters.sessionId ||
      filters.forkedFrom ||
      filters.forked_from ||
      filters.parentThread ||
      filters.parent_thread ||
      filters.lineageRoot ||
      filters.lineage_root ||
      filters.rootSession ||
      filters.root_session ||
      filters.memoryMode ||
      filters.memory_mode ||
      filters.eventMode ||
      filters.event_mode ||
      filters.qualityClass ||
      filters.quality_class ||
      filters.has
    );
  }

  function matchesSessionFilters(sessionLike, filters = {}) {
    if (filters.cwd && !(sessionLike.cwd || "").toLowerCase().includes(String(filters.cwd).toLowerCase())) {
      return false;
    }
    if (filters.sessionId) {
      const needle = prefixedSessionId(filters.sessionId);
      if (!needle || sessionLike.sessionId !== needle) return false;
    }
    if (filters.sessionKey && !matchesSessionLookupValue(sessionLike, filters.sessionKey)) {
      return false;
    }
    if (filters.forkedFrom || filters.forked_from) {
      const needle = prefixedSessionId(filters.forkedFrom || filters.forked_from);
      if (!needle || prefixedSessionId(sessionLike.forkedFromId) !== needle) return false;
    }
    if (filters.parentThread || filters.parent_thread) {
      const needle = prefixedSessionId(filters.parentThread || filters.parent_thread);
      if (!needle || prefixedSessionId(sessionLike.parentThreadId) !== needle) return false;
    }
    if (filters.lineageRoot || filters.lineage_root || filters.rootSession || filters.root_session) {
      const needle = prefixedSessionId(
        filters.lineageRoot ||
        filters.lineage_root ||
        filters.rootSession ||
        filters.root_session
      );
      const lineageRootId = prefixedSessionId(sessionLike.lineageRootId || sessionLike.sessionId);
      if (!needle || lineageRootId !== needle) return false;
    }

    const requestedMemoryMode = normalizeRolloutMemoryMode(filters.memoryMode || filters.memory_mode);
    if (requestedMemoryMode) {
      if (getSessionRolloutMemoryMode(sessionLike) !== requestedMemoryMode) return false;
    }

    const requestedEventMode = normalizeRolloutEventMode(filters.eventMode || filters.event_mode);
    if (requestedEventMode) {
      if (getSessionRolloutEventMode(sessionLike) !== requestedEventMode) return false;
    }

    const requestedQualityClass = normalizeSessionQualityClass(filters.qualityClass || filters.quality_class);
    if (requestedQualityClass) {
      if (classifySessionQuality(sessionLike) !== requestedQualityClass) return false;
    }

    if (filters.has) {
      const tags = getSessionTags(sessionLike);
      const wanted = Array.isArray(filters.has) ? filters.has : [filters.has];
      for (const tag of wanted) {
        const normalized = resolveRequestedSessionTag(sessionLike, tag);
        if (!normalized) continue;
        if (!tags.includes(normalized)) return false;
      }
    }

    if (!matchesSessionAnnotationScope(sessionLike, filters)) return false;

    return true;
  }

  function getRequestedCommandOpSignal(filters = {}) {
    return normalizeCommandOpSignal(filters.commandOpSignal || filters.command_op_signal);
  }

  function getRequestedQuery(filters = {}) {
    return typeof filters.query === "string"
      ? filters.query.trim()
      : "";
  }

  function getRequestedSearchMode(filters = {}, keys = [], fallback = "substring") {
    for (const key of Array.isArray(keys) ? keys : []) {
      if (!key) continue;
      const value = filters[key];
      if (typeof value === "string" && value.trim()) {
        return normalizeSearchMode(value, fallback);
      }
    }
    return fallback;
  }

  function getRequestedQMode(filters = {}) {
    return getRequestedSearchMode(filters, ["qMode", "q_mode"], "substring");
  }

  function getRequestedQueryMode(filters = {}) {
    return getRequestedSearchMode(filters, ["queryMode", "query_mode"], "substring");
  }

  function normalizeQueryCandidateValue(value) {
    if (typeof value === "string") return value.trim();
    if (value && typeof value === "object" && typeof value.query === "string") return value.query.trim();
    return "";
  }

  function getEntityQueryValues(entity) {
    return [
      ...(Array.isArray(entity && entity.recentQueries) ? entity.recentQueries : []),
      ...(Array.isArray(entity && entity.queries) ? entity.queries : []),
      ...(Array.isArray(entity && entity.queryArtifacts) ? entity.queryArtifacts : []),
    ];
  }

  function getMatchingQueryValues(values, filters = {}, modeOverride = "") {
    const requestedQuery = getRequestedQuery(filters).toLowerCase();
    if (!requestedQuery) return [];
    const requestedMode = normalizeSearchMode(modeOverride || getRequestedQueryMode(filters), "substring");
    const candidates = buildQuerySearchCandidates(values);

    if (requestedMode !== "substring") {
      return findSearchCandidateMatches(candidates, requestedQuery, requestedMode, {
        limit: requestedMode === "fuzzy" ? 5 : 50,
      }).matches.map((entry) => entry.text);
    }

    const matched = [];
    for (const candidate of candidates) {
      const text = normalizeQueryCandidateValue(candidate && candidate.value);
      if (!text) continue;
      if (!text.toLowerCase().includes(requestedQuery)) continue;
      matched.push(text);
    }
    return matched;
  }

  function getRecordQueryCandidates(record) {
    const values = [];
    const seen = new Set();
    const note = (value) => {
      const text = normalizeQueryCandidateValue(value);
      if (!text) return;
      const normalized = text.toLowerCase();
      if (seen.has(normalized)) return;
      seen.add(normalized);
      values.push(text);
    };

    for (const value of Array.isArray(record && record.commandQueries) ? record.commandQueries : []) note(value);
    note(record && record.query);
    for (const value of Array.isArray(record && record.queries) ? record.queries : []) note(value);
    return values;
  }

  function getTranscriptItemQueryCandidates(item) {
    const values = [];
    const seen = new Set();
    const note = (value) => {
      const text = normalizeQueryCandidateValue(value);
      if (!text) return;
      const normalized = text.toLowerCase();
      if (seen.has(normalized)) return;
      seen.add(normalized);
      values.push(text);
    };

    for (const value of Array.isArray(item && item.commandQueries) ? item.commandQueries : []) note(value);
    note(item && item.query);
    for (const value of Array.isArray(item && item.queries) ? item.queries : []) note(value);
    return values;
  }

  function matchesCommandOpValue(value, needle) {
    const normalizedValue = String(value || "").toLowerCase();
    const query = typeof needle === "string" ? needle.trim().toLowerCase() : "";
    if (!query) return Boolean(normalizedValue);
    return normalizedValue.includes(query);
  }

  function getMatchingFileValues(entity, filters = {}) {
    if (!entity || !filters.file) return [];
    const baseCwd = normalizeCwdValue(filters.cwd || entity.cwd || "");
    return (Array.isArray(entity.filesTouched) ? entity.filesTouched : []).filter((value) => matchesPathNeedle(value, filters.file, baseCwd));
  }

  function getMatchingCommandOps(values, filters = {}) {
    const needle = filters.commandOp || filters.command_op;
    const requestedSignal = getRequestedCommandOpSignal(filters);
    return (Array.isArray(values) ? values : []).filter((value) => {
      if (needle && !matchesCommandOpValue(value, needle)) return false;
      if (requestedSignal && classifyCommandOpSignal(value) !== requestedSignal) return false;
      return true;
    });
  }

  function matchesCommandOpFilters(values, filters = {}) {
    return getMatchingCommandOps(values, filters).length > 0;
  }

  function getEntityPathCandidates(entity, filters = {}, fallbackValues = []) {
    const requestedPathRole = resolveRequestedPathRole(filters);
    if (requestedPathRole) {
      return getPathRoleValues(entity && entity.pathRoles, requestedPathRole);
    }
    return Array.isArray(fallbackValues) ? fallbackValues : [];
  }

  function getEntityPathPatternCandidates(entity, filters = {}, fallbackValues = []) {
    const requestedPathRole = resolveRequestedPathRole(filters);
    if (requestedPathRole) {
      return getPathRoleValues(entity && entity.pathPatternRoles, requestedPathRole);
    }
    return Array.isArray(fallbackValues) ? fallbackValues : [];
  }

  function getMatchingPathValues(entity, filters = {}, fallbackValues = []) {
    const candidates = getEntityPathCandidates(entity, filters, fallbackValues);
    if (!filters.path) return candidates;
    const baseCwd = normalizeCwdValue(filters.cwd || (entity && entity.cwd) || "");
    return candidates.filter((value) => matchesPathNeedle(value, filters.path, baseCwd));
  }

  function getMatchingPathPatternValues(entity, filters = {}, fallbackValues = []) {
    const candidates = getEntityPathPatternCandidates(entity, filters, fallbackValues);
    const requestedPathPattern = getRequestedPathPattern(filters);
    if (!requestedPathPattern) return candidates;
    const baseCwd = normalizeCwdValue(filters.cwd || (entity && entity.cwd) || "");
    return candidates.filter((value) => matchesPathNeedle(value, requestedPathPattern, baseCwd));
  }

  function getMatchingRecordFileValues(record, filters = {}, resolvedCwd = "") {
    if (!record || !filters.file) return [];
    const refs = getRecordReferencedPaths(record, resolvedCwd || record.cwd);
    const baseCwd = normalizeCwdValue(filters.cwd || resolvedCwd || record.cwd || "");
    return refs.patchPaths.filter((value) => matchesPathNeedle(value, filters.file, baseCwd));
  }

  function getMatchingTranscriptItemFileValues(item, filters = {}) {
    if (!item || !filters.file) return [];
    const baseCwd = normalizeCwdValue(filters.cwd || item.cwd || "");
    return [
      ...(Array.isArray(item.filesTouched) ? item.filesTouched : []),
      ...getTranscriptItemMemoryCitationPaths(item),
    ].filter((value) => matchesPathNeedle(value, filters.file, baseCwd));
  }

  function matchesEntityPathFilters(entity, filters = {}, fallbackValues = []) {
    const candidates = getMatchingPathValues(entity, filters, fallbackValues);
    if (filters.path) {
      if (!candidates.length) return false;
    } else if (resolveRequestedPathRole(filters) && !candidates.length) {
      return false;
    }
    return true;
  }

  function matchesEntityPathPatternFilters(entity, filters = {}, fallbackValues = []) {
    const requestedPathPattern = getRequestedPathPattern(filters);
    const candidates = getMatchingPathPatternValues(entity, filters, fallbackValues);
    if (requestedPathPattern) {
      if (!candidates.length) return false;
    } else if (resolveRequestedPathRole(filters) && !candidates.length) {
      return false;
    }
    return true;
  }

  function sessionMatches(session, filters = {}) {
    if (!matchesSessionFilters(session, filters)) return null;
    const requestedPathRole = resolveRequestedPathRole(filters);
    const requestedPathPattern = getRequestedPathPattern(filters);
    const requestedQuery = getRequestedQuery(filters);
    const requestedQMode = getRequestedQMode(filters);
    const requestedQueryMode = getRequestedQueryMode(filters);
    const matchedCommandOps = filters.commandOp || filters.command_op || filters.commandOpSignal || filters.command_op_signal
      ? sortCommandOpValues(getMatchingCommandOps(getEntityCommandOpArtifacts(session), filters))
      : [];
    const matchedFiles = filters.file ? getMatchingFileValues(session, filters) : [];
    const matchedPaths = filters.path || requestedPathRole
      ? getMatchingPathValues(session, filters, getEntityPathArtifacts(session))
      : [];
    const matchedPathPatterns = requestedPathPattern || requestedPathRole
      ? getMatchingPathPatternValues(session, filters, getEntityPathPatternArtifacts(session))
      : [];
    let matchedQueries = [];
    let queryMatch = null;
    if (requestedQuery) {
      matchedQueries = getMatchingQueryValues(
        getEntityQueryValues(session),
        filters,
        requestedQueryMode
      );
      if (matchedQueries.length) {
        queryMatch = {
          kind: "query",
          text: matchedQueries[0],
          score: requestedQueryMode === "substring"
            ? 1400
            : findSearchCandidateMatches(
              getSessionQuerySearchCandidates(session),
              requestedQuery,
              requestedQueryMode,
              { limit: 1 }
            ).bestScore,
        };
      }
    }

    if (filters.tool) {
      const needle = String(filters.tool).toLowerCase();
      if (!session.toolsUsed.some((toolName) => toolName.toLowerCase().includes(needle))) return null;
    }

    if (filters.file && !matchedFiles.length) return null;
    if (filters.path && !matchedPaths.length) return null;
    if (requestedPathPattern && !matchedPathPatterns.length) return null;
    if (requestedPathRole && !filters.path && !requestedPathPattern && !matchedPaths.length && !matchedPathPatterns.length) {
      return null;
    }
    if (requestedQuery && !matchedQueries.length) return null;

    if (filters.commandOp || filters.command_op || filters.commandOpSignal || filters.command_op_signal) {
      if (!matchedCommandOps.length) return null;
    }

    if (filters.commandType) {
      const needle = String(filters.commandType).toLowerCase();
      if (!(session.commandTypes || []).some((type) => type.toLowerCase().includes(needle))) return null;
    }

    if (filters.error) {
      const needle = String(filters.error).toLowerCase();
      if (!session.recentErrors.some((entry) => errorEntryMatchesNeedle(entry, needle))) return null;
    }

    const rawQ = typeof filters.q === "string" ? filters.q.trim() : "";
    const q = rawQ.toLowerCase();
    if (!q) {
      return {
        score: queryMatch && requestedQueryMode !== "substring"
          ? queryMatch.score
          : (toTimestampMs(session.updatedAt) || 0),
        reasons: queryMatch ? [queryMatch.kind] : [],
        matchedCommandOps,
        matchedFiles,
        matchedPaths,
        matchedPathPatterns,
        matchedQueries,
        match: queryMatch ? { kind: queryMatch.kind, text: queryMatch.text } : null,
      };
    }

    if (requestedQMode !== "substring") {
      const sessionMatch = findSearchCandidateMatches(
        getSessionFindSearchCandidates(session),
        rawQ,
        requestedQMode,
        { limit: 5 }
      );
      if (!sessionMatch.bestMatch) return null;
      const reasons = [sessionMatch.bestMatch.kind];
      if (queryMatch && !reasons.includes(queryMatch.kind)) reasons.push(queryMatch.kind);
      return {
        score: sessionMatch.bestScore,
        reasons,
        matchedCommandOps,
        matchedFiles,
        matchedPaths,
        matchedPathPatterns,
        matchedQueries,
        match: {
          kind: sessionMatch.bestMatch.kind,
          text: sessionMatch.bestMatch.text,
        },
      };
    }

    let score = 0;
    const reasons = [];
    const note = (amount, reason) => {
      score += amount;
      if (reason && !reasons.includes(reason)) reasons.push(reason);
    };

    if ((session.sessionId || "").toLowerCase().includes(q)) note(12, "session_id");
    if ((session.lineageRootId || "").toLowerCase().includes(q)) note(11, "lineage_root");
    if ((getSessionKey(session) || "").toLowerCase().includes(q)) note(11, "session_key");
    if ((session.filePath || "").toLowerCase().includes(q)) note(10, "file_path");
    if ((session.cwd || "").toLowerCase().includes(q)) note(10, "cwd");
    if ((session.focusRoot || "").toLowerCase().includes(q)) note(9, "focus_root");
    if ((session.finalAnswerPreview || "").toLowerCase().includes(q)) note(9, "final_answer");
    if ((session.lastUserPreview || "").toLowerCase().includes(q)) note(8, "user_prompt");
    if (session.filesTouched.some((filePath) => matchesPathNeedle(filePath, q, session.cwd))) note(8, "files");
    if (getEntityPathArtifacts(session).some((filePath) => matchesPathNeedle(filePath, q, session.cwd))) note(8, "paths");
    if (getEntityPathPatternArtifacts(session).some((pattern) => matchesPathNeedle(pattern, q, session.cwd))) note(8, "path_pattern");
    if (session.recentCommands.some((entry) => (entry.command || "").toLowerCase().includes(q))) note(7, "commands");
    if (session.recentQueries.some((entry) => (entry.query || "").toLowerCase().includes(q))) note(7, "queries");
    if (session.recentErrors.some((entry) => errorEntryMatchesNeedle(entry, q))) note(7, "errors");
    if (session.toolsUsed.some((toolName) => toolName.toLowerCase().includes(q))) note(6, "tools");
    if (getEntityCommandOpArtifacts(session).some((value) => value.toLowerCase().includes(q))) note(6, "command_op");
    if ((session.commandTypes || []).some((type) => type.toLowerCase().includes(q))) note(5, "command_type");
    const annotation = getEntityAnnotation(session);
    if (annotation && annotation.note && annotation.note.toLowerCase().includes(q)) note(8, "annotation_note");
    if (annotation && annotation.tags.some((tag) => tag.toLowerCase().includes(q))) note(7, "manual_tag");
    if (annotation && annotation.bookmarked && "bookmark".includes(q)) note(5, "bookmarked");
    if ((session.searchText || "").includes(q)) note(3, "text");

    if (!score) return null;
    return {
      score,
      reasons,
      matchedCommandOps,
      matchedFiles,
      matchedPaths,
      matchedPathPatterns,
      matchedQueries,
      match: queryMatch ? { kind: queryMatch.kind, text: queryMatch.text } : null,
    };
  }

  function eventMatches(item, filters = {}) {
    const record = item && item.record ? item.record : item;
    const resolvedTurnId = item && Object.prototype.hasOwnProperty.call(item, "resolvedTurnId")
      ? item.resolvedTurnId
      : record.turnId;
    const resolvedCwd = item && Object.prototype.hasOwnProperty.call(item, "resolvedCwd")
      ? item.resolvedCwd
      : record.cwd;
    const requestedPathRole = resolveRequestedPathRole(filters);
    const requestedPathPattern = getRequestedPathPattern(filters);
    const requestedQuery = getRequestedQuery(filters);
    const pathRefs = getRecordReferencedPaths(record, resolvedCwd);
    const pathPatternRefs = getRecordReferencedPathPatterns(record, resolvedCwd);
    const matchedCommandOps = filters.commandOp || filters.command_op || filters.commandOpSignal || filters.command_op_signal
      ? sortCommandOpValues(getMatchingCommandOps(record.shellCommands, filters))
      : [];
    const matchedFiles = filters.file ? getMatchingRecordFileValues(record, filters, resolvedCwd) : [];
    const matchedPaths = filters.path || requestedPathRole
      ? getMatchingPathValues({
        cwd: resolvedCwd || record.cwd || "",
        pathRoles: pathRefs.pathRoles,
      }, filters, pathRefs.allPaths)
      : [];
    const matchedPathPatterns = requestedPathPattern || requestedPathRole
      ? getMatchingPathPatternValues({
        cwd: resolvedCwd || record.cwd || "",
        pathPatternRoles: pathPatternRefs.pathPatternRoles,
      }, filters, pathPatternRefs.commandPathPatterns)
      : [];
    const matchedQueries = requestedQuery
      ? getMatchingQueryValues(getRecordQueryCandidates(record), filters)
      : [];

    if (filters.kind) {
      const needle = String(filters.kind).toLowerCase();
      if (!(record.kind || "").toLowerCase().includes(needle)) return null;
    }

    if (filters.tool) {
      const needle = String(filters.tool).toLowerCase();
      if (!(record.toolName || "").toLowerCase().includes(needle)) return null;
    }

    if (filters.commandType) {
      const needle = String(filters.commandType).toLowerCase();
      if (!(Array.isArray(record.commandTypes) ? record.commandTypes : []).some((type) => type.toLowerCase().includes(needle))) {
        return null;
      }
    }

    if (filters.commandOp || filters.command_op || filters.commandOpSignal || filters.command_op_signal) {
      if (!matchedCommandOps.length) return null;
    }

    if (filters.turn) {
      const needle = String(filters.turn).toLowerCase();
      if (!(resolvedTurnId || "").toLowerCase().includes(needle)) return null;
    }

    if (filters.file && !matchedFiles.length) return null;
    if (filters.path && !matchedPaths.length) return null;

    if (requestedPathRole && !filters.path && !requestedPathPattern && !matchedPaths.length && !matchedPathPatterns.length) {
      return null;
    }

    if (requestedPathPattern && !matchedPathPatterns.length) return null;
    if (requestedQuery && !matchedQueries.length) return null;

    if (filters.error) {
      const needle = String(filters.error).toLowerCase();
      const errorText = [
        record.preview,
        record.text,
        ...getRecordErrorSearchValues(record),
        record.output && record.output.text,
        record.output && record.output.preview,
        record.mcp && record.mcp.resultPreview,
      ].filter(Boolean).join("\n").toLowerCase();
      if (!getRecordErrorSearchValues(record).length || !errorText.includes(needle)) return null;
    }

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

    const text = [
      record.key,
      record.kind,
      record.preview,
      record.text,
      record.command,
      record.commandSource,
      Array.isArray(record.commandTypes) ? record.commandTypes.join("\n") : "",
      Array.isArray(record.commandTypeHints) ? record.commandTypeHints.join("\n") : "",
      Array.isArray(record.shellCommands) ? record.shellCommands.join("\n") : "",
      Array.isArray(record.commandPaths)
        ? record.commandPaths.map((value) => normalizeReferencedPath(record.cwd, value)).join("\n")
        : "",
      Array.isArray(record.commandPathPatterns)
        ? record.commandPathPatterns.map((value) => normalizeReferencedPathPattern(record.cwd, value) || value).join("\n")
        : "",
      Array.isArray(record.commandQueries) ? record.commandQueries.join("\n") : "",
      record.query,
      Array.isArray(record.queries) ? record.queries.join("\n") : "",
      record.role,
      record.phase,
      record.toolName,
      record.toolStatus,
      record.cwd,
      ...getRecordErrorSearchValues(record),
      record.output && record.output.text,
      record.output && record.output.preview,
      record.mcp && record.mcp.resultPreview,
      record.sessionMeta && record.sessionMeta.cwd,
      record.turnContext && record.turnContext.model,
      record.patch && Array.isArray(record.patch.files)
        ? record.patch.files.map((file) => file && file.path).filter(Boolean).join("\n")
        : "",
    ].filter(Boolean).join("\n").toLowerCase();

    if (!text.includes(q)) return null;

    return {
      matchedFiles,
      matchedPaths,
      matchedPathPatterns,
      matchedCommandOps,
      matchedQueries,
    };
  }

  function hasTurnScopedFilters(filters = {}) {
    return Boolean(
      (typeof filters.q === "string" && filters.q.trim()) ||
      hasAnnotationScopedFilters(filters) ||
      getRequestedQuery(filters) ||
      filters.tool ||
      filters.file ||
      filters.path ||
      filters.pathPattern ||
      filters.path_pattern ||
      filters.pathRole ||
      filters.path_role ||
      filters.commandOp ||
      filters.command_op ||
      filters.commandOpSignal ||
      filters.command_op_signal ||
      filters.commandType ||
      filters.error
    );
  }

  function turnMatches(turn, filters = {}) {
    if (!matchesAnnotationFilters(turn, filters)) return null;
    const requestedPathRole = resolveRequestedPathRole(filters);
    const requestedPathPattern = getRequestedPathPattern(filters);
    const requestedQuery = getRequestedQuery(filters);
    const matchedCommandOps = filters.commandOp || filters.command_op || filters.commandOpSignal || filters.command_op_signal
      ? sortCommandOpValues(getMatchingCommandOps(getEntityCommandOpArtifacts(turn), filters))
      : [];
    const matchedFiles = filters.file ? getMatchingFileValues(turn, filters) : [];
    const matchedPaths = filters.path || requestedPathRole
      ? getMatchingPathValues(turn, filters, getEntityPathArtifacts(turn))
      : [];
    const matchedPathPatterns = requestedPathPattern || requestedPathRole
      ? getMatchingPathPatternValues(turn, filters, getEntityPathPatternArtifacts(turn))
      : [];
    const matchedQueries = requestedQuery
      ? getMatchingQueryValues(getEntityQueryValues(turn), filters)
      : [];

    if (filters.turn) {
      const needle = String(filters.turn).toLowerCase();
      if (!(turn.turnId || "").toLowerCase().includes(needle)) return null;
    }

    if (filters.status) {
      const needle = String(filters.status).toLowerCase();
      if (!(turn.status || "").toLowerCase().includes(needle)) return null;
    }

    if (filters.tool) {
      const needle = String(filters.tool).toLowerCase();
      if (!turn.toolsUsed.some((toolName) => toolName.toLowerCase().includes(needle))) return null;
    }

    if (filters.file && !matchedFiles.length) return null;
    if (filters.path && !matchedPaths.length) return null;
    if (requestedPathPattern && !matchedPathPatterns.length) return null;

    if (requestedPathRole && !filters.path && !requestedPathPattern && !matchedPaths.length && !matchedPathPatterns.length) {
      return null;
    }

    if (requestedQuery && !matchedQueries.length) return null;

    if (filters.commandOp || filters.command_op || filters.commandOpSignal || filters.command_op_signal) {
      if (!matchedCommandOps.length) return null;
    }

    if (filters.commandType) {
      const needle = String(filters.commandType).toLowerCase();
      if (!(turn.commandTypes || []).some((type) => type.toLowerCase().includes(needle))) return null;
    }

    if (filters.error) {
      const needle = String(filters.error).toLowerCase();
      if (!turn.errors.some((entry) => errorEntryMatchesNeedle(entry, needle))) return null;
    }

    const q = typeof filters.q === "string" ? filters.q.trim().toLowerCase() : "";
    if (!q) {
      return {
        score: toTimestampMs(turn.endedAt || turn.startedAt) || 0,
        reasons: [],
        matchedCommandOps,
        matchedFiles,
        matchedPaths,
        matchedPathPatterns,
        matchedQueries,
      };
    }

    let score = 0;
    const reasons = [];
    const note = (amount, reason) => {
      score += amount;
      if (reason && !reasons.includes(reason)) reasons.push(reason);
    };

    if ((turn.turnId || "").toLowerCase().includes(q)) note(12, "turn_id");
    if ((turn.finalAnswerPreview || "").toLowerCase().includes(q)) note(9, "final_answer");
    if ((turn.userPromptPreview || "").toLowerCase().includes(q)) note(8, "user_prompt");
    if ((turn.commentaryPreview || "").toLowerCase().includes(q)) note(7, "commentary");
    if (turn.filesTouched.some((filePath) => matchesPathNeedle(filePath, q, turn.cwd))) note(8, "files");
    if (getEntityPathArtifacts(turn).some((filePath) => matchesPathNeedle(filePath, q, turn.cwd))) note(8, "paths");
    if (getEntityPathPatternArtifacts(turn).some((pattern) => matchesPathNeedle(pattern, q, turn.cwd))) note(8, "path_pattern");
    if (turn.commands.some((entry) => (entry.command || "").toLowerCase().includes(q))) note(7, "commands");
    if (turn.queries.some((entry) => {
      const text = entry && typeof entry === "object"
        ? entry.query
        : (typeof entry === "string" ? entry : "");
      return text.toLowerCase().includes(q);
    })) note(7, "queries");
    if (turn.errors.some((entry) => errorEntryMatchesNeedle(entry, q))) note(7, "errors");
    if (turn.toolsUsed.some((toolName) => toolName.toLowerCase().includes(q))) note(6, "tools");
    if (getEntityCommandOpArtifacts(turn).some((value) => value.toLowerCase().includes(q))) note(6, "command_op");
    if ((turn.commandTypes || []).some((type) => type.toLowerCase().includes(q))) note(5, "command_type");
    const annotation = getEntityAnnotation(turn);
    if (annotation && annotation.note && annotation.note.toLowerCase().includes(q)) note(8, "annotation_note");
    if (annotation && annotation.tags.some((tag) => tag.toLowerCase().includes(q))) note(7, "manual_tag");
    if (annotation && annotation.bookmarked && "bookmark".includes(q)) note(5, "bookmarked");
    if ((turn.summary || "").toLowerCase().includes(q)) note(3, "summary");

    if (!score) return null;
    return { score, reasons, matchedCommandOps, matchedFiles, matchedPaths, matchedPathPatterns, matchedQueries };
  }

  return {
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
  };
}

function normalizeCommandOpSignal(value) {
  const text = typeof value === "string"
    ? value.trim().toLowerCase().replace(/[\s-]+/g, "_")
    : "";
  if (!text) return "";
  if (text === "normal") return "medium";
  return text === "high" || text === "medium" || text === "low" ? text : "";
}

function matchesSessionLookupValue(sessionLike, value) {
  const needle = normalizeSessionLookupValue(value);
  if (!needle) return false;
  const key = sessionLike && typeof sessionLike.sessionKey === "string"
    ? normalizeSessionLookupValue(sessionLike.sessionKey)
    : "";
  if (key && key === needle) return true;
  const filePath = sessionLike && typeof sessionLike.filePath === "string"
    ? normalizeSessionLookupValue(sessionLike.filePath)
    : "";
  if (filePath && filePath === needle) return true;
  return false;
}

function normalizeSessionLookupValue(value) {
  if (typeof value !== "string") return "";
  const text = value.trim();
  if (!text) return "";
  return text.toLowerCase();
}

module.exports = { createCatalogMatchers };
