"use strict";

function createCatalogTimelineHelpers(deps = {}) {
  const {
    summarizeRecord,
    getRecordReferencedPaths,
    getRecordReferencedPathPatterns,
    summarizeText,
    clonePathRoleBuckets,
    sortCommandOpValues,
    mergeUniqueTextValues,
    createPathRoleBuckets,
    PATH_ROLE_ORDER,
    MAX_PATH_ARTIFACTS,
    toTimestampMs,
    normalizeCwdValue,
    normalizeReferencedPath,
    addUnique,
  } = deps;

  function normalizeErrorTextValue(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function summarizeStructuredValue(value, limit = 4000) {
    if (value == null) return "";
    if (typeof value === "string") return summarizeText(value, limit);
    try {
      return summarizeText(JSON.stringify(value), limit);
    } catch {
      return "";
    }
  }

  function buildNormalizedErrorSearchValues(error) {
    if (!error || typeof error !== "object") return [];

    const values = [];
    const message = normalizeErrorTextValue(error.message || error.text);
    const detail = normalizeErrorTextValue(error.detail);
    const code = normalizeErrorTextValue(error.code || error.errorCode);
    const requestId = normalizeErrorTextValue(error.requestId || error.errorRequestId);
    const url = normalizeErrorTextValue(error.url || error.errorUrl);
    const cfRay = normalizeErrorTextValue(error.cfRay || error.errorCfRay);
    const additionalDetails = normalizeErrorTextValue(error.additionalDetails || error.additional_details);
    const statusCode = Number.isInteger(error.statusCode) ? String(error.statusCode) : "";
    const codexErrorInfo = error.codexErrorInfo != null
      ? error.codexErrorInfo
      : (error.codex_error_info != null ? error.codex_error_info : null);
    const structured = summarizeStructuredValue(codexErrorInfo, 2000);

    for (const value of [
      message,
      detail,
      code,
      statusCode,
      requestId,
      url,
      cfRay,
      additionalDetails,
      structured,
    ]) {
      if (value) values.push(value);
    }

    return values;
  }

  function buildNormalizedErrorDetail(error, limit = 4000) {
    if (!error || typeof error !== "object") return "";

    const message = normalizeErrorTextValue(error.message || error.text);
    const code = normalizeErrorTextValue(error.code || error.errorCode);
    const requestId = normalizeErrorTextValue(error.requestId || error.errorRequestId);
    const url = normalizeErrorTextValue(error.url || error.errorUrl);
    const cfRay = normalizeErrorTextValue(error.cfRay || error.errorCfRay);
    const additionalDetails = normalizeErrorTextValue(error.additionalDetails || error.additional_details);
    const statusCode = Number.isInteger(error.statusCode) ? String(error.statusCode) : "";
    const codexErrorInfo = error.codexErrorInfo != null
      ? error.codexErrorInfo
      : (error.codex_error_info != null ? error.codex_error_info : null);
    const structured = summarizeStructuredValue(codexErrorInfo, 2000);
    const parts = [];

    if (message) parts.push(message);
    if (code) parts.push(`errorCode=${code}`);
    if (statusCode) parts.push(`statusCode=${statusCode}`);
    if (requestId) parts.push(`requestId=${requestId}`);
    if (url) parts.push(`url=${url}`);
    if (cfRay) parts.push(`cfRay=${cfRay}`);
    if (structured && structured !== message && structured !== code) parts.push(structured);
    if (additionalDetails && additionalDetails !== message) parts.push(additionalDetails);

    return summarizeText(parts.join("\n"), limit);
  }

  function errorEntryMatchesNeedle(entry, needle) {
    const normalizedNeedle = typeof needle === "string" ? needle.trim().toLowerCase() : "";
    if (!normalizedNeedle) return false;
    return buildNormalizedErrorSearchValues(entry).join("\n").toLowerCase().includes(normalizedNeedle);
  }

  function getRecordErrorSearchValues(record) {
    return record && typeof record === "object" && record.error
      ? buildNormalizedErrorSearchValues(record.error)
      : [];
  }

  function getTranscriptItemErrorSearchValues(item) {
    if (!item || typeof item !== "object") return [];
    const hasErrorMetadata = (
      item.type === "error" ||
      Boolean(item.errorCode) ||
      item.statusCode != null ||
      Boolean(item.errorRequestId) ||
      Boolean(item.errorUrl) ||
      Boolean(item.errorCfRay) ||
      item.codexErrorInfo != null ||
      Boolean(item.additionalDetails)
    );
    if (!hasErrorMetadata) return [];
    return buildNormalizedErrorSearchValues({
      message: item.type === "error" ? item.text : "",
      detail: item.type === "error" ? item.detail : "",
      errorCode: item.errorCode || "",
      statusCode: item.statusCode,
      errorRequestId: item.errorRequestId || null,
      errorUrl: item.errorUrl || null,
      errorCfRay: item.errorCfRay || null,
      codexErrorInfo: item.codexErrorInfo,
      additionalDetails: item.additionalDetails || null,
    });
  }

  function summarizeCatalogEvent(record, lineNumber, index, resolvedTurnId = null, resolvedCwd = null, includedInFinalHistory = true, extra = {}) {
    const summary = summarizeRecord(record);
    const referencedPaths = getRecordReferencedPaths(record, resolvedCwd || record.cwd);
    const referencedPathPatterns = getRecordReferencedPathPatterns(record, resolvedCwd || record.cwd);
    const commandPaths = referencedPaths.commandPaths.slice(0, 20);
    const commandPathPatterns = referencedPathPatterns.commandPathPatterns.slice(0, 20);
    const filesTouched = referencedPaths.patchPaths.slice(0, 20);
    const errorDetail = buildNormalizedErrorDetail(record.error, 800);

    return {
      index,
      lineNumber,
      timestamp: summary.timestamp,
      key: summary.key,
      kind: summary.kind,
      lifecycle: summary.lifecycle,
      turnId: resolvedTurnId || summary.turnId,
      callId: summary.callId,
      role: summary.role,
      phase: summary.phase,
      preview: summary.preview,
      detail: summarizeText(
        record.text ||
        errorDetail ||
        (record.output && (record.output.text || record.output.preview)) ||
        (record.mcp && record.mcp.resultPreview) ||
        record.preview,
        800
      ),
      toolName: summary.toolName,
      toolClass: summary.toolClass,
      toolStatus: summary.toolStatus,
      command: summary.command,
      commandSource: summary.commandSource,
      commandTypes: summary.commandTypes,
      commandTypeHints: summary.commandTypeHints,
      pathRoles: clonePathRoleBuckets(referencedPaths.pathRoles),
      pathPatternRoles: clonePathRoleBuckets(referencedPathPatterns.pathPatternRoles),
      commandPaths,
      commandPathPatterns,
      commandQueries: summary.commandQueries,
      shellCommands: summary.shellCommands,
      query: summary.query,
      queries: summary.queries,
      matchedFiles: Array.isArray(extra.matchedFiles) ? extra.matchedFiles : [],
      matchedPaths: Array.isArray(extra.matchedPaths) ? extra.matchedPaths : [],
      matchedPathPatterns: Array.isArray(extra.matchedPathPatterns) ? extra.matchedPathPatterns : [],
      matchedCommandOps: Array.isArray(extra.matchedCommandOps) ? extra.matchedCommandOps : [],
      matchedQueries: Array.isArray(extra.matchedQueries) ? extra.matchedQueries : [],
      actionType: summary.actionType,
      success: summary.success,
      exitCode: summary.exitCode,
      errorCode: summary.errorCode,
      statusCode: summary.statusCode,
      errorRequestId: record.error ? record.error.requestId || null : null,
      errorUrl: record.error ? record.error.url || null : null,
      errorCfRay: record.error ? record.error.cfRay || null : null,
      mutationType: summary.mutationType,
      rollbackTurns: summary.rollbackTurns,
      activityCategory: summary.activityCategory,
      stateSignal: summary.stateSignal,
      includedInFinalHistory: includedInFinalHistory !== false,
      cwd: resolvedCwd || record.cwd || null,
      fileCount: record.patch ? record.patch.fileCount || filesTouched.length : 0,
      filesTouched,
    };
  }

  function eventValueScore(event) {
    let score = 0;
    if (event.toolName) score += 4;
    if (event.command) score += 4;
    if (event.query) score += 3;
    if (event.queries && event.queries.length) score += 3;
    if (event.filesTouched && event.filesTouched.length) score += 2;
    if (event.exitCode != null) score += 1;
    if (event.statusCode != null) score += 1;
    if (event.detail) score += Math.min(2, Math.ceil(event.detail.length / 200));
    return score;
  }

  function sameOrMissing(a, b) {
    return !a || !b || a === b;
  }

  function sameArrayOrMissing(a, b) {
    const aList = Array.isArray(a) ? a.filter(Boolean) : [];
    const bList = Array.isArray(b) ? b.filter(Boolean) : [];
    if (!aList.length || !bList.length) return true;
    return aList.join("\n") === bList.join("\n");
  }

  function samePathRolesOrMissing(a, b) {
    const aRoles = a && typeof a === "object" ? a : null;
    const bRoles = b && typeof b === "object" ? b : null;
    if (!aRoles || !bRoles) return true;
    return PATH_ROLE_ORDER.every((role) => sameArrayOrMissing(aRoles[role], bRoles[role]));
  }

  function mergePathRoleBuckets(left, right, limit = MAX_PATH_ARTIFACTS) {
    const merged = createPathRoleBuckets();
    for (const role of PATH_ROLE_ORDER) {
      merged[role] = mergeUniqueTextValues(
        left && left[role],
        right && right[role],
        limit
      );
    }
    return merged;
  }

  function sameTimestampOrNear(leftTimestamp, rightTimestamp) {
    if ((leftTimestamp || "") === (rightTimestamp || "")) return true;
    const leftMs = toTimestampMs(leftTimestamp);
    const rightMs = toTimestampMs(rightTimestamp);
    if (leftMs == null || rightMs == null) return false;
    return Math.abs(leftMs - rightMs) <= 250;
  }

  function canCompactTimelineEventPair(left, right) {
    if (!left || !right) return false;
    if (!sameTimestampOrNear(left.timestamp, right.timestamp)) return false;
    if ((left.kind || "") !== (right.kind || "")) return false;
    if ((left.turnId || "") !== (right.turnId || "")) return false;
    if ((left.role || "") !== (right.role || "")) return false;
    if ((left.phase || "") !== (right.phase || "")) return false;
    if ((left.detail || "") !== (right.detail || "")) return false;
    if (!sameOrMissing(left.toolName, right.toolName)) return false;
    if (!sameOrMissing(left.commandSource, right.commandSource)) return false;
    if (!sameOrMissing(left.command, right.command)) return false;
    if (!sameArrayOrMissing(left.commandTypes, right.commandTypes)) return false;
    if (!samePathRolesOrMissing(left.pathRoles, right.pathRoles)) return false;
    if (!sameArrayOrMissing(left.commandPaths, right.commandPaths)) return false;
    if (!sameArrayOrMissing(left.commandPathPatterns, right.commandPathPatterns)) return false;
    if (!sameArrayOrMissing(left.commandQueries, right.commandQueries)) return false;
    if (!sameOrMissing(left.query, right.query)) return false;
    if (!sameArrayOrMissing(left.queries, right.queries)) return false;
    if (!sameArrayOrMissing(left.filesTouched, right.filesTouched)) return false;
    if (!sameOrMissing(String(left.exitCode ?? ""), String(right.exitCode ?? ""))) return false;
    if (!sameOrMissing(String(left.statusCode ?? ""), String(right.statusCode ?? ""))) return false;
    return true;
  }

  function mergeTimelineEvents(left, right) {
    const primary = eventValueScore(left) >= eventValueScore(right) ? left : right;
    const secondary = primary === left ? right : left;
    return {
      ...secondary,
      ...primary,
      index: Math.min(left.index, right.index),
      lineNumber: Math.min(left.lineNumber, right.lineNumber),
      commandTypes: (primary.commandTypes && primary.commandTypes.length) ? primary.commandTypes : secondary.commandTypes,
      pathRoles: mergePathRoleBuckets(primary.pathRoles, secondary.pathRoles, 20),
      commandPaths: (primary.commandPaths && primary.commandPaths.length) ? primary.commandPaths : secondary.commandPaths,
      commandPathPatterns: (primary.commandPathPatterns && primary.commandPathPatterns.length) ? primary.commandPathPatterns : secondary.commandPathPatterns,
      commandQueries: (primary.commandQueries && primary.commandQueries.length) ? primary.commandQueries : secondary.commandQueries,
      queries: (primary.queries && primary.queries.length) ? primary.queries : secondary.queries,
      filesTouched: (primary.filesTouched && primary.filesTouched.length) ? primary.filesTouched : secondary.filesTouched,
      matchedFiles: mergeUniqueTextValues(primary.matchedFiles, secondary.matchedFiles, 20),
      matchedPaths: mergeUniqueTextValues(primary.matchedPaths, secondary.matchedPaths, 20),
      matchedPathPatterns: mergeUniqueTextValues(primary.matchedPathPatterns, secondary.matchedPathPatterns, 20),
      matchedCommandOps: sortCommandOpValues(mergeUniqueTextValues(primary.matchedCommandOps, secondary.matchedCommandOps, 20)),
      matchedQueries: mergeUniqueTextValues(primary.matchedQueries, secondary.matchedQueries, 20),
    };
  }

  function compactCatalogEvents(events) {
    const compacted = [];
    for (const event of events) {
      const last = compacted[compacted.length - 1];
      if (last && canCompactTimelineEventPair(last, event)) {
        compacted[compacted.length - 1] = mergeTimelineEvents(last, event);
        continue;
      }
      compacted.push(event);
    }
    return compacted;
  }

  function buildTranscriptItem(record, lineNumber, index, resolvedTurnId = null, resolvedCwd = null, includedInFinalHistory = true) {
    const summary = summarizeCatalogEvent(record, lineNumber, index, resolvedTurnId, resolvedCwd, includedInFinalHistory);
    const base = {
      index,
      lineNumber,
      timestamp: summary.timestamp,
      turnId: summary.turnId,
      callId: summary.callId,
      type: "",
      kind: summary.kind,
      lifecycle: summary.lifecycle,
      role: summary.role,
      phase: summary.phase,
      preview: summary.preview,
      text: "",
      detail: summary.detail,
      includedInFinalHistory: summary.includedInFinalHistory,
      toolName: summary.toolName,
      toolClass: summary.toolClass,
      toolStatus: summary.toolStatus,
      command: summary.command,
      commandSource: summary.commandSource,
      commandTypes: summary.commandTypes || [],
      commandTypeHints: summary.commandTypeHints || [],
      pathRoles: clonePathRoleBuckets(summary.pathRoles),
      pathPatternRoles: clonePathRoleBuckets(summary.pathPatternRoles),
      commandPaths: summary.commandPaths || [],
      commandPathPatterns: summary.commandPathPatterns || [],
      commandQueries: summary.commandQueries || [],
      shellCommands: summary.shellCommands || [],
      query: summary.query,
      queries: summary.queries || [],
      actionType: summary.actionType,
      success: summary.success,
      exitCode: summary.exitCode,
      errorCode: summary.errorCode,
      statusCode: summary.statusCode,
      errorRequestId: summary.errorRequestId || null,
      errorUrl: summary.errorUrl || null,
      errorCfRay: summary.errorCfRay || null,
      cwd: summary.cwd,
      filesTouched: summary.filesTouched || [],
      fileCount: summary.fileCount || 0,
      stage: "single",
    };

    switch (record.kind) {
      case "message":
        if (record.role === "user") {
          return {
            ...base,
            type: "user",
            text: summary.detail,
          };
        }
        if (record.role === "assistant") {
          return {
            ...base,
            type: record.phase === "commentary" ? "commentary" : "assistant",
            text: summary.detail,
          };
        }
        return null;
      case "reasoning":
        if (!summary.detail || summary.detail === "reasoning") return null;
        return {
          ...base,
          type: "reasoning",
          role: "assistant",
          text: summary.detail,
        };
      case "tool_call":
        return {
          ...base,
          type: "tool",
          role: "assistant",
          stage: "call",
          text: "",
        };
      case "tool_output":
        return {
          ...base,
          type: "tool",
          role: "system",
          stage: "result",
          text: summary.detail,
        };
      case "web_search":
        return {
          ...base,
          type: "tool",
          role: "assistant",
          toolName: summary.toolName || "web_search",
          stage: record.key === "event_msg:web_search_end" ? "result" : "call",
          text: summary.detail,
        };
      case "patch":
        return {
          ...base,
          type: "tool",
          role: "system",
          toolName: summary.toolName || "apply_patch",
          stage: "result",
          text: summary.detail,
        };
      case "mcp":
        return {
          ...base,
          type: "tool",
          role: "assistant",
          toolName: summary.toolName || "mcp",
          stage: "result",
          text: summary.detail,
        };
      case "error":
        return {
          ...base,
          type: "error",
          role: "system",
          text: summary.detail,
        };
      case "turn_lifecycle":
        if (record.lifecycle !== "completed" && record.lifecycle !== "aborted") return null;
        return {
          ...base,
          type: "status",
          role: "system",
          text: summary.detail,
        };
      case "history_mutation":
        return {
          ...base,
          type: "status",
          role: "system",
          text: summary.detail,
        };
      default:
        return null;
    }
  }

  function mergeTranscriptToolItem(existing, incoming) {
    return {
      ...existing,
      ...incoming,
      index: Math.min(existing.index, incoming.index),
      lineNumber: Math.min(existing.lineNumber, incoming.lineNumber),
      timestamp: existing.timestamp || incoming.timestamp,
      preview: existing.preview || incoming.preview,
      text: incoming.text || existing.text,
      detail: incoming.detail || existing.detail,
      toolName: existing.toolName || incoming.toolName,
      toolClass: existing.toolClass || incoming.toolClass,
      toolStatus: incoming.toolStatus || existing.toolStatus,
      command: existing.command || incoming.command,
      commandSource: existing.commandSource || incoming.commandSource,
      commandTypes: mergeUniqueTextValues(existing.commandTypes, incoming.commandTypes, 10),
      commandTypeHints: mergeUniqueTextValues(existing.commandTypeHints, incoming.commandTypeHints, 10),
      pathRoles: mergePathRoleBuckets(existing.pathRoles, incoming.pathRoles, 20),
      pathPatternRoles: mergePathRoleBuckets(existing.pathPatternRoles, incoming.pathPatternRoles, 20),
      commandPaths: mergeUniqueTextValues(existing.commandPaths, incoming.commandPaths, 20),
      commandPathPatterns: mergeUniqueTextValues(existing.commandPathPatterns, incoming.commandPathPatterns, 20),
      commandQueries: mergeUniqueTextValues(existing.commandQueries, incoming.commandQueries, 20),
      shellCommands: mergeUniqueTextValues(existing.shellCommands, incoming.shellCommands, 10),
      query: existing.query || incoming.query,
      queries: mergeUniqueTextValues(existing.queries, incoming.queries, 10),
      filesTouched: mergeUniqueTextValues(existing.filesTouched, incoming.filesTouched, 20),
      fileCount: Math.max(existing.fileCount || 0, incoming.fileCount || 0),
      success: incoming.success != null ? incoming.success : existing.success,
      exitCode: incoming.exitCode != null ? incoming.exitCode : existing.exitCode,
      statusCode: incoming.statusCode != null ? incoming.statusCode : existing.statusCode,
      errorCode: incoming.errorCode || existing.errorCode,
      stage: (existing.stage === "call" && incoming.stage === "result") ? "paired" : (incoming.stage || existing.stage),
    };
  }

  function canDeduplicateTranscriptMessagePair(left, right) {
    if (!left || !right) return false;
    if ((left.turnId || "") !== (right.turnId || "")) return false;
    if (!sameTimestampOrNear(left.timestamp, right.timestamp)) return false;
    if ((left.type || "") !== (right.type || "")) return false;
    if (
      (left.type || "") !== "assistant" &&
      (left.type || "") !== "commentary" &&
      (left.type || "") !== "reasoning"
    ) {
      return false;
    }
    if (!sameOrMissing(left.phase, right.phase)) return false;
    const leftText = normalizeCwdValue(left.text || left.detail || left.preview);
    const rightText = normalizeCwdValue(right.text || right.detail || right.preview);
    return Boolean(leftText && leftText === rightText);
  }

  function mergeTranscriptMemoryCitation(left, right) {
    const leftCitation = left && left.memoryCitation && typeof left.memoryCitation === "object"
      ? left.memoryCitation
      : null;
    const rightCitation = right && right.memoryCitation && typeof right.memoryCitation === "object"
      ? right.memoryCitation
      : null;
    if (!leftCitation && !rightCitation) return null;

    const entries = [];
    const seenEntries = new Set();
    const noteEntry = (entry) => {
      if (!entry || typeof entry !== "object") return;
      const key = [
        typeof entry.path === "string" ? entry.path.trim() : "",
        Number.isInteger(entry.lineStart) ? entry.lineStart : "",
        Number.isInteger(entry.lineEnd) ? entry.lineEnd : "",
        typeof entry.note === "string" ? entry.note.trim() : "",
      ].join("\u0000");
      if (seenEntries.has(key)) return;
      seenEntries.add(key);
      entries.push({
        path: typeof entry.path === "string" ? entry.path.trim() : "",
        lineStart: Number.isInteger(entry.lineStart) ? entry.lineStart : null,
        lineEnd: Number.isInteger(entry.lineEnd) ? entry.lineEnd : null,
        note: typeof entry.note === "string" ? entry.note.trim() : "",
      });
    };
    for (const entry of Array.isArray(leftCitation && leftCitation.entries) ? leftCitation.entries : []) noteEntry(entry);
    for (const entry of Array.isArray(rightCitation && rightCitation.entries) ? rightCitation.entries : []) noteEntry(entry);

    const threadIds = mergeUniqueTextValues(
      leftCitation && leftCitation.threadIds,
      rightCitation && rightCitation.threadIds,
      20
    );
    if (!entries.length && !threadIds.length) return null;
    return {
      entries,
      threadIds,
    };
  }

  function mergeTranscriptMessageItem(existing, incoming) {
    const primary = eventValueScore(existing) >= eventValueScore(incoming) ? existing : incoming;
    const secondary = primary === existing ? incoming : existing;
    const existingLine = Number.isInteger(existing.lineNumber) ? existing.lineNumber : null;
    const incomingLine = Number.isInteger(incoming.lineNumber) ? incoming.lineNumber : null;

    return {
      ...secondary,
      ...primary,
      index: Math.min(existing.index, incoming.index),
      lineNumber: existingLine == null
        ? incomingLine
        : (incomingLine == null ? existingLine : Math.min(existingLine, incomingLine)),
      timestamp: existing.timestamp || incoming.timestamp,
      preview: primary.preview || secondary.preview,
      text: primary.text || secondary.text,
      detail: primary.detail || secondary.detail,
      includedInFinalHistory: existing.includedInFinalHistory || incoming.includedInFinalHistory,
      commandTypes: mergeUniqueTextValues(existing.commandTypes, incoming.commandTypes, 10),
      pathRoles: mergePathRoleBuckets(existing.pathRoles, incoming.pathRoles, 20),
      pathPatternRoles: mergePathRoleBuckets(existing.pathPatternRoles, incoming.pathPatternRoles, 20),
      commandPaths: mergeUniqueTextValues(existing.commandPaths, incoming.commandPaths, 20),
      commandPathPatterns: mergeUniqueTextValues(existing.commandPathPatterns, incoming.commandPathPatterns, 20),
      commandQueries: mergeUniqueTextValues(existing.commandQueries, incoming.commandQueries, 20),
      queries: mergeUniqueTextValues(existing.queries, incoming.queries, 10),
      filesTouched: mergeUniqueTextValues(existing.filesTouched, incoming.filesTouched, 20),
      memoryCitation: mergeTranscriptMemoryCitation(existing, incoming),
      memoryCitationPaths: mergeUniqueTextValues(existing.memoryCitationPaths, incoming.memoryCitationPaths, 20),
    };
  }

  function appServerSecondsToIso(value) {
    if (!Number.isFinite(value)) return null;
    return new Date(Number(value) * 1000).toISOString();
  }

  function normalizeAppServerEnumValue(value) {
    if (typeof value !== "string") return "";
    return value
      .trim()
      .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
      .replace(/[\s-]+/g, "_")
      .toLowerCase();
  }

  function summarizeAppServerUserContent(content, limit = 4000) {
    if (!Array.isArray(content)) return "";

    const parts = [];
    for (const item of content) {
      if (!item || typeof item !== "object") continue;
      if (item.type === "text" && typeof item.text === "string") {
        parts.push(item.text);
        continue;
      }
      if (item.type === "localImage" && typeof item.path === "string") {
        parts.push(`[local_image] ${item.path}`);
        continue;
      }
      if (item.type === "image" && typeof item.url === "string") {
        parts.push(`[image] ${item.url}`);
        continue;
      }
      if (item.type === "skill" && typeof item.name === "string") {
        parts.push(`[skill] ${item.name}`);
        continue;
      }
      if (item.type === "mention" && typeof item.name === "string") {
        parts.push(`@${item.name}`);
        continue;
      }
    }

    return summarizeText(parts.join("\n\n"), limit);
  }

  function summarizeAppServerReasoning(item) {
    if (!item || typeof item !== "object") return "";
    const summary = Array.isArray(item.summary) ? item.summary : [];
    const content = Array.isArray(item.content) ? item.content : [];
    return summarizeText([...summary, ...content].filter(Boolean).join("\n\n"), 4000);
  }

  function summarizeAppServerContentBlocks(blocks) {
    if (!Array.isArray(blocks)) return "";
    const parts = [];
    for (const block of blocks) {
      if (!block || typeof block !== "object") continue;
      if (typeof block.text === "string" && block.text) parts.push(block.text);
      else if (typeof block.content === "string" && block.content) parts.push(block.content);
    }
    return summarizeText(parts.join("\n\n"), 4000);
  }

  function summarizeAppServerDynamicContent(items) {
    if (!Array.isArray(items)) return "";
    const parts = [];
    for (const item of items) {
      if (!item) continue;
      if (typeof item === "string") {
        parts.push(item);
        continue;
      }
      if (typeof item === "object") {
        if (typeof item.text === "string" && item.text) parts.push(item.text);
        else {
          const serialized = summarizeStructuredValue(item, 2000);
          if (serialized) parts.push(serialized);
        }
      }
    }
    return summarizeText(parts.join("\n\n"), 4000);
  }

  function normalizeAppServerMemoryCitation(value, cwd = "") {
    if (!value || typeof value !== "object") {
      return {
        memoryCitation: null,
        paths: [],
      };
    }

    const entries = [];
    const paths = [];
    for (const entry of Array.isArray(value.entries) ? value.entries : []) {
      if (!entry || typeof entry !== "object") continue;
      const pathValue = typeof entry.path === "string" ? entry.path.trim() : "";
      const lineStart = Number.isInteger(entry.lineStart) ? entry.lineStart : null;
      const lineEnd = Number.isInteger(entry.lineEnd) ? entry.lineEnd : null;
      const note = typeof entry.note === "string" ? entry.note.trim() : "";
      if (!pathValue && !note) continue;
      entries.push({
        path: pathValue,
        lineStart,
        lineEnd,
        note,
      });
      if (pathValue) {
        addUnique(paths, normalizeReferencedPath(cwd, pathValue) || pathValue, 20);
      }
    }

    const threadIds = [];
    for (const valueId of Array.isArray(value.threadIds) ? value.threadIds : []) {
      if (typeof valueId !== "string" || !valueId.trim()) continue;
      addUnique(threadIds, valueId.trim(), 20);
    }

    if (!entries.length && !threadIds.length) {
      return {
        memoryCitation: null,
        paths,
      };
    }

    return {
      memoryCitation: {
        entries,
        threadIds,
      },
      paths,
    };
  }

  function extractAppServerErrorCode(value) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (!value || typeof value !== "object") return null;
    if (Array.isArray(value)) {
      for (const item of value) {
        const code = extractAppServerErrorCode(item);
        if (code) return code;
      }
      return null;
    }
    const ignoredKeys = new Set([
      "httpStatusCode",
      "http_status_code",
      "statusCode",
      "status_code",
      "turnKind",
      "turn_kind",
      "message",
    ]);
    for (const key of Object.keys(value)) {
      if (typeof key === "string" && key.trim() && !ignoredKeys.has(key)) return key.trim();
    }
    for (const nested of Object.values(value)) {
      const code = extractAppServerErrorCode(nested);
      if (code) return code;
    }
    return null;
  }

  function extractAppServerErrorStatusCode(value, depth = 0) {
    if (depth > 6 || value == null) return null;
    if (Number.isInteger(value)) return null;
    if (Array.isArray(value)) {
      for (const item of value) {
        const statusCode = extractAppServerErrorStatusCode(item, depth + 1);
        if (statusCode != null) return statusCode;
      }
      return null;
    }
    if (typeof value !== "object") return null;
    if (Number.isInteger(value.httpStatusCode)) return value.httpStatusCode;
    if (Number.isInteger(value.http_status_code)) return value.http_status_code;
    if (Number.isInteger(value.statusCode)) return value.statusCode;
    if (Number.isInteger(value.status_code)) return value.status_code;
    for (const nested of Object.values(value)) {
      const statusCode = extractAppServerErrorStatusCode(nested, depth + 1);
      if (statusCode != null) return statusCode;
    }
    return null;
  }

  function normalizeAppServerTurnError(value) {
    if (!value || typeof value !== "object") return null;
    const message = summarizeText(typeof value.message === "string" ? value.message : "", 4000);
    const rawCodexErrorInfo = value.codexErrorInfo != null
      ? value.codexErrorInfo
      : (value.codex_error_info != null ? value.codex_error_info : null);
    const errorCode = extractAppServerErrorCode(rawCodexErrorInfo);
    const statusCode = extractAppServerErrorStatusCode(rawCodexErrorInfo);
    const additionalDetails = summarizeStructuredValue(
      value.additionalDetails != null ? value.additionalDetails : value.additional_details,
      4000
    );
    const detail = buildNormalizedErrorDetail({
      message,
      errorCode,
      statusCode,
      codexErrorInfo: rawCodexErrorInfo,
      additionalDetails,
    }, 4000);
    if (!message && !detail) return null;
    return {
      message: message || detail,
      detail: detail || message,
      errorCode,
      statusCode,
      codexErrorInfo: rawCodexErrorInfo,
      additionalDetails: additionalDetails || null,
    };
  }

  function getTranscriptItemMemoryCitationPaths(item) {
    return Array.isArray(item && item.memoryCitationPaths) ? item.memoryCitationPaths : [];
  }

  function getTranscriptItemMemoryCitationSearchValues(item) {
    const values = [];
    const citation = item && item.memoryCitation && typeof item.memoryCitation === "object"
      ? item.memoryCitation
      : null;
    if (!citation) return values;

    for (const entry of Array.isArray(citation.entries) ? citation.entries : []) {
      if (!entry || typeof entry !== "object") continue;
      if (typeof entry.path === "string" && entry.path.trim()) values.push(entry.path.trim());
      if (typeof entry.note === "string" && entry.note.trim()) values.push(entry.note.trim());
      if (Number.isInteger(entry.lineStart) || Number.isInteger(entry.lineEnd)) {
        const start = Number.isInteger(entry.lineStart) ? entry.lineStart : "?";
        const end = Number.isInteger(entry.lineEnd) ? entry.lineEnd : start;
        values.push(`${start}-${end}`);
      }
    }
    for (const pathValue of getTranscriptItemMemoryCitationPaths(item)) values.push(pathValue);
    for (const threadId of Array.isArray(citation.threadIds) ? citation.threadIds : []) {
      if (typeof threadId === "string" && threadId.trim()) values.push(threadId.trim());
    }
    return values;
  }

  return {
    buildNormalizedErrorSearchValues,
    buildNormalizedErrorDetail,
    errorEntryMatchesNeedle,
    getRecordErrorSearchValues,
    getTranscriptItemErrorSearchValues,
    summarizeCatalogEvent,
    compactCatalogEvents,
    buildTranscriptItem,
    mergeTranscriptToolItem,
    canDeduplicateTranscriptMessagePair,
    mergeTranscriptMessageItem,
    appServerSecondsToIso,
    normalizeAppServerEnumValue,
    summarizeAppServerUserContent,
    summarizeStructuredValue,
    summarizeAppServerReasoning,
    summarizeAppServerContentBlocks,
    summarizeAppServerDynamicContent,
    normalizeAppServerMemoryCitation,
    normalizeAppServerTurnError,
    getTranscriptItemMemoryCitationPaths,
    getTranscriptItemMemoryCitationSearchValues,
  };
}

module.exports = { createCatalogTimelineHelpers };
