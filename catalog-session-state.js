"use strict";

function createCatalogSessionState(deps = {}) {
  const {
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
  } = deps;

  function createPathRoleBuckets() {
    return {
      read: [],
      search_scope: [],
      list_scope: [],
      write: [],
    };
  }

  function clonePathRoleBuckets(pathRoles) {
    const cloned = createPathRoleBuckets();
    if (!pathRoles || typeof pathRoles !== "object") return cloned;
    for (const role of PATH_ROLE_ORDER) {
      cloned[role] = Array.isArray(pathRoles[role]) ? pathRoles[role].slice() : [];
    }
    return cloned;
  }

  function createTurn(turnId) {
    return {
      turnId,
      startedAt: null,
      endedAt: null,
      status: "open",
      cwd: "",
      model: null,
      approvalPolicy: null,
      sandboxMode: null,
      reasoningEffort: null,
      summaryMode: null,
      userPromptPreview: "",
      finalAnswerPreview: "",
      commentaryPreview: "",
      commands: [],
      filesTouched: [],
      pathsReferenced: [],
      pathRoles: createPathRoleBuckets(),
      pathPatternArtifacts: [],
      pathPatternRoles: createPathRoleBuckets(),
      queries: [],
      toolsUsed: [],
      commandTypes: [],
      errors: [],
      commandArtifacts: [],
      commandOpArtifacts: [],
      pathArtifacts: [],
      queryArtifacts: [],
      errorArtifacts: [],
      events: 0,
    };
  }

  function createSessionDocument(filePath, historyMode = "effective") {
    return {
      schemaVersion: SESSION_DOC_SCHEMA_VERSION,
      historyMode: normalizeHistoryMode(historyMode),
      sessionId: prefixedSessionId(extractSessionIdFromFilePath(filePath)) || "codex:unknown",
      sessionKey: extractRolloutKeyFromFilePath(filePath) || null,
      filePath,
      forkedFromId: null,
      parentThreadId: null,
      subagentDepth: null,
      lineageRootId: null,
      lineageDepth: 0,
      lineageFamilyCount: 1,
      replayedSessionIds: [],
      startedAt: null,
      updatedAt: null,
      endedAt: null,
      cwd: "",
      cliVersion: null,
      model: null,
      modelProvider: null,
      memoryMode: null,
      rolloutPersistence: null,
      originator: null,
      source: null,
      sourceKind: null,
      sourceDetail: null,
      agentNickname: null,
      agentRole: null,
      agentPath: null,
      gitBranch: null,
      gitSha: null,
      gitOriginUrl: null,
      baseInstructionsPreview: "",
      dynamicToolNames: [],
      dynamicToolCount: 0,
      approvalPolicy: null,
      sandboxMode: null,
      reasoningEffort: null,
      summaryMode: null,
      turnCount: 0,
      eventCount: 0,
      userMessageCount: 0,
      assistantMessageCount: 0,
      reasoningCount: 0,
      commandCount: 0,
      patchCount: 0,
      searchCount: 0,
      mcpCount: 0,
      errorCount: 0,
      lastUserPreview: "",
      commentaryPreview: "",
      finalAnswerPreview: "",
      toolsUsed: [],
      filesTouched: [],
      pathsReferenced: [],
      pathRoles: createPathRoleBuckets(),
      pathPatternArtifacts: [],
      pathPatternRoles: createPathRoleBuckets(),
      commandTypes: [],
      recentCommands: [],
      recentQueries: [],
      recentErrors: [],
      commandArtifacts: [],
      commandOpArtifacts: [],
      pathArtifacts: [],
      queryArtifacts: [],
      errorArtifacts: [],
      turns: [],
      tags: [],
      _turnMap: new Map(),
      _activeTurnId: null,
      _primarySessionMetaSeen: false,
      _replayedSessionIds: new Set(),
      _rolloutPersistenceKnown: false,
      _extendedEventPersistenceKeys: new Set(),
      _searchSegments: [],
      _searchChars: 0,
      _searchSeen: new Set(),
    };
  }

  function ensureTurn(session, turnId) {
    const id = turnId || session._activeTurnId;
    if (!id) return null;
    if (!session._turnMap.has(id)) {
      const turn = createTurn(id);
      session._turnMap.set(id, turn);
      session.turns.push(turn);
    }
    return session._turnMap.get(id);
  }

  function noteSearchBucket(session, bucket, value) {
    const remaining = MAX_SEARCH_TEXT_CHARS - session._searchChars;
    if (remaining <= 0) return;

    const snippet = summarizeText(value, Math.min(400, remaining));
    if (!snippet) return;

    const key = `${bucket}:${snippet.toLowerCase()}`;
    if (session._searchSeen.has(key)) return;

    session._searchSeen.add(key);
    session._searchSegments.push(snippet);
    session._searchChars += snippet.length + 1;
  }

  function noteRolloutPersistence(session, record) {
    if (!session || session._rolloutPersistenceKnown !== true || !record || typeof record !== "object") return;
    if (record.kind === "session_meta" && record.sessionMeta && typeof record.sessionMeta.memoryMode === "string") {
      session.memoryMode = record.sessionMeta.memoryMode;
    }
    if (EXTENDED_EVENT_PERSISTENCE_KEYS.has(record.key)) {
      session._extendedEventPersistenceKeys.add(record.key);
    }
  }

  function noteTurnTool(turn, toolName) {
    addUnique(turn.toolsUsed, toolName, MAX_UNIQUE_VALUES);
  }

  function normalizeReferencedPath(cwd, value) {
    if (typeof value !== "string") return "";
    const text = value.trim();
    if (!text) return "";
    if (path.isAbsolute(text)) return path.normalize(text);
    if (!cwd || text.startsWith("~") || text.startsWith("$")) return text;
    return path.normalize(path.resolve(cwd, text));
  }

  function normalizeTouchedFilePath(cwd, value) {
    const normalized = normalizeReferencedPath(cwd, value);
    if (normalized) return normalized;
    return typeof value === "string" ? value.trim() : "";
  }

  function noteTurnFile(turn, cwd, filePath) {
    const resolved = normalizeTouchedFilePath(cwd, filePath);
    addUnique(turn.filesTouched, resolved, MAX_UNIQUE_VALUES);
    return resolved;
  }

  function noteSessionFile(session, cwd, filePath) {
    const resolved = normalizeTouchedFilePath(cwd, filePath);
    addUnique(session.filesTouched, resolved);
    return resolved;
  }

  function normalizePathRole(value) {
    const text = typeof value === "string"
      ? value.trim().toLowerCase().replace(/[\s-]+/g, "_")
      : "";
    if (!text) return "";
    if (text === "search") return "search_scope";
    if (text === "list" || text === "list_files" || text === "listing" || text === "ls") return "list_scope";
    if (text === "patch" || text === "change" || text === "changes" || text === "changed" || text === "file_change") {
      return "write";
    }
    return PATH_ROLE_ORDER.includes(text) ? text : "";
  }

  function addPathRoleValue(pathRoles, role, value, limit = MAX_PATH_ARTIFACTS) {
    const normalizedRole = normalizePathRole(role);
    if (!normalizedRole || !pathRoles || typeof pathRoles !== "object") return;
    if (!Array.isArray(pathRoles[normalizedRole])) pathRoles[normalizedRole] = [];
    addUnique(pathRoles[normalizedRole], value, limit);
  }

  function addPathRoleValues(pathRoles, roles, value, limit = MAX_PATH_ARTIFACTS) {
    const list = Array.isArray(roles) ? roles : [roles];
    for (const role of list) addPathRoleValue(pathRoles, role, value, limit);
  }

  function getCommandPathRoles(commandTypes = []) {
    const roles = [];
    for (const type of Array.isArray(commandTypes) ? commandTypes : []) {
      const normalizedType = typeof type === "string" ? type.trim().toLowerCase() : "";
      const role = COMMAND_TYPE_PATH_ROLE_MAP[normalizedType];
      if (role) addUnique(roles, role, PATH_ROLE_ORDER.length);
    }
    return roles;
  }

  function getPathRoleValues(pathRoles, role) {
    const normalizedRole = normalizePathRole(role);
    if (!normalizedRole || !pathRoles || typeof pathRoles !== "object") return [];
    return Array.isArray(pathRoles[normalizedRole]) ? pathRoles[normalizedRole] : [];
  }

  function getEntityPathValueRoles(entity, value) {
    const roles = [];
    const pathRoles = entity && entity.pathRoles && typeof entity.pathRoles === "object" ? entity.pathRoles : null;
    if (!pathRoles) return roles;
    for (const role of PATH_ROLE_ORDER) {
      if (getPathRoleValues(pathRoles, role).some((candidate) => matchesPathValue(candidate, value))) {
        roles.push(role);
      }
    }
    return roles;
  }

  function getEntityPathPatternValueRoles(entity, value) {
    const roles = [];
    const pathRoles = entity && entity.pathPatternRoles && typeof entity.pathPatternRoles === "object"
      ? entity.pathPatternRoles
      : null;
    if (!pathRoles) return roles;
    for (const role of PATH_ROLE_ORDER) {
      if (getPathRoleValues(pathRoles, role).some((candidate) => matchesPathValue(candidate, value))) {
        roles.push(role);
      }
    }
    return roles;
  }

  function noteTurnQuery(turn, query) {
    const text = typeof query === "string"
      ? summarizeText(query, 240)
      : (query && typeof query.query === "string" ? summarizeText(query.query, 240) : "");
    if (!text) return;

    const timestamp = query && typeof query === "object" && typeof query.timestamp === "string"
      ? query.timestamp
      : null;
    const actionType = query && typeof query === "object" && typeof query.actionType === "string"
      ? query.actionType
      : null;

    const existing = turn.queries.find((entry) => entry && typeof entry === "object" && entry.query === text);
    if (existing) {
      if (!existing.timestamp && timestamp) existing.timestamp = timestamp;
      if (!existing.actionType && actionType) existing.actionType = actionType;
      return;
    }
    if (turn.queries.length >= MAX_UNIQUE_VALUES) return;
    turn.queries.push({
      timestamp,
      query: text,
      actionType,
    });
  }

  function normalizeReferencedPathPattern(cwd, value) {
    if (typeof value !== "string") return "";
    const text = value.trim();
    if (!text) return "";
    if (path.isAbsolute(text)) return path.normalize(text);
    if (text.startsWith("~") || text.startsWith("$")) return text;
    if (text.startsWith("!")) return path.normalize(text);
    if (!looksLikeGlobPath(text)) {
      const normalized = path.normalize(text);
      return normalized && normalized !== "." ? normalized : text;
    }
    if (!cwd) return text;
    return path.normalize(path.resolve(cwd, text));
  }

  function deriveRelativeDisplayPath(cwd, value) {
    const base = typeof cwd === "string" ? cwd.trim() : "";
    const target = typeof value === "string" ? value.trim() : "";
    if (!base || !target || !path.isAbsolute(base) || !path.isAbsolute(target)) return "";
    const relative = path.relative(base, target);
    if (!relative || relative === "") return ".";
    if (relative.startsWith("..") || path.isAbsolute(relative)) return "";
    return relative.split(path.sep).join("/");
  }

  function isPathWithinProject(cwd, value) {
    return Boolean(deriveRelativeDisplayPath(cwd, value));
  }

  function deriveCompactExternalDisplayPath(value) {
    const target = typeof value === "string" ? value.trim() : "";
    if (!target) return "";
    if (!path.isAbsolute(target)) return target;
    const homeDir = typeof os.homedir === "function" ? os.homedir() : "";
    if (homeDir && target.startsWith(homeDir + path.sep)) {
      const relative = path.relative(homeDir, target).split(path.sep).join("/");
      return relative ? `~/${relative}` : "~";
    }
    const segments = target.split(path.sep).filter(Boolean);
    if (segments.length <= 4) return target;
    return `.../${segments.slice(-4).join("/")}`;
  }

  function deriveProjectDisplayPath(cwd, value) {
    const relative = deriveRelativeDisplayPath(cwd, value);
    if (relative) return relative;
    return deriveCompactExternalDisplayPath(value);
  }

  function deriveProjectFocusRoot(cwd, value) {
    const relative = deriveRelativeDisplayPath(cwd, value);
    if (!relative || relative === ".") return "";
    const segments = relative.split("/").filter(Boolean);
    return segments.length ? segments[0] : "";
  }

  function isStableProjectRootSegment(value) {
    const text = typeof value === "string" ? value.trim() : "";
    if (!text || text === "." || text === "..") return false;
    return !/[!*?[\]{}]/.test(text);
  }

  function deriveProjectPatternFocusRoot(cwd, value) {
    const normalized = normalizeReferencedPathPattern(cwd, value);
    if (!normalized) return "";
    const relative = deriveRelativeDisplayPath(cwd, normalized);
    if (!relative || relative === ".") return "";
    const segments = relative.split("/").filter(Boolean);
    const root = segments.length ? segments[0] : "";
    return isStableProjectRootSegment(root) ? root : "";
  }

  function createFocusRootStats() {
    return {};
  }

  function normalizeProjectAreaValue(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function noteFocusRootStat(stats, root, score) {
    const normalizedRoot = normalizeProjectAreaValue(root);
    if (!normalizedRoot) return;
    if (!stats[normalizedRoot]) stats[normalizedRoot] = { count: 0, score: 0 };
    stats[normalizedRoot].count += 1;
    stats[normalizedRoot].score += Number.isFinite(score) ? score : 0;
  }

  function noteFocusRootStatsFromList(stats, roots, score) {
    for (const root of Array.isArray(roots) ? roots : []) {
      noteFocusRootStat(stats, root, score);
    }
  }

  function mergeFocusRootStats(target, source) {
    for (const [root, value] of Object.entries(source || {})) {
      if (!target[root]) target[root] = { count: 0, score: 0 };
      target[root].count += value.count || 0;
      target[root].score += value.score || 0;
    }
  }

  function getPathRoleFocusScore(roles = [], options = {}) {
    const normalizedRoles = Array.isArray(roles)
      ? roles.map(normalizePathRole).filter(Boolean)
      : [];
    if (normalizedRoles.includes("write")) return FOCUS_ROOT_SIGNAL_SCORES.write;
    if (normalizedRoles.includes("read")) return FOCUS_ROOT_SIGNAL_SCORES.read;
    if (normalizedRoles.includes("search_scope")) {
      return options.pathPattern
        ? FOCUS_ROOT_SIGNAL_SCORES.path_pattern
        : FOCUS_ROOT_SIGNAL_SCORES.search_scope;
    }
    if (normalizedRoles.includes("list_scope")) {
      return options.pathPattern
        ? FOCUS_ROOT_SIGNAL_SCORES.path_pattern
        : FOCUS_ROOT_SIGNAL_SCORES.list_scope;
    }
    return options.pathPattern ? FOCUS_ROOT_SIGNAL_SCORES.path_pattern : FOCUS_ROOT_SIGNAL_SCORES.fallback;
  }

  function sortFocusRootStats(stats, limit = 10) {
    return Object.entries(stats || {})
      .map(([root, value]) => ({
        root,
        count: value && Number.isFinite(value.count) ? value.count : 0,
        score: value && Number.isFinite(value.score) ? value.score : 0,
      }))
      .sort((left, right) =>
        right.score - left.score ||
        right.count - left.count ||
        left.root.localeCompare(right.root)
      )
      .slice(0, limit);
  }

  function collectEntityFocusRoots(entity, cwd) {
    return sortFocusRootStats(collectEntityFocusRootStats(entity, cwd), Number.MAX_SAFE_INTEGER)
      .map((item) => item.root);
  }

  function collectEntityFileFocusRoots(entity, cwd) {
    return sortFocusRootStats(collectEntityFileFocusRootStats(entity, cwd), Number.MAX_SAFE_INTEGER)
      .map((item) => item.root);
  }

  function collectEntityFocusRootStats(entity, cwd) {
    const stats = createFocusRootStats();
    if (!entity || typeof entity !== "object" || !cwd) return stats;

    noteFocusRootStatsFromList(
      stats,
      (entity.filesTouched || []).map((filePath) => deriveProjectFocusRoot(cwd, filePath)).filter(Boolean),
      FOCUS_ROOT_SIGNAL_SCORES.file
    );

    for (const referencedPath of getEntityPathArtifacts(entity)) {
      const root = deriveProjectFocusRoot(cwd, referencedPath);
      if (!root) continue;
      noteFocusRootStat(stats, root, getPathRoleFocusScore(getEntityPathValueRoles(entity, referencedPath)));
    }

    for (const pattern of getEntityPathPatternArtifacts(entity)) {
      const root = deriveProjectPatternFocusRoot(cwd, pattern);
      if (!root) continue;
      noteFocusRootStat(
        stats,
        root,
        getPathRoleFocusScore(getEntityPathPatternValueRoles(entity, pattern), { pathPattern: true })
      );
    }

    return stats;
  }

  function collectEntityFileFocusRootStats(entity, cwd) {
    const stats = createFocusRootStats();
    if (!entity || typeof entity !== "object" || !cwd) return stats;
    noteFocusRootStatsFromList(
      stats,
      (entity.filesTouched || []).map((filePath) => deriveProjectFocusRoot(cwd, filePath)).filter(Boolean),
      FOCUS_ROOT_SIGNAL_SCORES.file
    );
    return stats;
  }

  function buildEntityFocusRootStats(entity, cwd) {
    const stats = createFocusRootStats();
    if (!entity || typeof entity !== "object" || !cwd) return stats;
    const turnList = Array.isArray(entity.turns) ? entity.turns.filter(Boolean) : [];
    if (turnList.length) {
      for (const turn of turnList) {
        const turnCwd = typeof turn.cwd === "string" && turn.cwd.trim() ? turn.cwd : cwd;
        mergeFocusRootStats(stats, collectEntityFocusRootStats(turn, turnCwd));
      }
      return stats;
    }
    return collectEntityFocusRootStats(entity, cwd);
  }

  function buildEntityFileFocusRootStats(entity, cwd) {
    const stats = createFocusRootStats();
    if (!entity || typeof entity !== "object" || !cwd) return stats;
    const turnList = Array.isArray(entity.turns) ? entity.turns.filter(Boolean) : [];
    if (turnList.length) {
      for (const turn of turnList) {
        const turnCwd = typeof turn.cwd === "string" && turn.cwd.trim() ? turn.cwd : cwd;
        mergeFocusRootStats(stats, collectEntityFileFocusRootStats(turn, turnCwd));
      }
      return stats;
    }
    return collectEntityFileFocusRootStats(entity, cwd);
  }

  function summarizeEntityFocusRoots(entity, cwd, limit = 10) {
    return sortFocusRootStats(buildEntityFocusRootStats(entity, cwd), limit);
  }

  function derivePrimaryEntityFocusRoot(entity, cwd) {
    const fileRoots = sortFocusRootStats(buildEntityFileFocusRootStats(entity, cwd), 1);
    if (fileRoots.length) return fileRoots[0].root;
    const roots = summarizeEntityFocusRoots(entity, cwd, 1);
    return roots.length ? roots[0].root : null;
  }

  function getRequestedProjectArea(filters = {}) {
    return normalizeProjectAreaValue(filters.area || filters.focusRoot || "");
  }

  function matchesProjectAreaValue(candidate, requested) {
    const left = normalizeProjectAreaValue(candidate).toLowerCase();
    const right = normalizeProjectAreaValue(requested).toLowerCase();
    if (!left || !right) return false;
    return left === right;
  }

  function getEntityProjectAreaRoot(entity, projectCwd) {
    if (!entity || typeof entity !== "object") return "";
    const stored = normalizeProjectAreaValue(entity.focusRoot || entity.areaRoot);
    if (stored) return stored;
    return normalizeProjectAreaValue(derivePrimaryEntityFocusRoot(entity, projectCwd || entity.cwd || ""));
  }

  function noteTurnPath(turn, cwd, value, roles = []) {
    const normalized = normalizeReferencedPath(cwd, value);
    const resolved = normalized || value;
    addUnique(turn.pathsReferenced, resolved, MAX_UNIQUE_VALUES);
    addPathRoleValues(turn.pathRoles, roles, resolved, MAX_UNIQUE_VALUES);
  }

  function noteSessionPath(session, cwd, value, roles = []) {
    const normalized = normalizeReferencedPath(cwd, value);
    const resolved = normalized || value;
    addUnique(session.pathsReferenced, resolved);
    addUnique(session.pathArtifacts, resolved, MAX_PATH_ARTIFACTS);
    addPathRoleValues(session.pathRoles, roles, resolved, MAX_PATH_ARTIFACTS);
  }

  function noteTurnPathPattern(turn, cwd, value, roles = []) {
    const normalized = normalizeReferencedPathPattern(cwd, value);
    const resolved = normalized || value;
    addUnique(turn.pathPatternArtifacts, resolved, MAX_PATH_ARTIFACTS);
    addPathRoleValues(turn.pathPatternRoles, roles, resolved, MAX_PATH_ARTIFACTS);
  }

  function noteSessionPathPattern(session, cwd, value, roles = []) {
    const normalized = normalizeReferencedPathPattern(cwd, value);
    const resolved = normalized || value;
    addUnique(session.pathPatternArtifacts, resolved, MAX_PATH_ARTIFACTS);
    addPathRoleValues(session.pathPatternRoles, roles, resolved, MAX_PATH_ARTIFACTS);
  }

  function noteTurnCommandType(turn, type) {
    addUnique(turn.commandTypes, type, MAX_UNIQUE_VALUES);
  }

  function summarizeTurn(turn) {
    const bits = [];
    if (turn.userPromptPreview) bits.push(`user ${turn.userPromptPreview}`);
    if (turn.finalAnswerPreview) bits.push(`answer ${turn.finalAnswerPreview}`);
    else if (turn.commentaryPreview) bits.push(`commentary ${turn.commentaryPreview}`);
    if (turn.commands.length) bits.push(`${turn.commands.length} commands`);
    if (turn.filesTouched.length) bits.push(`${turn.filesTouched.length} files`);
    if (turn.pathsReferenced.length) bits.push(`${turn.pathsReferenced.length} paths`);
    if (turn.queries.length) bits.push(`${turn.queries.length} searches`);
    if (turn.errors.length) bits.push(`${turn.errors.length} errors`);
    return summarizeText(bits.join(" | "), 240);
  }

  function finalizeTurn(turn) {
    turn.commands = turn.commands.slice(-MAX_TURN_ITEMS);
    turn.queries = turn.queries.slice(-MAX_TURN_ITEMS);
    turn.errors = turn.errors.slice(-MAX_TURN_ITEMS);
    turn.summary = summarizeTurn(turn);
    return turn;
  }

  function buildRolloutPersistence(session) {
    if (!session || session._rolloutPersistenceKnown !== true) return null;

    const observedEventKeys = Array.from(session._extendedEventPersistenceKeys || []).sort();
    const memoryMode = normalizeRolloutMemoryMode(session.memoryMode) || "enabled";
    const extendedObserved = observedEventKeys.length > 0;

    return {
      memoryMode,
      eventMode: extendedObserved ? "extended_observed" : "limited_or_unknown",
      extendedObserved,
      observedEventKeys,
      responseItemsPersisted: true,
      note: extendedObserved
        ? "Observed event_msg variants that Codex only persists in Extended mode."
        : "No extended-only event_msg variants were observed. This does not prove Limited mode; supported response items are still persisted regardless of event persistence mode.",
    };
  }

  function buildTagList(session) {
    const tags = [];
    if (session.patchCount > 0) tags.push("has_patch");
    if (session.searchCount > 0) tags.push("has_search");
    if (session.errorCount > 0) tags.push("has_error");
    if (session.mcpCount > 0) tags.push("has_mcp");
    if (session.commandCount > 0) tags.push("has_command");
    if (session.finalAnswerPreview) tags.push("has_answer");
    if (session.forkedFromId) tags.push("forked");
    if (
      session.parentThreadId ||
      (typeof session.sourceKind === "string" && session.sourceKind.startsWith("subAgent"))
    ) {
      tags.push("subagent");
    }
    if ((Array.isArray(session.replayedSessionIds) && session.replayedSessionIds.length) ||
        (session._replayedSessionIds instanceof Set && session._replayedSessionIds.size > 0)) {
      tags.push("has_replayed_history");
    }
    if (session.rolloutPersistence && session.rolloutPersistence.extendedObserved) tags.push("has_extended_events");
    if (session.rolloutPersistence && session.rolloutPersistence.memoryMode === "disabled") tags.push("memory_disabled");
    if (session.rolloutPersistence && session.rolloutPersistence.memoryMode === "polluted") tags.push("memory_polluted");
    return tags;
  }

  function finalizeSession(session) {
    session.turns.sort((a, b) => {
      const aTime = toTimestampMs(a.startedAt || a.endedAt) || 0;
      const bTime = toTimestampMs(b.startedAt || b.endedAt) || 0;
      return aTime - bTime;
    });
    for (const turn of session.turns) finalizeTurn(turn);
    session.turnCount = session.turns.length;
    session.topFocusRoots = summarizeEntityFocusRoots(session, session.cwd, 10);
    session.focusRoot = derivePrimaryEntityFocusRoot(session, session.cwd);
    session.rolloutPersistence = buildRolloutPersistence(session);
    session.tags = buildTagList(session);
    session.searchText = [
      session.sessionId,
      session.forkedFromId,
      session.parentThreadId,
      session.cwd,
      session.model,
      session.modelProvider,
      session.originator,
      session.source,
      session.sourceKind,
      session.sourceDetail && session.sourceDetail.type,
      session.sourceDetail && session.sourceDetail.variant,
      session.sourceDetail && session.sourceDetail.value,
      session.cliVersion,
      session.agentNickname,
      session.agentRole,
      session.agentPath,
      session.gitBranch,
      session.gitSha,
      session.gitOriginUrl,
      session.baseInstructionsPreview,
      session.finalAnswerPreview,
      session.lastUserPreview,
      session.commentaryPreview,
      ...(Array.isArray(session.dynamicToolNames) ? session.dynamicToolNames : []),
      ...(Array.isArray(session.replayedSessionIds) ? session.replayedSessionIds : []),
      ...session._searchSegments,
    ].filter(Boolean).join("\n").toLowerCase();
    delete session._turnMap;
    delete session._activeTurnId;
    delete session._primarySessionMetaSeen;
    session.replayedSessionIds = Array.from(session._replayedSessionIds || []);
    delete session._replayedSessionIds;
    delete session._rolloutPersistenceKnown;
    delete session._extendedEventPersistenceKeys;
    delete session._searchSegments;
    delete session._searchChars;
    delete session._searchSeen;
    return session;
  }

  return {
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
  };
}

module.exports = { createCatalogSessionState };
