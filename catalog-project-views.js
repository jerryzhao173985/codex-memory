"use strict";

function createCatalogProjectViews(deps = {}) {
  const {
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
  } = deps;

  function getProjectSessions(catalog, cwd) {
    const needle = normalizeCwdValue(cwd);
    if (!needle || !catalog || !Array.isArray(catalog.sessions)) return [];
    return catalog.sessions.filter((session) => normalizeCwdValue(session.cwd) === needle);
  }

  function projectMatches(project, catalog, filters = {}) {
    const projectCwd = normalizeCwdValue(project && project.cwd);
    if (!projectCwd) return null;
    const requestedPathRole = resolveRequestedPathRole(filters);
    const requestedPathPattern = getRequestedPathPattern(filters);
    const requestedQuery = getRequestedQuery(filters);

    if (filters.cwd && !projectCwd.toLowerCase().includes(String(filters.cwd).toLowerCase())) {
      return null;
    }

    const sessions = getProjectSessions(catalog, projectCwd).filter((session) => matchesSessionFilters(session, filters));
    if (!sessions.length) return null;

    if (filters.tool) {
      const needle = String(filters.tool).toLowerCase();
      if (!sessions.some((session) => session.toolsUsed.some((toolName) => toolName.toLowerCase().includes(needle)))) {
        return null;
      }
    }

    if (filters.file) {
      if (!sessions.some((session) => getMatchingFileValues(session, filters).length)) {
        return null;
      }
    }

    if (filters.path) {
      if (!sessions.some((session) => getMatchingPathValues(session, filters, getEntityPathArtifacts(session)).length)) {
        return null;
      }
    }

    if (requestedPathPattern) {
      if (!sessions.some((session) => getMatchingPathPatternValues(session, filters, getEntityPathPatternArtifacts(session)).length)) {
        return null;
      }
    }

    if (requestedPathRole && !filters.path && !requestedPathPattern) {
      if (!sessions.some((session) => (
        getMatchingPathValues(session, filters, getEntityPathArtifacts(session)).length ||
        getMatchingPathPatternValues(session, filters, getEntityPathPatternArtifacts(session)).length
      ))) {
        return null;
      }
    }

    if (requestedQuery) {
      if (!sessions.some((session) => getMatchingQueryValues(session.queryArtifacts || session.recentQueries, filters).length)) {
        return null;
      }
    }

    if (filters.commandOp || filters.command_op || filters.commandOpSignal || filters.command_op_signal) {
      if (!sessions.some((session) => matchesCommandOpFilters(getEntityCommandOpArtifacts(session), filters))) {
        return null;
      }
    }

    if (filters.commandType) {
      const needle = String(filters.commandType).toLowerCase();
      if (!sessions.some((session) => (session.commandTypes || []).some((type) => type.toLowerCase().includes(needle)))) {
        return null;
      }
    }

    if (filters.error) {
      const needle = String(filters.error).toLowerCase();
      if (!sessions.some((session) => session.recentErrors.some((entry) => errorEntryMatchesNeedle(entry, needle)))) {
        return null;
      }
    }

    const q = typeof filters.q === "string" ? filters.q.trim().toLowerCase() : "";
    if (!q) {
      return { score: toTimestampMs(project.updatedAt) || 0, reasons: [] };
    }

    let score = 0;
    const reasons = [];
    const note = (amount, reason) => {
      score += amount;
      if (reason && !reasons.includes(reason)) reasons.push(reason);
    };

    if (projectCwd.toLowerCase().includes(q)) note(12, "cwd");
    if ((project.topFocusRoots || []).some((item) => (item.root || "").toLowerCase().includes(q))) note(10, "focus_root");
    if (project.recentSessions.some((session) => (session.focusRoot || "").toLowerCase().includes(q))) note(9, "recent_focus_root");
    if (project.recentSessions.some((session) => (session.sessionId || "").toLowerCase().includes(q))) note(10, "session_id");
    if (project.recentSessions.some((session) => (getSessionKey(session) || "").toLowerCase().includes(q))) note(10, "session_key");
    if (project.recentSessions.some((session) => (session.finalAnswerPreview || "").toLowerCase().includes(q))) note(9, "final_answer");
    if (project.recentSessions.some((session) => (session.lastUserPreview || "").toLowerCase().includes(q))) note(8, "user_prompt");
    if (project.topFiles.some((item) => matchesPathNeedle(item && item.file, q, project.cwd))) note(8, "files");
    if ((project.topPaths || []).some((item) => matchesPathNeedle(item && item.path, q, project.cwd))) note(8, "paths");
    if (project.topErrors.some((item) => (item.error || "").toLowerCase().includes(q))) note(7, "errors");
    if (sessions.some((session) => session.recentErrors.some((entry) => errorEntryMatchesNeedle(entry, q)))) note(7, "errors");
    if (project.topTools.some((item) => (item.tool || "").toLowerCase().includes(q))) note(6, "tools");
    if (sessions.some((session) => getEntityCommandOpArtifacts(session).some((value) => value.toLowerCase().includes(q)))) note(6, "command_op");
    if ((project.searchText || "").includes(q)) note(3, "text");

    if (!score) return null;
    return { score, reasons };
  }

  function summarizeProject(project, extra = {}) {
    const recentSessionLimit = Number.isInteger(extra.recentSessionLimit) && extra.recentSessionLimit > 0
      ? extra.recentSessionLimit
      : MAX_PROJECT_SESSION_REFS;
    return {
      cwd: project.cwd,
      startedAt: project.startedAt,
      updatedAt: project.updatedAt,
      endedAt: project.endedAt,
      sessionCount: project.sessionCount,
      turnCount: project.turnCount,
      counts: project.counts,
      tags: project.tags,
      models: project.models,
      topTools: project.topTools,
      topFiles: project.topFiles,
      topPaths: project.topPaths || [],
      topFocusRoots: project.topFocusRoots || [],
      topProjectPaths: project.topProjectPaths || [],
      topExternalPaths: project.topExternalPaths || [],
      topErrors: project.topErrors,
      recentSessions: project.recentSessions.slice(0, recentSessionLimit),
      manualCounts: extra.manualCounts || null,
      topManualTags: extra.topManualTags || [],
      matchedManualCounts: extra.matchedManualCounts || null,
      matchedTopManualTags: extra.matchedTopManualTags || [],
      matchScore: extra.matchScore ?? null,
      matchReasons: extra.matchReasons || [],
    };
  }

  function summarizeProjectCompact(project, extra = {}) {
    return {
      cwd: project.cwd,
      startedAt: project.startedAt,
      updatedAt: project.updatedAt,
      endedAt: project.endedAt,
      sessionCount: project.sessionCount,
      turnCount: project.turnCount,
      counts: project.counts,
      tags: project.tags,
      topTools: (project.topTools || []).slice(0, 5),
      topFiles: (project.topFiles || []).slice(0, 5),
      topPaths: (project.topPaths || []).slice(0, 5),
      topFocusRoots: (project.topFocusRoots || []).slice(0, 5),
      topProjectPaths: (project.topProjectPaths || []).slice(0, 5),
      topExternalPaths: (project.topExternalPaths || []).slice(0, 5),
      manualCounts: extra.manualCounts || null,
      topManualTags: extra.topManualTags || [],
      matchedManualCounts: extra.matchedManualCounts || null,
      matchedTopManualTags: extra.matchedTopManualTags || [],
      matchScore: extra.matchScore ?? null,
      matchReasons: extra.matchReasons || [],
    };
  }

  function summarizeProjectTurn(session, turn, extra = {}) {
    return {
      sessionId: session.sessionId,
      sessionKey: getSessionKey(session),
      forkedFromId: session.forkedFromId || null,
      parentThreadId: session.parentThreadId || null,
      lineageRootId: session.lineageRootId || session.sessionId || null,
      lineageDepth: Number.isInteger(session.lineageDepth) ? session.lineageDepth : 0,
      sessionUpdatedAt: session.updatedAt,
      cwd: turn.cwd || session.cwd,
      model: turn.model || session.model,
      focusRoot: normalizeProjectAreaValue(extra.focusRoot || getEntityProjectAreaRoot(turn, turn.cwd || session.cwd || "")) || null,
      turnId: turn.turnId,
      startedAt: turn.startedAt,
      endedAt: turn.endedAt,
      status: turn.status,
      userPromptPreview: turn.userPromptPreview,
      commentaryPreview: turn.commentaryPreview,
      finalAnswerPreview: turn.finalAnswerPreview,
      toolsUsed: turn.toolsUsed,
      filesTouched: turn.filesTouched,
      matchedFiles: Array.isArray(extra.matchedFiles) ? extra.matchedFiles : [],
      pathsReferenced: turn.pathsReferenced || [],
      matchedPaths: Array.isArray(extra.matchedPaths) ? extra.matchedPaths : [],
      pathRoles: clonePathRoleBuckets(turn.pathRoles),
      pathPatterns: turn.pathPatternArtifacts || [],
      matchedPathPatterns: Array.isArray(extra.matchedPathPatterns) ? extra.matchedPathPatterns : [],
      pathPatternRoles: clonePathRoleBuckets(turn.pathPatternRoles),
      commandTypes: turn.commandTypes || [],
      commandOps: sortCommandOpValues(turn.commandOpArtifacts || []),
      matchedCommandOps: Array.isArray(extra.matchedCommandOps) ? extra.matchedCommandOps : [],
      matchedQueries: Array.isArray(extra.matchedQueries) ? extra.matchedQueries : [],
      queries: turn.queries,
      errors: turn.errors,
      annotation: getEntityAnnotation(turn),
      summary: turn.summary,
      matchScore: extra.matchScore ?? null,
      matchReasons: extra.matchReasons || [],
    };
  }

  function summarizeProjectTurnCompact(session, turn, extra = {}) {
    return {
      sessionId: session.sessionId,
      sessionKey: getSessionKey(session),
      forkedFromId: session.forkedFromId || null,
      parentThreadId: session.parentThreadId || null,
      lineageRootId: session.lineageRootId || session.sessionId || null,
      lineageDepth: Number.isInteger(session.lineageDepth) ? session.lineageDepth : 0,
      sessionUpdatedAt: session.updatedAt,
      cwd: turn.cwd || session.cwd,
      model: turn.model || session.model,
      turnId: turn.turnId,
      startedAt: turn.startedAt,
      endedAt: turn.endedAt,
      status: turn.status,
      userPromptPreview: shapeCompactPreview(turn.userPromptPreview),
      commentaryPreview: shapeCompactPreview(turn.commentaryPreview),
      finalAnswerPreview: shapeCompactPreview(turn.finalAnswerPreview),
      summary: shapeCompactPreview(turn.summary, {
        maxChars: COMPACT_SUMMARY_CHARS,
        maxLines: COMPACT_SUMMARY_LINES,
      }),
      toolsUsed: turn.toolsUsed,
      commandTypes: turn.commandTypes || [],
      commandOps: sortCommandOpValues(turn.commandOpArtifacts || []),
      annotation: getEntityAnnotation(turn),
      counts: {
        files: Array.isArray(turn.filesTouched) ? turn.filesTouched.length : 0,
        paths: Array.isArray(turn.pathsReferenced) ? turn.pathsReferenced.length : 0,
        queries: Array.isArray(turn.queries) ? turn.queries.length : 0,
        errors: Array.isArray(turn.errors) ? turn.errors.length : 0,
      },
      matchedFiles: Array.isArray(extra.matchedFiles) ? extra.matchedFiles : [],
      matchedPaths: Array.isArray(extra.matchedPaths) ? extra.matchedPaths : [],
      matchedPathPatterns: Array.isArray(extra.matchedPathPatterns) ? extra.matchedPathPatterns : [],
      matchedCommandOps: Array.isArray(extra.matchedCommandOps) ? extra.matchedCommandOps : [],
      matchedQueries: Array.isArray(extra.matchedQueries) ? extra.matchedQueries : [],
      matchScore: extra.matchScore ?? null,
      matchReasons: extra.matchReasons || [],
    };
  }

  function createProjectAreaSummary(root, cwd) {
    return {
      root,
      cwd,
      sessionIds: new Set(),
      sessionRefs: new Map(),
      turns: [],
      turnCount: 0,
      counts: {
        commands: 0,
        writes: 0,
        searches: 0,
        errors: 0,
      },
      tools: {},
      files: {},
      paths: {},
      recentSessions: new Map(),
    };
  }

  function getProjectAreaReasonNote(reason) {
    return PROJECT_AREA_REASON_NOTES[reason] || PROJECT_AREA_REASON_NOTES.no_local_anchor;
  }

  function createProjectAreaUnscopedSummary() {
    return {
      sessionReasons: {},
      turnReasons: {},
      sessionSamples: [],
      turnSamples: [],
    };
  }

  function noteProjectAreaUnscopedReason(reasonMap, reason) {
    const normalizedReason = typeof reason === "string" && reason.trim()
      ? reason.trim()
      : "no_local_anchor";
    reasonMap[normalizedReason] = (reasonMap[normalizedReason] || 0) + 1;
  }

  function addProjectAreaUnscopedSample(samples, sample) {
    if (!sample || samples.length >= MAX_UNSCOPED_AREA_SAMPLES) return;
    samples.push(sample);
  }

  function summarizeProjectAreaReasonCounts(reasonMap) {
    return Object.entries(reasonMap || {})
      .map(([reason, count]) => ({
        reason,
        count,
        note: getProjectAreaReasonNote(reason),
      }))
      .sort((left, right) => right.count - left.count || left.reason.localeCompare(right.reason));
  }

  function getEntityProjectAreaEvidence(entity, cwd) {
    const fileRoots = new Set();
    const pathRoots = new Set();
    const patternRoots = new Set();
    let externalPathCount = 0;
    let localPatternCount = 0;

    for (const filePath of entity && Array.isArray(entity.filesTouched) ? entity.filesTouched : []) {
      const root = deriveProjectFocusRoot(cwd, filePath);
      if (root) fileRoots.add(root);
    }

    for (const referencedPath of getEntityPathArtifacts(entity)) {
      const root = deriveProjectFocusRoot(cwd, referencedPath);
      if (root) {
        pathRoots.add(root);
      } else if (referencedPath) {
        externalPathCount += 1;
      }
    }

    for (const pattern of getEntityPathPatternArtifacts(entity)) {
      const root = deriveProjectPatternFocusRoot(cwd, pattern);
      if (root) {
        patternRoots.add(root);
        continue;
      }
      const normalized = normalizeReferencedPathPattern(cwd, pattern);
      if (deriveRelativeDisplayPath(cwd, normalized)) localPatternCount += 1;
    }

    const commandTypes = Array.isArray(entity && entity.commandTypes)
      ? entity.commandTypes.map((value) => String(value || "").trim().toLowerCase()).filter(Boolean)
      : [];
    const queryCount = Array.isArray(entity && entity.queries) ? entity.queries.length : 0;
    const commandCount = Array.isArray(entity && entity.commands)
      ? entity.commands.length
      : (Number.isInteger(entity && entity.commandCount) ? entity.commandCount : 0);
    const pathArtifactCount = getEntityPathArtifacts(entity).length;
    const pathPatternCount = getEntityPathPatternArtifacts(entity).length;
    const fileCount = Array.isArray(entity && entity.filesTouched) ? entity.filesTouched.length : 0;
    const previewText = [
      entity && entity.lastUserPreview,
      entity && entity.userPromptPreview,
      entity && entity.summary,
    ].filter(Boolean).join("\n").toLowerCase();

    return {
      fileRootCount: fileRoots.size,
      pathRootCount: pathRoots.size,
      patternRootCount: patternRoots.size,
      localRootCount: fileRoots.size + pathRoots.size + patternRoots.size,
      externalPathCount,
      localPatternCount,
      queryCount,
      commandTypes,
      commandCount,
      pathArtifactCount,
      pathPatternCount,
      fileCount,
      hasActivity: Boolean(commandCount || queryCount || pathArtifactCount || pathPatternCount || fileCount),
      searchOnly: commandTypes.length > 0 && commandTypes.every((type) => type === "search"),
      previewAborted: previewText.includes("<turn_aborted>"),
    };
  }

  function classifyEntityProjectAreaReason(entity, cwd, options = {}) {
    const evidence = getEntityProjectAreaEvidence(entity, cwd);
    if (evidence.localRootCount > 0) return "";

    if ((String(entity && entity.status || "").toLowerCase() === "aborted" || evidence.previewAborted) && !evidence.hasActivity) {
      return "aborted_no_activity";
    }
    if (options.sessionWithoutTurns === true) {
      if (evidence.queryCount > 0 && !evidence.pathArtifactCount && !evidence.pathPatternCount && !evidence.fileCount) {
        return "query_only_search";
      }
      return "session_without_turns";
    }
    if (evidence.queryCount > 0 && !evidence.pathArtifactCount && !evidence.pathPatternCount && !evidence.fileCount) {
      return "query_only_search";
    }
    if (evidence.externalPathCount > 0 && !evidence.fileRootCount && !evidence.pathRootCount && !evidence.patternRootCount) {
      return "external_only";
    }
    if (evidence.pathPatternCount > 0 && !evidence.patternRootCount && !evidence.pathArtifactCount && !evidence.fileCount) {
      return "pattern_only_scope";
    }
    return evidence.hasActivity ? "no_local_anchor" : "session_without_turns";
  }

  function summarizeUnscopedProjectAreaSession(session, reason, options = {}) {
    return {
      sessionId: session.sessionId,
      updatedAt: session.updatedAt || session.endedAt || session.startedAt || null,
      model: session.model || null,
      reason,
      note: getProjectAreaReasonNote(reason),
      turnCount: Number.isInteger(options.turnCount) ? options.turnCount : (session.turnCount || 0),
      preview: shapeCompactPreview(session.lastUserPreview || session.commentaryPreview || session.finalAnswerPreview),
    };
  }

  function summarizeUnscopedProjectAreaTurn(session, turn, reason) {
    return {
      sessionId: session.sessionId,
      turnId: turn.turnId,
      status: turn.status || null,
      startedAt: turn.startedAt || null,
      endedAt: turn.endedAt || null,
      reason,
      note: getProjectAreaReasonNote(reason),
      preview: shapeCompactPreview(turn.userPromptPreview || turn.summary || turn.commentaryPreview || turn.finalAnswerPreview),
    };
  }

  function noteProjectAreaSession(area, session) {
    if (!area || !session) return;
    if (session.sessionId) area.sessionIds.add(session.sessionId);
    if (session.sessionId && !area.sessionRefs.has(session.sessionId)) {
      area.sessionRefs.set(session.sessionId, session);
    }
    if (session.sessionId && !area.recentSessions.has(session.sessionId)) {
      area.recentSessions.set(session.sessionId, {
        sessionId: session.sessionId,
        updatedAt: session.updatedAt,
        model: session.model,
        focusRoot: area.root || null,
        sessionFocusRoot: session.focusRoot || null,
        lastUserPreview: shapeCompactPreview(session.lastUserPreview),
        finalAnswerPreview: shapeCompactPreview(session.finalAnswerPreview),
        commentaryPreview: shapeCompactPreview(session.commentaryPreview),
      });
    }
  }

  function noteProjectAreaSessionFallback(area, session) {
    if (!area || !session) return;
    noteProjectAreaSession(area, session);
    area.counts.commands += session.commandCount || 0;
    area.counts.writes += Array.isArray(session.filesTouched) ? session.filesTouched.length : 0;
    area.counts.searches += session.searchCount || 0;
    area.counts.errors += session.errorCount || 0;
    for (const toolName of session.toolsUsed || []) {
      area.tools[toolName] = (area.tools[toolName] || 0) + 1;
    }
    for (const filePath of session.filesTouched || []) {
      area.files[filePath] = (area.files[filePath] || 0) + 1;
    }
    for (const referencedPath of getEntityPathArtifacts(session)) {
      area.paths[referencedPath] = (area.paths[referencedPath] || 0) + 1;
    }
  }

  function noteProjectAreaTurn(area, session, turn) {
    if (!area || !turn) return;
    noteProjectAreaSession(area, session);
    area.turns.push(turn);
    area.turnCount += 1;
    area.counts.commands += Array.isArray(turn.commands) ? turn.commands.length : 0;
    area.counts.writes += Array.isArray(turn.filesTouched) ? turn.filesTouched.length : 0;
    area.counts.searches += Array.isArray(turn.queries) ? turn.queries.length : 0;
    area.counts.errors += Array.isArray(turn.errors) ? turn.errors.length : 0;
    for (const toolName of turn.toolsUsed || []) {
      area.tools[toolName] = (area.tools[toolName] || 0) + 1;
    }
    for (const filePath of turn.filesTouched || []) {
      area.files[filePath] = (area.files[filePath] || 0) + 1;
    }
    for (const referencedPath of getEntityPathArtifacts(turn)) {
      area.paths[referencedPath] = (area.paths[referencedPath] || 0) + 1;
    }
  }

  function finalizeProjectAreaSummary(area) {
    const recentSessions = Array.from(area.recentSessions.values())
      .sort((left, right) => (toTimestampMs(right.updatedAt) || 0) - (toTimestampMs(left.updatedAt) || 0))
      .slice(0, MAX_PROJECT_AREA_SESSION_REFS);
    const manualBrowse = buildProjectManualBrowseSummary(
      Array.from(area.sessionRefs.values()),
      area.turns
    );
    return {
      root: area.root,
      sessionCount: area.sessionIds.size,
      turnCount: area.turnCount,
      counts: area.counts,
      topTools: mapToTopList(area.tools, "tool", MAX_PROJECT_AREA_VALUE_REFS),
      topFiles: mapToTopList(area.files, "file", MAX_PROJECT_AREA_VALUE_REFS).map((item) => ({
        ...item,
        displayFile: deriveRelativeDisplayPath(area.cwd, item.file),
      })),
      topPaths: mapToTopList(area.paths, "path", MAX_PROJECT_AREA_VALUE_REFS).map((item) => ({
        ...item,
        scope: isPathWithinProject(area.cwd, item.path) ? "project" : "external",
        displayPath: deriveProjectDisplayPath(area.cwd, item.path),
      })),
      recentSessions,
      manualCounts: manualBrowse.manualCounts,
      topManualTags: manualBrowse.topManualTags,
    };
  }

  function summarizeProjectArea(area, project, extra = {}) {
    return {
      cwd: project.cwd,
      root: area.root,
      updatedAt: area.recentSessions[0] ? area.recentSessions[0].updatedAt : null,
      projectUpdatedAt: project.updatedAt,
      projectSessionCount: project.sessionCount,
      projectTurnCount: project.turnCount,
      sessionCount: area.sessionCount,
      turnCount: area.turnCount,
      counts: area.counts,
      topTools: area.topTools,
      topFiles: area.topFiles,
      topPaths: area.topPaths,
      recentSessions: area.recentSessions,
      manualCounts: area.manualCounts || null,
      topManualTags: area.topManualTags || [],
      matchScore: extra.matchScore ?? null,
      matchReasons: extra.matchReasons || [],
    };
  }

  function summarizeProjectAreaCompact(area, project, extra = {}) {
    return {
      cwd: project.cwd,
      root: area.root,
      updatedAt: area.recentSessions[0] ? area.recentSessions[0].updatedAt : null,
      sessionCount: area.sessionCount,
      turnCount: area.turnCount,
      counts: area.counts,
      topTools: (area.topTools || []).slice(0, 4),
      topFiles: (area.topFiles || []).slice(0, 4),
      topPaths: (area.topPaths || []).slice(0, 4),
      recentSessions: (area.recentSessions || []).slice(0, 3),
      manualCounts: area.manualCounts || null,
      topManualTags: area.topManualTags || [],
      matchScore: extra.matchScore ?? null,
      matchReasons: extra.matchReasons || [],
    };
  }

  function buildProjectAreaSummary(projectCwd, entries, options = {}) {
    const cwd = normalizeCwdValue(projectCwd);
    const limit = Number.isInteger(options.limit) && options.limit > 0
      ? options.limit
      : MAX_PROJECT_AREA_REFS;
    const requestedArea = getRequestedProjectArea(options);
    const areaMap = new Map();
    const unscopedSessionIds = new Set();
    let unscopedTurns = 0;
    const unscopedSummary = createProjectAreaUnscopedSummary();

    const getArea = (root) => {
      const normalizedRoot = normalizeProjectAreaValue(root);
      if (!normalizedRoot) return null;
      if (!areaMap.has(normalizedRoot)) {
        areaMap.set(normalizedRoot, createProjectAreaSummary(normalizedRoot, cwd));
      }
      return areaMap.get(normalizedRoot);
    };

    for (const entry of Array.isArray(entries) ? entries : []) {
      const session = entry && entry.session;
      if (!session) continue;
      const turnEntries = Array.isArray(entry.turnMatches) ? entry.turnMatches : [];
      const sessionRoot = getEntityProjectAreaRoot(session, cwd);
      let scopedTurnCount = 0;

      for (const turnEntry of turnEntries) {
        const turn = turnEntry && turnEntry.turn;
        if (!turn) continue;
        const turnRoot = getEntityProjectAreaRoot(turn, cwd);
        if (!turnRoot) {
          unscopedTurns += 1;
          const turnReason = classifyEntityProjectAreaReason(turn, cwd);
          noteProjectAreaUnscopedReason(unscopedSummary.turnReasons, turnReason);
          addProjectAreaUnscopedSample(unscopedSummary.turnSamples, summarizeUnscopedProjectAreaTurn(session, turn, turnReason));
          continue;
        }
        scopedTurnCount += 1;
        noteProjectAreaTurn(getArea(turnRoot), session, turn);
      }

      if (!turnEntries.length) {
        if (sessionRoot) {
          noteProjectAreaSessionFallback(getArea(sessionRoot), session);
        } else {
          unscopedSessionIds.add(session.sessionId);
          const sessionReason = classifyEntityProjectAreaReason(session, cwd, { sessionWithoutTurns: true });
          noteProjectAreaUnscopedReason(unscopedSummary.sessionReasons, sessionReason);
          addProjectAreaUnscopedSample(
            unscopedSummary.sessionSamples,
            summarizeUnscopedProjectAreaSession(session, sessionReason, { turnCount: 0 })
          );
        }
        continue;
      }

      if (!scopedTurnCount) {
        if (sessionRoot) {
          noteProjectAreaSessionFallback(getArea(sessionRoot), session);
        } else {
          unscopedSessionIds.add(session.sessionId);
          const sessionReasonCounts = {};
          for (const turnEntry of turnEntries) {
            const turn = turnEntry && turnEntry.turn;
            if (!turn) continue;
            const turnReason = classifyEntityProjectAreaReason(turn, cwd);
            noteProjectAreaUnscopedReason(sessionReasonCounts, turnReason);
          }
          const sessionReason = summarizeProjectAreaReasonCounts(sessionReasonCounts)[0]?.reason || "no_local_anchor";
          noteProjectAreaUnscopedReason(unscopedSummary.sessionReasons, sessionReason);
          addProjectAreaUnscopedSample(
            unscopedSummary.sessionSamples,
            summarizeUnscopedProjectAreaSession(session, sessionReason, { turnCount: turnEntries.length })
          );
        }
      }
    }

    const allAreas = Array.from(areaMap.values())
      .map(finalizeProjectAreaSummary)
      .sort((left, right) => {
        if (right.turnCount !== left.turnCount) return right.turnCount - left.turnCount;
        if (right.sessionCount !== left.sessionCount) return right.sessionCount - left.sessionCount;
        if ((right.counts.writes || 0) !== (left.counts.writes || 0)) {
          return (right.counts.writes || 0) - (left.counts.writes || 0);
        }
        if ((right.counts.searches || 0) !== (left.counts.searches || 0)) {
          return (right.counts.searches || 0) - (left.counts.searches || 0);
        }
        if ((right.counts.commands || 0) !== (left.counts.commands || 0)) {
          return (right.counts.commands || 0) - (left.counts.commands || 0);
        }
        return left.root.localeCompare(right.root);
      });

    const selectedArea = requestedArea
      ? (allAreas.find((item) => matchesProjectAreaValue(item.root, requestedArea)) || null)
      : null;

    let areas = allAreas.slice(0, limit);
    if (selectedArea && !areas.some((item) => item.root === selectedArea.root)) {
      if (areas.length >= limit && limit > 0) {
        areas = areas.slice(0, limit - 1);
      }
      areas.push(selectedArea);
    }

    return {
      areaCount: allAreas.length,
      selectedArea: selectedArea ? selectedArea.root : (requestedArea || null),
      selectedAreaMatched: requestedArea ? Boolean(selectedArea) : null,
      truncatedAreas: allAreas.length > areas.length,
      unscopedAreaCounts: {
        sessions: unscopedSessionIds.size,
        turns: unscopedTurns,
      },
      unscopedAreaReasons: {
        sessions: summarizeProjectAreaReasonCounts(unscopedSummary.sessionReasons),
        turns: summarizeProjectAreaReasonCounts(unscopedSummary.turnReasons),
      },
      unscopedAreaSamples: {
        sessions: unscopedSummary.sessionSamples,
        turns: unscopedSummary.turnSamples,
      },
      areas,
    };
  }

  function projectAreaMatches(area, project, filters = {}) {
    const requestedArea = getRequestedProjectArea(filters);
    if (requestedArea && !matchesProjectAreaValue(area.root, requestedArea)) return null;

    const q = typeof filters.q === "string" ? filters.q.trim().toLowerCase() : "";
    if (!q) {
      return { score: toTimestampMs((area.recentSessions[0] && area.recentSessions[0].updatedAt) || project.updatedAt) || 0, reasons: [] };
    }

    let score = 0;
    const reasons = [];
    const note = (amount, reason) => {
      score += amount;
      if (reason && !reasons.includes(reason)) reasons.push(reason);
    };

    if ((area.root || "").toLowerCase().includes(q)) note(12, "area");
    if ((project.cwd || "").toLowerCase().includes(q)) note(4, "cwd");
    if ((area.topFiles || []).some((item) => matchesPathNeedle(item && item.file, q, project.cwd))) note(8, "files");
    if ((area.topPaths || []).some((item) => matchesPathNeedle(item && item.path, q, project.cwd))) note(8, "paths");
    if ((area.topTools || []).some((item) => (item.tool || "").toLowerCase().includes(q))) note(6, "tools");
    if ((area.recentSessions || []).some((session) => (session.sessionId || "").toLowerCase().includes(q))) note(10, "session_id");
    if ((area.recentSessions || []).some((session) => (session.focusRoot || "").toLowerCase().includes(q))) note(9, "focus_root");
    if ((area.recentSessions || []).some((session) => (session.finalAnswerPreview || "").toLowerCase().includes(q))) note(9, "final_answer");
    if ((area.recentSessions || []).some((session) => (session.lastUserPreview || "").toLowerCase().includes(q))) note(8, "user_prompt");
    if ((area.recentSessions || []).some((session) => (session.commentaryPreview || "").toLowerCase().includes(q))) note(7, "commentary");

    if (!score) return null;
    return { score, reasons };
  }

  function filterProjectMatchEntriesByArea(entries, projectCwd, requestedArea) {
    const areaNeedle = normalizeProjectAreaValue(requestedArea);
    if (!areaNeedle) return Array.isArray(entries) ? entries : [];
    const filtered = [];

    for (const entry of Array.isArray(entries) ? entries : []) {
      const session = entry && entry.session;
      if (!session) continue;
      const sessionRoot = getEntityProjectAreaRoot(session, projectCwd);
      const turnMatches = Array.isArray(entry.turnMatches)
        ? entry.turnMatches.filter((turnEntry) => {
          const turn = turnEntry && turnEntry.turn;
          return matchesProjectAreaValue(getEntityProjectAreaRoot(turn, projectCwd), areaNeedle);
        })
        : [];

      const includeSession = turnMatches.length > 0 ||
        (entry.sessionMatch && matchesProjectAreaValue(sessionRoot, areaNeedle));
      if (!includeSession) continue;
      filtered.push({
        session,
        sessionMatch: entry.sessionMatch,
        turnMatches,
      });
    }

    return filtered;
  }

  function manualBrowseSummariesEqual(left, right) {
    const leftCounts = left && left.manualCounts ? left.manualCounts : {};
    const rightCounts = right && right.manualCounts ? right.manualCounts : {};
    const countKeys = ["annotatedSessions", "bookmarkedSessions", "annotatedTurns", "bookmarkedTurns"];
    for (const key of countKeys) {
      if ((leftCounts[key] || 0) !== (rightCounts[key] || 0)) return false;
    }
    const leftTags = Array.isArray(left && left.topManualTags) ? left.topManualTags : [];
    const rightTags = Array.isArray(right && right.topManualTags) ? right.topManualTags : [];
    if (leftTags.length !== rightTags.length) return false;
    for (let index = 0; index < leftTags.length; index += 1) {
      const leftTag = leftTags[index];
      const rightTag = rightTags[index];
      if ((leftTag && leftTag.tag) !== (rightTag && rightTag.tag)) return false;
      if ((leftTag && leftTag.count) !== (rightTag && rightTag.count)) return false;
    }
    return true;
  }

  function collectProjectMatchEntries(project, catalog, filters = {}) {
    const projectCwd = normalizeCwdValue(project && project.cwd);
    if (!projectCwd) return [];
    const contentFilters = hasTurnScopedFilters(filters);
    const projectSessions = getProjectSessions(catalog, projectCwd).filter((session) => matchesSessionFilters(session, filters));
    const entries = [];

    for (const session of projectSessions) {
      const sessionMatch = sessionMatches(session, filters);
      const matchedTurnEntries = [];

      for (const turn of session.turns) {
        const turnMatch = contentFilters
          ? turnMatches(turn, filters)
          : { score: toTimestampMs(turn.endedAt || turn.startedAt) || 0, reasons: [] };
        if (!turnMatch) continue;
        matchedTurnEntries.push({ turn, turnMatch });
      }

      if (!sessionMatch && !matchedTurnEntries.length) continue;
      entries.push({ session, sessionMatch, turnMatches: matchedTurnEntries });
    }

    return entries;
  }

  function listCatalogProjects(catalog, filters = {}) {
    ({ catalog } = resolveCatalogForHistoryMode(catalog, filters));
    const limit = Number.isInteger(filters.limit) && filters.limit > 0 ? filters.limit : DEFAULT_RESULT_LIMIT;
    const offset = normalizeOffset(filters.offset);
    const resultShape = normalizeResultShape(filters);
    const queryMode = getRequestedQueryMode(filters);
    const matched = [];

    for (const project of catalog.projects || []) {
      const match = projectMatches(project, catalog, filters);
      if (!match) continue;
      matched.push({
        project,
        score: match.score,
        reasons: match.reasons,
      });
    }

    matched.sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return (toTimestampMs(right.project.updatedAt) || 0) - (toTimestampMs(left.project.updatedAt) || 0);
    });

    return {
      generatedAt: catalog.generatedAt,
      historyMode: normalizeHistoryMode(catalog.historyMode),
      shape: resultShape,
      queryMode: filters.query ? queryMode : undefined,
      offset,
      total: matched.length,
      projects: matched.slice(offset, offset + limit).map((item) => {
        const allProjectSessions = getProjectSessions(catalog, item.project.cwd);
        const overallManualBrowse = buildProjectManualBrowseSummary(allProjectSessions);
        const projectEntries = collectProjectMatchEntries(item.project, catalog, filters);
        const matchedManualBrowse = buildProjectManualBrowseSummary(
          projectEntries.map((entry) => entry.session),
          projectEntries.flatMap((entry) => entry.turnMatches.map((match) => match.turn))
        );
        const includeMatchedManual = !manualBrowseSummariesEqual(overallManualBrowse, matchedManualBrowse);
        const extra = {
          matchScore: item.score,
          matchReasons: item.reasons,
          recentSessionLimit: 4,
          manualCounts: overallManualBrowse.manualCounts,
          topManualTags: overallManualBrowse.topManualTags,
          matchedManualCounts: includeMatchedManual ? matchedManualBrowse.manualCounts : null,
          matchedTopManualTags: includeMatchedManual ? matchedManualBrowse.topManualTags : [],
        };
        return resultShape === "compact"
          ? summarizeProjectCompact(item.project, extra)
          : summarizeProject(item.project, extra);
      }),
      facets: resultShape === "compact" ? undefined : catalog.facets,
    };
  }

  function listCatalogProjectAreas(catalog, filters = {}) {
    ({ catalog } = resolveCatalogForHistoryMode(catalog, filters));
    const limit = Number.isInteger(filters.limit) && filters.limit > 0 ? filters.limit : DEFAULT_RESULT_LIMIT;
    const offset = normalizeOffset(filters.offset);
    const resultShape = normalizeResultShape(filters);
    const queryMode = getRequestedQueryMode(filters);
    const requestedArea = getRequestedProjectArea(filters);
    const requestedProjectCwd = normalizeCwdValue(filters.cwd || "");
    const matchFilters = { ...filters };
    delete matchFilters.area;
    delete matchFilters.focusRoot;
    const matched = [];

    for (const project of catalog.projects || []) {
      if (requestedProjectCwd && normalizeCwdValue(project.cwd) !== requestedProjectCwd) continue;
      const projectEntries = collectProjectMatchEntries(project, catalog, matchFilters);
      if (!projectEntries.length) continue;

      const areaSummary = buildProjectAreaSummary(project.cwd, projectEntries, {
        limit: Number.MAX_SAFE_INTEGER,
        area: requestedArea,
      });

      for (const area of areaSummary.areas || []) {
        const match = projectAreaMatches(area, project, filters);
        if (!match) continue;
        matched.push({
          project,
          area,
          score: match.score,
          reasons: match.reasons,
        });
      }
    }

    matched.sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      if (right.area.turnCount !== left.area.turnCount) return right.area.turnCount - left.area.turnCount;
      if (right.area.sessionCount !== left.area.sessionCount) return right.area.sessionCount - left.area.sessionCount;
      return (toTimestampMs((right.area.recentSessions[0] && right.area.recentSessions[0].updatedAt) || right.project.updatedAt) || 0) -
        (toTimestampMs((left.area.recentSessions[0] && left.area.recentSessions[0].updatedAt) || left.project.updatedAt) || 0);
    });

    return {
      generatedAt: catalog.generatedAt,
      historyMode: normalizeHistoryMode(catalog.historyMode),
      shape: resultShape,
      queryMode: filters.query ? queryMode : undefined,
      offset,
      total: matched.length,
      areas: matched.slice(offset, offset + limit).map((item) => {
        const extra = {
          matchScore: item.score,
          matchReasons: item.reasons,
        };
        return resultShape === "compact"
          ? summarizeProjectAreaCompact(item.area, item.project, extra)
          : summarizeProjectArea(item.area, item.project, extra);
      }),
    };
  }

  function getCatalogProject(catalog, cwd, filters = {}) {
    ({ catalog } = resolveCatalogForHistoryMode(catalog, filters));
    const needle = normalizeCwdValue(cwd);
    if (!needle) return null;
    const queryMode = getRequestedQueryMode(filters);

    const project = (catalog.projects || []).find((item) => normalizeCwdValue(item.cwd) === needle);
    if (!project) return null;

    const sessionLimit = Number.isInteger(filters.limit) && filters.limit > 0 ? filters.limit : DEFAULT_RESULT_LIMIT;
    const turnLimit = Number.isInteger(filters.turnLimit) && filters.turnLimit > 0 ? filters.turnLimit : MAX_PROJECT_TURN_REFS;
    const requestedArea = getRequestedProjectArea(filters);
    const matchFilters = { ...filters };
    delete matchFilters.area;
    delete matchFilters.focusRoot;
    const projectEntries = collectProjectMatchEntries(project, catalog, matchFilters);
    const areaSummary = buildProjectAreaSummary(project.cwd, projectEntries, {
      limit: MAX_PROJECT_AREA_REFS,
      area: requestedArea,
    });
    const filteredEntries = requestedArea
      ? filterProjectMatchEntriesByArea(projectEntries, project.cwd, requestedArea)
      : projectEntries;
    const matchedSessions = [];
    const matchedTurns = [];

    for (const entry of filteredEntries) {
      const turnSummaries = entry.turnMatches.map(({ turn, turnMatch }) => summarizeProjectTurn(entry.session, turn, {
        matchScore: turnMatch.score,
        matchReasons: turnMatch.reasons,
        matchedFiles: turnMatch.matchedFiles,
        matchedPaths: turnMatch.matchedPaths,
        matchedPathPatterns: turnMatch.matchedPathPatterns,
        matchedCommandOps: turnMatch.matchedCommandOps,
        matchedQueries: turnMatch.matchedQueries,
        focusRoot: getEntityProjectAreaRoot(turn, project.cwd),
      }));

      matchedSessions.push(summarizeSession(entry.session, {
        matchScore: entry.sessionMatch ? entry.sessionMatch.score : null,
        matchReasons: entry.sessionMatch ? entry.sessionMatch.reasons : [],
        matchedFiles: entry.sessionMatch ? entry.sessionMatch.matchedFiles : [],
        matchedPaths: entry.sessionMatch ? entry.sessionMatch.matchedPaths : [],
        matchedPathPatterns: entry.sessionMatch ? entry.sessionMatch.matchedPathPatterns : [],
        matchedCommandOps: entry.sessionMatch ? entry.sessionMatch.matchedCommandOps : [],
        matchedQueries: entry.sessionMatch ? entry.sessionMatch.matchedQueries : [],
      }));
      matchedTurns.push(...turnSummaries);
    }

    matchedSessions.sort((left, right) => {
      if ((right.matchScore || 0) !== (left.matchScore || 0)) return (right.matchScore || 0) - (left.matchScore || 0);
      return (toTimestampMs(right.updatedAt) || 0) - (toTimestampMs(left.updatedAt) || 0);
    });
    matchedTurns.sort((left, right) => {
      if ((right.matchScore || 0) !== (left.matchScore || 0)) return (right.matchScore || 0) - (left.matchScore || 0);
      return (toTimestampMs(right.endedAt || right.startedAt || right.sessionUpdatedAt) || 0) -
        (toTimestampMs(left.endedAt || left.startedAt || left.sessionUpdatedAt) || 0);
    });
    const manual = buildProjectManualSummary(matchedSessions, matchedTurns);

    return {
      generatedAt: catalog.generatedAt,
      historyMode: normalizeHistoryMode(catalog.historyMode),
      queryMode: filters.query ? queryMode : undefined,
      ...summarizeProject(project),
      selectedArea: areaSummary.selectedArea,
      selectedAreaMatched: areaSummary.selectedAreaMatched,
      areaCount: areaSummary.areaCount,
      truncatedAreas: areaSummary.truncatedAreas,
      unscopedAreaCounts: areaSummary.unscopedAreaCounts,
      unscopedAreaReasons: areaSummary.unscopedAreaReasons,
      unscopedAreaSamples: areaSummary.unscopedAreaSamples,
      areas: areaSummary.areas,
      matchedSessionCount: matchedSessions.length,
      matchedTurnCount: matchedTurns.length,
      truncatedSessions: matchedSessions.length > sessionLimit,
      truncatedTurns: matchedTurns.length > turnLimit,
      manual,
      sessions: matchedSessions.slice(0, sessionLimit),
      turns: matchedTurns.slice(0, turnLimit),
    };
  }

  function getCatalogArea(catalog, cwd, area, filters = {}) {
    ({ catalog } = resolveCatalogForHistoryMode(catalog, filters));
    const needle = normalizeCwdValue(cwd);
    const requestedArea = normalizeProjectAreaValue(area || filters.area || filters.focusRoot);
    if (!needle || !requestedArea) return null;
    const queryMode = getRequestedQueryMode(filters);

    const project = (catalog.projects || []).find((item) => normalizeCwdValue(item.cwd) === needle);
    if (!project) return null;

    const sessionLimit = Number.isInteger(filters.limit) && filters.limit > 0 ? filters.limit : DEFAULT_RESULT_LIMIT;
    const turnLimit = Number.isInteger(filters.turnLimit) && filters.turnLimit > 0 ? filters.turnLimit : MAX_PROJECT_TURN_REFS;
    const matchFilters = { ...filters };
    delete matchFilters.area;
    delete matchFilters.focusRoot;
    const projectEntries = collectProjectMatchEntries(project, catalog, matchFilters);
    const areaSummary = buildProjectAreaSummary(project.cwd, projectEntries, {
      limit: Number.MAX_SAFE_INTEGER,
      area: requestedArea,
    });
    const filteredEntries = filterProjectMatchEntriesByArea(projectEntries, project.cwd, requestedArea);
    const matchedSessions = [];
    const matchedTurns = [];

    for (const entry of filteredEntries) {
      const turnSummaries = entry.turnMatches.map(({ turn, turnMatch }) => summarizeProjectTurn(entry.session, turn, {
        matchScore: turnMatch.score,
        matchReasons: turnMatch.reasons,
        matchedFiles: turnMatch.matchedFiles,
        matchedPaths: turnMatch.matchedPaths,
        matchedPathPatterns: turnMatch.matchedPathPatterns,
        matchedCommandOps: turnMatch.matchedCommandOps,
        matchedQueries: turnMatch.matchedQueries,
        focusRoot: getEntityProjectAreaRoot(turn, project.cwd),
      }));

      matchedSessions.push(summarizeSession(entry.session, {
        matchScore: entry.sessionMatch ? entry.sessionMatch.score : null,
        matchReasons: entry.sessionMatch ? entry.sessionMatch.reasons : [],
        matchedFiles: entry.sessionMatch ? entry.sessionMatch.matchedFiles : [],
        matchedPaths: entry.sessionMatch ? entry.sessionMatch.matchedPaths : [],
        matchedPathPatterns: entry.sessionMatch ? entry.sessionMatch.matchedPathPatterns : [],
        matchedCommandOps: entry.sessionMatch ? entry.sessionMatch.matchedCommandOps : [],
        matchedQueries: entry.sessionMatch ? entry.sessionMatch.matchedQueries : [],
      }));
      matchedTurns.push(...turnSummaries);
    }

    matchedSessions.sort((left, right) => {
      if ((right.matchScore || 0) !== (left.matchScore || 0)) return (right.matchScore || 0) - (left.matchScore || 0);
      return (toTimestampMs(right.updatedAt) || 0) - (toTimestampMs(left.updatedAt) || 0);
    });
    matchedTurns.sort((left, right) => {
      if ((right.matchScore || 0) !== (left.matchScore || 0)) return (right.matchScore || 0) - (left.matchScore || 0);
      return (toTimestampMs(right.endedAt || right.startedAt || right.sessionUpdatedAt) || 0) -
        (toTimestampMs(left.endedAt || left.startedAt || left.sessionUpdatedAt) || 0);
    });

    const selectedArea = Array.isArray(areaSummary.areas)
      ? areaSummary.areas.find((item) => matchesProjectAreaValue(item.root, requestedArea)) || null
      : null;
    const manual = buildProjectManualSummary(matchedSessions, matchedTurns);

    return {
      generatedAt: catalog.generatedAt,
      historyMode: normalizeHistoryMode(catalog.historyMode),
      queryMode: filters.query ? queryMode : undefined,
      cwd: project.cwd,
      root: selectedArea ? selectedArea.root : requestedArea,
      areaMatched: areaSummary.selectedAreaMatched,
      area: selectedArea,
      projectUpdatedAt: project.updatedAt,
      projectStartedAt: project.startedAt,
      projectEndedAt: project.endedAt,
      projectSessionCount: project.sessionCount,
      projectTurnCount: project.turnCount,
      matchedSessionCount: matchedSessions.length,
      matchedTurnCount: matchedTurns.length,
      truncatedSessions: matchedSessions.length > sessionLimit,
      truncatedTurns: matchedTurns.length > turnLimit,
      manual,
      sessions: matchedSessions.slice(0, sessionLimit),
      turns: matchedTurns.slice(0, turnLimit),
    };
  }

  function searchCatalogTurns(catalog, filters = {}) {
    ({ catalog } = resolveCatalogForHistoryMode(catalog, filters));
    const limit = Number.isInteger(filters.limit) && filters.limit > 0 ? filters.limit : DEFAULT_RESULT_LIMIT;
    const offset = normalizeOffset(filters.offset);
    const resultShape = normalizeResultShape(filters);
    const queryMode = getRequestedQueryMode(filters);
    const cwdNeedle = typeof filters.cwd === "string" ? filters.cwd.trim().toLowerCase() : "";
    const matched = [];
    const seenSessions = new Set();

    for (const session of catalog.sessions) {
      if (!matchesSessionFilters(session, filters)) continue;

      for (const turn of session.turns) {
        const turnCwd = normalizeCwdValue(turn.cwd || session.cwd);
        if (cwdNeedle && !turnCwd.toLowerCase().includes(cwdNeedle)) continue;

        const match = turnMatches(turn, filters);
        if (!match) continue;

        const extra = {
          matchScore: match.score,
          matchReasons: match.reasons,
          matchedFiles: match.matchedFiles,
          matchedPaths: match.matchedPaths,
          matchedPathPatterns: match.matchedPathPatterns,
          matchedCommandOps: match.matchedCommandOps,
          matchedQueries: match.matchedQueries,
        };
        matched.push(resultShape === "compact"
          ? summarizeProjectTurnCompact(session, turn, extra)
          : summarizeProjectTurn(session, turn, extra));
        seenSessions.add(session.sessionId);
      }
    }

    matched.sort((left, right) => {
      if ((right.matchScore || 0) !== (left.matchScore || 0)) return (right.matchScore || 0) - (left.matchScore || 0);
      return (toTimestampMs(right.endedAt || right.startedAt || right.sessionUpdatedAt) || 0) -
        (toTimestampMs(left.endedAt || left.startedAt || left.sessionUpdatedAt) || 0);
    });

    return {
      generatedAt: catalog.generatedAt,
      historyMode: normalizeHistoryMode(catalog.historyMode),
      shape: resultShape,
      queryMode: filters.query ? queryMode : undefined,
      offset,
      total: matched.length,
      sessionCount: seenSessions.size,
      turns: matched.slice(offset, offset + limit),
    };
  }

  return {
    summarizeProjectTurn,
    summarizeProjectTurnCompact,
    listCatalogProjects,
    listCatalogProjectAreas,
    getCatalogProject,
    getCatalogArea,
    searchCatalogTurns,
  };
}

module.exports = { createCatalogProjectViews };
