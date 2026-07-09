"use strict";

function createCatalogBuild(deps = {}) {
  const {
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
  } = deps;

  function getSessionLineageParentId(session) {
    return prefixedSessionId(
      session && typeof session === "object"
        ? (session.parentThreadId || session.forkedFromId || "")
        : ""
    ) || "";
  }

  function buildSessionLineageMetadata(sessions) {
    const sessionList = Array.isArray(sessions) ? sessions : [];
    const sessionsById = new Map();

    for (const session of sessionList) {
      const sessionId = prefixedSessionId(session && session.sessionId);
      if (!sessionId) continue;
      if (!sessionsById.has(sessionId)) sessionsById.set(sessionId, []);
      sessionsById.get(sessionId).push(session);
    }

    for (const items of sessionsById.values()) {
      items.sort((left, right) => {
        const rightTime = toTimestampMs(right && (right.updatedAt || right.startedAt)) || 0;
        const leftTime = toTimestampMs(left && (left.updatedAt || left.startedAt)) || 0;
        if (rightTime !== leftTime) return rightTime - leftTime;
        return String(right && right.filePath || "").localeCompare(String(left && left.filePath || ""));
      });
    }

    const rootCache = new Map();
    const familyCounts = new Map();

    function resolveSessionRepresentative(sessionId) {
      const items = sessionsById.get(sessionId);
      return Array.isArray(items) && items.length ? items[0] : null;
    }

    function resolveLineage(session) {
      const sessionId = prefixedSessionId(session && session.sessionId);
      if (!sessionId) {
        return {
          lineageRootId: "",
          lineageDepth: 0,
        };
      }
      if (rootCache.has(sessionId)) return rootCache.get(sessionId);

      let current = session;
      let currentId = sessionId;
      let depth = 0;
      const seen = new Set([sessionId]);

      while (current) {
        const nextId = getSessionLineageParentId(current);
        if (!nextId) {
          const resolved = {
            lineageRootId: currentId,
            lineageDepth: depth,
          };
          rootCache.set(sessionId, resolved);
          return resolved;
        }

        depth += 1;
        if (seen.has(nextId)) {
          const resolved = {
            lineageRootId: currentId,
            lineageDepth: depth,
          };
          rootCache.set(sessionId, resolved);
          return resolved;
        }

        seen.add(nextId);
        const nextSession = resolveSessionRepresentative(nextId);
        if (!nextSession) {
          const resolved = {
            lineageRootId: nextId,
            lineageDepth: depth,
          };
          rootCache.set(sessionId, resolved);
          return resolved;
        }

        current = nextSession;
        currentId = nextSession.sessionId;
      }

      const resolved = {
        lineageRootId: currentId || sessionId,
        lineageDepth: depth,
      };
      rootCache.set(sessionId, resolved);
      return resolved;
    }

    for (const session of sessionList) {
      const resolved = resolveLineage(session);
      const lineageRootId = resolved.lineageRootId || prefixedSessionId(session.sessionId) || "";
      const lineageDepth = Number.isInteger(resolved.lineageDepth) ? resolved.lineageDepth : 0;
      session.lineageRootId = lineageRootId || session.sessionId || null;
      session.lineageDepth = lineageDepth;
      familyCounts.set(session.lineageRootId, (familyCounts.get(session.lineageRootId) || 0) + 1);
    }

    for (const session of sessionList) {
      const lineageRootId = session.lineageRootId || prefixedSessionId(session.sessionId) || "";
      session.lineageFamilyCount = familyCounts.get(lineageRootId) || 1;
      if (session.searchText) {
        session.searchText = [
          session.searchText,
          session.lineageRootId,
        ].filter(Boolean).join("\n").toLowerCase();
      }
    }
  }

  function mapToTopList(map, keyName, limit = 20) {
    return Object.entries(map)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([value, count]) => ({ [keyName]: value, count }));
  }

  function mapCommandOpsToTopList(map, limit = 20) {
    return mapToTopList(map, "commandOp", limit)
      .map((item) => ({
        ...item,
        signalTier: classifyCommandOpSignal(item.commandOp),
      }));
  }

  function mapQueriesToTopList(map, limit = 20, options = {}) {
    const allowedSignalTiers = Array.isArray(options.signalTiers) && options.signalTiers.length
      ? new Set(options.signalTiers)
      : null;

    return Object.entries(map)
      .map(([query, count]) => ({
        query,
        count,
        signalTier: classifyQuerySignal(query),
      }))
      .filter((item) => !allowedSignalTiers || allowedSignalTiers.has(item.signalTier))
      .sort((left, right) =>
        right.count - left.count ||
        getQuerySignalRank(left.query) - getQuerySignalRank(right.query) ||
        left.query.localeCompare(right.query)
      )
      .slice(0, limit);
  }

  function buildCatalogFacets(sessions) {
    const tools = {};
    const files = {};
    const paths = {};
    const activeTools = {};
    const activeFiles = {};
    const activePaths = {};
    const activeProjects = {};
    const pathPatterns = {};
    const commandOps = {};
    const queries = {};
    const models = {};
    const projects = {};
    const memoryModes = {};
    const eventModes = {};
    const qualityClasses = {};
    for (const session of sessions) {
      for (const toolName of session.toolsUsed) tools[toolName] = (tools[toolName] || 0) + 1;
      for (const file of session.filesTouched) files[file] = (files[file] || 0) + 1;
      for (const referencedPath of getEntityPathArtifacts(session)) {
        paths[referencedPath] = (paths[referencedPath] || 0) + 1;
      }
      for (const referencedPattern of getEntityPathPatternArtifacts(session)) {
        pathPatterns[referencedPattern] = (pathPatterns[referencedPattern] || 0) + 1;
      }
      const turnList = Array.isArray(session.turns) ? session.turns.filter(Boolean) : [];
      if (turnList.length) {
        if (session.cwd) activeProjects[session.cwd] = (activeProjects[session.cwd] || 0) + turnList.length;
        for (const turn of turnList) {
          for (const toolName of turn.toolsUsed || []) {
            activeTools[toolName] = (activeTools[toolName] || 0) + 1;
          }
          for (const file of turn.filesTouched || []) {
            activeFiles[file] = (activeFiles[file] || 0) + 1;
          }
          for (const referencedPath of getEntityPathArtifacts(turn)) {
            activePaths[referencedPath] = (activePaths[referencedPath] || 0) + 1;
          }
        }
      } else {
        for (const toolName of session.toolsUsed) activeTools[toolName] = (activeTools[toolName] || 0) + 1;
        for (const file of session.filesTouched) activeFiles[file] = (activeFiles[file] || 0) + 1;
        for (const referencedPath of getEntityPathArtifacts(session)) {
          activePaths[referencedPath] = (activePaths[referencedPath] || 0) + 1;
        }
        if (session.cwd) activeProjects[session.cwd] = (activeProjects[session.cwd] || 0) + 1;
      }
      for (const commandOp of session.commandOpArtifacts || []) {
        commandOps[commandOp] = (commandOps[commandOp] || 0) + 1;
      }
      for (const query of session.queryArtifacts || []) queries[query] = (queries[query] || 0) + 1;
      if (session.model) models[session.model] = (models[session.model] || 0) + 1;
      if (session.cwd) projects[session.cwd] = (projects[session.cwd] || 0) + 1;
      const memoryMode = getSessionRolloutMemoryMode(session) || "enabled";
      const eventMode = getSessionRolloutEventMode(session) || "limited_or_unknown";
      const qualityClass = classifySessionQuality(session);
      memoryModes[memoryMode] = (memoryModes[memoryMode] || 0) + 1;
      eventModes[eventMode] = (eventModes[eventMode] || 0) + 1;
      qualityClasses[qualityClass] = (qualityClasses[qualityClass] || 0) + 1;
    }

    return {
      topTools: mapToTopList(tools, "tool"),
      topFiles: mapToTopList(files, "file"),
      topPaths: mapToTopList(paths, "path"),
      topActiveTools: mapToTopList(activeTools, "tool"),
      topActiveFiles: mapToTopList(activeFiles, "file"),
      topActivePaths: mapToTopList(activePaths, "path"),
      topPathPatterns: mapToTopList(pathPatterns, "pattern").map((item) => ({
        ...item,
        patternKind: classifyPathPatternValue(item.pattern),
      })),
      topCommandOps: mapCommandOpsToTopList(commandOps),
      topHighSignalCommandOps: mapCommandOpsToTopList(
        Object.fromEntries(
          Object.entries(commandOps).filter(([commandOp]) => classifyCommandOpSignal(commandOp) === "high")
        )
      ),
      topQueries: mapQueriesToTopList(queries, 20, { signalTiers: ["high", "medium"] }),
      topLowSignalQueries: mapQueriesToTopList(queries, 20, { signalTiers: ["low"] }),
      topModels: mapToTopList(models, "model"),
      topProjects: mapToTopList(projects, "cwd"),
      topActiveProjects: mapToTopList(activeProjects, "cwd"),
      topMemoryModes: mapToTopList(memoryModes, "memoryMode"),
      topEventModes: mapToTopList(eventModes, "eventMode"),
      topQualityClasses: mapToTopList(qualityClasses, "qualityClass"),
    };
  }

  function createArtifactRef(session, extra = {}) {
    return {
      sessionId: session.sessionId,
      updatedAt: session.updatedAt,
      cwd: session.cwd,
      model: session.model,
      memoryMode: getSessionRolloutMemoryMode(session) || null,
      eventMode: getSessionRolloutEventMode(session) || null,
      tags: getSessionTags(session),
      ...extra,
    };
  }

  function getEntityErrorArtifactCandidates(entity) {
    const values = [];
    const entries = Array.isArray(entity && entity.recentErrors)
      ? entity.recentErrors
      : (Array.isArray(entity && entity.errors) ? entity.errors : []);

    for (const entry of entries) {
      for (const value of buildNormalizedErrorSearchValues(entry)) {
        if (!value || values.includes(value) || values.length >= MAX_ERROR_ARTIFACTS) continue;
        values.push(value);
      }
    }

    if (!values.length) {
      for (const value of Array.isArray(entity && entity.errorArtifacts) ? entity.errorArtifacts : []) {
        if (!value || values.includes(value) || values.length >= MAX_ERROR_ARTIFACTS) continue;
        values.push(value);
      }
    }

    return values;
  }

  function buildArtifactCatalog(sessions) {
    const buckets = {
      file: new Map(),
      path: new Map(),
      path_pattern: new Map(),
      tool: new Map(),
      command: new Map(),
      command_op: new Map(),
      query: new Map(),
      error: new Map(),
    };

    function observe(kind, value, session, searchValues = []) {
      if (!Object.prototype.hasOwnProperty.call(buckets, kind)) return;
      if (typeof value !== "string") return;
      const normalizedValue = value.trim();
      if (!normalizedValue) return;

      let entry = buckets[kind].get(normalizedValue);
      if (!entry) {
        entry = {
          kind,
          value: normalizedValue,
          patternKind: kind === "path_pattern" ? classifyPathPatternValue(normalizedValue) : undefined,
          signalTier: kind === "command_op"
            ? classifyCommandOpSignal(normalizedValue)
            : (kind === "query" ? classifyQuerySignal(normalizedValue) : undefined),
          sessionCount: 0,
          lastSeenAt: session.updatedAt || session.startedAt || null,
          sessions: [],
          pathRoles: [],
          searchValues: [],
          _sessionRefs: new Map(),
          _pathRoleSet: new Set(),
          _searchValueSet: new Set(),
        };
        buckets[kind].set(normalizedValue, entry);
      }

      const candidates = Array.isArray(searchValues) && searchValues.length
        ? searchValues
        : [normalizedValue];
      for (const searchValue of candidates) {
        const normalizedSearchValue = normalizeArtifactValue(searchValue);
        if (!normalizedSearchValue) continue;
        entry._searchValueSet.add(normalizedSearchValue);
      }

      const seenAt = session.updatedAt || session.startedAt || null;
      if (seenAt && (!entry.lastSeenAt || (toTimestampMs(seenAt) || 0) > (toTimestampMs(entry.lastSeenAt) || 0))) {
        entry.lastSeenAt = seenAt;
      }

      let sessionRef = entry._sessionRefs.get(session.sessionId);
      if (!sessionRef) {
        sessionRef = createArtifactRef(session, kind === "path" || kind === "path_pattern" ? { pathRoles: [] } : {});
        entry._sessionRefs.set(session.sessionId, sessionRef);
        entry.sessionCount += 1;
        entry.sessions.push(sessionRef);
      }

      if (kind === "path" || kind === "path_pattern") {
        const roles = kind === "path"
          ? getEntityPathValueRoles(session, normalizedValue)
          : getEntityPathPatternValueRoles(session, normalizedValue);
        for (const role of roles) {
          if (!sessionRef.pathRoles.includes(role)) sessionRef.pathRoles.push(role);
          entry._pathRoleSet.add(role);
        }
      }
    }

    for (const session of sessions) {
      for (const filePath of session.filesTouched) observe("file", filePath, session);
      for (const referencedPath of getEntityPathArtifacts(session)) observe("path", referencedPath, session);
      for (const referencedPattern of getEntityPathPatternArtifacts(session)) observe("path_pattern", referencedPattern, session);
      for (const toolName of session.toolsUsed) observe("tool", toolName, session);
      for (const command of session.commandArtifacts || []) observe("command", command, session);
      for (const commandOp of session.commandOpArtifacts || []) observe("command_op", commandOp, session);
      for (const query of session.queryArtifacts || []) observe("query", query, session);
      for (const message of session.errorArtifacts || []) observe("error", message, session);
      for (const entry of session.recentErrors || []) {
        observe("error", entry && entry.message, session, buildNormalizedErrorSearchValues(entry));
      }
    }

    const finalizeEntries = (map) => Array.from(map.values())
      .map((entry) => {
        entry.sessions.sort((a, b) => (toTimestampMs(b.updatedAt) || 0) - (toTimestampMs(a.updatedAt) || 0));
        for (const sessionRef of entry.sessions) {
          if (Array.isArray(sessionRef.pathRoles) && sessionRef.pathRoles.length) {
            sessionRef.pathRoles.sort((a, b) => PATH_ROLE_ORDER.indexOf(a) - PATH_ROLE_ORDER.indexOf(b));
          } else {
            delete sessionRef.pathRoles;
          }
        }
        entry.sessions = entry.sessions.slice(0, MAX_ARTIFACT_SESSION_REFS);
        entry.pathRoles = Array.from(entry._pathRoleSet || [])
          .sort((a, b) => PATH_ROLE_ORDER.indexOf(a) - PATH_ROLE_ORDER.indexOf(b));
        entry.searchValues = Array.from(entry._searchValueSet || []);
        if (!entry.pathRoles.length) delete entry.pathRoles;
        if (entry.kind !== "path_pattern") delete entry.patternKind;
        if (entry.kind !== "command_op" && entry.kind !== "query") delete entry.signalTier;
        delete entry._sessionRefs;
        delete entry._pathRoleSet;
        delete entry._searchValueSet;
        return entry;
      })
      .sort((a, b) => {
        if (b.sessionCount !== a.sessionCount) return b.sessionCount - a.sessionCount;
        const bTime = toTimestampMs(b.lastSeenAt) || 0;
        const aTime = toTimestampMs(a.lastSeenAt) || 0;
        if (bTime !== aTime) return bTime - aTime;
        return a.value.localeCompare(b.value);
      });

    const byKind = {
      file: finalizeEntries(buckets.file),
      path: finalizeEntries(buckets.path),
      path_pattern: finalizeEntries(buckets.path_pattern),
      tool: finalizeEntries(buckets.tool),
      command: finalizeEntries(buckets.command),
      command_op: finalizeEntries(buckets.command_op),
      query: finalizeEntries(buckets.query),
      error: finalizeEntries(buckets.error),
    };

    return {
      counts: {
        file: byKind.file.length,
        path: byKind.path.length,
        path_pattern: byKind.path_pattern.length,
        tool: byKind.tool.length,
        command: byKind.command.length,
        command_op: byKind.command_op.length,
        query: byKind.query.length,
        error: byKind.error.length,
      },
      byKind,
    };
  }

  function buildProjectCatalog(sessions) {
    const projects = new Map();

    for (const session of sessions) {
      const cwd = typeof session.cwd === "string" ? session.cwd.trim() : "";
      if (!cwd) continue;

      let project = projects.get(cwd);
      if (!project) {
        project = {
          cwd,
          sessionCount: 0,
          turnCount: 0,
          startedAt: null,
          updatedAt: null,
          endedAt: null,
          counts: {
            commands: 0,
            patches: 0,
            searches: 0,
            mcp: 0,
            errors: 0,
          },
          tags: new Set(),
          models: {},
          tools: {},
          files: {},
          paths: {},
          projectPaths: {},
          externalPaths: {},
          focusRoots: {},
          errors: {},
          recentSessions: [],
          searchText: "",
          _searchChars: 0,
        };
        projects.set(cwd, project);
      }

      project.sessionCount += 1;
      project.turnCount += session.turnCount || 0;
      project.counts.commands += session.commandCount || 0;
      project.counts.patches += session.patchCount || 0;
      project.counts.searches += session.searchCount || 0;
      project.counts.mcp += session.mcpCount || 0;
      project.counts.errors += session.errorCount || 0;

      if (session.startedAt && (!project.startedAt || (toTimestampMs(session.startedAt) || 0) < (toTimestampMs(project.startedAt) || 0))) {
        project.startedAt = session.startedAt;
      }
      if (session.updatedAt && (!project.updatedAt || (toTimestampMs(session.updatedAt) || 0) > (toTimestampMs(project.updatedAt) || 0))) {
        project.updatedAt = session.updatedAt;
      }
      if (session.endedAt && (!project.endedAt || (toTimestampMs(session.endedAt) || 0) > (toTimestampMs(project.endedAt) || 0))) {
        project.endedAt = session.endedAt;
      }

      for (const tag of session.tags || []) project.tags.add(tag);
      if (session.model) project.models[session.model] = (project.models[session.model] || 0) + 1;
      const turnList = Array.isArray(session.turns) ? session.turns.filter(Boolean) : [];
      if (turnList.length) {
        for (const turn of turnList) {
          for (const toolName of turn.toolsUsed || []) {
            project.tools[toolName] = (project.tools[toolName] || 0) + 1;
          }
          for (const filePath of turn.filesTouched || []) {
            project.files[filePath] = (project.files[filePath] || 0) + 1;
          }
          for (const referencedPath of getEntityPathArtifacts(turn)) {
            project.paths[referencedPath] = (project.paths[referencedPath] || 0) + 1;
            if (isPathWithinProject(project.cwd, referencedPath)) {
              project.projectPaths[referencedPath] = (project.projectPaths[referencedPath] || 0) + 1;
            } else {
              project.externalPaths[referencedPath] = (project.externalPaths[referencedPath] || 0) + 1;
            }
          }
          for (const message of turn.errorArtifacts || []) {
            project.errors[message] = (project.errors[message] || 0) + 1;
          }
          mergeFocusRootStats(project.focusRoots, collectEntityFocusRootStats(turn, project.cwd));
        }
      } else {
        for (const toolName of session.toolsUsed || []) project.tools[toolName] = (project.tools[toolName] || 0) + 1;
        for (const filePath of session.filesTouched || []) project.files[filePath] = (project.files[filePath] || 0) + 1;
        for (const referencedPath of getEntityPathArtifacts(session)) {
          project.paths[referencedPath] = (project.paths[referencedPath] || 0) + 1;
          if (isPathWithinProject(project.cwd, referencedPath)) {
            project.projectPaths[referencedPath] = (project.projectPaths[referencedPath] || 0) + 1;
          } else {
            project.externalPaths[referencedPath] = (project.externalPaths[referencedPath] || 0) + 1;
          }
        }
        for (const message of session.errorArtifacts || []) project.errors[message] = (project.errors[message] || 0) + 1;
        mergeFocusRootStats(project.focusRoots, collectEntityFocusRootStats(session, project.cwd));
      }

      project.recentSessions.push({
        sessionId: session.sessionId,
        updatedAt: session.updatedAt,
        model: session.model,
        focusRoot: session.focusRoot || null,
        lastUserPreview: session.lastUserPreview,
        finalAnswerPreview: session.finalAnswerPreview,
        commentaryPreview: session.commentaryPreview,
        tags: session.tags || [],
      });

      const segment = [
        cwd,
        session.lastUserPreview,
        session.finalAnswerPreview,
        session.commentaryPreview,
        ...(session.filesTouched || []).slice(0, 10),
        ...getEntityPathArtifacts(session).slice(0, 10),
        ...(session.toolsUsed || []).slice(0, 10),
        ...(session.errorArtifacts || []).slice(0, 5),
      ].filter(Boolean).join("\n").toLowerCase();
      if (segment && project._searchChars < MAX_PROJECT_SEARCH_TEXT_CHARS) {
        const remaining = MAX_PROJECT_SEARCH_TEXT_CHARS - project._searchChars;
        const snippet = segment.slice(0, remaining);
        project.searchText += `${snippet}\n`;
        project._searchChars += snippet.length + 1;
      }
    }

    const entries = Array.from(projects.values()).map((project) => {
      project.recentSessions.sort((a, b) => (toTimestampMs(b.updatedAt) || 0) - (toTimestampMs(a.updatedAt) || 0));
      project.recentSessions = project.recentSessions.slice(0, MAX_PROJECT_SESSION_REFS);
      project.models = mapToTopList(project.models, "model", 10);
      project.topTools = mapToTopList(project.tools, "tool", 10);
      project.topFiles = mapToTopList(project.files, "file", 10).map((item) => ({
        ...item,
        displayFile: deriveRelativeDisplayPath(project.cwd, item.file),
      }));
      project.topPaths = mapToTopList(project.paths, "path", 10).map((item) => ({
        ...item,
        scope: isPathWithinProject(project.cwd, item.path) ? "project" : "external",
        displayPath: deriveProjectDisplayPath(project.cwd, item.path),
      }));
      project.topFocusRoots = sortFocusRootStats(project.focusRoots, 10);
      project.topProjectPaths = mapToTopList(project.projectPaths, "path", 10).map((item) => ({
        ...item,
        scope: "project",
        displayPath: deriveProjectDisplayPath(project.cwd, item.path),
      }));
      project.topExternalPaths = mapToTopList(project.externalPaths, "path", 10).map((item) => ({
        ...item,
        scope: "external",
        displayPath: deriveProjectDisplayPath(project.cwd, item.path),
      }));
      project.topErrors = mapToTopList(project.errors, "error", 5);
      project.tags = Array.from(project.tags).sort();
      delete project.tools;
      delete project.files;
      delete project.paths;
      delete project.projectPaths;
      delete project.externalPaths;
      delete project.focusRoots;
      delete project.errors;
      delete project._searchChars;
      return project;
    });

    entries.sort((a, b) => {
      const bTime = toTimestampMs(b.updatedAt) || 0;
      const aTime = toTimestampMs(a.updatedAt) || 0;
      if (bTime !== aTime) return bTime - aTime;
      return a.cwd.localeCompare(b.cwd);
    });

    return entries;
  }

  function buildHistoricalCatalog(options = {}) {
    const historyMode = normalizeHistoryMode(options.historyMode);
    const sessionDir = resolveSessionDir(options.sessionDir);
    const files = listRolloutFiles(sessionDir, options);
    const sessions = [];

    for (const filePath of files) {
      const session = buildSessionDocumentFromFile(filePath, { historyMode });
      if (session) sessions.push(session);
    }

    sessions.sort((a, b) => {
      const bTime = toTimestampMs(b.updatedAt) || 0;
      const aTime = toTimestampMs(a.updatedAt) || 0;
      if (bTime !== aTime) return bTime - aTime;
      return b.filePath.localeCompare(a.filePath);
    });

    buildSessionLineageMetadata(sessions);

    return {
      generatedAt: new Date().toISOString(),
      historyMode,
      sessionDir,
      sessionCount: sessions.length,
      sessions,
      facets: buildCatalogFacets(sessions),
      artifacts: buildArtifactCatalog(sessions),
      projects: buildProjectCatalog(sessions),
    };
  }

  return {
    buildSessionLineageMetadata,
    mapToTopList,
    buildCatalogFacets,
    getEntityErrorArtifactCandidates,
    buildArtifactCatalog,
    buildProjectCatalog,
    buildHistoricalCatalog,
  };
}

module.exports = { createCatalogBuild };
