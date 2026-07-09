"use strict";

function createCatalogRolloutBuild(deps = {}) {
  const {
    fs,
    prefixedSessionId,
    extractSessionIdFromFilePath,
    normalizeHistoryMode,
    normalizeRecordObject,
    logEventMap,
    createSessionDocument,
    finalizeSession,
    toTimestampMs,
    noteSearchBucket,
    noteRolloutPersistence,
    ensureTurn,
    summarizeText,
    addUnique,
    noteTurnTool,
    getCommandPathRoles,
    normalizeReferencedPath,
    normalizeReferencedPathPattern,
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
    noteTurnFile,
    normalizeTouchedFilePath,
    noteSessionFile,
    noteTurnQuery,
    MAX_RECENT_QUERIES,
    MAX_QUERY_ARTIFACTS,
    buildNormalizedErrorDetail,
    buildNormalizedErrorSearchValues,
    MAX_RECENT_ERRORS,
    MAX_ERROR_ARTIFACTS,
  } = deps;

  function resolveRecordTurnId(record, activeTurnId) {
    if (record.turnId) return record.turnId;
    if (record.turnContext && record.turnContext.turnId) return record.turnContext.turnId;
    if (record.kind === "history_mutation" || record.kind === "session_meta" || record.kind === "session_header") {
      return null;
    }
    return activeTurnId || null;
  }

  function resolveEffectiveHistoryEvents(events) {
    const orderedTurnIds = [];
    const seenTurnIds = new Set();

    for (const item of events) {
      const turnId = typeof item.resolvedTurnId === "string" && item.resolvedTurnId
        ? item.resolvedTurnId
        : null;

      if (turnId && !seenTurnIds.has(turnId)) {
        seenTurnIds.add(turnId);
        orderedTurnIds.push(turnId);
      }

      const mutation = item.record && item.record.kind === "history_mutation" && item.record.mutation
        ? item.record.mutation
        : null;
      if (!mutation || mutation.type !== "thread_rollback") continue;

      const dropCount = Number.isInteger(mutation.numTurns) && mutation.numTurns > 0
        ? mutation.numTurns
        : 0;
      if (!dropCount) continue;

      orderedTurnIds.splice(Math.max(0, orderedTurnIds.length - dropCount), dropCount);
    }

    const survivingTurnIds = new Set(orderedTurnIds);
    return {
      finalTurnIds: orderedTurnIds,
      events: events.map((item) => ({
        ...item,
        includedInFinalHistory: !item.resolvedTurnId || survivingTurnIds.has(item.resolvedTurnId),
      })),
    };
  }

  function selectNormalizedEvents(normalized, historyMode = "effective") {
    const mode = normalizeHistoryMode(historyMode);
    const allEvents = Array.isArray(normalized && normalized.events) ? normalized.events : [];
    if (mode === "raw") return allEvents;
    return allEvents.filter((item) => item.includedInFinalHistory);
  }

  function normalizeLegacyMessageContent(content, role) {
    if (Array.isArray(content)) return content;
    if (typeof content === "string") {
      return content
        ? [{ type: role === "user" ? "input_text" : "output_text", text: content }]
        : [];
    }
    if (content && typeof content === "object") return [content];
    return [];
  }

  function buildLegacySessionMetaRecord(filePath, session) {
    if (!session || typeof session !== "object") return null;
    return {
      timestamp: typeof session.timestamp === "string" ? session.timestamp : null,
      type: "session_meta",
      payload: {
        id: typeof session.id === "string" ? session.id : extractSessionIdFromFilePath(filePath),
        timestamp: typeof session.timestamp === "string" ? session.timestamp : null,
        cwd: typeof session.cwd === "string" ? session.cwd : "",
        originator: typeof session.originator === "string" ? session.originator : "legacy_rollout_json",
        cli_version: typeof session.cli_version === "string" ? session.cli_version : "",
        source: session.source || "legacy",
        instructions: typeof session.instructions === "string"
          ? session.instructions
          : (session.instructions === null ? null : undefined),
      },
    };
  }

  function buildLegacyItemRecords(item) {
    if (!item || typeof item !== "object") return [];

    // Responses-API style legacy items (2025-04 era) carry their own `type`
    // (reasoning, function_call, function_call_output, ...). Route them
    // through the modern response_item normalization path so their tool and
    // reasoning evidence is preserved instead of being dropped.
    if (typeof item.type === "string" && item.type && item.type !== "message") {
      return [{ type: "response_item", payload: item }];
    }

    const role = typeof item.role === "string" ? item.role : null;
    const records = [];

    if (role === "tool" && typeof item.tool_call_id === "string") {
      let output = "";
      if (typeof item.content === "string") output = item.content;
      else if (item.content != null) {
        try {
          output = JSON.stringify(item.content);
        } catch {
          output = String(item.content);
        }
      }
      records.push({
        type: "response_item",
        payload: {
          type: "function_call_output",
          call_id: item.tool_call_id,
          output,
        },
      });
      return records;
    }

    const content = normalizeLegacyMessageContent(item.content, role);
    if (role === "user" || role === "assistant" || role === "developer" || role === "system") {
      if (
        (typeof item.content === "string" && item.content.trim()) ||
        (Array.isArray(content) && content.length)
      ) {
        records.push({
          type: "message",
          role,
          phase: role === "assistant" && !Array.isArray(item.tool_calls)
            ? "final_answer"
            : undefined,
          content,
        });
      }
    }

    if (role === "assistant" && Array.isArray(item.tool_calls)) {
      for (const toolCall of item.tool_calls) {
        const fn = toolCall && toolCall.function && typeof toolCall.function === "object"
          ? toolCall.function
          : null;
        const name = fn && typeof fn.name === "string" ? fn.name : null;
        if (!name) continue;
        records.push({
          type: "response_item",
          payload: {
            type: "function_call",
            name,
            arguments: typeof fn.arguments === "string" ? fn.arguments : "{}",
            call_id: typeof toolCall.id === "string" ? toolCall.id : null,
          },
        });
      }
    }

    return records;
  }

  function convertLegacyRolloutObject(filePath, value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    if (!value.session || !Array.isArray(value.items)) return null;

    const records = [];
    const sessionMetaRecord = buildLegacySessionMetaRecord(filePath, value.session);
    if (sessionMetaRecord) records.push(sessionMetaRecord);
    for (const item of value.items) {
      records.push(...buildLegacyItemRecords(item));
    }
    return records;
  }

  // Legacy and mid-generation rollouts carry no turn_context / task_started
  // markers, so their sessions would stay turnless. For those generations
  // (identified by the bare "message" record key, which modern rollouts never
  // emit) every real user message starts an implicit turn. Synthetic context
  // wrappers do not open turns.
  const IMPLICIT_TURN_SKIP_PREFIXES = [
    "<environment_context>",
    "<user_instructions>",
    "<turn_aborted>",
    "<permissions",
  ];

  function isImplicitTurnBoundary(record) {
    if (!record || record.key !== "message" || record.role !== "user") return false;
    const text = typeof record.text === "string" ? record.text.trimStart() : "";
    if (!text) return false;
    const head = text.slice(0, 40).toLowerCase();
    return !IMPLICIT_TURN_SKIP_PREFIXES.some((prefix) => head.startsWith(prefix));
  }

  function isMaterializedSessionDoc(value) {
    return Boolean(
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Number.isInteger(value.schemaVersion) &&
      typeof value.historyMode === "string" &&
      typeof value.sessionId === "string" &&
      Array.isArray(value.turns)
    );
  }

  function loadRolloutObjects(filePath, text) {
    if (typeof text !== "string" || !text.trim()) return [];

    try {
      const parsed = JSON.parse(text);
      if (isMaterializedSessionDoc(parsed)) return [];
      const legacy = convertLegacyRolloutObject(filePath, parsed);
      if (legacy) return legacy;
      if (Array.isArray(parsed)) return parsed.filter((item) => item && typeof item === "object");
      if (parsed && typeof parsed === "object") return [parsed];
    } catch {}

    const objects = [];
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || (!trimmed.startsWith("{") && !trimmed.startsWith("["))) continue;

      let value;
      try {
        value = JSON.parse(trimmed);
      } catch {
        continue;
      }

      if (Array.isArray(value)) {
        for (const item of value) {
          if (item && typeof item === "object" && !isMaterializedSessionDoc(item)) objects.push(item);
        }
      } else if (value && typeof value === "object" && !isMaterializedSessionDoc(value)) {
        objects.push(value);
      }
    }

    return objects;
  }

  function readNormalizedSessionEvents(filePath, options = {}) {
    const fallbackSessionId = prefixedSessionId(extractSessionIdFromFilePath(filePath)) || "codex:unknown";
    let text;
    try {
      text = fs.readFileSync(filePath, "utf8");
    } catch {
      return {
        sessionId: fallbackSessionId,
        filePath,
        events: [],
      };
    }

    let sessionId = fallbackSessionId;
    let forkedFromId = null;
    let parentThreadId = null;
    let subagentDepth = null;
    let primarySessionMetaSeen = false;
    const replayedSessionIds = new Set();
    let currentCwd = typeof options.defaultCwd === "string" ? options.defaultCwd : "";
    let activeTurnId = "";
    let implicitTurnCount = 0;
    const events = [];
    const objects = loadRolloutObjects(filePath, text);

    for (let index = 0; index < objects.length; index += 1) {
      const obj = objects[index];
      const lineNumber = index + 1;

      const record = normalizeRecordObject(obj, {
        logEventMap,
        defaultCwd: currentCwd,
      });

      if (record.kind === "session_meta" && record.sessionMeta) {
        const recordSessionId = prefixedSessionId(record.sessionMeta.id);
        if (!primarySessionMetaSeen) {
          sessionId = recordSessionId || sessionId;
          forkedFromId = prefixedSessionId(record.sessionMeta.forkedFromId) || null;
          parentThreadId = prefixedSessionId(record.sessionMeta.subagent && record.sessionMeta.subagent.parentThreadId) || null;
          subagentDepth = Number.isInteger(record.sessionMeta.subagent && record.sessionMeta.subagent.depth)
            ? record.sessionMeta.subagent.depth
            : null;
          primarySessionMetaSeen = true;
        } else if (recordSessionId && recordSessionId !== sessionId) {
          replayedSessionIds.add(recordSessionId);
        }
        currentCwd = record.sessionMeta.cwd || currentCwd;
      }
      if (record.kind === "turn_context" && record.turnContext) {
        activeTurnId = record.turnContext.turnId || activeTurnId;
        currentCwd = record.turnContext.cwd || currentCwd;
      }
      if (record.kind === "turn_lifecycle" && record.lifecycle === "started") {
        activeTurnId = record.turnId || activeTurnId;
      }
      if (isImplicitTurnBoundary(record)) {
        implicitTurnCount += 1;
        activeTurnId = `implicit-${implicitTurnCount}`;
      }
      if (record.cwd) currentCwd = record.cwd;

      events.push({
        lineNumber,
        record,
        resolvedTurnId: resolveRecordTurnId(record, activeTurnId),
        resolvedCwd: record.cwd || currentCwd || null,
      });
    }

    const resolved = resolveEffectiveHistoryEvents(events);
    return {
      sessionId,
      forkedFromId,
      parentThreadId,
      subagentDepth,
      replayedSessionIds: Array.from(replayedSessionIds),
      filePath,
      rawEventCount: events.length,
      finalTurnIds: resolved.finalTurnIds,
      events: resolved.events,
    };
  }

  function observeRecordInCatalog(session, record, resolvedTurnId = null) {
    const timestampMs = toTimestampMs(record.timestamp);
    if (timestampMs != null) {
      const iso = new Date(timestampMs).toISOString();
      if (!session.startedAt || timestampMs < toTimestampMs(session.startedAt)) session.startedAt = iso;
      if (!session.updatedAt || timestampMs > toTimestampMs(session.updatedAt)) session.updatedAt = iso;
    }

    session.eventCount += 1;
    if (record.cwd) session.cwd = record.cwd;
    noteSearchBucket(session, "text", record.preview);
    noteRolloutPersistence(session, record);

    if (record.kind === "session_meta" && record.sessionMeta) {
      const recordSessionId = prefixedSessionId(record.sessionMeta.id);
      if (!session._primarySessionMetaSeen) {
        session.sessionId = recordSessionId || session.sessionId;
        session.forkedFromId = prefixedSessionId(record.sessionMeta.forkedFromId) || session.forkedFromId;
        session.parentThreadId = prefixedSessionId(record.sessionMeta.subagent && record.sessionMeta.subagent.parentThreadId) || session.parentThreadId;
        session.subagentDepth = Number.isInteger(record.sessionMeta.subagent && record.sessionMeta.subagent.depth)
          ? record.sessionMeta.subagent.depth
          : session.subagentDepth;
        session._primarySessionMetaSeen = true;
      } else if (recordSessionId && recordSessionId !== session.sessionId) {
        session._replayedSessionIds.add(recordSessionId);
      }
      session.cwd = record.sessionMeta.cwd || session.cwd;
      session.cliVersion = record.sessionMeta.cliVersion || session.cliVersion;
      session.modelProvider = record.sessionMeta.modelProvider || session.modelProvider;
      session.memoryMode = record.sessionMeta.memoryMode || session.memoryMode;
      session.originator = record.sessionMeta.originator || session.originator;
      session.source = record.sessionMeta.source || session.source;
      session.sourceKind = record.sessionMeta.sourceKind || session.sourceKind;
      if (record.sessionMeta.sourceDetail) session.sourceDetail = record.sessionMeta.sourceDetail;
      session.agentNickname = record.sessionMeta.agentNickname || session.agentNickname;
      session.agentRole = record.sessionMeta.agentRole || session.agentRole;
      session.agentPath = record.sessionMeta.agentPath || session.agentPath;
      session.baseInstructionsPreview = record.sessionMeta.baseInstructionsPreview || session.baseInstructionsPreview;
      if (record.sessionMeta.git) {
        session.gitBranch = record.sessionMeta.git.branch || session.gitBranch;
        session.gitSha = record.sessionMeta.git.sha || session.gitSha;
        session.gitOriginUrl = record.sessionMeta.git.originUrl || session.gitOriginUrl;
      }
      if (Array.isArray(record.sessionMeta.dynamicToolNames) && record.sessionMeta.dynamicToolNames.length) {
        const combined = new Set([...(session.dynamicToolNames || []), ...record.sessionMeta.dynamicToolNames]);
        session.dynamicToolNames = Array.from(combined).slice(0, 20);
        session.dynamicToolCount = Math.max(
          Number.isInteger(session.dynamicToolCount) ? session.dynamicToolCount : 0,
          Number.isInteger(record.sessionMeta.dynamicToolCount) ? record.sessionMeta.dynamicToolCount : session.dynamicToolNames.length
        );
      }
    }

    if (record.kind === "turn_context" && record.turnContext) {
      session._activeTurnId = record.turnContext.turnId || session._activeTurnId;
      session.cwd = record.turnContext.cwd || session.cwd;
      session.model = record.turnContext.model || session.model;
      session.approvalPolicy = record.turnContext.approvalPolicy || session.approvalPolicy;
      session.sandboxMode = record.turnContext.sandboxMode || session.sandboxMode;
      session.reasoningEffort = record.turnContext.reasoningEffort || session.reasoningEffort;
      session.summaryMode = record.turnContext.summaryMode || session.summaryMode;

      const turn = ensureTurn(session, record.turnContext.turnId);
      if (turn) {
        turn.cwd = record.turnContext.cwd || turn.cwd || session.cwd;
        turn.model = record.turnContext.model || turn.model || session.model;
        turn.approvalPolicy = record.turnContext.approvalPolicy || turn.approvalPolicy;
        turn.sandboxMode = record.turnContext.sandboxMode || turn.sandboxMode;
        turn.reasoningEffort = record.turnContext.reasoningEffort || turn.reasoningEffort;
        turn.summaryMode = record.turnContext.summaryMode || turn.summaryMode;
      }
    }

    // Implicit turn ids are minted once in readNormalizedSessionEvents and
    // adopted here via resolvedTurnId, so both paths agree even when the
    // effective filter drops rolled-back turns from this stream.
    if (typeof resolvedTurnId === "string" && resolvedTurnId.startsWith("implicit-")) {
      session._activeTurnId = resolvedTurnId;
    }

    const turn = ensureTurn(session, record.turnId || session._activeTurnId);
    if (turn) {
      if (record.cwd) turn.cwd = record.cwd || turn.cwd;
      turn.events += 1;
    }

    switch (record.kind) {
      case "turn_lifecycle":
        if (record.lifecycle === "started") {
          session._activeTurnId = record.turnId || session._activeTurnId;
          if (turn) {
            turn.startedAt = record.timestamp || turn.startedAt;
            turn.status = "running";
          }
        } else if (record.lifecycle === "completed") {
          if (turn) {
            turn.endedAt = record.timestamp || turn.endedAt;
            turn.status = "completed";
          }
          session.endedAt = record.timestamp || session.endedAt;
          if (record.text) {
            const preview = summarizeText(record.text, 240);
            if (turn) turn.finalAnswerPreview = preview;
            session.finalAnswerPreview = preview;
          }
        } else if (record.lifecycle === "aborted") {
          if (turn) {
            turn.endedAt = record.timestamp || turn.endedAt;
            turn.status = "aborted";
          }
        }
        break;
      case "message":
        if (record.role === "user") {
          session.userMessageCount += 1;
          session.lastUserPreview = summarizeText(record.text || record.preview, 240);
          if (turn && !turn.userPromptPreview) turn.userPromptPreview = session.lastUserPreview;
        } else if (record.role === "assistant") {
          session.assistantMessageCount += 1;
          if (record.phase === "commentary") {
            const preview = summarizeText(record.text || record.preview, 240);
            if (turn) turn.commentaryPreview = preview;
            session.commentaryPreview = preview;
          } else if (record.phase === "final_answer") {
            const preview = summarizeText(record.text || record.preview, 240);
            if (turn) turn.finalAnswerPreview = preview;
            session.finalAnswerPreview = preview;
          }
        }
        noteSearchBucket(session, "text", record.text || record.preview);
        break;
      case "reasoning":
        session.reasoningCount += 1;
        break;
      case "tool_call":
        session.commandCount += record.command ? 1 : 0;
        if (record.toolName) {
          addUnique(session.toolsUsed, record.toolName);
          noteSearchBucket(session, "tools", record.toolName);
          if (turn) noteTurnTool(turn, record.toolName);
        }
        if (record.command) {
          const command = summarizeText(record.command, 240);
          const commandTypes = Array.isArray(record.commandTypes) ? record.commandTypes.slice(0, 10) : [];
          const commandTypeHints = Array.isArray(record.commandTypeHints) ? record.commandTypeHints.slice(0, 10) : [];
          const commandPathRoles = getCommandPathRoles(commandTypes);
          const commandPaths = Array.isArray(record.commandPaths)
            ? record.commandPaths
              .map((value) => normalizeReferencedPath(record.cwd || (turn && turn.cwd) || session.cwd, value))
              .filter(Boolean)
              .slice(0, 20)
            : [];
          const commandPathPatterns = Array.isArray(record.commandPathPatterns)
            ? record.commandPathPatterns
              .map((value) => normalizeReferencedPathPattern(record.cwd || (turn && turn.cwd) || session.cwd, value))
              .filter(Boolean)
              .slice(0, 20)
            : [];
          const commandQueries = Array.isArray(record.commandQueries)
            ? record.commandQueries
              .map((value) => summarizeText(value, 240))
              .filter(Boolean)
              .slice(0, 20)
            : [];
          const shellCommands = Array.isArray(record.shellCommands) ? record.shellCommands.slice(0, 10) : [];
          pushBounded(session.recentCommands, {
            timestamp: record.timestamp,
            command,
            toolName: record.toolName || null,
            status: record.toolStatus || null,
            commandSource: record.commandSource || null,
            commandTypes,
            commandTypeHints,
            pathRoles: commandPathRoles,
            commandPaths,
            commandPathPatterns,
            commandQueries,
            shellCommands,
          }, MAX_RECENT_COMMANDS);
          if (turn) {
            pushBounded(turn.commands, {
              timestamp: record.timestamp,
              command,
              toolName: record.toolName || null,
              status: record.toolStatus || null,
              commandSource: record.commandSource || null,
              commandTypes,
              commandTypeHints,
              pathRoles: commandPathRoles,
              commandPaths,
              commandPathPatterns,
              commandQueries,
              shellCommands,
            }, MAX_TURN_ITEMS);
            addUnique(turn.commandArtifacts, command, MAX_COMMAND_ARTIFACTS);
          }
          noteSearchBucket(session, "commands", command);
          addUnique(session.commandArtifacts, command, MAX_COMMAND_ARTIFACTS);
          for (const type of commandTypes) {
            addUnique(session.commandTypes, type);
            if (turn) noteTurnCommandType(turn, type);
            noteSearchBucket(session, "command_types", type);
          }
          for (const typeHint of commandTypeHints) {
            noteSearchBucket(session, "command_type_hints", typeHint);
          }
          for (const shellCommand of shellCommands) {
            addUnique(session.commandOpArtifacts, shellCommand, MAX_COMMAND_ARTIFACTS);
            if (turn) addUnique(turn.commandOpArtifacts, shellCommand, MAX_COMMAND_ARTIFACTS);
            noteSearchBucket(session, "command_ops", shellCommand);
          }
          for (const referencedPath of commandPaths) {
            noteSessionPath(session, "", referencedPath, commandPathRoles);
            noteSearchBucket(session, "paths", referencedPath);
            if (turn) {
              noteTurnPath(turn, "", referencedPath, commandPathRoles);
              addUnique(turn.pathArtifacts, referencedPath, MAX_PATH_ARTIFACTS);
            }
          }
          for (const referencedPattern of commandPathPatterns) {
            noteSessionPathPattern(session, "", referencedPattern, commandPathRoles);
            noteSearchBucket(session, "path_patterns", referencedPattern);
            if (turn) {
              noteTurnPathPattern(turn, "", referencedPattern, commandPathRoles);
            }
          }
          for (const query of commandQueries) {
            pushBounded(session.recentQueries, {
              timestamp: record.timestamp,
              query,
              actionType: "command",
            }, MAX_RECENT_QUERIES);
            if (turn) {
              noteTurnQuery(turn, {
                timestamp: record.timestamp,
                query,
                actionType: "command",
              });
              addUnique(turn.queryArtifacts, query, MAX_QUERY_ARTIFACTS);
            }
            addUnique(session.queryArtifacts, query, MAX_QUERY_ARTIFACTS);
            noteSearchBucket(session, "queries", query);
          }
        }
        if (!record.command && Array.isArray(record.commandPaths) && record.commandPaths.length) {
          // Command-less tool calls (dynamic Read/Edit, view_image) still carry
          // path evidence worth indexing as artifacts.
          const pathCwd = record.cwd || (turn && turn.cwd) || session.cwd;
          for (const rawPath of record.commandPaths.slice(0, 20)) {
            const referencedPath = normalizeReferencedPath(pathCwd, rawPath);
            if (!referencedPath) continue;
            noteSessionPath(session, "", referencedPath, []);
            noteSearchBucket(session, "paths", referencedPath);
            if (turn) {
              noteTurnPath(turn, "", referencedPath, []);
              addUnique(turn.pathArtifacts, referencedPath, MAX_PATH_ARTIFACTS);
            }
          }
        }
        if (record.patch && Array.isArray(record.patch.files)) {
          for (const file of record.patch.files) {
            if (!file || typeof file !== "object") continue;
            const fileCwd = record.cwd || (turn && turn.cwd) || session.cwd;
            const resolvedFilePath = turn
              ? noteTurnFile(turn, fileCwd, file.path)
              : normalizeTouchedFilePath(fileCwd, file.path);
            if (turn) {
              noteTurnPath(turn, "", resolvedFilePath, "write");
              addUnique(turn.pathArtifacts, resolvedFilePath, MAX_PATH_ARTIFACTS);
            }
            noteSessionFile(session, fileCwd, resolvedFilePath);
            noteSessionPath(session, "", resolvedFilePath, "write");
            noteSearchBucket(session, "files", resolvedFilePath);
            noteSearchBucket(session, "paths", resolvedFilePath);
          }
        }
        break;
      case "tool_output":
        if (record.command) {
          const command = summarizeText(record.command, 240);
          const commandTypes = Array.isArray(record.commandTypes) ? record.commandTypes.slice(0, 10) : [];
          const commandTypeHints = Array.isArray(record.commandTypeHints) ? record.commandTypeHints.slice(0, 10) : [];
          const commandPathRoles = getCommandPathRoles(commandTypes);
          const commandPaths = Array.isArray(record.commandPaths)
            ? record.commandPaths
              .map((value) => normalizeReferencedPath(record.cwd || (turn && turn.cwd) || session.cwd, value))
              .filter(Boolean)
              .slice(0, 20)
            : [];
          const commandPathPatterns = Array.isArray(record.commandPathPatterns)
            ? record.commandPathPatterns
              .map((value) => normalizeReferencedPathPattern(record.cwd || (turn && turn.cwd) || session.cwd, value))
              .filter(Boolean)
              .slice(0, 20)
            : [];
          const commandQueries = Array.isArray(record.commandQueries)
            ? record.commandQueries
              .map((value) => summarizeText(value, 240))
              .filter(Boolean)
              .slice(0, 20)
            : [];
          const shellCommands = Array.isArray(record.shellCommands) ? record.shellCommands.slice(0, 10) : [];
          pushBounded(session.recentCommands, {
            timestamp: record.timestamp,
            command,
            toolName: record.toolName || null,
            exitCode: record.output ? record.output.exitCode : null,
            commandSource: record.commandSource || null,
            commandTypes,
            commandTypeHints,
            pathRoles: commandPathRoles,
            commandPaths,
            commandPathPatterns,
            commandQueries,
            shellCommands,
          }, MAX_RECENT_COMMANDS);
          if (turn) {
            pushBounded(turn.commands, {
              timestamp: record.timestamp,
              command,
              toolName: record.toolName || null,
              exitCode: record.output ? record.output.exitCode : null,
              commandSource: record.commandSource || null,
              commandTypes,
              commandTypeHints,
              pathRoles: commandPathRoles,
              commandPaths,
              commandPathPatterns,
              commandQueries,
              shellCommands,
            }, MAX_TURN_ITEMS);
            addUnique(turn.commandArtifacts, command, MAX_COMMAND_ARTIFACTS);
          }
          noteSearchBucket(session, "commands", command);
          addUnique(session.commandArtifacts, command, MAX_COMMAND_ARTIFACTS);
          for (const type of commandTypes) {
            addUnique(session.commandTypes, type);
            if (turn) noteTurnCommandType(turn, type);
            noteSearchBucket(session, "command_types", type);
          }
          for (const typeHint of commandTypeHints) {
            noteSearchBucket(session, "command_type_hints", typeHint);
          }
          for (const shellCommand of shellCommands) {
            addUnique(session.commandOpArtifacts, shellCommand, MAX_COMMAND_ARTIFACTS);
            if (turn) addUnique(turn.commandOpArtifacts, shellCommand, MAX_COMMAND_ARTIFACTS);
            noteSearchBucket(session, "command_ops", shellCommand);
          }
          for (const referencedPath of commandPaths) {
            noteSessionPath(session, "", referencedPath, commandPathRoles);
            noteSearchBucket(session, "paths", referencedPath);
            if (turn) {
              noteTurnPath(turn, "", referencedPath, commandPathRoles);
              addUnique(turn.pathArtifacts, referencedPath, MAX_PATH_ARTIFACTS);
            }
          }
          for (const referencedPattern of commandPathPatterns) {
            noteSessionPathPattern(session, "", referencedPattern, commandPathRoles);
            noteSearchBucket(session, "path_patterns", referencedPattern);
            if (turn) {
              noteTurnPathPattern(turn, "", referencedPattern, commandPathRoles);
            }
          }
          for (const query of commandQueries) {
            pushBounded(session.recentQueries, {
              timestamp: record.timestamp,
              query,
              actionType: "command",
            }, MAX_RECENT_QUERIES);
            if (turn) {
              noteTurnQuery(turn, {
                timestamp: record.timestamp,
                query,
                actionType: "command",
              });
              addUnique(turn.queryArtifacts, query, MAX_QUERY_ARTIFACTS);
            }
            addUnique(session.queryArtifacts, query, MAX_QUERY_ARTIFACTS);
            noteSearchBucket(session, "queries", query);
          }
        }
        break;
      case "patch":
        session.patchCount += 1;
        if (record.patch && Array.isArray(record.patch.files)) {
          for (const file of record.patch.files) {
            if (!file || typeof file !== "object") continue;
            const fileCwd = record.cwd || (turn && turn.cwd) || session.cwd;
            const resolvedFilePath = turn
              ? noteTurnFile(turn, fileCwd, file.path)
              : normalizeTouchedFilePath(fileCwd, file.path);
            if (turn) {
              noteTurnPath(turn, "", resolvedFilePath, "write");
              addUnique(turn.pathArtifacts, resolvedFilePath, MAX_PATH_ARTIFACTS);
            }
            noteSessionFile(session, fileCwd, resolvedFilePath);
            noteSessionPath(session, "", resolvedFilePath, "write");
            noteSearchBucket(session, "files", resolvedFilePath);
            noteSearchBucket(session, "paths", resolvedFilePath);
          }
        }
        break;
      case "web_search":
        session.searchCount += 1;
        addUnique(session.toolsUsed, "web_search");
        if (turn) noteTurnTool(turn, "web_search");
        if (record.query) {
          const query = summarizeText(record.query, 240);
          pushBounded(session.recentQueries, {
            timestamp: record.timestamp,
            query,
            actionType: record.actionType || null,
          }, MAX_RECENT_QUERIES);
          if (turn) {
            noteTurnQuery(turn, {
              timestamp: record.timestamp,
              query,
              actionType: record.actionType || null,
            });
            addUnique(turn.queryArtifacts, query, MAX_QUERY_ARTIFACTS);
          }
          noteSearchBucket(session, "queries", query);
          addUnique(session.queryArtifacts, query, MAX_QUERY_ARTIFACTS);
        }
        if (Array.isArray(record.queries)) {
          for (const query of record.queries) {
            if (turn) {
              noteTurnQuery(turn, {
                timestamp: record.timestamp,
                query,
                actionType: record.actionType || null,
              });
              addUnique(turn.queryArtifacts, summarizeText(query, 240), MAX_QUERY_ARTIFACTS);
            }
            noteSearchBucket(session, "queries", query);
            addUnique(session.queryArtifacts, summarizeText(query, 240), MAX_QUERY_ARTIFACTS);
          }
        }
        break;
      case "mcp":
        session.mcpCount += 1;
        if (record.mcp && record.mcp.tool) {
          const toolName = `mcp:${record.mcp.tool}`;
          addUnique(session.toolsUsed, toolName);
          if (turn) noteTurnTool(turn, toolName);
          noteSearchBucket(session, "tools", toolName);
        }
        noteSearchBucket(session, "text", record.mcp && record.mcp.resultPreview ? record.mcp.resultPreview : record.preview);
        break;
      case "error": {
        session.errorCount += 1;
        const entry = {
          timestamp: record.timestamp,
          message: summarizeText(record.error && record.error.message, 240),
          detail: buildNormalizedErrorDetail(record.error, 4000),
          statusCode: record.error ? record.error.statusCode : null,
          code: record.error ? record.error.code : null,
          requestId: record.error ? record.error.requestId || null : null,
          url: record.error ? record.error.url || null : null,
          cfRay: record.error ? record.error.cfRay || null : null,
        };
        pushBounded(session.recentErrors, entry, MAX_RECENT_ERRORS);
        if (turn) {
          pushBounded(turn.errors, entry, MAX_TURN_ITEMS);
          addUnique(turn.errorArtifacts, entry.message, MAX_ERROR_ARTIFACTS);
        }
        for (const value of buildNormalizedErrorSearchValues(entry)) {
          noteSearchBucket(session, "errors", value);
        }
        addUnique(session.errorArtifacts, entry.message, MAX_ERROR_ARTIFACTS);
        break;
      }
      case "history_mutation":
        noteSearchBucket(session, "history", record.preview);
        break;
      default:
        break;
    }
  }

  function buildSessionDocumentFromFile(filePath, options = {}) {
    const historyMode = normalizeHistoryMode(options.historyMode);
    const session = createSessionDocument(filePath, historyMode);
    session._rolloutPersistenceKnown = true;
    const normalized = readNormalizedSessionEvents(filePath);
    session.sessionId = normalized.sessionId || session.sessionId;
    session.forkedFromId = normalized.forkedFromId || session.forkedFromId;
    session.parentThreadId = normalized.parentThreadId || session.parentThreadId;
    session.subagentDepth = Number.isInteger(normalized.subagentDepth) ? normalized.subagentDepth : session.subagentDepth;
    if (Array.isArray(normalized.replayedSessionIds)) {
      for (const replayedSessionId of normalized.replayedSessionIds) {
        if (replayedSessionId && replayedSessionId !== session.sessionId) {
          session._replayedSessionIds.add(replayedSessionId);
        }
      }
    }
    for (const item of selectNormalizedEvents(normalized, historyMode)) {
      observeRecordInCatalog(session, item.record, item.resolvedTurnId);
    }
    finalizeSession(session);
    return session.eventCount > 0 ? session : null;
  }

  return {
    loadRolloutObjects,
    readNormalizedSessionEvents,
    selectNormalizedEvents,
    buildSessionDocumentFromFile,
  };
}

module.exports = { createCatalogRolloutBuild };
