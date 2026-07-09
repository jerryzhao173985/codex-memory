"use strict";

function createCatalogAppServerThreadView(deps = {}) {
  const {
    looksLikeGlobPath,
    summarizeText,
    inferShellCommandStructure,
    prefixedSessionId,
    normalizeSessionSource,
    normalizeAppServerTurnError,
    getTranscriptItemMemoryCitationSearchValues,
    createSessionDocument,
    extractRolloutKeyFromFilePath,
    appServerSecondsToIso,
    normalizeCwdValue,
    getEntityAnnotation,
    noteSearchBucket,
    ensureTurn,
    normalizeAppServerEnumValue,
    summarizeAppServerUserContent,
    normalizeAppServerMemoryCitation,
    summarizeAppServerReasoning,
    getCommandPathRoles,
    addUnique,
    noteTurnTool,
    pushBounded,
    MAX_RECENT_COMMANDS,
    MAX_TURN_ITEMS,
    MAX_COMMAND_ARTIFACTS,
    noteTurnCommandType,
    noteSessionPath,
    noteTurnPath,
    MAX_PATH_ARTIFACTS,
    noteSessionPathPattern,
    noteTurnPathPattern,
    MAX_RECENT_QUERIES,
    noteTurnQuery,
    MAX_QUERY_ARTIFACTS,
    clonePathRoleBuckets,
    createPathRoleBuckets,
    noteTurnFile,
    noteSessionFile,
    summarizeAppServerContentBlocks,
    summarizeStructuredValue,
    summarizeAppServerDynamicContent,
    normalizeReferencedPath,
    normalizeReferencedPathPattern,
    canDeduplicateTranscriptMessagePair,
    mergeTranscriptMessageItem,
    toTimestampMs,
    finalizeSession,
    buildNormalizedErrorSearchValues,
    MAX_RECENT_ERRORS,
    MAX_ERROR_ARTIFACTS,
  } = deps;

function extractAppServerCommandArtifacts(commandActions, cwd) {
  const commandTypes = [];
  const commandPaths = [];
  const commandPathPatterns = [];
  const commandQueries = [];

  for (const action of Array.isArray(commandActions) ? commandActions : []) {
    if (!action || typeof action !== "object") continue;

    const type = normalizeAppServerEnumValue(action.type);
    if (type) addUnique(commandTypes, type, 10);

    if (typeof action.path === "string" && action.path) {
      if (looksLikeGlobPath(action.path)) {
        addUnique(commandPathPatterns, normalizeReferencedPathPattern(cwd, action.path) || action.path, 20);
      } else {
        addUnique(commandPaths, normalizeReferencedPath(cwd, action.path) || action.path, 20);
      }
    }

    if (typeof action.query === "string" && action.query) {
      addUnique(commandQueries, summarizeText(action.query, 240), 20);
    }
  }

  return { commandTypes, commandPaths, commandPathPatterns, commandQueries };
}

function extractAppServerFilePaths(changes, cwd) {
  const paths = [];

  for (const change of Array.isArray(changes) ? changes : []) {
    if (!change || typeof change !== "object") continue;
    if (typeof change.path === "string" && change.path) {
      addUnique(paths, normalizeReferencedPath(cwd, change.path) || change.path);
    }
    if (change.kind && typeof change.kind === "object" && typeof change.kind.movePath === "string") {
      addUnique(paths, normalizeReferencedPath(cwd, change.kind.movePath) || change.kind.movePath);
    }
  }

  return paths;
}

function extractAppServerWebSearch(item) {
  const queries = [];
  const action = item && item.action && typeof item.action === "object" ? item.action : null;
  const actionType = normalizeAppServerEnumValue(action && action.type);
  let query = summarizeText(item && item.query, 240);

  if (actionType === "search") {
    if (action && typeof action.query === "string" && action.query) {
      query = summarizeText(action.query, 240) || query;
    }
    for (const value of Array.isArray(action && action.queries) ? action.queries : []) {
      addUnique(queries, summarizeText(value, 240), 10);
    }
  } else if (actionType === "open_page" && action && typeof action.url === "string") {
    query = summarizeText(action.url, 240) || query;
  } else if (actionType === "find_in_page") {
    if (action && typeof action.pattern === "string") addUnique(queries, summarizeText(action.pattern, 240), 10);
    if (!query && action && typeof action.url === "string") query = summarizeText(action.url, 240);
  }

  return {
    actionType,
    query,
    queries,
  };
}

function createAppServerTranscriptBase(session, turn, item, index, overrides = {}) {
  return {
    index,
    lineNumber: null,
    timestamp: turn.startedAt || turn.endedAt || session.updatedAt || session.startedAt || null,
    turnId: turn.turnId,
    callId: item && typeof item.id === "string" ? item.id : null,
    type: "",
    kind: "app_server_item",
    role: "system",
    phase: "",
    preview: "",
    text: "",
    detail: "",
    toolName: null,
    toolClass: null,
    toolStatus: null,
    command: "",
    commandSource: "",
    commandTypes: [],
    pathRoles: createPathRoleBuckets(),
    pathPatternRoles: createPathRoleBuckets(),
    commandPaths: [],
    commandPathPatterns: [],
    commandQueries: [],
    query: "",
    queries: [],
    actionType: "",
    success: null,
    exitCode: null,
    errorCode: "",
    statusCode: null,
    errorRequestId: null,
    errorUrl: null,
    errorCfRay: null,
    codexErrorInfo: null,
    additionalDetails: null,
    cwd: turn.cwd || session.cwd || "",
    filesTouched: [],
    fileCount: 0,
    memoryCitation: null,
    memoryCitationPaths: [],
    stage: "single",
    ...overrides,
  };
}

function noteAppServerTurnError(session, turn, error, timestamp = null) {
  const normalized = typeof error === "string"
    ? normalizeAppServerTurnError({ message: error })
    : normalizeAppServerTurnError(error);
  if (!normalized) return;
  const entry = {
    timestamp: timestamp || turn.endedAt || turn.startedAt || session.updatedAt || null,
    message: summarizeText(normalized.message, 240),
    detail: summarizeText(normalized.detail, 4000),
    statusCode: normalized.statusCode,
    code: normalized.errorCode || null,
    codexErrorInfo: normalized.codexErrorInfo,
    additionalDetails: normalized.additionalDetails,
  };
  if (!entry.message) return;
  session.errorCount += 1;
  pushBounded(session.recentErrors, entry, MAX_RECENT_ERRORS);
  pushBounded(turn.errors, entry, MAX_TURN_ITEMS);
  addUnique(session.errorArtifacts, entry.message, MAX_ERROR_ARTIFACTS);
  addUnique(turn.errorArtifacts, entry.message, MAX_ERROR_ARTIFACTS);
  for (const value of buildNormalizedErrorSearchValues(entry)) {
    noteSearchBucket(session, "errors", value);
  }
}

function buildAppServerThreadView(thread, fallbackSession = null) {
  if (!thread || typeof thread !== "object") return null;

  const fallbackTurns = new Map(
    Array.isArray(fallbackSession && fallbackSession.turns)
      ? fallbackSession.turns.map((turn) => [turn.turnId, turn])
      : []
  );
  const sourceInfo = normalizeSessionSource(thread.source);

  const session = createSessionDocument(
    typeof thread.path === "string" && thread.path
      ? thread.path
      : `rollout-${thread.id || "unknown"}.jsonl`
  );
  session.sessionId = prefixedSessionId(thread.id) || (fallbackSession && fallbackSession.sessionId) || session.sessionId;
  session.filePath = typeof thread.path === "string" && thread.path
    ? thread.path
    : (fallbackSession && fallbackSession.filePath) || session.filePath;
  session.sessionKey = (fallbackSession && fallbackSession.sessionKey) || extractRolloutKeyFromFilePath(session.filePath) || session.sessionKey;
  session.forkedFromId = prefixedSessionId(thread.forkedFromId) || (fallbackSession && fallbackSession.forkedFromId) || null;
  session.parentThreadId = (sourceInfo.sourceDetail && sourceInfo.sourceDetail.type === "subAgent" && sourceInfo.sourceDetail.variant === "threadSpawn"
    ? sourceInfo.sourceDetail.parentThreadId
    : null) || (fallbackSession && fallbackSession.parentThreadId) || null;
  session.subagentDepth = Number.isInteger(
    sourceInfo.sourceDetail && sourceInfo.sourceDetail.type === "subAgent" && sourceInfo.sourceDetail.variant === "threadSpawn"
      ? sourceInfo.sourceDetail.depth
      : null
  )
    ? sourceInfo.sourceDetail.depth
    : (Number.isInteger(fallbackSession && fallbackSession.subagentDepth) ? fallbackSession.subagentDepth : null);
  session.lineageRootId = (fallbackSession && fallbackSession.lineageRootId) || null;
  session.lineageDepth = Number.isInteger(fallbackSession && fallbackSession.lineageDepth) ? fallbackSession.lineageDepth : 0;
  session.lineageFamilyCount = Number.isInteger(fallbackSession && fallbackSession.lineageFamilyCount)
    ? fallbackSession.lineageFamilyCount
    : 1;
  session.replayedSessionIds = [];
  session.startedAt = appServerSecondsToIso(thread.createdAt) || (fallbackSession && fallbackSession.startedAt) || null;
  session.updatedAt = appServerSecondsToIso(thread.updatedAt) || (fallbackSession && fallbackSession.updatedAt) || session.startedAt;
  session.endedAt = (fallbackSession && fallbackSession.endedAt) || null;
  session.cwd = normalizeCwdValue(thread.cwd || (fallbackSession && fallbackSession.cwd) || "");
  session.cliVersion = thread.cliVersion || (fallbackSession && fallbackSession.cliVersion) || null;
  session.model = (fallbackSession && fallbackSession.model) || null;
  session.modelProvider = thread.modelProvider || (fallbackSession && fallbackSession.modelProvider) || null;
  session.memoryMode = (fallbackSession && fallbackSession.memoryMode) || null;
  session.source = sourceInfo.source || (fallbackSession && fallbackSession.source) || null;
  session.sourceKind = sourceInfo.sourceKind || (fallbackSession && fallbackSession.sourceKind) || null;
  session.sourceDetail = sourceInfo.sourceDetail || (fallbackSession && fallbackSession.sourceDetail) || null;
  session.agentNickname =
    thread.agentNickname ??
    (
      sourceInfo.sourceDetail &&
      sourceInfo.sourceDetail.type === "subAgent" &&
      typeof sourceInfo.sourceDetail.agentNickname === "string" &&
      sourceInfo.sourceDetail.agentNickname
        ? sourceInfo.sourceDetail.agentNickname
        : null
    ) ??
    (fallbackSession && fallbackSession.agentNickname) ??
    null;
  session.agentRole =
    thread.agentRole ??
    (
      sourceInfo.sourceDetail &&
      sourceInfo.sourceDetail.type === "subAgent" &&
      typeof sourceInfo.sourceDetail.agentRole === "string" &&
      sourceInfo.sourceDetail.agentRole
        ? sourceInfo.sourceDetail.agentRole
        : null
    ) ??
    (fallbackSession && fallbackSession.agentRole) ??
    null;
  session.agentPath =
    (
      sourceInfo.sourceDetail &&
      sourceInfo.sourceDetail.type === "subAgent" &&
      typeof sourceInfo.sourceDetail.agentPath === "string" &&
      sourceInfo.sourceDetail.agentPath
        ? sourceInfo.sourceDetail.agentPath
        : null
    ) ||
    (fallbackSession && fallbackSession.agentPath) ||
    null;
  session.gitBranch =
    (thread.gitInfo && typeof thread.gitInfo.branch === "string" && thread.gitInfo.branch)
      ? thread.gitInfo.branch
      : ((fallbackSession && fallbackSession.gitBranch) || null);
  session.gitSha =
    (thread.gitInfo && typeof thread.gitInfo.sha === "string" && thread.gitInfo.sha)
      ? thread.gitInfo.sha
      : ((fallbackSession && fallbackSession.gitSha) || null);
  session.gitOriginUrl =
    (thread.gitInfo && typeof thread.gitInfo.originUrl === "string" && thread.gitInfo.originUrl)
      ? thread.gitInfo.originUrl
      : ((fallbackSession && fallbackSession.gitOriginUrl) || null);
  session.approvalPolicy = (fallbackSession && fallbackSession.approvalPolicy) || null;
  session.sandboxMode = (fallbackSession && fallbackSession.sandboxMode) || null;
  session.reasoningEffort = (fallbackSession && fallbackSession.reasoningEffort) || null;
  session.summaryMode = (fallbackSession && fallbackSession.summaryMode) || null;
  session.annotation = getEntityAnnotation(fallbackSession);
  session.lastUserPreview = (fallbackSession && fallbackSession.lastUserPreview) || "";
  session.commentaryPreview = (fallbackSession && fallbackSession.commentaryPreview) || "";
  session.finalAnswerPreview = (fallbackSession && fallbackSession.finalAnswerPreview) || "";
  if (fallbackSession && fallbackSession.rolloutPersistence && typeof fallbackSession.rolloutPersistence === "object") {
    session._rolloutPersistenceKnown = true;
    session.memoryMode = fallbackSession.rolloutPersistence.memoryMode || session.memoryMode || null;
    for (const key of Array.isArray(fallbackSession.rolloutPersistence.observedEventKeys)
      ? fallbackSession.rolloutPersistence.observedEventKeys
      : []) {
      if (typeof key === "string" && key) session._extendedEventPersistenceKeys.add(key);
    }
  }
  for (const replayedSessionId of Array.isArray(fallbackSession && fallbackSession.replayedSessionIds)
    ? fallbackSession.replayedSessionIds
    : []) {
    if (typeof replayedSessionId === "string" && replayedSessionId) {
      session._replayedSessionIds.add(replayedSessionId);
    }
  }

  if (!session.lastUserPreview && typeof thread.preview === "string" && thread.preview) {
    session.lastUserPreview = summarizeText(thread.preview, 240);
    noteSearchBucket(session, "text", thread.preview);
  }

  const transcript = [];
  const compactions = [];
  let index = 0;

  for (const rawTurn of Array.isArray(thread.turns) ? thread.turns : []) {
    if (!rawTurn || typeof rawTurn !== "object") continue;

    const turn = ensureTurn(session, rawTurn.id);
    if (!turn) continue;

    const fallbackTurn = fallbackTurns.get(rawTurn.id) || null;
    turn.startedAt = appServerSecondsToIso(rawTurn.startedAt) || (fallbackTurn && fallbackTurn.startedAt) || null;
    turn.endedAt = appServerSecondsToIso(rawTurn.completedAt) || (fallbackTurn && fallbackTurn.endedAt) || null;
    turn.status = normalizeAppServerEnumValue(rawTurn.status) || (fallbackTurn && fallbackTurn.status) || "open";
    turn.cwd = session.cwd || (fallbackTurn && fallbackTurn.cwd) || "";
    turn.model = (fallbackTurn && fallbackTurn.model) || session.model || null;
    turn.approvalPolicy = (fallbackTurn && fallbackTurn.approvalPolicy) || session.approvalPolicy || null;
    turn.sandboxMode = (fallbackTurn && fallbackTurn.sandboxMode) || session.sandboxMode || null;
    turn.reasoningEffort = (fallbackTurn && fallbackTurn.reasoningEffort) || session.reasoningEffort || null;
    turn.summaryMode = (fallbackTurn && fallbackTurn.summaryMode) || session.summaryMode || null;
    turn.annotation = getEntityAnnotation(fallbackTurn);

    for (const item of Array.isArray(rawTurn.items) ? rawTurn.items : []) {
      if (!item || typeof item !== "object") continue;
      index += 1;
      session.eventCount += 1;

      const itemType = String(item.type || "");
      let transcriptItem = null;

      if (itemType === "userMessage") {
        const text = summarizeAppServerUserContent(item.content, 4000);
        const preview = summarizeText(text, 240);
        session.userMessageCount += 1;
        if (preview) {
          turn.userPromptPreview = preview;
          session.lastUserPreview = preview;
          noteSearchBucket(session, "text", text);
        }
        transcriptItem = createAppServerTranscriptBase(session, turn, item, index, {
          type: "user",
          kind: "message",
          role: "user",
          phase: "prompt",
          preview,
          text,
          detail: text,
        });
      } else if (itemType === "hookPrompt") {
        const text = summarizeText(
          (Array.isArray(item.fragments) ? item.fragments : [])
            .map((fragment) => fragment && fragment.text)
            .filter(Boolean)
            .join("\n\n"),
          4000
        );
        if (text) noteSearchBucket(session, "text", text);
        transcriptItem = createAppServerTranscriptBase(session, turn, item, index, {
          type: "status",
          kind: "status",
          role: "system",
          preview: summarizeText(text, 240),
          text,
          detail: text,
        });
      } else if (itemType === "agentMessage") {
        const text = summarizeText(item.text, 4000);
        const preview = summarizeText(text, 240);
        const phase = normalizeAppServerEnumValue(item.phase);
        const memoryCitation = normalizeAppServerMemoryCitation(item.memoryCitation, turn.cwd || session.cwd);
        session.assistantMessageCount += 1;
        if (phase === "commentary") turn.commentaryPreview = preview;
        else turn.finalAnswerPreview = preview;
        if (phase === "commentary") session.commentaryPreview = preview;
        else session.finalAnswerPreview = preview;
        if (text) noteSearchBucket(session, "text", text);
        for (const value of getTranscriptItemMemoryCitationSearchValues({
          memoryCitation: memoryCitation.memoryCitation,
          memoryCitationPaths: memoryCitation.paths,
        })) {
          noteSearchBucket(session, "text", value);
        }
        transcriptItem = createAppServerTranscriptBase(session, turn, item, index, {
          type: phase === "commentary" ? "commentary" : "assistant",
          kind: "message",
          role: "assistant",
          phase,
          preview,
          text,
          detail: text,
          memoryCitation: memoryCitation.memoryCitation,
          memoryCitationPaths: memoryCitation.paths,
        });
      } else if (itemType === "plan") {
        const text = summarizeText(item.text, 4000);
        if (text) noteSearchBucket(session, "text", text);
        transcriptItem = createAppServerTranscriptBase(session, turn, item, index, {
          type: "reasoning",
          kind: "reasoning",
          role: "assistant",
          preview: summarizeText(text, 240),
          text,
          detail: text,
        });
      } else if (itemType === "reasoning") {
        const text = summarizeAppServerReasoning(item);
        session.reasoningCount += 1;
        if (text) noteSearchBucket(session, "text", text);
        transcriptItem = createAppServerTranscriptBase(session, turn, item, index, {
          type: "reasoning",
          kind: "reasoning",
          role: "assistant",
          preview: summarizeText(text, 240),
          text,
          detail: text,
        });
      } else if (itemType === "commandExecution") {
        const commandCwd = normalizeCwdValue(item.cwd || turn.cwd || session.cwd);
        const command = summarizeText(item.command, 240);
        const commandSource = normalizeAppServerEnumValue(item.source);
        const toolStatus = normalizeAppServerEnumValue(item.status);
        const details = extractAppServerCommandArtifacts(item.commandActions, commandCwd);
        const shellStructure = inferShellCommandStructure(command);
        const commandTypeHints = shellStructure.commandTypeHints.filter(
          (value) => !details.commandTypes.includes(value)
        );
        const outputText = summarizeText(item.aggregatedOutput, 4000);
        const commandPathRoles = getCommandPathRoles(details.commandTypes);
        const commandEntry = {
          timestamp: turn.endedAt || turn.startedAt || session.updatedAt || null,
          command,
          toolName: "exec_command",
          exitCode: Number.isFinite(item.exitCode) ? Number(item.exitCode) : null,
          status: toolStatus || null,
          commandSource: commandSource || null,
          commandTypes: details.commandTypes,
          commandTypeHints,
          pathRoles: commandPathRoles,
          commandPaths: details.commandPaths,
          commandPathPatterns: details.commandPathPatterns,
          commandQueries: details.commandQueries,
          shellCommands: shellStructure.shellCommands,
        };

        session.commandCount += 1;
        addUnique(session.toolsUsed, "exec_command");
        noteTurnTool(turn, "exec_command");
        pushBounded(session.recentCommands, commandEntry, MAX_RECENT_COMMANDS);
        pushBounded(turn.commands, commandEntry, MAX_TURN_ITEMS);
        addUnique(session.commandArtifacts, command, MAX_COMMAND_ARTIFACTS);
        addUnique(turn.commandArtifacts, command, MAX_COMMAND_ARTIFACTS);
        noteSearchBucket(session, "commands", command);

        for (const type of details.commandTypes) {
          addUnique(session.commandTypes, type);
          noteTurnCommandType(turn, type);
          noteSearchBucket(session, "command_types", type);
        }
        for (const typeHint of commandTypeHints) {
          noteSearchBucket(session, "command_type_hints", typeHint);
        }
        for (const shellCommand of shellStructure.shellCommands) {
          addUnique(session.commandOpArtifacts, shellCommand, MAX_COMMAND_ARTIFACTS);
          addUnique(turn.commandOpArtifacts, shellCommand, MAX_COMMAND_ARTIFACTS);
          noteSearchBucket(session, "command_ops", shellCommand);
        }

        for (const referencedPath of details.commandPaths) {
          noteSessionPath(session, commandCwd, referencedPath, commandPathRoles);
          noteTurnPath(turn, commandCwd, referencedPath, commandPathRoles);
          addUnique(turn.pathArtifacts, referencedPath, MAX_PATH_ARTIFACTS);
          noteSearchBucket(session, "paths", referencedPath);
        }
        for (const referencedPattern of details.commandPathPatterns) {
          noteSessionPathPattern(session, commandCwd, referencedPattern, commandPathRoles);
          noteTurnPathPattern(turn, commandCwd, referencedPattern, commandPathRoles);
          noteSearchBucket(session, "path_patterns", referencedPattern);
        }

        for (const query of details.commandQueries) {
          const entry = {
            timestamp: commandEntry.timestamp,
            query,
            actionType: "command",
          };
          pushBounded(session.recentQueries, entry, MAX_RECENT_QUERIES);
          noteTurnQuery(turn, entry);
          addUnique(session.queryArtifacts, query, MAX_QUERY_ARTIFACTS);
          addUnique(turn.queryArtifacts, query, MAX_QUERY_ARTIFACTS);
          noteSearchBucket(session, "queries", query);
        }

        transcriptItem = createAppServerTranscriptBase(session, turn, item, index, {
          type: "tool",
          kind: "tool_output",
          role: "system",
          preview: summarizeText(outputText || command, 240),
          text: outputText,
          detail: outputText || command,
          toolName: "exec_command",
          toolClass: "command",
          toolStatus: toolStatus || null,
          command,
          commandSource: commandSource || "",
          cwd: commandCwd,
          commandTypes: details.commandTypes,
          commandTypeHints,
          pathRoles: clonePathRoleBuckets({
            ...createPathRoleBuckets(),
            ...(commandPathRoles.length ? Object.fromEntries(commandPathRoles.map((role) => [role, details.commandPaths])) : {}),
          }),
          pathPatternRoles: clonePathRoleBuckets({
            ...createPathRoleBuckets(),
            ...(commandPathRoles.length ? Object.fromEntries(commandPathRoles.map((role) => [role, details.commandPathPatterns])) : {}),
          }),
          commandPaths: details.commandPaths,
          commandPathPatterns: details.commandPathPatterns,
          commandQueries: details.commandQueries,
          shellCommands: shellStructure.shellCommands,
          success: commandEntry.exitCode == null ? null : commandEntry.exitCode === 0,
          exitCode: commandEntry.exitCode,
        });
      } else if (itemType === "fileChange") {
        const toolStatus = normalizeAppServerEnumValue(item.status);
        const filesTouched = extractAppServerFilePaths(item.changes, turn.cwd || session.cwd);
        session.patchCount += 1;
        addUnique(session.toolsUsed, "apply_patch");
        noteTurnTool(turn, "apply_patch");

        for (const filePath of filesTouched) {
          const resolvedFilePath = noteTurnFile(turn, "", filePath);
          noteTurnPath(turn, "", resolvedFilePath, "write");
          addUnique(turn.pathArtifacts, resolvedFilePath, MAX_PATH_ARTIFACTS);
          noteSessionFile(session, "", resolvedFilePath);
          noteSessionPath(session, "", resolvedFilePath, "write");
          noteSearchBucket(session, "files", resolvedFilePath);
          noteSearchBucket(session, "paths", resolvedFilePath);
        }

        const detail = filesTouched.length
          ? `${toolStatus || "completed"} ${filesTouched.length} file change${filesTouched.length === 1 ? "" : "s"}`
          : (toolStatus || "file change");
        transcriptItem = createAppServerTranscriptBase(session, turn, item, index, {
          type: "tool",
          kind: "patch",
          role: "system",
          preview: summarizeText(detail, 240),
          text: detail,
          detail,
          toolName: "apply_patch",
          toolClass: "patch",
          toolStatus: toolStatus || null,
          pathRoles: clonePathRoleBuckets({
            read: [],
            search_scope: [],
            list_scope: [],
            write: filesTouched.slice(0, 20),
          }),
          filesTouched,
          fileCount: filesTouched.length,
          success: toolStatus ? toolStatus === "completed" : null,
        });
      } else if (itemType === "mcpToolCall") {
        const toolStatus = normalizeAppServerEnumValue(item.status);
        const toolName = item.tool ? `mcp:${item.tool}` : "mcp";
        const detail = item.error && typeof item.error.message === "string"
          ? summarizeText(item.error.message, 4000)
          : summarizeAppServerContentBlocks(item.result && item.result.content) ||
            summarizeStructuredValue(item.result && item.result.structuredContent, 4000);
        session.mcpCount += 1;
        addUnique(session.toolsUsed, toolName);
        noteTurnTool(turn, toolName);
        if (detail) noteSearchBucket(session, "text", detail);
        transcriptItem = createAppServerTranscriptBase(session, turn, item, index, {
          type: "tool",
          kind: "mcp",
          role: "assistant",
          preview: summarizeText(detail || toolName, 240),
          text: detail,
          detail: detail || toolName,
          toolName,
          toolClass: "mcp",
          toolStatus: toolStatus || null,
          success: toolStatus ? toolStatus === "completed" : null,
        });
      } else if (itemType === "dynamicToolCall") {
        const toolStatus = normalizeAppServerEnumValue(item.status);
        const toolName = typeof item.tool === "string" && item.tool ? item.tool : "dynamic_tool";
        const detail = summarizeAppServerDynamicContent(item.contentItems) ||
          summarizeStructuredValue(item.arguments, 2000);
        addUnique(session.toolsUsed, toolName);
        noteTurnTool(turn, toolName);
        if (detail) noteSearchBucket(session, "text", detail);
        transcriptItem = createAppServerTranscriptBase(session, turn, item, index, {
          type: "tool",
          kind: "tool_output",
          role: "assistant",
          preview: summarizeText(detail || toolName, 240),
          text: detail,
          detail: detail || toolName,
          toolName,
          toolClass: "dynamic_tool",
          toolStatus: toolStatus || null,
          success: typeof item.success === "boolean" ? item.success : (toolStatus ? toolStatus === "completed" : null),
        });
      } else if (itemType === "collabAgentToolCall") {
        const toolStatus = normalizeAppServerEnumValue(item.status);
        const toolName = normalizeAppServerEnumValue(item.tool) || "collab_agent";
        const detail = summarizeText([
          item.prompt,
          Array.isArray(item.receiverThreadIds) && item.receiverThreadIds.length
            ? `receivers=${item.receiverThreadIds.join(", ")}`
            : "",
          item.model ? `model=${item.model}` : "",
          item.reasoningEffort ? `effort=${normalizeAppServerEnumValue(item.reasoningEffort)}` : "",
        ].filter(Boolean).join(" | "), 4000);
        addUnique(session.toolsUsed, toolName);
        noteTurnTool(turn, toolName);
        if (detail) noteSearchBucket(session, "text", detail);
        transcriptItem = createAppServerTranscriptBase(session, turn, item, index, {
          type: "tool",
          kind: "tool_output",
          role: "assistant",
          preview: summarizeText(detail || toolName, 240),
          text: detail,
          detail: detail || toolName,
          toolName,
          toolClass: "collab",
          toolStatus: toolStatus || null,
          success: toolStatus ? toolStatus === "completed" : null,
        });
      } else if (itemType === "webSearch") {
        const search = extractAppServerWebSearch(item);
        const detail = summarizeText(
          [search.query, ...(search.queries || [])].filter(Boolean).join(" | "),
          4000
        );
        session.searchCount += 1;
        addUnique(session.toolsUsed, "web_search");
        noteTurnTool(turn, "web_search");

        if (search.query) {
          const entry = {
            timestamp: turn.startedAt || turn.endedAt || session.updatedAt || null,
            query: search.query,
            actionType: search.actionType || null,
          };
          pushBounded(session.recentQueries, entry, MAX_RECENT_QUERIES);
          noteTurnQuery(turn, entry);
          addUnique(session.queryArtifacts, search.query, MAX_QUERY_ARTIFACTS);
          addUnique(turn.queryArtifacts, search.query, MAX_QUERY_ARTIFACTS);
          noteSearchBucket(session, "queries", search.query);
        }
        for (const query of search.queries) {
          const entry = {
            timestamp: turn.startedAt || turn.endedAt || session.updatedAt || null,
            query,
            actionType: search.actionType || null,
          };
          noteTurnQuery(turn, entry);
          addUnique(session.queryArtifacts, query, MAX_QUERY_ARTIFACTS);
          addUnique(turn.queryArtifacts, query, MAX_QUERY_ARTIFACTS);
          noteSearchBucket(session, "queries", query);
        }

        transcriptItem = createAppServerTranscriptBase(session, turn, item, index, {
          type: "tool",
          kind: "web_search",
          role: "assistant",
          preview: summarizeText(detail || search.query || "web search", 240),
          text: detail,
          detail: detail || search.query || "web search",
          toolName: "web_search",
          toolClass: "search",
          query: search.query,
          queries: search.queries,
          actionType: search.actionType || "",
        });
      } else if (itemType === "imageView") {
        const detail = typeof item.path === "string" ? item.path : "";
        if (detail) {
          const referencedPath = normalizeReferencedPath(turn.cwd || session.cwd, detail) || detail;
          noteSessionPath(session, turn.cwd || session.cwd, detail, "read");
          noteTurnPath(turn, turn.cwd || session.cwd, detail, "read");
          addUnique(turn.pathArtifacts, referencedPath, MAX_PATH_ARTIFACTS);
          noteSearchBucket(session, "paths", detail);
        }
        transcriptItem = createAppServerTranscriptBase(session, turn, item, index, {
          type: "tool",
          kind: "tool_output",
          role: "system",
          preview: summarizeText(detail || "image view", 240),
          text: detail,
          detail: detail || "image view",
          toolName: "image_view",
          toolClass: "image",
          pathRoles: clonePathRoleBuckets({
            read: detail ? [normalizeReferencedPath(turn.cwd || session.cwd, detail) || detail] : [],
            search_scope: [],
            list_scope: [],
            write: [],
          }),
          commandPaths: detail ? [normalizeReferencedPath(turn.cwd || session.cwd, detail) || detail] : [],
        });
      } else if (itemType === "imageGeneration") {
        const toolStatus = normalizeAppServerEnumValue(item.status);
        const savedPath = typeof item.savedPath === "string" ? item.savedPath : "";
        if (savedPath) {
          const resolvedSavedPath = noteTurnFile(turn, turn.cwd || session.cwd, savedPath);
          noteTurnPath(turn, "", resolvedSavedPath, "write");
          addUnique(turn.pathArtifacts, resolvedSavedPath, MAX_PATH_ARTIFACTS);
          noteSessionFile(session, turn.cwd || session.cwd, resolvedSavedPath);
          noteSessionPath(session, "", resolvedSavedPath, "write");
          noteSearchBucket(session, "files", resolvedSavedPath);
          noteSearchBucket(session, "paths", resolvedSavedPath);
        }
        const detail = summarizeText([item.revisedPrompt, item.result, savedPath].filter(Boolean).join(" | "), 4000);
        addUnique(session.toolsUsed, "image_generation");
        noteTurnTool(turn, "image_generation");
        transcriptItem = createAppServerTranscriptBase(session, turn, item, index, {
          type: "tool",
          kind: "tool_output",
          role: "system",
          preview: summarizeText(detail || "image generation", 240),
          text: detail,
          detail: detail || "image generation",
          toolName: "image_generation",
          toolClass: "image",
          toolStatus: toolStatus || null,
          success: toolStatus ? toolStatus === "completed" : null,
          pathRoles: clonePathRoleBuckets({
            read: [],
            search_scope: [],
            list_scope: [],
            write: savedPath ? [savedPath] : [],
          }),
          filesTouched: savedPath ? [savedPath] : [],
          fileCount: savedPath ? 1 : 0,
        });
      } else if (itemType === "enteredReviewMode" || itemType === "exitedReviewMode") {
        const detail = summarizeText(item.review, 4000);
        if (detail) noteSearchBucket(session, "text", detail);
        transcriptItem = createAppServerTranscriptBase(session, turn, item, index, {
          type: "status",
          kind: "status",
          role: "system",
          preview: summarizeText(detail || itemType, 240),
          text: detail,
          detail: detail || itemType,
        });
      } else if (itemType === "contextCompaction") {
        compactions.push({
          timestamp: turn.endedAt || turn.startedAt || session.updatedAt || null,
          turnId: turn.turnId,
          replacementCount: 0,
          preview: "",
        });
      }

      if (transcriptItem) {
        const previous = transcript[transcript.length - 1];
        if (previous && canDeduplicateTranscriptMessagePair(previous, transcriptItem)) {
          transcript[transcript.length - 1] = mergeTranscriptMessageItem(previous, transcriptItem);
        } else {
          transcript.push(transcriptItem);
        }
      }
    }

    const normalizedTurnError = normalizeAppServerTurnError(rawTurn.error);
    if (normalizedTurnError) {
      index += 1;
      session.eventCount += 1;
      noteAppServerTurnError(
        session,
        turn,
        rawTurn.error,
        turn.endedAt || turn.startedAt || session.updatedAt || null
      );
      transcript.push(createAppServerTranscriptBase(session, turn, { id: `turn-error:${turn.turnId}` }, index, {
        type: "error",
        kind: "error",
        role: "system",
        preview: summarizeText(normalizedTurnError.message, 240),
        text: normalizedTurnError.message,
        detail: normalizedTurnError.detail,
        errorCode: normalizedTurnError.errorCode || "",
        statusCode: normalizedTurnError.statusCode,
        codexErrorInfo: normalizedTurnError.codexErrorInfo,
        additionalDetails: normalizedTurnError.additionalDetails,
      }));
    }

    if (turn.endedAt && (!session.endedAt || (toTimestampMs(turn.endedAt) || 0) > (toTimestampMs(session.endedAt) || 0))) {
      session.endedAt = turn.endedAt;
    }
  }

  finalizeSession(session);
  return { session, transcript, compactions };
}

  return {
    buildAppServerThreadView,
  };
}

module.exports = { createCatalogAppServerThreadView };
