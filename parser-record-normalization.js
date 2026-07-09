"use strict";

const { categorizeRecord } = require("./analytics");
const { normalizeSessionSource } = require("./history-session-source");
const {
  inferCommandHints,
  inferShellCommandStructure,
  looksLikeGlobPath,
} = require("./parser-shell-hints");

function createParserRecordNormalization({
  safeJsonParse,
  summarizeText,
  captureText,
  extractTextFromContent,
  extractReasoningSummary,
  parseToolArguments,
  parseDurationMs,
}) {
  function pickString(obj, ...keys) {
    if (!obj || typeof obj !== "object") return null;
    for (const key of keys) {
      if (typeof obj[key] === "string" && obj[key]) return obj[key];
    }
    return null;
  }

  function pushUniqueString(list, value, limit = 20) {
    if (!Array.isArray(list)) return;
    if (typeof value !== "string") return;
    const text = value.trim();
    if (!text || list.includes(text) || list.length >= limit) return;
    list.push(text);
  }

  function basenamePathHint(value) {
    if (typeof value !== "string") return "";
    const text = value.trim();
    if (!text) return "";
    const parts = text.split(/[\\/]/);
    return parts[parts.length - 1] || "";
  }

  function pathHintHasSeparator(value) {
    return typeof value === "string" && /[\\/]/.test(value);
  }

  function resolveMoreSpecificParsedPath(existingPath, inferredPaths) {
    const current = typeof existingPath === "string" ? existingPath.trim() : "";
    const candidates = Array.isArray(inferredPaths)
      ? inferredPaths.filter((value) => typeof value === "string" && value.trim())
      : [];
    if (!candidates.length) return current;
    if (!current) return candidates.length === 1 ? candidates[0].trim() : "";

    const normalizedCurrent = current.replace(/\\/g, "/");
    const currentBase = basenamePathHint(current);
    if (!currentBase) return current;

    const scored = [];
    for (const rawCandidate of candidates) {
      const candidate = rawCandidate.trim();
      if (!candidate || candidate === current) return current;
      const candidateBase = basenamePathHint(candidate);
      if (!candidateBase || candidateBase !== currentBase) continue;

      const normalizedCandidate = candidate.replace(/\\/g, "/");
      let score = 0;
      if (normalizedCandidate.endsWith(`/${normalizedCurrent}`) && normalizedCandidate.length > normalizedCurrent.length) {
        score = 4;
      } else if (normalizedCandidate.startsWith(`${normalizedCurrent}/`) && normalizedCandidate.length > normalizedCurrent.length) {
        score = 3;
      } else if (!pathHintHasSeparator(current) && pathHintHasSeparator(candidate)) {
        score = 2;
      } else if (candidate.length > current.length) {
        score = 1;
      }

      if (score > 0) scored.push({ candidate, score, length: candidate.length });
    }

    if (!scored.length) return current;
    scored.sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return right.length - left.length;
    });
    if (scored.length > 1 && scored[0].score === scored[1].score && scored[0].length === scored[1].length) {
      return current;
    }
    return scored[0].candidate;
  }

  function normalizeParsedCommandParts(parsedCommand) {
    if (!Array.isArray(parsedCommand)) {
      return {
        items: [],
        types: [],
        paths: [],
        patterns: [],
        names: [],
        queries: [],
      };
    }

    const items = [];
    const types = [];
    const paths = [];
    const patterns = [];
    const names = [];
    const queries = [];

    for (const part of parsedCommand) {
      if (!part || typeof part !== "object") continue;
      const inferred = typeof part.cmd === "string" && part.cmd
        ? inferCommandHints(part.cmd)
        : { paths: [], patterns: [] };
      const rawPartPath = typeof part.path === "string" ? part.path : "";
      const itemPath = looksLikeGlobPath(rawPartPath)
        ? null
        : (resolveMoreSpecificParsedPath(rawPartPath, inferred.paths) || rawPartPath || null);
      const itemPathPattern = looksLikeGlobPath(rawPartPath)
        ? (resolveMoreSpecificParsedPath(rawPartPath, inferred.patterns) || rawPartPath || null)
        : null;

      const item = {
        type: typeof part.type === "string" ? part.type : null,
        cmd: typeof part.cmd === "string" ? part.cmd : "",
        name: typeof part.name === "string" ? part.name : null,
        path: itemPath,
        pathPattern: itemPathPattern,
        query: typeof part.query === "string" ? part.query : null,
      };

      if (!item.type && !item.cmd && !item.name && !item.path && !item.pathPattern && !item.query) continue;
      items.push(item);
      pushUniqueString(types, item.type);
      pushUniqueString(paths, item.path);
      pushUniqueString(patterns, item.pathPattern);
      for (const inferredPattern of inferred.patterns) pushUniqueString(patterns, inferredPattern);
      pushUniqueString(names, item.name);
      pushUniqueString(queries, item.query);
    }

    return {
      items,
      types,
      paths,
      patterns,
      names,
      queries,
    };
  }

  function extractCommandText(command, parsedCommand) {
    if (Array.isArray(parsedCommand)) {
      for (const part of parsedCommand) {
        if (part && typeof part === "object" && typeof part.cmd === "string" && part.cmd) {
          return part.cmd;
        }
      }
    }

    if (Array.isArray(command)) {
      const shellArgs = command.filter((part) => typeof part === "string");
      if (shellArgs.length >= 3 && /^-l?c$/.test(shellArgs[1])) return shellArgs[2];
      if (shellArgs.length) return shellArgs.join(" ");
    }

    if (typeof command === "string") return command;
    return "";
  }

  function mergeUniqueStrings(primary, secondary, limit = 20) {
    const merged = [];
    for (const value of Array.isArray(primary) ? primary : []) pushUniqueString(merged, value, limit);
    for (const value of Array.isArray(secondary) ? secondary : []) pushUniqueString(merged, value, limit);
    return merged;
  }

  function parsePatchInput(input) {
    if (typeof input !== "string" || !input) return null;
    const files = [];
    let current = null;
    const lines = input.split("\n");
    for (const line of lines) {
      let match = /^\*\*\* (Add|Update|Delete) File: (.+)$/.exec(line);
      if (match) {
        current = {
          path: match[2],
          type: match[1].toLowerCase(),
          movePath: null,
        };
        files.push(current);
        continue;
      }
      match = /^\*\*\* Move to: (.+)$/.exec(line);
      if (match && current) current.movePath = match[1];
    }
    if (!files.length) return null;
    const types = {};
    for (const file of files) {
      types[file.type] = (types[file.type] || 0) + 1;
    }
    return {
      fileCount: files.length,
      types,
      files: files.slice(0, 20),
      truncated: files.length > 20,
    };
  }

  function summarizePatchChanges(changes) {
    if (!changes || typeof changes !== "object") return null;
    const files = Object.entries(changes).map(([filePath, change]) => ({
      path: filePath,
      type: change && typeof change.type === "string" ? change.type : "update",
      movePath: change && typeof change.move_path === "string" ? change.move_path : null,
    }));
    if (!files.length) return null;
    const types = {};
    for (const file of files) {
      types[file.type] = (types[file.type] || 0) + 1;
    }
    return {
      fileCount: files.length,
      types,
      files: files.slice(0, 20),
      truncated: files.length > 20,
    };
  }

  function parseWrappedCommandOutput(output) {
    if (typeof output !== "string" || !output) {
      return {
        preview: "",
        text: "",
        exitCode: null,
        durationSeconds: null,
        tokenCount: null,
        chunkId: null,
      };
    }

    const wrapper = safeJsonParse(output);
    if (wrapper && typeof wrapper === "object" && ("output" in wrapper || "metadata" in wrapper)) {
      const text = captureText(wrapper.output || "");
      const metadata = wrapper.metadata && typeof wrapper.metadata === "object"
        ? wrapper.metadata
        : {};
      return {
        preview: summarizeText(text),
        text,
        exitCode: Number.isInteger(metadata.exit_code) ? metadata.exit_code : null,
        durationSeconds: Number.isFinite(metadata.duration_seconds) ? metadata.duration_seconds : null,
        tokenCount: Number.isInteger(metadata.token_count) ? metadata.token_count : null,
        chunkId: typeof metadata.chunk_id === "string" ? metadata.chunk_id : null,
      };
    }

    const chunkId = /Chunk ID:\s*([^\n]+)/.exec(output);
    const wallTime = /Wall time:\s*([0-9.]+)\s*seconds?/.exec(output);
    const exitCode = /Process exited with code\s+(-?\d+)/.exec(output);
    const tokenCount = /Original token count:\s*(\d+)/.exec(output);
    const outputMarker = output.indexOf("\nOutput:\n");
    const text = outputMarker === -1 ? captureText(output) : captureText(output.slice(outputMarker + 9));

    return {
      preview: summarizeText(text || output),
      text,
      exitCode: exitCode ? Number(exitCode[1]) : null,
      durationSeconds: wallTime ? Number(wallTime[1]) : null,
      tokenCount: tokenCount ? Number(tokenCount[1]) : null,
      chunkId: chunkId ? chunkId[1].trim() : null,
    };
  }

  function extractResultText(result) {
    if (!result || typeof result !== "object") return "";
    if (typeof result.text === "string") return result.text;
    if (Array.isArray(result.content)) return extractTextFromContent(result.content);
    if (result.Ok && typeof result.Ok === "object") return extractResultText(result.Ok);
    if (result.Err && typeof result.Err === "object") return extractResultText(result.Err);
    return "";
  }

  function parseErrorMetadata(message) {
    if (typeof message !== "string" || !message) {
      return {
        statusCode: null,
        requestId: null,
        url: null,
        cfRay: null,
      };
    }

    const statusCode = /status\s+(\d{3})\b/i.exec(message);
    const requestId = /request id:\s*([^\s,]+)/i.exec(message);
    const url = /url:\s*([^,\s]+)/i.exec(message);
    const cfRay = /cf-ray:\s*([^\s,]+)/i.exec(message);

    return {
      statusCode: statusCode ? Number(statusCode[1]) : null,
      requestId: requestId ? requestId[1] : null,
      url: url ? url[1] : null,
      cfRay: cfRay ? cfRay[1] : null,
    };
  }

  function normalizeGitInfo(payload) {
    const git = payload && payload.git && typeof payload.git === "object" ? payload.git : null;
    if (!git) return null;

    const branch = typeof git.branch === "string" ? git.branch : null;
    const sha = typeof git.commit_hash === "string"
      ? git.commit_hash
      : (typeof git.sha === "string" ? git.sha : null);
    const originUrl = typeof git.repository_url === "string"
      ? git.repository_url
      : (typeof git.origin_url === "string" ? git.origin_url : null);

    if (!branch && !sha && !originUrl) return null;
    return { branch, sha, originUrl };
  }

  function normalizeSessionMeta(payload) {
    if (!payload || typeof payload !== "object") return null;
    const sourceInfo = normalizeSessionSource(payload.source);
    const sourceSubagent = payload.source && typeof payload.source === "object"
      ? (payload.source.subagent || payload.source.subAgent)
      : null;
    const rawThreadSpawn = sourceSubagent && typeof sourceSubagent === "object"
      ? (sourceSubagent.thread_spawn || sourceSubagent.threadSpawn)
      : null;
    const subagent = rawThreadSpawn && typeof rawThreadSpawn === "object" ? rawThreadSpawn : null;
    const dynamicToolNames = Array.isArray(payload.dynamic_tools)
      ? payload.dynamic_tools
        .map((tool) => (tool && typeof tool.name === "string" ? tool.name.trim() : ""))
        .filter(Boolean)
      : [];
    const baseInstructionsText = payload.base_instructions && typeof payload.base_instructions.text === "string"
      ? payload.base_instructions.text
      : (typeof payload.instructions === "string" ? payload.instructions : "");
    return {
      id: typeof payload.id === "string" ? payload.id : null,
      forkedFromId: typeof payload.forked_from_id === "string" ? payload.forked_from_id : null,
      cwd: typeof payload.cwd === "string" ? payload.cwd : "",
      originator: typeof payload.originator === "string" ? payload.originator : null,
      cliVersion: typeof payload.cli_version === "string" ? payload.cli_version : null,
      modelProvider: typeof payload.model_provider === "string" ? payload.model_provider : null,
      source: sourceInfo.source,
      sourceKind: sourceInfo.sourceKind,
      sourceDetail: sourceInfo.sourceDetail,
      agentNickname: typeof payload.agent_nickname === "string" ? payload.agent_nickname : null,
      agentRole: typeof payload.agent_role === "string" ? payload.agent_role : null,
      agentPath: typeof payload.agent_path === "string" ? payload.agent_path : null,
      memoryMode: typeof payload.memory_mode === "string" ? payload.memory_mode : null,
      git: normalizeGitInfo(payload),
      subagent: subagent ? {
        parentThreadId: pickString(subagent, "parent_thread_id", "parentThreadId"),
        depth: Number.isInteger(subagent.depth) ? subagent.depth : null,
        agentPath: pickString(subagent, "agent_path", "agentPath"),
        agentNickname: pickString(subagent, "agent_nickname", "agentNickname"),
        agentRole: pickString(subagent, "agent_role", "agentRole"),
      } : null,
      baseInstructionsPreview: baseInstructionsText
        ? summarizeText(baseInstructionsText, 300)
        : "",
      dynamicToolNames,
      dynamicToolCount: dynamicToolNames.length,
    };
  }

  function normalizeTurnContext(payload) {
    if (!payload || typeof payload !== "object") return null;
    const sandboxPolicy = payload.sandbox_policy && typeof payload.sandbox_policy === "object"
      ? payload.sandbox_policy
      : null;
    return {
      turnId: typeof payload.turn_id === "string" ? payload.turn_id : null,
      cwd: typeof payload.cwd === "string" ? payload.cwd : "",
      currentDate: typeof payload.current_date === "string" ? payload.current_date : null,
      timezone: typeof payload.timezone === "string" ? payload.timezone : null,
      approvalPolicy: typeof payload.approval_policy === "string" ? payload.approval_policy : null,
      sandboxMode: sandboxPolicy && typeof sandboxPolicy.type === "string"
        ? sandboxPolicy.type
        : (sandboxPolicy && typeof sandboxPolicy.mode === "string" ? sandboxPolicy.mode : null),
      networkAccess: sandboxPolicy ? sandboxPolicy.network_access === true : null,
      model: typeof payload.model === "string" ? payload.model : null,
      personality: typeof payload.personality === "string" ? payload.personality : null,
      collaborationMode: payload.collaboration_mode && payload.collaboration_mode.mode
        ? payload.collaboration_mode.mode
        : null,
      reasoningEffort: typeof payload.effort === "string" ? payload.effort : null,
      summaryMode: typeof payload.summary === "string" ? payload.summary : null,
      realtimeActive: payload.realtime_active === true,
      userInstructionsPreview: typeof payload.user_instructions === "string"
        ? summarizeText(payload.user_instructions, 300)
        : "",
    };
  }

  function deriveStateSignal(key, logEventMap = {}) {
    if (Object.prototype.hasOwnProperty.call(logEventMap, key)) return logEventMap[key];
    if (key === "event_msg:error") return "error";
    if (key === "compacted") return "sweeping";
    return undefined;
  }

  const BARE_RESPONSE_ITEM_TYPES = new Set([
    "reasoning",
    "function_call",
    "function_call_output",
    "custom_tool_call",
    "custom_tool_call_output",
    "web_search_call",
    "local_shell_call",
    "local_shell_call_output",
    "tool_search_call",
    "tool_search_output",
  ]);

  function normalizeRecordObject(obj, options = {}) {
    // Mid-generation rollouts (2025 bare JSONL) persist response items at the
    // top level without a payload envelope; route them through the modern
    // response_item path so their evidence is not dropped.
    if (
      obj && typeof obj === "object" &&
      typeof obj.type === "string" &&
      BARE_RESPONSE_ITEM_TYPES.has(obj.type) &&
      (!obj.payload || typeof obj.payload !== "object")
    ) {
      return normalizeRecordObject(
        { timestamp: typeof obj.timestamp === "string" ? obj.timestamp : null, type: "response_item", payload: obj },
        options
      );
    }

    const payload = obj && obj.payload && typeof obj.payload === "object" ? obj.payload : null;
    const rawType = obj && typeof obj.type === "string" ? obj.type : "<root>";
    const subtype = payload && typeof payload.type === "string" ? payload.type : null;
    const key = subtype ? `${rawType}:${subtype}` : rawType;
    const record = {
      timestamp: obj && typeof obj.timestamp === "string" ? obj.timestamp : null,
      rawType,
      subtype,
      key,
      kind: "unknown",
      stateSignal: deriveStateSignal(key, options.logEventMap),
      preview: "",
      turnId: null,
      callId: null,
      cwd: options.defaultCwd || "",
    };

    if (rawType === "<root>") {
      if (obj && typeof obj === "object" && typeof obj.record_type === "string") {
        record.kind = "state_marker";
        record.preview = `state marker (${obj.record_type})`;
        return record;
      }
      // Mid-generation bare JSONL headers carry id/git/instructions at the
      // top level; treat them as session_meta so git metadata is preserved.
      if (
        obj && typeof obj === "object" &&
        typeof obj.id === "string" &&
        (obj.git !== undefined || obj.instructions !== undefined)
      ) {
        record.kind = "session_meta";
        record.sessionMeta = normalizeSessionMeta(obj);
        if (record.sessionMeta && record.sessionMeta.cwd) record.cwd = record.sessionMeta.cwd;
        record.preview = `session ${obj.id}`;
        return record;
      }
      record.kind = "session_header";
      record.sessionHeader = {
        id: obj && typeof obj.id === "string" ? obj.id : null,
      };
      record.preview = record.sessionHeader.id ? `session ${record.sessionHeader.id}` : "session header";
      return record;
    }

    if (rawType === "message") {
      record.kind = "message";
      record.role = typeof obj.role === "string" ? obj.role : null;
      record.phase = typeof obj.phase === "string" ? obj.phase : null;
      record.text = extractTextFromContent(obj.content);
      record.preview = summarizeText(record.text || `${record.role || "message"} message`);
      return record;
    }

    if (key === "session_meta") {
      record.kind = "session_meta";
      record.sessionMeta = normalizeSessionMeta(payload);
      if (record.sessionMeta && record.sessionMeta.cwd) record.cwd = record.sessionMeta.cwd;
      record.preview = record.sessionMeta && record.sessionMeta.cwd
        ? `session ${record.sessionMeta.cwd}`
        : "session meta";
      return record;
    }

    if (key === "turn_context") {
      record.kind = "turn_context";
      record.turnContext = normalizeTurnContext(payload);
      if (record.turnContext) {
        record.turnId = record.turnContext.turnId;
        if (record.turnContext.cwd) record.cwd = record.turnContext.cwd;
      }
      record.preview = record.turnContext && record.turnContext.model
        ? `${record.turnContext.model} turn context`
        : "turn context";
      return record;
    }

    if (key === "event_msg:task_started" || key === "event_msg:turn_started") {
      record.kind = "turn_lifecycle";
      record.lifecycle = "started";
      record.turnId = payload && typeof payload.turn_id === "string" ? payload.turn_id : null;
      record.preview = "task started";
      return record;
    }

    if (key === "event_msg:task_complete" || key === "event_msg:turn_complete") {
      record.kind = "turn_lifecycle";
      record.lifecycle = "completed";
      record.turnId = payload && typeof payload.turn_id === "string" ? payload.turn_id : null;
      record.text = payload && typeof payload.last_agent_message === "string"
        ? captureText(payload.last_agent_message)
        : "";
      record.preview = summarizeText(record.text || "task complete");
      return record;
    }

    if (key === "event_msg:turn_aborted") {
      record.kind = "turn_lifecycle";
      record.lifecycle = "aborted";
      record.turnId = payload && typeof payload.turn_id === "string" ? payload.turn_id : null;
      record.reason = payload && typeof payload.reason === "string" ? payload.reason : null;
      record.preview = record.reason ? `turn aborted: ${record.reason}` : "turn aborted";
      return record;
    }

    if (key === "event_msg:thread_rolled_back") {
      const numTurns = payload && Number.isInteger(payload.num_turns) ? payload.num_turns : null;
      record.kind = "history_mutation";
      record.mutation = {
        type: "thread_rollback",
        numTurns,
      };
      record.preview = numTurns != null
        ? `thread rolled back ${numTurns} turn${numTurns === 1 ? "" : "s"}`
        : "thread rolled back";
      return record;
    }

    if (key === "event_msg:context_compacted" || key === "compacted") {
      record.kind = "compaction";
      const replacementHistory = payload && Array.isArray(payload.replacement_history)
        ? payload.replacement_history
        : [];
      record.compaction = {
        replacementCount: replacementHistory.length,
        preview: payload && typeof payload.message === "string"
          ? summarizeText(payload.message)
          : "",
      };
      record.preview = record.compaction.preview || `context compacted (${replacementHistory.length} items)`;
      return record;
    }

    if (key === "event_msg:user_message") {
      record.kind = "message";
      record.role = "user";
      record.text = payload && typeof payload.message === "string" ? captureText(payload.message) : "";
      record.preview = summarizeText(record.text || "user message");
      return record;
    }

    if (key === "event_msg:agent_message") {
      record.kind = "message";
      record.role = "assistant";
      record.phase = payload && typeof payload.phase === "string" ? payload.phase : null;
      record.text = payload && typeof payload.message === "string" ? captureText(payload.message) : "";
      record.preview = summarizeText(record.text || "assistant message");
      return record;
    }

    if (key === "event_msg:agent_reasoning" || key === "response_item:reasoning") {
      record.kind = "reasoning";
      record.text = key === "event_msg:agent_reasoning"
        ? (payload && typeof payload.text === "string" ? captureText(payload.text) : "")
        : extractReasoningSummary(payload && payload.summary);
      record.preview = summarizeText(record.text || "reasoning");
      return record;
    }

    if (key === "response_item:message") {
      record.kind = "message";
      record.role = payload && typeof payload.role === "string" ? payload.role : null;
      record.phase = payload && typeof payload.phase === "string" ? payload.phase : null;
      record.text = extractTextFromContent(payload && payload.content);
      record.preview = summarizeText(record.text || `${record.role || "message"} item`);
      return record;
    }

    if (
      key === "response_item:web_search_call" ||
      key === "event_msg:web_search_end"
    ) {
      const action = payload && payload.action && typeof payload.action === "object"
        ? payload.action
        : null;
      const queries = action && Array.isArray(action.queries)
        ? action.queries.filter((item) => typeof item === "string" && item)
        : [];
      record.kind = "web_search";
      record.callId = payload && typeof payload.call_id === "string" ? payload.call_id : null;
      record.toolName = "web_search";
      record.toolClass = "search";
      record.toolStatus = payload && typeof payload.status === "string" ? payload.status : null;
      record.query = payload && typeof payload.query === "string" && payload.query
        ? payload.query
        : (action && typeof action.query === "string" ? action.query : "");
      record.queries = queries.slice(0, 10);
      record.actionType = action && typeof action.type === "string"
        ? action.type
        : null;
      record.preview = summarizeText(record.query || record.queries[0] || "web search");
      return record;
    }

    if (
      key === "response_item:function_call" ||
      key === "response_item:custom_tool_call"
    ) {
      record.kind = "tool_call";
      record.callId = payload && typeof payload.call_id === "string" ? payload.call_id : null;
      record.toolName = payload && typeof payload.name === "string" ? payload.name : null;
      record.toolStatus = payload && typeof payload.status === "string" ? payload.status : null;
      record.toolClass = key.startsWith("response_item:custom") ? "custom" : "function";
      if (key === "response_item:function_call") {
        record.toolArgs = parseToolArguments(payload.arguments);
        if (record.toolArgs && typeof record.toolArgs.cmd === "string") record.command = record.toolArgs.cmd;
        if (!record.command && record.toolArgs) {
          const extractedCommand = extractCommandText(record.toolArgs.command, null) ||
            extractCommandText(record.toolArgs.cmd, null);
          if (extractedCommand) record.command = extractedCommand;
        }
        if (record.toolArgs && typeof record.toolArgs.workdir === "string") record.cwd = record.toolArgs.workdir;
        if (record.command) {
          const inferredCommand = inferCommandHints(record.command);
          const shellStructure = inferShellCommandStructure(record.command);
          record.commandTypes = inferredCommand.types;
          record.commandPaths = inferredCommand.paths;
          record.commandPathPatterns = inferredCommand.patterns;
          record.commandQueries = inferredCommand.queries;
          record.shellCommands = shellStructure.shellCommands;
          record.commandTypeHints = shellStructure.commandTypeHints.filter(
            (value) => !record.commandTypes.includes(value)
          );
        }
      } else if (key === "response_item:custom_tool_call") {
        record.toolArgs = payload && typeof payload.input === "string"
          ? { inputPreview: summarizeText(payload.input, 300) }
          : null;
        if (record.toolName === "apply_patch") {
          record.patch = parsePatchInput(payload.input);
        }
      }
      record.preview = summarizeText(
        record.command ||
        (record.patch ? `apply_patch ${record.patch.fileCount} files` : "") ||
        `${record.toolName || "tool"} call`
      );
      return record;
    }

    if (
      key === "response_item:function_call_output" ||
      key === "response_item:custom_tool_call_output" ||
      key === "response_item:local_shell_call_output"
    ) {
      record.kind = "tool_output";
      record.callId = payload && typeof payload.call_id === "string" ? payload.call_id : null;
      record.output = parseWrappedCommandOutput(payload && payload.output);
      record.preview = record.output.preview || "tool output";
      return record;
    }

    if (key === "event_msg:patch_apply_end") {
      record.kind = "patch";
      record.callId = payload && typeof payload.call_id === "string" ? payload.call_id : null;
      record.turnId = payload && typeof payload.turn_id === "string" ? payload.turn_id : null;
      record.success = payload ? payload.success === true : null;
      record.patch = summarizePatchChanges(payload && payload.changes);
      record.stdoutPreview = summarizeText(payload && payload.stdout);
      record.stderrPreview = summarizeText(payload && payload.stderr);
      record.preview = record.patch
        ? `patch ${record.success ? "applied" : "failed"} (${record.patch.fileCount} files)`
        : `patch ${record.success ? "applied" : "failed"}`;
      return record;
    }

    if (key === "event_msg:token_count") {
      record.kind = "token_count";
      const info = payload && payload.info && typeof payload.info === "object" ? payload.info : {};
      record.tokenUsage = {
        total: info.total_token_usage || null,
        last: info.last_token_usage || null,
        modelContextWindow: Number.isInteger(info.model_context_window) ? info.model_context_window : null,
      };
      record.rateLimits = payload && payload.rate_limits && typeof payload.rate_limits === "object"
        ? payload.rate_limits
        : null;
      const totalTokens = record.tokenUsage.total && Number.isInteger(record.tokenUsage.total.total_tokens)
        ? record.tokenUsage.total.total_tokens
        : null;
      record.preview = totalTokens != null ? `token count ${totalTokens}` : "token count";
      return record;
    }

    if (key === "event_msg:mcp_tool_call_end") {
      record.kind = "mcp";
      record.callId = payload && typeof payload.call_id === "string" ? payload.call_id : null;
      record.mcp = {
        server: payload && payload.invocation && typeof payload.invocation.server === "string"
          ? payload.invocation.server
          : null,
        tool: payload && payload.invocation && typeof payload.invocation.tool === "string"
          ? payload.invocation.tool
          : null,
        arguments: payload && payload.invocation && payload.invocation.arguments && typeof payload.invocation.arguments === "object"
          ? payload.invocation.arguments
          : null,
        durationMs: parseDurationMs(payload && payload.duration),
        resultPreview: summarizeText(extractResultText(payload && payload.result), 300),
      };
      record.preview = `${record.mcp.server || "mcp"}:${record.mcp.tool || "tool"}`;
      return record;
    }

    if (key === "event_msg:error") {
      const message = payload && typeof payload.message === "string" ? payload.message : "";
      const meta = parseErrorMetadata(message);
      record.kind = "error";
      record.error = {
        message,
        code: payload && typeof payload.codex_error_info === "string" ? payload.codex_error_info : null,
        statusCode: meta.statusCode,
        requestId: meta.requestId,
        url: meta.url,
        cfRay: meta.cfRay,
      };
      record.preview = summarizeText(record.error.message || "error");
      return record;
    }

    if (key === "event_msg:exec_command_end") {
      const durationMs = parseDurationMs(payload && payload.duration);
      const parsedCommand = normalizeParsedCommandParts(payload && payload.parsed_cmd);
      const outputText = payload && typeof payload.formatted_output === "string" && payload.formatted_output
        ? payload.formatted_output
        : (payload && typeof payload.aggregated_output === "string" && payload.aggregated_output
          ? payload.aggregated_output
          : (payload && typeof payload.stdout === "string" && payload.stdout
            ? payload.stdout
            : (payload && typeof payload.stderr === "string" ? payload.stderr : "")));
      record.kind = "tool_output";
      record.callId = payload && typeof payload.call_id === "string" ? payload.call_id : null;
      record.turnId = payload && typeof payload.turn_id === "string" ? payload.turn_id : null;
      record.command = extractCommandText(payload && payload.command, payload && payload.parsed_cmd);
      const inferredCommand = inferCommandHints(record.command);
      const shellStructure = inferShellCommandStructure(record.command);
      record.commandSource = payload && typeof payload.source === "string" ? payload.source : null;
      record.commandParts = parsedCommand.items;
      record.commandTypes = mergeUniqueStrings(parsedCommand.types, inferredCommand.types);
      record.commandPaths = mergeUniqueStrings(parsedCommand.paths, inferredCommand.paths);
      record.commandPathPatterns = mergeUniqueStrings(parsedCommand.patterns, inferredCommand.patterns);
      record.commandNames = parsedCommand.names;
      record.commandQueries = mergeUniqueStrings(parsedCommand.queries, inferredCommand.queries);
      record.shellCommands = shellStructure.shellCommands;
      record.commandTypeHints = shellStructure.commandTypeHints.filter(
        (value) => !record.commandTypes.includes(value)
      );
      record.processId = payload && typeof payload.process_id === "string" ? payload.process_id : null;
      record.toolName = "exec_command";
      record.toolClass = "function";
      record.toolStatus = payload && typeof payload.status === "string" ? payload.status : null;
      if (payload && typeof payload.cwd === "string") record.cwd = payload.cwd;
      record.success = payload && typeof payload.success === "boolean"
        ? payload.success
        : (payload && Number.isInteger(payload.exit_code) ? payload.exit_code === 0 : null);
      record.output = {
        preview: summarizeText(outputText || record.command || "exec command end"),
        text: captureText(outputText),
        exitCode: payload && Number.isInteger(payload.exit_code) ? payload.exit_code : null,
        durationSeconds: durationMs != null ? durationMs / 1000 : null,
        tokenCount: null,
        chunkId: null,
      };
      record.stdoutPreview = summarizeText(payload && payload.stdout);
      record.stderrPreview = summarizeText(payload && payload.stderr);
      record.preview = record.output.preview || record.command || "exec command end";
      return record;
    }

    if (key === "event_msg:dynamic_tool_call_request") {
      record.kind = "tool_call";
      record.toolClass = "dynamic";
      record.toolName = payload ? pickString(payload, "tool") : null;
      record.callId = payload ? pickString(payload, "call_id", "callId") : null;
      record.turnId = payload ? pickString(payload, "turn_id", "turnId") : null;
      record.toolArgs = payload && payload.arguments && typeof payload.arguments === "object"
        ? payload.arguments
        : null;
      if (record.toolArgs) {
        if (typeof record.toolArgs.command === "string" && record.toolArgs.command) {
          record.command = record.toolArgs.command;
          const inferredCommand = inferCommandHints(record.command);
          const shellStructure = inferShellCommandStructure(record.command);
          record.commandTypes = inferredCommand.types;
          record.commandPaths = inferredCommand.paths;
          record.commandPathPatterns = inferredCommand.patterns;
          record.commandQueries = inferredCommand.queries;
          record.shellCommands = shellStructure.shellCommands;
          record.commandTypeHints = shellStructure.commandTypeHints.filter(
            (value) => !record.commandTypes.includes(value)
          );
        }
        const argPath = pickString(record.toolArgs, "file_path", "path", "notebook_path");
        if (argPath) record.commandPaths = mergeUniqueStrings(record.commandPaths, [argPath]);
        const argQuery = pickString(record.toolArgs, "query", "pattern");
        if (argQuery) record.commandQueries = mergeUniqueStrings(record.commandQueries, [argQuery]);
      }
      record.preview = summarizeText(
        record.command || `${record.toolName || "dynamic tool"} call`
      );
      return record;
    }

    if (key === "event_msg:dynamic_tool_call_response") {
      const durationMs = parseDurationMs(payload && payload.duration);
      const contentItems = payload && Array.isArray(payload.content_items) ? payload.content_items : [];
      const textParts = [];
      for (const item of contentItems) {
        if (item && typeof item === "object" && typeof item.text === "string" && item.text) {
          textParts.push(item.text);
        }
      }
      const text = captureText(textParts.join("\n\n"));
      record.kind = "tool_output";
      record.toolClass = "dynamic";
      record.toolName = payload ? pickString(payload, "tool") : null;
      record.callId = payload ? pickString(payload, "call_id", "callId") : null;
      record.turnId = payload ? pickString(payload, "turn_id", "turnId") : null;
      record.success = payload && typeof payload.success === "boolean" ? payload.success : null;
      record.output = {
        preview: summarizeText(text || `${record.toolName || "dynamic tool"} output`),
        text,
        exitCode: null,
        durationSeconds: durationMs != null ? durationMs / 1000 : null,
        tokenCount: null,
        chunkId: null,
      };
      if (payload && typeof payload.error === "string" && payload.error) {
        record.error = { message: payload.error, code: null, statusCode: null, requestId: null, url: null, cfRay: null };
      }
      record.preview = record.output.preview;
      return record;
    }

    if (rawType === "event_msg" && subtype && subtype.startsWith("collab_")) {
      const agentStatuses = payload && Array.isArray(payload.agent_statuses)
        ? payload.agent_statuses
          .filter((item) => item && typeof item === "object")
          .slice(0, 20)
          .map((item) => ({
            threadId: pickString(item, "thread_id", "threadId"),
            agentNickname: pickString(item, "agent_nickname", "agentNickname"),
            agentRole: pickString(item, "agent_role", "agentRole"),
            statusPreview: summarizeText(
              typeof item.status === "string" ? item.status : JSON.stringify(item.status || null),
              200
            ),
          }))
        : [];
      record.kind = "collab";
      record.callId = payload ? pickString(payload, "call_id", "callId") : null;
      record.collab = {
        action: subtype,
        senderThreadId: payload ? pickString(payload, "sender_thread_id", "senderThreadId") : null,
        receiverThreadId: payload
          ? pickString(payload, "receiver_thread_id", "receiverThreadId", "new_thread_id", "newThreadId")
          : null,
        spawnedThreadId: payload ? pickString(payload, "new_thread_id", "newThreadId") : null,
        agentNickname: payload
          ? pickString(payload, "new_agent_nickname", "receiver_agent_nickname", "agent_nickname")
          : null,
        agentRole: payload
          ? pickString(payload, "new_agent_role", "receiver_agent_role", "agent_role")
          : null,
        model: payload ? pickString(payload, "model") : null,
        promptPreview: payload && typeof payload.prompt === "string"
          ? summarizeText(payload.prompt, 300)
          : "",
        statusPreview: payload && payload.status !== undefined && typeof payload.status !== "object"
          ? summarizeText(String(payload.status), 200)
          : (payload && payload.status && typeof payload.status === "object"
            ? summarizeText(JSON.stringify(payload.status), 200)
            : ""),
        agentStatuses,
      };
      const actionLabel = subtype.replace(/^collab_/, "").replace(/_end$|_begin$/, "");
      record.preview = summarizeText(
        `collab ${actionLabel}${record.collab.agentNickname ? ` ${record.collab.agentNickname}` : ""}${record.collab.agentRole ? ` (${record.collab.agentRole})` : ""}` +
        (record.collab.promptPreview ? `: ${record.collab.promptPreview}` : "")
      );
      return record;
    }

    if (key === "event_msg:guardian_assessment") {
      const action = payload && payload.action && typeof payload.action === "object" ? payload.action : null;
      record.kind = "guardian";
      record.turnId = payload ? pickString(payload, "turn_id", "turnId") : null;
      record.guardian = {
        id: payload ? pickString(payload, "id") : null,
        targetItemId: payload ? pickString(payload, "target_item_id", "targetItemId") : null,
        status: payload ? pickString(payload, "status") : null,
        actionType: action ? pickString(action, "type") : null,
        actionSource: action ? pickString(action, "source") : null,
        command: action ? pickString(action, "command") : null,
        cwd: action ? pickString(action, "cwd") : null,
      };
      if (record.guardian.command) record.command = record.guardian.command;
      if (record.guardian.cwd) record.cwd = record.guardian.cwd;
      record.preview = summarizeText(
        `guardian ${record.guardian.status || "assessment"}${record.guardian.command ? `: ${record.guardian.command}` : ""}`
      );
      return record;
    }

    if (
      key === "event_msg:thread_name_updated" ||
      key === "event_msg:thread_goal_updated" ||
      key === "event_msg:thread_settings_applied"
    ) {
      record.kind = "thread_meta";
      record.threadMeta = {
        type: subtype,
        threadId: payload ? pickString(payload, "thread_id", "threadId") : null,
        threadName: payload ? pickString(payload, "thread_name", "threadName") : null,
        goalPreview: payload && payload.goal !== undefined
          ? summarizeText(typeof payload.goal === "string" ? payload.goal : JSON.stringify(payload.goal), 300)
          : "",
        model: payload && payload.thread_settings && typeof payload.thread_settings === "object"
          ? pickString(payload.thread_settings, "model")
          : null,
      };
      if (key === "event_msg:thread_name_updated") {
        record.preview = record.threadMeta.threadName
          ? `thread named "${record.threadMeta.threadName}"`
          : "thread name updated";
      } else if (key === "event_msg:thread_goal_updated") {
        record.preview = summarizeText(record.threadMeta.goalPreview || "thread goal updated");
      } else {
        record.preview = record.threadMeta.model
          ? `thread settings applied (${record.threadMeta.model})`
          : "thread settings applied";
      }
      return record;
    }

    if (key === "event_msg:view_image_tool_call") {
      record.kind = "tool_call";
      record.toolClass = "function";
      record.toolName = "view_image";
      record.callId = payload ? pickString(payload, "call_id", "callId") : null;
      const imagePath = payload ? pickString(payload, "path") : null;
      if (imagePath) record.commandPaths = [imagePath];
      record.preview = imagePath ? `view image ${imagePath}` : "view image";
      return record;
    }

    if (key === "event_msg:entered_review_mode" || key === "event_msg:exited_review_mode") {
      const target = payload && payload.target && typeof payload.target === "object" ? payload.target : null;
      record.kind = "review_mode";
      record.reviewMode = {
        entered: key === "event_msg:entered_review_mode",
        targetType: target ? pickString(target, "type") : null,
        branch: target ? pickString(target, "branch") : null,
        hint: payload ? pickString(payload, "user_facing_hint", "userFacingHint") : null,
      };
      record.preview = record.reviewMode.entered
        ? `entered review mode${record.reviewMode.hint ? `: ${record.reviewMode.hint}` : ""}`
        : "exited review mode";
      return record;
    }

    if (key === "event_msg:agent_reasoning_raw_content") {
      record.kind = "reasoning";
      record.text = payload && typeof payload.text === "string" ? captureText(payload.text) : "";
      record.preview = summarizeText(record.text || "reasoning");
      return record;
    }

    if (key === "response_item:tool_search_call" || key === "response_item:tool_search_output") {
      const isCall = key === "response_item:tool_search_call";
      record.kind = isCall ? "tool_call" : "tool_output";
      record.toolClass = "function";
      record.toolName = "tool_search";
      record.callId = payload ? pickString(payload, "call_id", "callId") : null;
      record.toolStatus = payload ? pickString(payload, "status") : null;
      const args = payload && payload.arguments && typeof payload.arguments === "object" ? payload.arguments : null;
      if (isCall) {
        record.toolArgs = args;
        record.query = args ? pickString(args, "query") : null;
        record.preview = summarizeText(record.query || "tool search");
      } else {
        record.output = parseWrappedCommandOutput(payload && typeof payload.output === "string" ? payload.output : "");
        record.preview = record.output.preview || "tool search output";
      }
      return record;
    }

    if (key === "response_item:local_shell_call") {
      const action = payload && payload.action && typeof payload.action === "object" ? payload.action : null;
      record.kind = "tool_call";
      record.toolClass = "function";
      record.toolName = "local_shell";
      record.callId = payload ? pickString(payload, "call_id", "callId") : null;
      record.toolStatus = payload ? pickString(payload, "status") : null;
      record.command = extractCommandText(action && action.command, null);
      if (record.command) {
        const inferredCommand = inferCommandHints(record.command);
        const shellStructure = inferShellCommandStructure(record.command);
        record.commandTypes = inferredCommand.types;
        record.commandPaths = inferredCommand.paths;
        record.commandPathPatterns = inferredCommand.patterns;
        record.commandQueries = inferredCommand.queries;
        record.shellCommands = shellStructure.shellCommands;
        record.commandTypeHints = shellStructure.commandTypeHints.filter(
          (value) => !record.commandTypes.includes(value)
        );
      }
      record.preview = summarizeText(record.command || "local shell call");
      return record;
    }

    if (rawType === "world_state") {
      const state = payload && payload.state && typeof payload.state === "object" ? payload.state : null;
      const environments = state && state.environments && typeof state.environments === "object" &&
        state.environments.environments && typeof state.environments.environments === "object"
        ? state.environments.environments
        : null;
      const environmentCwds = [];
      if (environments) {
        for (const env of Object.values(environments)) {
          if (env && typeof env === "object" && typeof env.cwd === "string" && env.cwd) {
            pushUniqueString(environmentCwds, env.cwd, 5);
          }
        }
      }
      record.kind = "world_state";
      record.worldState = {
        full: payload ? payload.full === true : null,
        environmentCwds,
        currentDate: state ? pickString(state, "current_date", "currentDate") : null,
        timezone: state ? pickString(state, "timezone") : null,
      };
      if (environmentCwds.length && !record.cwd) record.cwd = environmentCwds[0];
      record.preview = `world state${record.worldState.full ? " (full)" : " (patch)"}${environmentCwds.length ? ` ${environmentCwds[0]}` : ""}`;
      return record;
    }

    if (rawType === "inter_agent_communication") {
      record.kind = "message";
      record.role = "assistant";
      record.phase = "inter_agent";
      record.text = payload && typeof payload.content === "string" ? captureText(payload.content) : "";
      record.interAgent = {
        author: payload && payload.author !== undefined
          ? summarizeText(typeof payload.author === "string" ? payload.author : JSON.stringify(payload.author), 120)
          : null,
        recipient: payload && payload.recipient !== undefined
          ? summarizeText(typeof payload.recipient === "string" ? payload.recipient : JSON.stringify(payload.recipient), 120)
          : null,
      };
      record.preview = summarizeText(record.text || "inter-agent message");
      return record;
    }

    if (key === "event_msg:item_completed" || key === "event_msg:item_started") {
      const item = payload && payload.item && typeof payload.item === "object" ? payload.item : null;
      const itemType = item ? pickString(item, "type") : null;
      record.kind = "turn_item";
      record.turnId = payload ? pickString(payload, "turn_id", "turnId") : null;
      record.turnItem = {
        phase: key === "event_msg:item_completed" ? "completed" : "started",
        itemType,
        itemId: item ? pickString(item, "id") : null,
      };
      const text = item
        ? (typeof item.text === "string" ? item.text : extractTextFromContent(item.content))
        : "";
      record.text = captureText(text);
      record.preview = summarizeText(record.text || `turn item ${itemType || "unknown"}`);
      return record;
    }

    record.preview = summarizeText(
      (payload && (payload.message || payload.text)) ||
      key
    );
    return record;
  }

  function createSyntheticPermissionRecord(command, payload) {
    return {
      timestamp: new Date().toISOString(),
      rawType: "synthetic",
      subtype: "permission_request",
      key: "synthetic:permission_request",
      kind: "permission",
      stateSignal: "notification",
      preview: summarizeText(command || "approval required"),
      toolName: payload && typeof payload.name === "string" ? payload.name : null,
      command: typeof command === "string" ? command : "",
      permissionDetail: {
        command: typeof command === "string" ? command : "",
        rawPayload: payload || null,
      },
    };
  }

  function summarizeRecord(record) {
    return {
      timestamp: record.timestamp,
      key: record.key,
      kind: record.kind,
      lifecycle: record.lifecycle || null,
      preview: record.preview,
      turnId: record.turnId || null,
      callId: record.callId || null,
      role: record.role || null,
      phase: record.phase || null,
      toolName: record.toolName || null,
      toolClass: record.toolClass || null,
      toolStatus: record.toolStatus || null,
      command: record.command || null,
      commandSource: record.commandSource || null,
      commandTypes: Array.isArray(record.commandTypes) && record.commandTypes.length ? record.commandTypes.slice(0, 4) : null,
      commandTypeHints: Array.isArray(record.commandTypeHints) && record.commandTypeHints.length
        ? record.commandTypeHints.slice(0, 4)
        : null,
      commandPaths: Array.isArray(record.commandPaths) && record.commandPaths.length ? record.commandPaths.slice(0, 4) : null,
      commandPathPatterns: Array.isArray(record.commandPathPatterns) && record.commandPathPatterns.length ? record.commandPathPatterns.slice(0, 4) : null,
      commandQueries: Array.isArray(record.commandQueries) && record.commandQueries.length ? record.commandQueries.slice(0, 4) : null,
      shellCommands: Array.isArray(record.shellCommands) && record.shellCommands.length ? record.shellCommands.slice(0, 6) : null,
      query: record.query || null,
      queries: Array.isArray(record.queries) && record.queries.length ? record.queries.slice(0, 3) : null,
      actionType: record.actionType || null,
      success: Object.prototype.hasOwnProperty.call(record, "success") ? record.success : null,
      exitCode: record.output && Number.isInteger(record.output.exitCode) ? record.output.exitCode : null,
      errorCode: record.error ? record.error.code || null : null,
      statusCode: record.error && Number.isInteger(record.error.statusCode) ? record.error.statusCode : null,
      mutationType: record.mutation ? record.mutation.type || null : null,
      rollbackTurns: record.mutation && Number.isInteger(record.mutation.numTurns)
        ? record.mutation.numTurns
        : null,
      activityCategory: categorizeRecord(record),
      stateSignal: record.stateSignal,
    };
  }

  return {
    parsePatchInput,
    summarizePatchChanges,
    parseWrappedCommandOutput,
    parseErrorMetadata,
    normalizeSessionMeta,
    normalizeTurnContext,
    deriveStateSignal,
    normalizeRecordObject,
    createSyntheticPermissionRecord,
    summarizeRecord,
  };
}

module.exports = {
  createParserRecordNormalization,
};
