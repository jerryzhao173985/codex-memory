"use strict";

const {
  buildAppServerThreadView,
  buildHistoryViewSource,
} = require("./catalog");
const { prefixedSessionId } = require("./history-session-id");
const { normalizeSessionSource } = require("./history-session-source");
const { summarizeText } = require("./parser");

function appServerSecondsToIso(value) {
  if (!Number.isFinite(value)) return null;
  const millis = Math.trunc(Number(value) * 1000);
  const date = new Date(millis);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizeBridgeStatus(status) {
  const type = status && typeof status.type === "string" && status.type.trim()
    ? status.type.trim()
    : "unknown";
  const activeFlags = Array.isArray(status && status.activeFlags)
    ? status.activeFlags.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim())
    : [];
  return {
    type,
    activeFlags,
    label: type === "active" && activeFlags.length
      ? `${type}(${activeFlags.join(",")})`
      : type,
  };
}

const normalizeBridgeSessionSource = normalizeSessionSource;

function normalizeBridgeThread(thread) {
  if (!thread || typeof thread !== "object") return null;

  const turns = Array.isArray(thread.turns) ? thread.turns : [];
  const itemTypes = new Set();
  const turnStatusCounts = Object.create(null);

  for (const turn of turns) {
    if (!turn || typeof turn !== "object") continue;
    const turnStatus = typeof turn.status === "string" && turn.status ? turn.status : "unknown";
    turnStatusCounts[turnStatus] = (turnStatusCounts[turnStatus] || 0) + 1;
    for (const item of Array.isArray(turn.items) ? turn.items : []) {
      if (!item || typeof item !== "object") continue;
      if (typeof item.type === "string" && item.type) itemTypes.add(item.type);
    }
  }

  const gitInfo = thread.gitInfo && typeof thread.gitInfo === "object"
    ? {
      sha: typeof thread.gitInfo.sha === "string" ? thread.gitInfo.sha : null,
      branch: typeof thread.gitInfo.branch === "string" ? thread.gitInfo.branch : null,
      originUrl: typeof thread.gitInfo.originUrl === "string" ? thread.gitInfo.originUrl : null,
    }
    : null;
  const sourceInfo = normalizeBridgeSessionSource(thread.source);

  return {
    threadId: typeof thread.id === "string" ? thread.id : "",
    sessionId: prefixedSessionId(thread.id) || "",
    forkedFromId: prefixedSessionId(thread.forkedFromId) || null,
    preview: typeof thread.preview === "string" ? thread.preview : "",
    previewShort: summarizeText(thread.preview, 240),
    ephemeral: thread.ephemeral === true,
    modelProvider: typeof thread.modelProvider === "string" ? thread.modelProvider : null,
    createdAt: appServerSecondsToIso(thread.createdAt),
    updatedAt: appServerSecondsToIso(thread.updatedAt),
    status: normalizeBridgeStatus(thread.status),
    path: typeof thread.path === "string" ? thread.path : null,
    cwd: typeof thread.cwd === "string" ? thread.cwd : "",
    cliVersion: typeof thread.cliVersion === "string" ? thread.cliVersion : null,
    source: sourceInfo.source,
    sourceKind: sourceInfo.sourceKind,
    sourceDetail: sourceInfo.sourceDetail,
    agentNickname: typeof thread.agentNickname === "string" ? thread.agentNickname : null,
    agentRole: typeof thread.agentRole === "string" ? thread.agentRole : null,
    gitInfo,
    name: typeof thread.name === "string" && thread.name.trim() ? thread.name.trim() : null,
    turnCount: turns.length,
    itemTypes: Array.from(itemTypes),
    turnStatusCounts,
  };
}

function normalizeBridgeThreadLifecycleResult(result) {
  if (!result || typeof result !== "object") return null;
  return {
    threadId: typeof result.threadId === "string" ? result.threadId : "",
    sessionId: prefixedSessionId(result.sessionId || result.threadId) || "",
    archived: result.archived === true,
  };
}

function normalizeBridgeThreadMemoryMode(value) {
  const text = typeof value === "string" ? value.trim().toLowerCase() : "";
  return text === "enabled" || text === "disabled" ? text : null;
}

function normalizeBridgeThreadMemoryModeResult(result) {
  if (!result || typeof result !== "object") return null;
  return {
    threadId: typeof result.threadId === "string" ? result.threadId : "",
    sessionId: prefixedSessionId(result.sessionId || result.threadId) || "",
    memoryMode: normalizeBridgeThreadMemoryMode(result.memoryMode),
  };
}

function normalizeBridgeListResponse(response) {
  const threads = Array.isArray(response && response.data)
    ? response.data.map(normalizeBridgeThread).filter(Boolean)
    : [];
  return {
    total: threads.length,
    nextCursor: response && typeof response.nextCursor === "string" ? response.nextCursor : null,
    threads,
  };
}

function normalizeBridgeLoadedResponse(response) {
  const threads = Array.isArray(response && response.data)
    ? response.data
      .filter((item) => typeof item === "string" && item.trim())
      .map((item) => ({
        threadId: item,
        sessionId: prefixedSessionId(item) || "",
      }))
    : [];
  return {
    total: threads.length,
    nextCursor: response && typeof response.nextCursor === "string" ? response.nextCursor : null,
    threads,
  };
}

function buildBridgeOperationSource() {
  return buildHistoryViewSource("app_server", "app_server", {
    selectionReason: "app_server_only_operation",
  });
}

function attachBridgeOperationSource(result) {
  if (!result || typeof result !== "object") return null;
  return {
    ...result,
    source: buildBridgeOperationSource(),
  };
}

function buildBridgeThreadViewResult(thread) {
  const normalizedThread = normalizeBridgeThread(thread);
  if (!normalizedThread) return null;
  return attachBridgeOperationSource({
    thread: normalizedThread,
  });
}

function buildBridgeThreadSessionView(thread, fallbackSession = null) {
  return buildAppServerThreadView(thread, fallbackSession);
}

module.exports = {
  attachBridgeOperationSource,
  normalizeBridgeListResponse,
  normalizeBridgeLoadedResponse,
  normalizeBridgeThreadLifecycleResult,
  normalizeBridgeThreadMemoryModeResult,
  buildBridgeOperationSource,
  buildBridgeThreadViewResult,
  buildBridgeThreadSessionView,
  normalizeBridgeSessionSource,
  normalizeBridgeThread,
};
